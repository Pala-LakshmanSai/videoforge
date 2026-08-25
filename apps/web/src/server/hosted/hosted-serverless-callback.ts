import {
  type ProvenanceReceiptSigner,
  type SqlExecutor,
  type SqlPrimitive,
  type TransactionalSqlExecutor,
} from "@videoforge/control-plane";

import {
  createHostedServerlessOutputBarrier,
  HostedOutputBarrierError,
  type HostedOutputBarrierOutcome,
  type HostedServerlessAttemptBinding,
} from "../runtime/hosted-serverless-output-barrier";
import {
  HostedR2OutputArtifactBarrier,
  HostedSqlOutputBarrierRepository,
} from "../runtime/hosted-serverless-output-adapters";
import type { HostedR2BucketBinding } from "./configuration";
import {
  materializeHostedRenderPlan,
  type HostedRenderPlanDatabase,
  type HostedRenderPlanMaterializationInput,
  type HostedRenderPlanMaterializationResult,
  type HostedRenderPlanSql,
} from "./render-plan-materialization";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_CALLBACK_BYTES = 4 * 1024 * 1024;
const HOSTED_RENDER_PLAN_APPEND_FUNCTION_NAME = "videoforge_append_hosted_render_plan";

export interface HostedAuthenticatedTenantScope {
  readonly accountId: string;
  readonly workspaceId: string;
}

export interface HostedServerlessCallbackLoaders {
  loadAttemptBinding(
    scope: HostedAuthenticatedTenantScope,
    attemptId: string,
  ): Promise<HostedServerlessAttemptBinding | null>;
  /**
   * Return null until every timeline-required lane output and immutable input/manifest artifact is
   * complete. The materializer independently revalidates the exact set and all document lineage.
   */
  loadReadyRenderPlan(
    scope: HostedAuthenticatedTenantScope,
    binding: HostedServerlessAttemptBinding,
  ): Promise<HostedRenderPlanMaterializationInput | null>;
}

export interface HostedServerlessCallbackResult {
  readonly barrier: HostedOutputBarrierOutcome;
  readonly renderPlan: HostedRenderPlanMaterializationResult | null;
}

export class HostedServerlessCallbackError extends Error {
  constructor(
    readonly code:
      | "HOSTED_SERVERLESS_CALLBACK_MALFORMED"
      | "HOSTED_SERVERLESS_CALLBACK_FOREIGN"
      | "HOSTED_SERVERLESS_CALLBACK_UNAUTHENTICATED"
      | "HOSTED_SERVERLESS_CALLBACK_SCHEMA_MISSING"
      | "HOSTED_SERVERLESS_CALLBACK_DISABLED_UNQUALIFIED",
  ) {
    super(code);
    this.name = "HostedServerlessCallbackError";
  }
}

/**
 * Converts the materializer's one exact INSERT into the migration-owned append capability. Every
 * other query, including the tenant principal binding and exact replay read, remains unchanged.
 */
export class HostedRenderPlanAppendDatabase implements HostedRenderPlanDatabase {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  transaction<Value>(work: (transaction: HostedRenderPlanSql) => Promise<Value>): Promise<Value> {
    return this.database.transaction((transaction) =>
      work({
        query: <Row extends Record<string, unknown>>(
          sql: string,
          parameters: readonly (boolean | number | string | null)[] = [],
        ) => this.#query<Row>(transaction, sql, parameters),
      }),
    );
  }

  async #query<Row extends Record<string, unknown>>(
    transaction: SqlExecutor,
    sql: string,
    parameters: readonly (boolean | number | string | null)[],
  ): Promise<{ readonly rows: readonly Row[]; readonly affectedRows: number }> {
    if (!/^\s*INSERT INTO hosted_render_plans\s*\(/u.test(sql)) {
      return transaction.query<Row>(sql, parameters as readonly SqlPrimitive[]);
    }
    if (parameters.length !== 6 || parameters.some((value) => typeof value !== "string")) {
      throw new HostedServerlessCallbackError("HOSTED_SERVERLESS_CALLBACK_MALFORMED");
    }
    const [accountId, workspaceId, projectId, revisionId, payload, payloadSha256] = parameters as
      | readonly [string, string, string, string, string, string]
      | never;
    const result = await transaction.query<
      { readonly inserted: boolean } & Record<string, unknown>
    >(
      `SELECT inserted
         FROM public.${HOSTED_RENDER_PLAN_APPEND_FUNCTION_NAME}(
           $1, $2, $3, $4, 'videoforge-hosted-cpu-submission/v1', $5::jsonb, $6
         )`,
      [accountId, workspaceId, projectId, revisionId, payload, payloadSha256],
    );
    if (result.rows.length !== 1 || typeof result.rows[0]!.inserted !== "boolean") {
      throw new HostedServerlessCallbackError("HOSTED_SERVERLESS_CALLBACK_SCHEMA_MISSING");
    }
    return { rows: [] as readonly Row[], affectedRows: result.rows[0]!.inserted ? 1 : 0 };
  }
}

/**
 * Provider-neutral ordinary-output callback composition. It has no dispatch, admission, provider,
 * endpoint, deployment-publication, credential-reading, or qualification mutation capability.
 */
export function createHostedServerlessCallback(input: {
  readonly database: TransactionalSqlExecutor;
  readonly bucket: HostedR2BucketBinding;
  readonly signer: ProvenanceReceiptSigner;
  readonly loaders: HostedServerlessCallbackLoaders;
}) {
  async function acceptBound(
    binding: HostedServerlessAttemptBinding,
    callbackValue: unknown,
  ): Promise<HostedServerlessCallbackResult> {
    const scope = Object.freeze({
      accountId: binding.accountId,
      workspaceId: binding.workspaceId,
    });
    if (
      !UUID.test(scope.accountId) ||
      !UUID.test(scope.workspaceId) ||
      !UUID.test(binding.attemptId)
    ) {
      throw new HostedServerlessCallbackError("HOSTED_SERVERLESS_CALLBACK_MALFORMED");
    }
    const repository = new HostedSqlOutputBarrierRepository(input.database, scope);
    if (!(await repository.schemaReady())) {
      throw new HostedServerlessCallbackError("HOSTED_SERVERLESS_CALLBACK_SCHEMA_MISSING");
    }
    const barrier = createHostedServerlessOutputBarrier({
      signer: input.signer,
      artifacts: new HostedR2OutputArtifactBarrier(input.database, input.bucket),
      repository,
    });
    const outcome = await barrier.accept(binding, callbackValue);
    const ready = await input.loaders.loadReadyRenderPlan(scope, binding);
    if (!ready) return Object.freeze({ barrier: outcome, renderPlan: null });
    if (
      ready.accountId !== scope.accountId ||
      ready.workspaceId !== scope.workspaceId ||
      ready.revision.projectId !== binding.projectId ||
      ready.revision.projectRevisionId !== binding.projectRevisionId
    ) {
      throw new HostedServerlessCallbackError("HOSTED_SERVERLESS_CALLBACK_FOREIGN");
    }
    const renderPlan = await materializeHostedRenderPlan(
      new HostedRenderPlanAppendDatabase(input.database),
      ready,
    );
    return Object.freeze({ barrier: outcome, renderPlan });
  }
  return Object.freeze({
    acceptBound,
    async accept(
      scope: HostedAuthenticatedTenantScope,
      attemptId: string,
      callbackValue: unknown,
    ): Promise<HostedServerlessCallbackResult> {
      if (!UUID.test(scope.accountId) || !UUID.test(scope.workspaceId) || !UUID.test(attemptId)) {
        throw new HostedServerlessCallbackError("HOSTED_SERVERLESS_CALLBACK_MALFORMED");
      }
      const binding = await input.loaders.loadAttemptBinding(scope, attemptId);
      if (
        !binding ||
        binding.attemptId !== attemptId ||
        binding.accountId !== scope.accountId ||
        binding.workspaceId !== scope.workspaceId
      ) {
        throw new HostedServerlessCallbackError("HOSTED_SERVERLESS_CALLBACK_FOREIGN");
      }
      return acceptBound(binding, callbackValue);
    },
  });
}

function callbackJson(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-videoforge-runtime": "hosted-v2-09",
    },
  });
}

export async function parseHostedServerlessCallbackRequest(request: Request): Promise<unknown> {
  if (request.method !== "POST" || request.headers.get("content-type") !== "application/json") {
    throw new HostedServerlessCallbackError("HOSTED_SERVERLESS_CALLBACK_MALFORMED");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    !Number.isSafeInteger(declaredLength) ||
    declaredLength < 1 ||
    declaredLength > MAX_CALLBACK_BYTES
  ) {
    throw new HostedServerlessCallbackError("HOSTED_SERVERLESS_CALLBACK_MALFORMED");
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength !== declaredLength || bytes.byteLength > MAX_CALLBACK_BYTES) {
    throw new HostedServerlessCallbackError("HOSTED_SERVERLESS_CALLBACK_MALFORMED");
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    ) as unknown;
  } catch {
    throw new HostedServerlessCallbackError("HOSTED_SERVERLESS_CALLBACK_MALFORMED");
  }
}

/** Current hosted route: authenticate first, then expose the truthful no-signer/no-qualified-lane state. */
export function hostedServerlessCallbackDisabledResponse(): Response {
  return callbackJson(
    {
      error: {
        code: "HOSTED_SERVERLESS_CALLBACK_DISABLED_UNQUALIFIED",
        retryable: false,
      },
    },
    503,
  );
}

export function hostedServerlessCallbackErrorResponse(error: unknown): Response {
  if (error instanceof HostedOutputBarrierError) {
    const status = error.code === "HOSTED_OUTPUT_FOREIGN" ? 403 : 409;
    return callbackJson({ error: { code: error.code, retryable: false } }, status);
  }
  if (error instanceof HostedServerlessCallbackError) {
    const status =
      error.code === "HOSTED_SERVERLESS_CALLBACK_UNAUTHENTICATED"
        ? 401
        : error.code === "HOSTED_SERVERLESS_CALLBACK_FOREIGN"
          ? 403
          : error.code === "HOSTED_SERVERLESS_CALLBACK_MALFORMED"
            ? 400
            : 503;
    return callbackJson({ error: { code: error.code, retryable: false } }, status);
  }
  return callbackJson(
    { error: { code: "HOSTED_SERVERLESS_CALLBACK_REJECTED", retryable: false } },
    503,
  );
}

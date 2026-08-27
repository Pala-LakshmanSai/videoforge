import { canonicalSha256, type Sha256 } from "@videoforge/control-plane";

import { createHostedAuth, type HostedExecutionContext } from "./auth";
import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import { createNeonExecutor, createNeonPool } from "./neon";

const PATH = "/api/v2/hosted/v213/materialization-selection";
const MAX_BODY_BYTES = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const ROLES = new Set(["primary", "sameAccountWaiter", "secondary", "fairnessProbe"]);
const IDENTITY_KEYS = Object.freeze(["accountId", "workspaceId", "projectId", "projectRevisionId"]);

type SelectionRole = "primary" | "sameAccountWaiter" | "secondary" | "fairnessProbe";

interface SelectionIdentity {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
}

interface SelectionRequest {
  readonly challengeId: string;
  readonly challengeSha256: Sha256;
  readonly role: SelectionRole;
  readonly identity: SelectionIdentity;
}

interface SelectionResult {
  readonly state: "PENDING" | "READY";
  readonly selectionSha256: Sha256 | null;
}

interface ChallengeResult {
  readonly challengeId: string;
  readonly challengeSha256: Sha256;
  readonly role: SelectionRole;
}

export interface V213PostConsumptionSelectionDependencies {
  readonly session: () => Promise<{ readonly user?: { readonly id?: string } } | null>;
  readonly challenge?: () => Promise<unknown>;
  readonly submit: (
    value: SelectionRequest & {
      readonly accountId: string;
      readonly workspaceId: string;
      readonly selectedByUserId: string;
    },
  ) => Promise<unknown>;
  readonly close: () => Promise<void>;
}

function response(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function parse(value: unknown): SelectionRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const identity = item.identity;
  if (
    !exactKeys(item, ["challengeId", "challengeSha256", "identity", "role"]) ||
    typeof item.challengeId !== "string" ||
    !UUID.test(item.challengeId) ||
    typeof item.challengeSha256 !== "string" ||
    !HASH.test(item.challengeSha256) ||
    typeof item.role !== "string" ||
    !ROLES.has(item.role) ||
    !identity ||
    typeof identity !== "object" ||
    Array.isArray(identity) ||
    !exactKeys(identity as Record<string, unknown>, IDENTITY_KEYS) ||
    IDENTITY_KEYS.some((key) => !UUID.test((identity as Record<string, unknown>)[key] as string))
  )
    return null;
  return {
    challengeId: item.challengeId,
    challengeSha256: item.challengeSha256 as Sha256,
    role: item.role as SelectionRole,
    identity: identity as SelectionIdentity,
  };
}

function sameOrigin(request: Request, config: HostedRuntimeConfiguration): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(config.publicOrigin).origin;
}

function exactResult(value: unknown): SelectionResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (
    !exactKeys(result, ["selectionSha256", "state"]) ||
    (result.state !== "PENDING" && result.state !== "READY") ||
    (result.selectionSha256 !== null &&
      (typeof result.selectionSha256 !== "string" || !HASH.test(result.selectionSha256)))
  )
    return null;
  return result as unknown as SelectionResult;
}

function exactChallenge(value: unknown): ChallengeResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (
    !exactKeys(result, ["challengeId", "challengeSha256", "role"]) ||
    typeof result.challengeId !== "string" ||
    !UUID.test(result.challengeId) ||
    typeof result.challengeSha256 !== "string" ||
    !HASH.test(result.challengeSha256) ||
    (result.role !== "primary" &&
      result.role !== "sameAccountWaiter" &&
      result.role !== "secondary" &&
      result.role !== "fairnessProbe")
  )
    return null;
  return result as unknown as ChallengeResult;
}

export async function handleV213PostConsumptionSelectionRequest(
  request: Request,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
  injected?: V213PostConsumptionSelectionDependencies,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== PATH) return null;
  if (request.method !== "POST" && request.method !== "GET")
    return response({ error: { code: "NOT_FOUND" } }, 404);
  if (config.environment !== "production" || config.gpuTransport !== "QUALIFIED_EXACT")
    return response({ error: { code: "V213_MATERIALIZATION_DISABLED" } }, 503);
  if (request.method === "POST" && !sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  let parsed: SelectionRequest | null = null;
  if (request.method === "POST") {
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 1 ||
      declaredLength > MAX_BODY_BYTES ||
      request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
    )
      return response({ error: { code: "V213_MATERIALIZATION_REQUEST_INVALID" } }, 400);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength !== declaredLength)
      return response({ error: { code: "V213_MATERIALIZATION_REQUEST_INVALID" } }, 400);
    try {
      parsed = parse(JSON.parse(raw));
    } catch {
      parsed = null;
    }
    if (!parsed) return response({ error: { code: "V213_MATERIALIZATION_REQUEST_INVALID" } }, 400);
  }

  const pool = injected ? null : createNeonPool(config.neon.databaseUrl);
  let dependencies = injected;
  if (!dependencies && pool) {
    const session = await createHostedAuth({ config, pool, executionContext }).api.getSession({
      headers: request.headers,
    });
    const userId = session?.user?.id;
    if (typeof userId !== "string" || userId.length === 0) {
      await pool.end();
      return response({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    }
    const sessionToken = session?.session?.token;
    if (typeof sessionToken !== "string" || sessionToken.length === 0) {
      await pool.end();
      return response({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    }
    const scope = await pool.query<{ account_id: string; workspace_id: string }>(
      "SELECT account_id, workspace_id FROM videoforge_hosted_session_scope($1)",
      [sessionToken],
    );
    const accountId = scope.rows[0]?.account_id;
    const workspaceId = scope.rows[0]?.workspace_id;
    if (!UUID.test(accountId ?? "") || !UUID.test(workspaceId ?? "")) {
      await pool.end();
      return response({ error: { code: "INVITE_ADMISSION_REQUIRED" } }, 403);
    }
    const scopedAccountId = accountId as string;
    const scopedWorkspaceId = workspaceId as string;
    if (
      request.method === "POST" &&
      (parsed!.identity.accountId !== scopedAccountId ||
        parsed!.identity.workspaceId !== scopedWorkspaceId)
    ) {
      await pool.end();
      return response({ error: { code: "V213_MATERIALIZATION_SCOPE_MISMATCH" } }, 403);
    }
    const executor = createNeonExecutor(pool);
    dependencies = {
      session: async () => ({ user: { id: userId } }),
      challenge: async () =>
        executor.transaction(async (transaction) => {
          await transaction.query("SELECT set_config($1,$2,true)", [
            "videoforge.account_id",
            scopedAccountId,
          ]);
          const result = await transaction.query<{ value: unknown }>(
            "SELECT public.videoforge_load_v213_materialization_challenge($1::uuid,$2::uuid) AS value",
            [scopedAccountId, scopedWorkspaceId],
          );
          if (result.rows.length !== 1) throw new Error("V213_MATERIALIZATION_CHALLENGE_INVALID");
          return result.rows[0]?.value;
        }),
      submit: async (value) =>
        executor.transaction(async (transaction) => {
          await transaction.query("SELECT set_config($1,$2,true)", [
            "videoforge.account_id",
            scopedAccountId,
          ]);
          const result = await transaction.query<{ value: unknown }>(
            "SELECT public.videoforge_submit_v213_materialization_selection($1::jsonb) AS value",
            [JSON.stringify(value)],
          );
          if (result.rows.length !== 1) throw new Error("V213_MATERIALIZATION_RESULT_INVALID");
          return result.rows[0]?.value;
        }),
      close: () => pool.end(),
    };
  }
  if (!dependencies) return response({ error: { code: "V213_MATERIALIZATION_DISABLED" } }, 503);
  try {
    const session = await dependencies.session();
    const userId = session?.user?.id;
    if (typeof userId !== "string" || userId.length === 0)
      return response({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    if (request.method === "GET") {
      if (typeof dependencies.challenge !== "function")
        return response({ error: { code: "V213_MATERIALIZATION_DISABLED" } }, 503);
      const challenge = exactChallenge(await dependencies.challenge());
      if (!challenge)
        return response({ error: { code: "V213_MATERIALIZATION_CHALLENGE_UNAVAILABLE" } }, 404);
      return response({
        schemaVersion: "videoforge.v213-post-consumption-challenge/v1",
        challengeId: challenge.challengeId,
        challengeSha256: challenge.challengeSha256,
        role: challenge.role,
      });
    }
    if (!parsed) return response({ error: { code: "V213_MATERIALIZATION_REQUEST_INVALID" } }, 400);
    const value = await dependencies.submit({
      ...parsed,
      accountId: parsed.identity.accountId,
      workspaceId: parsed.identity.workspaceId,
      selectedByUserId: userId,
    });
    const result = exactResult(value);
    if (!result) return response({ error: { code: "V213_MATERIALIZATION_RESULT_INVALID" } }, 409);
    return response(
      {
        schemaVersion: "videoforge.v213-post-consumption-selection/v1",
        state: result.state,
        selectionSha256: result.selectionSha256,
      },
      result.state === "READY" ? 200 : 202,
    );
  } catch {
    return response({ error: { code: "V213_MATERIALIZATION_SELECTION_REJECTED" } }, 409);
  } finally {
    await dependencies.close();
  }
}

export { PATH as V213_POST_CONSUMPTION_SELECTION_PATH, canonicalSha256 };

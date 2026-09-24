import type { SqlExecutor, TransactionalSqlExecutor } from "@videoforge/control-plane";
import type { JsonValue } from "@videoforge/contracts";

import type { HostedExecutionContext } from "./auth";
import type {
  HostedNeonPool,
  HostedRuntimeConfiguration,
  HostedRuntimeEnvironment,
} from "./configuration";
import {
  commitAndScheduleV209OrdinaryPair,
  ensureHostedPairWorkflow,
  materializeAndEnsureV209OrdinaryPair,
  observeV209ShortAdmission,
} from "./hosted-pair-live-wiring";
import { createNeonExecutor, createNeonPool } from "./neon";
import { response, sameOrigin, sessionScope } from "./hosted-product-route-common";
import { ensureHostedApiGenerationWorkflow } from "./hosted-api-generation";
import { buildKieScenePrompt } from "../providers/kie-image-job";
import {
  ensureHostedV209GenerationAdmission,
  type HostedV209AdmissionResult,
} from "./hosted-v209-queue-admission";
import {
  assertV209OrdinaryCandidate,
  freezeV209OrdinaryLiveAdmission,
  type V209OrdinaryVerifiedSystemAvatarReference,
} from "../runtime/v209-ordinary-live-cost";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DATABASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SYSTEM_AVATAR_OBJECT_KEY =
  /^tenant\/ffffffff-ffff-4fff-8fff-000000000001\/workspace\/ffffffff-ffff-4fff-8fff-000000000011\/avatar-profile\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/version\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/canonical\/avatar\.(?:png|jpg)$/u;
const PATH = /^\/api\/v2\/hosted\/projects\/([0-9a-f-]+)\/gpu-dispatch$/u;
const HOSTED_V209_PRE_SEND_INTEGRITY_CODE = "V209_ORDINARY_CANDIDATE_HASH_INVALID";
const HOSTED_V209_PRE_SEND_INTEGRITY_MESSAGE =
  "Generation has not started. Prepared generation data failed validation.";

type DispatchIdentity = {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly projectId: string;
};

interface MaterializedDispatchCandidate {
  readonly candidate: unknown;
  readonly databaseCanonicalJson?: string;
  readonly systemAvatarReference: V209OrdinaryVerifiedSystemAvatarReference | null;
}

type ExistingPairProbe = (
  database: TransactionalSqlExecutor,
  identity: Pick<DispatchIdentity, "accountId" | "workspaceId">,
  generationRequestId: string,
) => Promise<boolean>;

type Candidate = Record<string, unknown> & {
  readonly schemaVersion: "videoforge.hosted-v209-ordinary-dispatch/v1";
  readonly candidateSha256: string;
  readonly replayed: boolean;
  readonly pairExists: boolean;
  readonly existingWorkflowId: string | null;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly generationRequestId: string;
  readonly generationPlanSha256: string;
  readonly leaseId: string;
  readonly approvalId: string;
  readonly approvalSha256: string;
  readonly expiresAt: string;
  readonly totalCapUsd: number;
  readonly laneBindings: JsonValue;
  readonly pair: JsonValue;
  readonly workManifestSha256: string;
  readonly work: JsonValue;
  readonly avatarSourceInputReservationId: string;
};

type ApiJob = {
  readonly generationTaskId: string;
  readonly lane: "IMAGE" | "AVATAR";
  readonly state: string;
  readonly inputManifest: Record<string, unknown>;
};

function apiJobs(value: unknown, generationRequestId: string): readonly ApiJob[] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("HOSTED_API_JOBS_INVALID");
  const result = value as Record<string, unknown>;
  if (result.generationRequestId !== generationRequestId || !Array.isArray(result.jobs))
    throw new Error("HOSTED_API_JOBS_INVALID");
  return result.jobs.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("HOSTED_API_JOBS_INVALID");
    const job = raw as Record<string, unknown>;
    if (
      typeof job.generationTaskId !== "string" ||
      !DATABASE_UUID.test(job.generationTaskId) ||
      (job.lane !== "IMAGE" && job.lane !== "AVATAR") ||
      typeof job.state !== "string" ||
      !job.inputManifest ||
      typeof job.inputManifest !== "object" ||
      Array.isArray(job.inputManifest)
    )
      throw new Error("HOSTED_API_JOBS_INVALID");
    return {
      generationTaskId: job.generationTaskId,
      lane: job.lane,
      state: job.state,
      inputManifest: job.inputManifest as Record<string, unknown>,
    };
  });
}

async function readApiJobs(
  database: TransactionalSqlExecutor,
  identity: DispatchIdentity,
  generationRequestId: string,
): Promise<readonly ApiJob[]> {
  return database.transaction(async (transaction) => {
    await transaction.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", identity.accountId]);
    const result = await transaction.query<{ jobs: unknown }>(
      "SELECT public.videoforge_read_hosted_api_jobs($1::uuid,$2::uuid,$3::uuid) AS jobs",
      [identity.accountId, identity.workspaceId, generationRequestId],
    );
    return apiJobs(result.rows[0]?.jobs, generationRequestId);
  });
}

async function resumeHostedApiDispatch(
  environment: HostedRuntimeEnvironment,
  database: TransactionalSqlExecutor,
  identity: DispatchIdentity,
  correlationId: string,
): Promise<Response> {
  const admission = await ensureHostedV209GenerationAdmission(database, identity);
  if (admission.state === "WAITING") return preparationResponse("WAITING", correlationId);
  let jobs = await readApiJobs(database, identity, admission.generationRequestId);
  if (jobs.length === 0) {
    const materialized = await database.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", identity.accountId]);
      const result = await transaction.query<{ jobs: unknown }>(
        "SELECT public.videoforge_materialize_hosted_api_jobs($1::uuid,$2::uuid,$3::uuid,$4::uuid) AS jobs",
        [identity.accountId, identity.workspaceId, identity.userId, identity.projectId],
      );
      return result.rows[0]?.jobs;
    });
    jobs = apiJobs(materialized, admission.generationRequestId);
  }
  for (const job of jobs) {
    if (job.lane !== "IMAGE" || job.state !== "PREPARED") continue;
    const prompt = buildKieScenePrompt(
      job.inputManifest.compiledPrompt as Parameters<typeof buildKieScenePrompt>[0],
    );
    await database.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", identity.accountId]);
      await transaction.query(
        "SELECT public.videoforge_bind_hosted_api_image_prompt($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text)",
        [identity.accountId, identity.workspaceId, admission.generationRequestId,
          job.generationTaskId, prompt],
      );
    });
  }
  const scheduled = await ensureHostedApiGenerationWorkflow(environment, database, {
    accountId: identity.accountId,
    workspaceId: identity.workspaceId,
    generationRequestId: admission.generationRequestId,
  });
  console.info("hosted_v209_project_dispatch", {
    correlation_id: correlationId,
    event: scheduled.recovered ? "API_WORKFLOW_RECOVERED" : "API_WORKFLOW_SCHEDULED",
  });
  const result = response({
    schema_version: "videoforge-hosted-v209-project-dispatch/v1",
    state: "SCHEDULED",
    generation_request_id: admission.generationRequestId,
    workflow_id: scheduled.id,
    correlation_id: correlationId,
  }, scheduled.recovered ? 200 : 202);
  const headers = new Headers(result.headers);
  headers.set("x-videoforge-correlation-id", correlationId);
  return new Response(result.body, { status: result.status, headers });
}

export interface HostedV209ProjectDispatchDependencies {
  readonly createPool: (databaseUrl: string) => HostedNeonPool;
  readonly createExecutor: (pool: HostedNeonPool) => TransactionalSqlExecutor;
  readonly scope: typeof sessionScope;
  readonly materialize: (
    database: TransactionalSqlExecutor,
    identity: DispatchIdentity,
  ) => Promise<MaterializedDispatchCandidate>;
  readonly observe: typeof observeV209ShortAdmission;
  readonly commitAndSchedule: typeof commitAndScheduleV209OrdinaryPair;
  readonly ensureWorkflow: typeof materializeAndEnsureV209OrdinaryPair;
  readonly ensureAdmission: (
    database: TransactionalSqlExecutor,
    identity: DispatchIdentity,
  ) => Promise<HostedV209AdmissionResult>;
  readonly hasExistingPair?: ExistingPairProbe;
  readonly findExistingGeneration?: (
    database: TransactionalSqlExecutor,
    identity: DispatchIdentity,
  ) => Promise<string | null>;
  readonly ensureExistingWorkflow?: HostedV209ProjectDispatchDependencies["ensureWorkflow"];
  readonly correlationId: () => string;
}

const hasExistingHostedV209Pair: ExistingPairProbe = async (
  database,
  identity,
  generationRequestId,
) =>
  database.transaction(async (transaction) => {
    await transaction.query("SELECT set_config($1,$2,true)", [
      "videoforge.account_id",
      identity.accountId,
    ]);
    const result = await transaction.query<{ existing_pair: unknown }>(
      `SELECT existing_pair
         FROM public.videoforge_load_hosted_pair_workflow_schedule(
           $1::uuid,$2::uuid,$3::uuid)`,
      [identity.accountId, identity.workspaceId, generationRequestId],
    );
    const row = result.rows[0];
    if (result.rows.length !== 1 || !row || typeof row.existing_pair !== "boolean") {
      throw new Error("HOSTED_PAIR_WORKFLOW_STATE_INVALID");
    }
    return row.existing_pair;
  });

export const defaults: HostedV209ProjectDispatchDependencies = Object.freeze({
  createPool: createNeonPool,
  createExecutor: createNeonExecutor,
  scope: sessionScope,
  materialize: materializeHostedV209OrdinaryDispatchCandidate,
  observe: observeV209ShortAdmission,
  commitAndSchedule: commitAndScheduleV209OrdinaryPair,
  ensureWorkflow: materializeAndEnsureV209OrdinaryPair,
  ensureAdmission: ensureHostedV209GenerationAdmission,
  hasExistingPair: hasExistingHostedV209Pair,
  ensureExistingWorkflow: ensureHostedPairWorkflow,
  findExistingGeneration: (database: TransactionalSqlExecutor, identity: DispatchIdentity) =>
    database.transaction(async (transaction: SqlExecutor) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        identity.accountId,
      ]);
      const result = await transaction.query<{ generation_request_id: string }>(
        `SELECT g.id AS generation_request_id FROM generation_requests g
        CROSS JOIN LATERAL public.videoforge_load_hosted_pair_workflow_schedule(
          g.account_id,g.workspace_id,g.id) p
        WHERE g.account_id=$1 AND g.workspace_id=$2 AND g.project_id=$3
          AND g.state='ACTIVE' AND p.existing_pair
        ORDER BY g.created_at DESC LIMIT 1`,
        [identity.accountId, identity.workspaceId, identity.projectId],
      );
      return result.rows[0]?.generation_request_id ?? null;
    }),
  correlationId: () => `v209-${crypto.randomUUID()}`,
});

function exactSystemAvatarReference(value: unknown, identity: DispatchIdentity) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const reference = value as Record<string, unknown>;
  const commonKeys = [
    "accountId",
    "generationRequestId",
    "projectId",
    "projectRevisionId",
    "referenceReady",
    "referenceRequired",
    "replayed",
    "schemaVersion",
    "workspaceId",
  ];
  const systemKeys = ["assetId", "checksumSha256", "objectKey", "receiptId", "reservationId"];
  const required = reference.referenceRequired;
  const expectedKeys = required === true ? [...commonKeys, ...systemKeys] : commonKeys;
  if (
    Object.keys(reference).sort().join(",") !== expectedKeys.sort().join(",") ||
    reference.schemaVersion !== "videoforge.hosted-v209-system-avatar-reference/v1" ||
    reference.accountId !== identity.accountId ||
    reference.workspaceId !== identity.workspaceId ||
    reference.projectId !== identity.projectId ||
    ![reference.projectRevisionId, reference.generationRequestId].every(
      (item) => typeof item === "string" && DATABASE_UUID.test(item),
    ) ||
    typeof required !== "boolean" ||
    reference.referenceReady !== true ||
    typeof reference.replayed !== "boolean" ||
    (required === false && reference.replayed !== true)
  ) {
    return null;
  }
  if (
    required === true &&
    (![reference.assetId, reference.receiptId, reference.reservationId].every(
      (item) => typeof item === "string" && DATABASE_UUID.test(item),
    ) ||
      typeof reference.objectKey !== "string" ||
      !SYSTEM_AVATAR_OBJECT_KEY.test(reference.objectKey) ||
      typeof reference.checksumSha256 !== "string" ||
      !SHA256.test(reference.checksumSha256))
  ) {
    return null;
  }
  return reference as {
    readonly projectRevisionId: string;
    readonly generationRequestId: string;
    readonly referenceRequired: boolean;
    readonly assetId?: string;
    readonly objectKey?: string;
    readonly checksumSha256?: `sha256:${string}`;
    readonly reservationId?: string;
  };
}

export async function materializeHostedV209OrdinaryDispatchCandidate(
  database: TransactionalSqlExecutor,
  identity: DispatchIdentity,
): Promise<MaterializedDispatchCandidate> {
  return database.transaction(async (transaction) => {
    await transaction.query("SELECT set_config($1,$2,true)", [
      "videoforge.account_id",
      identity.accountId,
    ]);
    const parameters = [
      identity.accountId,
      identity.workspaceId,
      identity.userId,
      identity.projectId,
    ];
    const referenceResult = await transaction.query<{ reference: unknown }>(
      `SELECT public.videoforge_materialize_hosted_v209_system_avatar_reference(
         $1::uuid,$2::uuid,$3::uuid,$4::uuid) AS reference`,
      parameters,
    );
    const reference = exactSystemAvatarReference(referenceResult.rows[0]?.reference, identity);
    if (referenceResult.rows.length !== 1 || !reference) {
      throw new RangeError("HOSTED_V209_SYSTEM_AVATAR_REFERENCE_INVALID");
    }
    const result = await transaction.query<{ candidate: unknown; candidate_canonical_json?: string }>(
      `SELECT candidate,candidate_canonical_json FROM public.videoforge_materialize_hosted_v209_ordinary_dispatch_canonical(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid)`,
      parameters,
    );
    if (result.rows.length !== 1) throw new Error("HOSTED_V209_CANDIDATE_NOT_READY");
    const candidate = result.rows[0]?.candidate;
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate) ||
      (candidate as Record<string, unknown>).projectRevisionId !== reference.projectRevisionId ||
      (candidate as Record<string, unknown>).generationRequestId !== reference.generationRequestId
    ) {
      throw new RangeError("HOSTED_V209_SYSTEM_AVATAR_REFERENCE_INVALID");
    }
    let systemAvatarReference: V209OrdinaryVerifiedSystemAvatarReference | null = null;
    if (reference.referenceRequired) {
      const candidateRecord = candidate as Record<string, unknown>;
      const work = candidateRecord.work as Record<string, unknown> | undefined;
      const soulx = Array.isArray(work?.soulx_avatar) ? work.soulx_avatar : [];
      if (
        candidateRecord.avatarSourceInputReservationId !== reference.reservationId ||
        soulx.length < 1 ||
        soulx.some((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return true;
          const source = item as Record<string, unknown>;
          return (
            source.avatarSourceAssetId !== reference.assetId ||
            source.avatarSourceObjectKey !== reference.objectKey ||
            source.avatarSourceSha256 !== reference.checksumSha256
          );
        })
      ) {
        throw new RangeError("HOSTED_V209_SYSTEM_AVATAR_REFERENCE_INVALID");
      }
      systemAvatarReference = Object.freeze({
        sourceScopeKind: "SYSTEM" as const,
        assetId: reference.assetId!,
        objectKey: reference.objectKey!,
        checksumSha256: reference.checksumSha256!,
        reservationId: reference.reservationId!,
      });
    }
    const databaseCanonicalJson = result.rows[0]?.candidate_canonical_json;
    if (databaseCanonicalJson !== undefined && typeof databaseCanonicalJson !== "string")
      throw new RangeError("V209_ORDINARY_CANDIDATE_HASH_INVALID");
    return Object.freeze({ candidate, systemAvatarReference,
      ...(databaseCanonicalJson === undefined ? {} : { databaseCanonicalJson }),
    });
  });
}

function exactCandidate(
  value: unknown,
  identity: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly projectId: string;
  },
): Candidate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Candidate;
  if (
    candidate.schemaVersion !== "videoforge.hosted-v209-ordinary-dispatch/v1" ||
    typeof candidate.candidateSha256 !== "string" ||
    !SHA256.test(candidate.candidateSha256) ||
    typeof candidate.replayed !== "boolean" ||
    typeof candidate.pairExists !== "boolean" ||
    candidate.accountId !== identity.accountId ||
    candidate.workspaceId !== identity.workspaceId ||
    candidate.projectId !== identity.projectId ||
    ![
      candidate.projectRevisionId,
      candidate.generationRequestId,
      candidate.leaseId,
      candidate.approvalId,
    ].every((item) => typeof item === "string" && DATABASE_UUID.test(item)) ||
    ![candidate.generationPlanSha256, candidate.approvalSha256, candidate.workManifestSha256].every(
      (item) => typeof item === "string" && SHA256.test(item),
    ) ||
    typeof candidate.avatarSourceInputReservationId !== "string" ||
    !DATABASE_UUID.test(candidate.avatarSourceInputReservationId) ||
    !Number.isFinite(Date.parse(candidate.expiresAt)) ||
    (candidate.budgetVersion === "ordinary-video-budget/v1"
      ? typeof candidate.totalCapUsd !== "number" ||
        candidate.totalCapUsd < 2 ||
        candidate.totalCapUsd > 5
      : candidate.totalCapUsd !== 2) ||
    !candidate.laneBindings ||
    typeof candidate.laneBindings !== "object" ||
    !candidate.pair ||
    typeof candidate.pair !== "object" ||
    !candidate.work ||
    typeof candidate.work !== "object" ||
    (candidate.pairExists
      ? candidate.existingWorkflowId !== `hosted-pair-${candidate.generationRequestId}`
      : candidate.existingWorkflowId !== null)
  )
    return null;
  return candidate;
}

function dispatchResponse(candidate: Candidate, correlationId: string, status: number): Response {
  const base = response(
    {
      schema_version: "videoforge-hosted-v209-project-dispatch/v1",
      state: "SCHEDULED",
      generation_request_id: candidate.generationRequestId,
      workflow_id: `hosted-pair-${candidate.generationRequestId}`,
      correlation_id: correlationId,
    },
    status,
  );
  const headers = new Headers(base.headers);
  headers.set("x-videoforge-correlation-id", correlationId);
  return new Response(base.body, { status: base.status, headers });
}

function preparationResponse(
  state: "PREPARING_INPUTS" | "SCHEDULED" | "WAITING" | "WAITING_FOR_GPUS",
  correlationId: string,
) {
  const base = response(
    {
      schema_version: "videoforge-hosted-v209-project-dispatch/v1",
      state,
      ...(state === "WAITING_FOR_GPUS" ? { retry_after_seconds: 30 } : {}),
      correlation_id: correlationId,
    },
    202,
  );
  const headers = new Headers(base.headers);
  headers.set("x-videoforge-correlation-id", correlationId);
  return new Response(base.body, { status: base.status, headers });
}

async function dispatchPhase<T>(code: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)) throw error;
    throw new RangeError(code);
  }
}

async function emptyBody(request: Request): Promise<boolean> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(length) || length < 0 || length > 2) return false;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength !== length && request.headers.has("content-length"))
    return false;
  return (
    raw === "" ||
    (request.headers.get("content-type")?.split(";", 1)[0] === "application/json" && raw === "{}")
  );
}

export async function resumeHostedV209ProjectDispatch(
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  identity: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly userId: string;
    readonly projectId: string;
  },
  injected: HostedV209ProjectDispatchDependencies = defaults,
  suppliedCorrelationId?: string,
  suppliedRuntimePool?: HostedNeonPool,
  admissionAlreadyEnsured = false,
): Promise<Response> {
  const correlationId = suppliedCorrelationId ?? injected.correlationId();
  const runtimePool = suppliedRuntimePool ?? injected.createPool(config.neon.databaseUrl);
  try {
    const runtimeDatabase = injected.createExecutor(runtimePool);
    if (config.apiGeneration) {
      return await resumeHostedApiDispatch(
        environment, runtimeDatabase, identity, correlationId,
      );
    }
    if (!admissionAlreadyEnsured) {
      const admission = await injected.ensureAdmission(runtimeDatabase, identity);
      if (admission.state === "WAITING") return preparationResponse("WAITING", correlationId);
    }
    const materialized = await injected.materialize(runtimeDatabase, identity);
    const candidate = exactCandidate(materialized.candidate, identity);
    if (!candidate) return response({ error: { code: "HOSTED_V209_CANDIDATE_NOT_READY" } }, 409);
    await assertV209OrdinaryCandidate(candidate, materialized.systemAvatarReference, materialized.databaseCanonicalJson);
    const reconcilerUrl = environment.VIDEOFORGE_RECONCILER_DATABASE_URL;
    if (typeof reconcilerUrl !== "string" || reconcilerUrl.length === 0)
      return response({ error: { code: "HOSTED_PAIR_RECONCILER_BINDING_MISSING" } }, 503);
    const reconcilerPool = injected.createPool(reconcilerUrl);
    try {
      if (candidate.pairExists) {
        await injected.ensureWorkflow(
          environment,
          runtimeDatabase,
          injected.createExecutor(reconcilerPool),
          {
            accountId: identity.accountId,
            workspaceId: identity.workspaceId,
            generationRequestId: candidate.generationRequestId,
          },
          config,
        );
        console.info("hosted_v209_project_dispatch", {
          correlation_id: correlationId,
          event: "EXISTING_WORKFLOW_RETRIEVED",
        });
        return dispatchResponse(candidate, correlationId, 200);
      }
      let observation: Awaited<ReturnType<typeof injected.observe>>;
      try {
        observation = await dispatchPhase("HOSTED_V209_OBSERVATION_FAILED", () =>
          injected.observe(environment, runtimeDatabase),
        );
      } catch (error) {
        if (error instanceof RangeError && error.message === "V209_GPU_CAPACITY_UNAVAILABLE")
          return preparationResponse("WAITING_FOR_GPUS", correlationId);
        throw error;
      }
      const admission = await dispatchPhase("HOSTED_V209_ADMISSION_FREEZE_FAILED", () =>
        freezeV209OrdinaryLiveAdmission(candidate, observation, materialized.systemAvatarReference, materialized.databaseCanonicalJson),
      );
      const scheduled = await dispatchPhase("HOSTED_V209_COMMIT_SCHEDULE_FAILED", () =>
        injected.commitAndSchedule(
          environment,
          runtimeDatabase,
          injected.createExecutor(reconcilerPool),
          {
            approvalId: candidate.approvalId,
            approvalSha256: candidate.approvalSha256,
            claimId: crypto.randomUUID(),
            accountId: identity.accountId,
            workspaceId: identity.workspaceId,
            userId: identity.userId,
            projectId: identity.projectId,
            projectRevisionId: candidate.projectRevisionId,
            generationRequestId: candidate.generationRequestId,
            generationPlanSha256: candidate.generationPlanSha256,
            leaseId: candidate.leaseId,
            laneBindings: candidate.laneBindings,
            totalCapUsd: candidate.totalCapUsd,
            expiresAt: candidate.expiresAt,
            pair: candidate.pair,
          },
          admission,
          config,
        ),
      );
      console.info("hosted_v209_project_dispatch", {
        correlation_id: correlationId,
        event: scheduled.recovered ? "WORKFLOW_RECOVERED" : "WORKFLOW_SCHEDULED",
      });
      return dispatchResponse(candidate, correlationId, 202);
    } finally {
      await reconcilerPool.end();
    }
  } finally {
    if (!suppliedRuntimePool) await runtimePool.end();
  }
}

export async function handleHostedV209ProjectDispatch(
  request: Request,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  executionContext: HostedExecutionContext,
  injected: HostedV209ProjectDispatchDependencies = defaults,
  spanAudio?: {
    readonly prepare: (identity: {
      readonly accountId: string;
      readonly workspaceId: string;
      readonly userId: string;
      readonly projectId: string;
    }) => Promise<{ readonly state: "PREPARING_INPUTS" | "PAIR_RESUMED" }>;
  },
): Promise<Response | null> {
  const match = PATH.exec(new URL(request.url).pathname);
  if (!match) return null;
  if (request.method !== "POST" || !UUID.test(match[1]!))
    return response({ error: { code: "PROJECT_NOT_FOUND" } }, 404);
  if (config.environment !== "production" ||
      (!config.apiGeneration && config.gpuTransport !== "QUALIFIED_EXACT"))
    return response({ error: { code: "GPU_TRANSPORT_DISABLED_UNQUALIFIED" } }, 503);
  if (!sameOrigin(request, config))
    return response({ error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" } }, 403);
  if (!(await emptyBody(request)))
    return response({ error: { code: "HOSTED_V209_DISPATCH_REQUEST_INVALID" } }, 400);

  const correlationId = injected.correlationId();
  console.info("hosted_v209_project_dispatch", { correlation_id: correlationId, event: "STARTED" });
  const runtimePool = injected.createPool(config.neon.databaseUrl);
  try {
    const scope = await injected.scope(request, config, runtimePool, executionContext);
    if (scope instanceof Response) return scope;
    const identity = {
      accountId: scope.account_id,
      workspaceId: scope.workspace_id,
      userId: scope.user_id,
      projectId: match[1]!,
    };
    const runtimeDatabase = injected.createExecutor(runtimePool);
    const existingGeneration = config.apiGeneration
      ? null
      : await injected.findExistingGeneration?.(runtimeDatabase, identity);
    const admission: HostedV209AdmissionResult = existingGeneration
      ? { state: "ACTIVE", generationRequestId: existingGeneration }
      : await injected.ensureAdmission(runtimeDatabase, identity);
    if (admission.state === "WAITING") return preparationResponse("WAITING", correlationId);
    if (spanAudio) {
      if (config.apiGeneration) {
        const existingApiJobs = await readApiJobs(runtimeDatabase, identity, admission.generationRequestId);
        if (existingApiJobs.length === 0) {
          const preparation = await spanAudio.prepare(identity);
          if (preparation.state === "PREPARING_INPUTS")
            return preparationResponse("PREPARING_INPUTS", correlationId);
        }
        return await resumeHostedApiDispatch(
          environment, runtimeDatabase, identity, correlationId,
        );
      }
      if (
        existingGeneration ||
        (injected.hasExistingPair &&
          (await injected.hasExistingPair(
            runtimeDatabase,
            identity,
            admission.generationRequestId,
          )))
      ) {
        const reconcilerUrl = environment.VIDEOFORGE_RECONCILER_DATABASE_URL;
        if (typeof reconcilerUrl !== "string" || reconcilerUrl.length === 0)
          return response({ error: { code: "HOSTED_PAIR_RECONCILER_BINDING_MISSING" } }, 503);
        const reconcilerPool = injected.createPool(reconcilerUrl);
        try {
          await (injected.ensureExistingWorkflow ?? injected.ensureWorkflow)(
            environment,
            runtimeDatabase,
            injected.createExecutor(reconcilerPool),
            {
              accountId: identity.accountId,
              workspaceId: identity.workspaceId,
              generationRequestId: admission.generationRequestId,
            },
            config,
          );
          return response(
            {
              schema_version: "videoforge-hosted-v209-project-dispatch/v1",
              state: "SCHEDULED",
              generation_request_id: admission.generationRequestId,
              workflow_id: `hosted-pair-${admission.generationRequestId}`,
              correlation_id: correlationId,
            },
            200,
          );
        } finally {
          await reconcilerPool.end();
        }
      }
      const preparation = await spanAudio.prepare(identity);
      if (preparation.state === "PREPARING_INPUTS") {
        return preparationResponse("PREPARING_INPUTS", correlationId);
      }
      return preparationResponse("SCHEDULED", correlationId);
    }
    return await resumeHostedV209ProjectDispatch(
      environment,
      config,
      identity,
      injected,
      correlationId,
      runtimePool,
      true,
    );
  } catch (error) {
    const cause =
      error instanceof TypeError && error.message === "fetch failed"
        ? "FETCH_FAILED"
        : error instanceof DOMException
          ? error.name
          : error instanceof Error
            ? error.name
            : "NON_ERROR_THROWN";
    const code =
      error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
        ? error.message
        : "HOSTED_V209_DISPATCH_REJECTED";
    // A rejected dispatch must stay diagnosable: log a bounded, URL-redacted reason plus the
    // SQLSTATE when the database refused the transaction. No payload, token, or connection
    // detail is included.
    const reason =
      error instanceof Error
        ? error.message.replace(/[a-z]+:\/\/\S+/giu, "[redacted-url]").slice(0, 200)
        : null;
    const sqlstate =
      error && typeof error === "object" && "code" in error
        ? String((error as { readonly code?: unknown }).code ?? "").slice(0, 24)
        : "";
    console.warn("hosted_v209_project_dispatch", {
      correlation_id: correlationId,
      event: "REJECTED",
      code,
      cause,
      reason,
      sqlstate,
    });
    if (code === HOSTED_V209_PRE_SEND_INTEGRITY_CODE) {
      return response(
        {
          error: {
            code,
            message: HOSTED_V209_PRE_SEND_INTEGRITY_MESSAGE,
            retryable: false,
            phase: "PRE_SEND",
          },
        },
        409,
      );
    }
    return response({ error: { code: "HOSTED_V209_DISPATCH_REJECTED" } }, 409);
  } finally {
    await runtimePool.end();
  }
}

export { PATH as HOSTED_V209_PROJECT_DISPATCH_PATH };

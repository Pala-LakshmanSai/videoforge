import type { SqlPrimitive, TransactionalSqlExecutor } from "@videoforge/control-plane";

import { hostedRuntimeConfiguration, type HostedRuntimeEnvironment } from "./configuration";
import { HostedR2Signer } from "./r2";
import { KieZImageClient, KieZImageError } from "../providers/kie-z-image";
import {
  submitKieImageJob,
  observeKieImageJob,
  KieImageJobError,
} from "../providers/kie-image-job";
import { FalFlashheadClient, FalFlashheadError } from "../providers/fal-flashhead-client";
import {
  submitFalAvatarJob,
  observeFalAvatarJob,
  FalAvatarJobError,
} from "../providers/fal-avatar-job";

const DATABASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export interface HostedApiGenerationScope {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly generationRequestId: string;
}

export interface HostedApiGenerationParameters extends HostedApiGenerationScope {
  readonly schema_version: "videoforge-api-generation-workflow/v1";
}

type Job = {
  id: string;
  generationTaskId: string;
  lane: "IMAGE" | "AVATAR";
  state: "PREPARED" | "SUBMITTING" | "SUBMITTED" | "UNKNOWN_NO_RETRY" | "SUCCEEDED" | "FAILED";
  inputManifest: Record<string, unknown>;
  outputObjectKey: string;
  providerTaskId: string | null;
  failureCode: string | null;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("HOSTED_API_GENERATION_RESPONSE_INVALID");
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("HOSTED_API_GENERATION_INPUT_INVALID");
  return value;
}

async function call(
  database: TransactionalSqlExecutor,
  accountId: string,
  functionName: string,
  args: readonly SqlPrimitive[],
): Promise<unknown> {
  if (!/^videoforge_[a-z_]+$/u.test(functionName))
    throw new Error("HOSTED_API_GENERATION_SQL_INVALID");
  return database.transaction(async (tx) => {
    await tx.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", accountId]);
    const placeholders = args.map((_, index) => `$${index + 1}`).join(",");
    const result = await tx.query<{ value: unknown }>(
      `SELECT public.${functionName}(${placeholders}) AS value`,
      [...args],
    );
    return result.rows[0]?.value ?? null;
  });
}

function jobs(value: unknown, scope: HostedApiGenerationScope): Job[] {
  const result = object(value);
  if (result.generationRequestId !== scope.generationRequestId || !Array.isArray(result.jobs))
    throw new Error("HOSTED_API_GENERATION_RESPONSE_INVALID");
  return result.jobs.map((raw) => {
    const row = object(raw);
    if (
      !["IMAGE", "AVATAR"].includes(String(row.lane)) ||
      !["PREPARED", "SUBMITTING", "SUBMITTED", "UNKNOWN_NO_RETRY", "SUCCEEDED", "FAILED"].includes(
        String(row.state),
      )
    )
      throw new Error("HOSTED_API_GENERATION_RESPONSE_INVALID");
    return {
      id: string(row.id),
      generationTaskId: string(row.generationTaskId),
      lane: row.lane as Job["lane"],
      state: row.state as Job["state"],
      inputManifest: object(row.inputManifest),
      outputObjectKey: string(row.outputObjectKey),
      providerTaskId: typeof row.providerTaskId === "string" ? row.providerTaskId : null,
      failureCode: typeof row.failureCode === "string" ? row.failureCode : null,
    };
  });
}

/** Advances one durable API job. The database claim precedes each paid POST, so a resumed
 * Workflow can observe a persisted provider ID but cannot resubmit an uncertain attempt. */
export async function advanceHostedApiGeneration(
  environment: HostedRuntimeEnvironment,
  database: TransactionalSqlExecutor,
  scope: HostedApiGenerationScope,
  observation = 0,
): Promise<{ state: "WAITING" | "READY_TO_RENDER" | "ACTION_REQUIRED"; code?: string }> {
  const config = hostedRuntimeConfiguration(environment);
  if (!config.apiGeneration || !environment.PRIVATE_ARTIFACTS)
    throw new Error("HOSTED_API_GENERATION_BINDING_MISSING");
  const base = [scope.accountId, scope.workspaceId, scope.generationRequestId] as const;
  const current = jobs(
    await call(database, scope.accountId, "videoforge_read_hosted_api_jobs", base),
    scope,
  );
  if (current.length === 0) return { state: "ACTION_REQUIRED", code: "HOSTED_API_JOBS_MISSING" };
  if (current.every((job) => job.state === "SUCCEEDED")) return { state: "READY_TO_RENDER" };
  const blocked = current.find((job) => ["SUBMITTING", "UNKNOWN_NO_RETRY"].includes(job.state));
  if (blocked) return { state: "ACTION_REQUIRED", code: blocked.failureCode ?? blocked.state };
  const failed = current.find((job) => job.state === "FAILED");
  const submitted = current.filter((item) => item.state === "SUBMITTED");
  const prepared = failed ? undefined : current.find((item) => item.state === "PREPARED");
  const job =
    prepared && submitted.length < 2
      ? prepared
      : submitted.length > 0
        ? submitted[observation % submitted.length]
        : prepared;
  if (!job && failed) {
    const settlement = object(
      await call(database, scope.accountId, "videoforge_settle_hosted_api_failure", base),
    );
    if (settlement.state !== "SETTLED") throw new Error("HOSTED_API_FAILURE_SETTLEMENT_INVALID");
    return { state: "ACTION_REQUIRED", code: failed.failureCode ?? "PROVIDER_TASK_FAILED" };
  }
  if (!job) return { state: "ACTION_REQUIRED", code: "HOSTED_API_JOB_STATE_INVALID" };
  const jobArgs = [...base, job.generationTaskId] as const;
  const bucket = environment.PRIVATE_ARTIFACTS;
  if (job.state === "PREPARED") {
    const claimId = crypto.randomUUID();
    const claimSubmission = async () => {
      const claimed = object(
        await call(database, scope.accountId, "videoforge_claim_hosted_api_job", [
          ...jobArgs,
          claimId,
        ]),
      );
      return claimed.state === "SUBMITTING" && claimed.claimId === claimId;
    };
    const persistTaskId = async (taskId: string) => {
      await call(database, scope.accountId, "videoforge_record_hosted_api_task", [
        ...jobArgs,
        claimId,
        taskId,
      ]);
    };
    const markSubmissionUnknown = async () => {
      await call(database, scope.accountId, "videoforge_mark_hosted_api_unknown", [
        ...jobArgs,
        claimId,
      ]);
    };
    const markSubmissionFailed = async () => {
      await call(database, scope.accountId, "videoforge_fail_hosted_api_job", [
        ...jobArgs,
        "PROVIDER_REQUEST_REJECTED",
      ]);
    };
    if (job.lane === "IMAGE") {
      try {
        await submitKieImageJob({
          manifest: { prompt: string(job.inputManifest.prompt), aspectRatio: "16:9" },
          client: new KieZImageClient(config.apiGeneration.kieApiKey),
          claimSubmission,
          persistTaskId,
          markSubmissionUnknown,
          markRequestRejected: markSubmissionFailed,
        });
      } catch {
        return { state: "WAITING" };
      }
    } else {
      const signer = new HostedR2Signer(config.r2);
      const source = async (prefix: "avatarSource" | "spanAudio") => {
        const m = job.inputManifest;
        const port = await signer.sign({
          method: "GET",
          objectKey: string(m[`${prefix}ObjectKey`]),
          contentType: string(m[`${prefix}ContentType`]),
          contentLength: Number(m[`${prefix}ContentLength`]),
          checksumSha256: string(m[`${prefix}Sha256`]),
          lifetimeSeconds: 3600,
        });
        return port.url;
      };
      const imageUrl = await source("avatarSource");
      const audioUrl = await source("spanAudio");
      try {
        await submitFalAvatarJob({
          imageUrl,
          audioUrl,
          client: new FalFlashheadClient(config.apiGeneration.falApiKey),
          claimSubmission,
          persistRequestId: persistTaskId,
          markSubmissionUnknown,
          markSubmissionFailed,
        });
      } catch {
        return { state: "WAITING" };
      }
    }
    return { state: "WAITING" };
  }
  if (!job.providerTaskId) return { state: "ACTION_REQUIRED", code: "PROVIDER_ID_MISSING" };
  let result:
    | Awaited<ReturnType<typeof observeKieImageJob>>
    | Awaited<ReturnType<typeof observeFalAvatarJob>>;
  try {
    result =
      job.lane === "IMAGE"
        ? await observeKieImageJob({
            taskId: job.providerTaskId,
            objectKey: job.outputObjectKey,
            client: new KieZImageClient(config.apiGeneration.kieApiKey),
            bucket,
          })
        : await observeFalAvatarJob({
            requestId: job.providerTaskId,
            objectKey: job.outputObjectKey,
            client: new FalFlashheadClient(config.apiGeneration.falApiKey),
            bucket,
          });
  } catch (error) {
    if (
      (error instanceof KieZImageError && error.code === "STATUS_UNKNOWN") ||
      (error instanceof KieImageJobError && error.code === "RESULT_DOWNLOAD_FAILED") ||
      (error instanceof FalFlashheadError &&
        ["STATUS_UNKNOWN", "RESULT_UNKNOWN"].includes(error.code)) ||
      (error instanceof FalAvatarJobError && error.code === "RESULT_DOWNLOAD_FAILED")
    )
      return { state: "WAITING" };
    if (
      (error instanceof KieZImageError && error.code === "RESPONSE_INVALID") ||
      (error instanceof KieImageJobError && error.code === "RESULT_MEDIA_INVALID") ||
      (error instanceof FalFlashheadError && error.code === "RESULT_INVALID") ||
      (error instanceof FalAvatarJobError && error.code === "RESULT_MP4_INVALID")
    ) {
      await call(database, scope.accountId, "videoforge_fail_hosted_api_job", [
        ...jobArgs,
        "PROVIDER_OUTPUT_INVALID",
      ]);
      return { state: "WAITING" };
    }
    throw error;
  }
  if (result.state === "FAILED") {
    await call(database, scope.accountId, "videoforge_fail_hosted_api_job", [
      ...jobArgs,
      "PROVIDER_TASK_FAILED",
    ]);
    return { state: "WAITING" };
  }
  if (result.state !== "SUCCEEDED") return { state: "WAITING" };
  const artifact = result.artifact;
  const probe =
    job.lane === "IMAGE"
      ? { width: artifact.width, height: artifact.height }
      : {
          width: artifact.width,
          height: artifact.height,
          durationMs: Math.round((artifact as { durationSeconds: number }).durationSeconds * 1000),
        };
  await call(database, scope.accountId, "videoforge_commit_hosted_api_output", [
    ...jobArgs,
    artifact.sha256,
    artifact.byteSize,
    artifact.contentType,
    JSON.stringify(probe),
  ]);
  return { state: "WAITING" };
}

/** Scheduling is idempotent by the durable generation identity. The Workflow never resubmits a
 * provider task unless the database still has an unclaimed PREPARED job. */
export async function ensureHostedApiGenerationWorkflow(
  environment: HostedRuntimeEnvironment,
  database: TransactionalSqlExecutor,
  input: HostedApiGenerationScope,
): Promise<{ readonly id: string; readonly recovered: boolean }> {
  if (
    ![input.accountId, input.workspaceId, input.generationRequestId].every((id) =>
      DATABASE_UUID.test(id),
    )
  ) {
    throw new Error("HOSTED_API_GENERATION_SCOPE_INVALID");
  }
  const workflow = environment.HOSTED_PAIR_WORKFLOW;
  if (!workflow) throw new Error("HOSTED_API_GENERATION_WORKFLOW_MISSING");
  const id = `hosted-api-${input.generationRequestId}`;
  const params: HostedApiGenerationParameters = Object.freeze({
    schema_version: "videoforge-api-generation-workflow/v1",
    ...input,
  });
  try {
    const created = await workflow.create({ id, params });
    if (created.id !== id) throw new Error("HOSTED_API_GENERATION_WORKFLOW_ID_MISMATCH");
    return { id, recovered: false };
  } catch (error) {
    if (error instanceof Error && error.message === "HOSTED_API_GENERATION_WORKFLOW_ID_MISMATCH")
      throw error;
    const existing = await workflow.get(id);
    const status = await existing.status();
    const state =
      status && typeof status === "object" && !Array.isArray(status)
        ? (status as Record<string, unknown>).status
        : null;
    if (["complete", "errored", "terminated"].includes(String(state))) {
      const current = jobs(
        await call(database, input.accountId, "videoforge_read_hosted_api_jobs", [
          input.accountId,
          input.workspaceId,
          input.generationRequestId,
        ]),
        input,
      );
      const pendingJobs = current.some((job) => ["PREPARED", "SUBMITTED"].includes(job.state));
      const renderPending =
        current.length > 0 && current.every((job) => job.state === "SUCCEEDED")
          ? await database.transaction(async (tx) => {
              await tx.query("SELECT set_config($1,$2,true)", [
                "videoforge.account_id",
                input.accountId,
              ]);
              const result = await tx.query<{ pending: boolean }>(
                `SELECT EXISTS(SELECT 1 FROM video_runtime_states runtime
                 WHERE runtime.account_id=$1 AND runtime.workspace_id=$2
                   AND runtime.generation_request_id=$3 AND runtime.stage='RENDERING'
                   AND NOT EXISTS(SELECT 1 FROM hosted_cpu_job_attempts attempt
                     WHERE attempt.account_id=runtime.account_id
                       AND attempt.workspace_id=runtime.workspace_id
                       AND attempt.project_revision_id=runtime.project_revision_id
                       AND attempt.kind='RENDER')) AS pending`,
                [input.accountId, input.workspaceId, input.generationRequestId],
              );
              return result.rows[0]?.pending === true;
            })
          : false;
      if (
        current.length > 0 &&
        current.every((job) => ["PREPARED", "SUBMITTED", "SUCCEEDED"].includes(job.state)) &&
        (pendingJobs || renderPending)
      ) {
        if (!existing.restart)
          throw new Error("HOSTED_API_GENERATION_WORKFLOW_RESTART_UNAVAILABLE");
        await existing.restart();
      }
    }
    return { id, recovered: true };
  }
}

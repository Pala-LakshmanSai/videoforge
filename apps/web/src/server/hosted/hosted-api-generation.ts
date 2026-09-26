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
const API_FAL_SUBMISSION_CONCURRENCY = 4;
const API_KIE_SUBMISSION_START_INTERVAL_MS = 1_050;
const API_OBSERVATION_CONCURRENCY = 1;
const API_KIE_OBSERVATION_START_INTERVAL_MS = 250;

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

/** Keep provider request and media-transfer concurrency bounded while preserving every result's
 * position. Kie submissions use a one-second start interval; Fal submissions remain parallel.
 * One observation keeps the provider result buffer and R2 readback below the worker memory
 * ceiling while visiting every submitted job in one pass. The 250ms start interval keeps Kie
 * status reads below eight per second across the two admitted accounts. */
export async function settleHostedApiJobsBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T) => Promise<R>,
  startIntervalMs = 0,
): Promise<PromiseSettledResult<R>[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new RangeError("HOSTED_API_GENERATION_CONCURRENCY_INVALID");
  if (!Number.isInteger(startIntervalMs) || startIntervalMs < 0)
    throw new RangeError("HOSTED_API_GENERATION_START_INTERVAL_INVALID");
  const results = new Array<PromiseSettledResult<R> | undefined>(items.length);
  let next = 0;
  let nextStartAt = 0;
  const waitForStartSlot = async () => {
    if (startIntervalMs === 0) return;
    const now = Date.now();
    const startAt = Math.max(now, nextStartAt);
    nextStartAt = startAt + startIntervalMs;
    if (startAt > now) await new Promise<void>((resolve) => setTimeout(resolve, startAt - now));
  };
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        await waitForStartSlot();
        results[index] = { status: "fulfilled", value: await operation(items[index]!) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  if (nextStartAt > Date.now())
    await new Promise<void>((resolve) => setTimeout(resolve, nextStartAt - Date.now()));
  return results as PromiseSettledResult<R>[];
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

/** Keep both provider lanes moving while limiting outstanding paid jobs. */
export function selectHostedApiGenerationJobIndex(
  current: readonly Pick<Job, "lane" | "state">[],
  observation: number,
): number | null {
  const submitted: number[] = [];
  let imageCount = 0;
  let avatarCount = 0;
  let imagePrepared = -1;
  let avatarPrepared = -1;
  let failed = false;
  for (let index = 0; index < current.length; index += 1) {
    const job = current[index]!;
    if (job.state === "SUBMITTING" || job.state === "UNKNOWN_NO_RETRY") return null;
    if (job.state === "FAILED") failed = true;
    if (job.state === "SUBMITTED") {
      submitted.push(index);
      if (job.lane === "IMAGE") imageCount += 1;
      else avatarCount += 1;
    }
    if (job.state === "PREPARED") {
      if (job.lane === "IMAGE" && imagePrepared < 0) imagePrepared = index;
      if (job.lane === "AVATAR" && avatarPrepared < 0) avatarPrepared = index;
    }
  }
  if (!failed) {
    if (
      imagePrepared >= 0 &&
      imageCount < 8 &&
      (avatarPrepared < 0 || avatarCount >= 4 || imageCount <= 2 * avatarCount)
    )
      return imagePrepared;
    if (avatarPrepared >= 0 && avatarCount < 4) return avatarPrepared;
  }
  return submitted.length > 0 ? submitted[observation % submitted.length]! : null;
}

/** Select every currently available paid slot in one dispatch pass. The virtual SUBMITTED
 * states keep the existing 8 IMAGE / 4 AVATAR balance and never select past an uncertain or
 * failed job. Claims still provide the per-job CAS immediately before each provider POST. */
export function selectHostedApiGenerationJobIndices(
  current: readonly Pick<Job, "lane" | "state">[],
  observation: number,
): number[] {
  const virtual = current.map((job) => ({ ...job }));
  const selected: number[] = [];
  while (true) {
    const index = selectHostedApiGenerationJobIndex(virtual, observation + selected.length);
    if (index === null || virtual[index]?.state !== "PREPARED") return selected;
    selected.push(index);
    virtual[index] = { ...virtual[index]!, state: "SUBMITTED" };
  }
}

/** Advances durable API jobs. The database claim precedes each paid POST, so a resumed Workflow
 * can observe a persisted provider ID but cannot resubmit an uncertain attempt. Prepared Fal jobs
 * in open slots submit concurrently; Kie starts are paced and stop queued work after any sibling
 * submission error without increasing the existing 8 IMAGE / 4 AVATAR outstanding-job cap. */
export async function advanceHostedApiGeneration(
  environment: HostedRuntimeEnvironment,
  database: TransactionalSqlExecutor,
  scope: HostedApiGenerationScope,
  observation = 0,
): Promise<{
  state: "WAITING" | "PROGRESSED" | "READY_TO_RENDER" | "ACTION_REQUIRED";
  jobCount: number;
  code?: string;
}> {
  const config = hostedRuntimeConfiguration(environment);
  if (!config.apiGeneration || !environment.PRIVATE_ARTIFACTS)
    throw new Error("HOSTED_API_GENERATION_BINDING_MISSING");
  const base = [scope.accountId, scope.workspaceId, scope.generationRequestId] as const;
  const current = jobs(
    await call(database, scope.accountId, "videoforge_read_hosted_api_jobs", base),
    scope,
  );
  const outcome = (
    state: "WAITING" | "PROGRESSED" | "READY_TO_RENDER" | "ACTION_REQUIRED",
    code?: string,
  ) => ({ state, jobCount: current.length, ...(code ? { code } : {}) });
  if (current.length === 0) return outcome("ACTION_REQUIRED", "HOSTED_API_JOBS_MISSING");
  if (current.every((job) => job.state === "SUCCEEDED")) return outcome("READY_TO_RENDER");
  const blocked = current.find((job) => ["SUBMITTING", "UNKNOWN_NO_RETRY"].includes(job.state));
  const failed = current.find((job) => job.state === "FAILED");
  const bucket = environment.PRIVATE_ARTIFACTS;
  const signer = new HostedR2Signer(config.r2);
  const kieClient = new KieZImageClient(config.apiGeneration.kieApiKey);
  const falClient = new FalFlashheadClient(config.apiGeneration.falApiKey);
  const submissionStopped = { value: false };
  const submitPreparedJob = async (job: Job): Promise<"PROGRESSED" | "WAITING"> => {
    if (submissionStopped.value) return "WAITING";
    const jobArgs = [...base, job.generationTaskId] as const;
    const claimId = crypto.randomUUID();
    let claimWasNotSelected = false;
    const claimSubmission = async () => {
      if (submissionStopped.value) {
        claimWasNotSelected = true;
        return false;
      }
      const claimed = object(
        await call(database, scope.accountId, "videoforge_claim_hosted_api_job", [
          ...jobArgs,
          claimId,
        ]),
      );
      const selected = claimed.state === "SUBMITTING" && claimed.claimId === claimId;
      if (!selected) {
        claimWasNotSelected = true;
        // A claim miss is a durable state change or a concurrent workflow. Stop the local
        // snapshot before another queued item can make a paid POST against stale state.
        submissionStopped.value = true;
      }
      return selected;
    };
    const persistTaskId = async (taskId: string) => {
      await call(database, scope.accountId, "videoforge_record_hosted_api_task", [
        ...jobArgs,
        claimId,
        taskId,
      ]);
    };
    const markSubmissionUnknown = async () => {
      // Stop sibling dispatch before awaiting the durable terminal write. The write can be slow
      // while the other lane is already between its claim and provider call.
      submissionStopped.value = true;
      await call(database, scope.accountId, "videoforge_mark_hosted_api_unknown", [
        ...jobArgs,
        claimId,
      ]);
    };
    const markSubmissionFailed = async () => {
      submissionStopped.value = true;
      await call(database, scope.accountId, "videoforge_fail_hosted_api_job", [
        ...jobArgs,
        "PROVIDER_REQUEST_REJECTED",
      ]);
    };
    try {
      if (job.lane === "IMAGE") {
        const submission = await submitKieImageJob({
          manifest: { prompt: string(job.inputManifest.prompt), aspectRatio: "16:9" },
          client: kieClient,
          claimSubmission,
          persistTaskId,
          markSubmissionUnknown,
          markRequestRejected: markSubmissionFailed,
        });
        return submission.state === "SUBMITTED" ? "PROGRESSED" : "WAITING";
      }
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
      const [imageUrl, audioUrl] = await Promise.all([source("avatarSource"), source("spanAudio")]);
      const submission = await submitFalAvatarJob({
        imageUrl,
        audioUrl,
        client: falClient,
        claimSubmission,
        persistRequestId: persistTaskId,
        markSubmissionUnknown,
        markSubmissionFailed,
      });
      return submission.state === "SUBMITTED" ? "PROGRESSED" : "WAITING";
    } catch {
      if (!claimWasNotSelected) submissionStopped.value = true;
      return "WAITING";
    }
  };
  const observeSubmittedJob = async (job: Job): Promise<"PROGRESSED" | "WAITING"> => {
    if (!job.providerTaskId) throw new Error("HOSTED_API_PROVIDER_ID_MISSING");
    const jobArgs = [...base, job.generationTaskId] as const;
    let result:
      | Awaited<ReturnType<typeof observeKieImageJob>>
      | Awaited<ReturnType<typeof observeFalAvatarJob>>;
    try {
      result =
        job.lane === "IMAGE"
          ? await observeKieImageJob({
              taskId: job.providerTaskId,
              objectKey: job.outputObjectKey,
              client: kieClient,
              bucket,
            })
          : await observeFalAvatarJob({
              requestId: job.providerTaskId,
              objectKey: job.outputObjectKey,
              client: falClient,
              bucket,
            });
    } catch (error) {
      if (
        (error instanceof KieZImageError && error.code === "STATUS_UNKNOWN") ||
        (error instanceof KieImageJobError && error.code === "RESULT_DOWNLOAD_FAILED") ||
        (error instanceof FalFlashheadError &&
          ["STATUS_UNKNOWN", "RESULT_UNKNOWN"].includes(error.code)) ||
        (error instanceof FalAvatarJobError && error.code === "RESULT_DOWNLOAD_FAILED")
      ) {
        console.warn("hosted_api_observe_wait", {
          lane: job.lane,
          code: error.code,
        });
        return "WAITING";
      }
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
        return "PROGRESSED";
      }
      throw error;
    }
    if (result.state === "FAILED") {
      await call(database, scope.accountId, "videoforge_fail_hosted_api_job", [
        ...jobArgs,
        "PROVIDER_TASK_FAILED",
      ]);
      return "PROGRESSED";
    }
    if (result.state !== "SUCCEEDED") return "WAITING";
    const artifact = result.artifact;
    const probe =
      job.lane === "IMAGE"
        ? { width: artifact.width, height: artifact.height }
        : {
            width: artifact.width,
            height: artifact.height,
            durationMs: Math.round(
              (artifact as { durationSeconds: number }).durationSeconds * 1000,
            ),
          };
    await call(database, scope.accountId, "videoforge_commit_hosted_api_output", [
      ...jobArgs,
      artifact.sha256,
      artifact.byteSize,
      artifact.contentType,
      JSON.stringify(probe),
    ]);
    return "PROGRESSED";
  };
  // A blocked sibling stops new paid submissions, but cannot strand other paid results.
  const indices = failed || blocked ? [] : selectHostedApiGenerationJobIndices(current, observation);
  if (indices.length > 0) {
    const imageIndices = indices.filter((index) => current[index]!.lane === "IMAGE");
    const avatarIndices = indices.filter((index) => current[index]!.lane === "AVATAR");
    const [imageSubmissions, avatarSubmissions] = await Promise.all([
      settleHostedApiJobsBounded(
        imageIndices,
        1,
        (index) => submitPreparedJob(current[index]!),
        API_KIE_SUBMISSION_START_INTERVAL_MS,
      ),
      settleHostedApiJobsBounded(avatarIndices, API_FAL_SUBMISSION_CONCURRENCY, (index) =>
        submitPreparedJob(current[index]!),
      ),
    ]);
    const submissions = [...imageSubmissions, ...avatarSubmissions];
    return outcome(
      submissions.some((result) => result.status === "fulfilled" && result.value === "PROGRESSED")
        ? "PROGRESSED"
        : "WAITING",
    );
  }
  const submittedJobs = current.filter((job) => job.state === "SUBMITTED");
  if (submittedJobs.length === 0 && blocked)
    return outcome("ACTION_REQUIRED", blocked.failureCode ?? blocked.state);
  if (submittedJobs.length === 0 && failed) {
    const settlement = object(
      await call(database, scope.accountId, "videoforge_settle_hosted_api_failure", base),
    );
    if (settlement.state !== "SETTLED") throw new Error("HOSTED_API_FAILURE_SETTLEMENT_INVALID");
    return outcome("ACTION_REQUIRED", failed.failureCode ?? "PROVIDER_TASK_FAILED");
  }
  if (submittedJobs.length === 0) return outcome("ACTION_REQUIRED", "HOSTED_API_JOB_STATE_INVALID");
  const observations = await settleHostedApiJobsBounded(
    submittedJobs,
    API_OBSERVATION_CONCURRENCY,
    observeSubmittedJob,
    API_KIE_OBSERVATION_START_INTERVAL_MS,
  );
  const rejected = observations.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejected) throw rejected.reason;
  // Rate slots include their tail interval, so completed work can advance immediately.
  return outcome(
    observations.some((result) => result.status === "fulfilled" && result.value === "PROGRESSED")
      ? "PROGRESSED"
      : "WAITING",
  );
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
      const retrievalPending = current.some((job) => job.state === "SUBMITTED");
      if (
        retrievalPending || (current.length > 0 &&
        current.every((job) => ["PREPARED", "SUBMITTED", "SUCCEEDED"].includes(job.state)) &&
        (pendingJobs || renderPending))
      ) {
        if (!existing.restart)
          throw new Error("HOSTED_API_GENERATION_WORKFLOW_RESTART_UNAVAILABLE");
        await existing.restart();
      }
    }
    return { id, recovered: true };
  }
}

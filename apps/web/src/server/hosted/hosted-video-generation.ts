import type { TransactionalSqlExecutor } from "@videoforge/control-plane";
import { hostedRuntimeConfiguration, type HostedRuntimeEnvironment } from "./configuration";
import { HostedR2Signer } from "./r2";
import { callHostedApiGeneration, settleHostedApiJobsBounded, type HostedApiGenerationScope } from "./hosted-api-generation";
import { observeRunwareSeedanceJob, submitRunwareSeedanceJob, RunwareSeedanceJobError } from "../providers/runware-seedance-job";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const VIDEO_CONCURRENCY = 4;
type Job = { id: string; state: string; claimId: string | null; inputManifest: Record<string, unknown>;
  providerTaskId: string | null; outputObjectKey: string; sourceReady: boolean; durationSeconds: number; videoFrameCount: number; failureCode: string | null };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("HOSTED_VIDEO_RESPONSE_INVALID");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("HOSTED_VIDEO_INPUT_INVALID");
  return value;
}
function job(value: unknown): Job {
  const row = object(value);
  if (!UUID.test(string(row.id)) || !["PREPARED", "SUBMITTING", "SUBMITTED", "UNKNOWN_NO_RETRY", "SUCCEEDED", "FAILED"].includes(string(row.state)) ||
      !Number.isFinite(Number(row.durationSeconds)) || Number(row.durationSeconds) < 1.2 || Number(row.durationSeconds) > 12 ||
      !Number.isSafeInteger(row.videoFrameCount) || Number(row.videoFrameCount) < 1 || Number(row.videoFrameCount) > Number(row.durationSeconds) * 30)
    throw new Error("HOSTED_VIDEO_RESPONSE_INVALID");
  return { id: string(row.id), state: string(row.state), claimId: row.claimId === null ? null : string(row.claimId),
    inputManifest: object(row.inputManifest), providerTaskId: row.providerTaskId === null ? null : string(row.providerTaskId),
    outputObjectKey: string(row.outputObjectKey), sourceReady: row.sourceReady === true,
    durationSeconds: Number(row.durationSeconds), videoFrameCount: Number(row.videoFrameCount),
    failureCode: row.failureCode === null ? null : string(row.failureCode) };
}

/** One existing workload lease owns the footage too. UUID claims precede the single paid POST. */
export async function advanceHostedVideoGeneration(environment: HostedRuntimeEnvironment, database: TransactionalSqlExecutor,
  scope: HostedApiGenerationScope, allowSubmission: boolean) {
  const base = [scope.accountId, scope.workspaceId, scope.generationRequestId] as const;
  const call = (name: string, args: readonly (string | number | null)[] = base) => callHostedApiGeneration(database, scope.accountId, name, args);
  const raw = await call("videoforge_read_hosted_video_jobs");
  // Legacy fixture ports have no video result; real SQL returns hasPlan=false for legacy requests.
  if (raw === null) return { complete: true, active: false, jobCount: 0, progressed: false, problemCode: undefined as string | undefined };
  const result = object(raw);
  if (result.generationRequestId !== scope.generationRequestId || !Array.isArray(result.jobs)) throw new Error("HOSTED_VIDEO_RESPONSE_INVALID");
  const current = result.jobs.map(job);
  if (result.hasPlan !== true) {
    if (current.length) throw new Error("HOSTED_VIDEO_UNPINNED_JOBS");
    return { complete: true, active: false, jobCount: 0, progressed: false, problemCode: undefined as string | undefined };
  }
  if (result.requestState === "CANCELLED") return { complete: false, active: false, jobCount: current.length, progressed: false, problemCode: "OWNER_CANCELLED" };
  if (result.plannedJobCount === null) return { complete: false, active: false, jobCount: 0, progressed: false, problemCode: undefined as string | undefined };
  if (!Number.isSafeInteger(result.plannedJobCount) || result.plannedJobCount !== current.length) throw new Error("HOSTED_VIDEO_JOBS_INCOMPLETE");
  const config = hostedRuntimeConfiguration(environment);
  if (!config.styleAnalysis || !environment.PRIVATE_ARTIFACTS) throw new Error("HOSTED_VIDEO_BINDING_MISSING");
  const bucket = environment.PRIVATE_ARTIFACTS;
  const apiKey = config.styleAnalysis.apiKey;
  const signer = new HostedR2Signer(config.r2);
  let progressed = false;
  let stopped = false;
  const batchClaim = crypto.randomUUID();
  const pending = current.filter((item) => ["SUBMITTING", "SUBMITTED", "UNKNOWN_NO_RETRY"].includes(item.state));
  const prepared = allowSubmission && result.requestState === "ACTIVE" && !current.some((item) => ["SUBMITTING", "UNKNOWN_NO_RETRY", "FAILED"].includes(item.state))
    ? current.filter((item) => item.state === "PREPARED" && item.sourceReady).slice(0, Math.max(0, VIDEO_CONCURRENCY - pending.length)) : [];
  const submissions = await settleHostedApiJobsBounded(prepared, VIDEO_CONCURRENCY, async (item) => {
    if (stopped) return;
    const claimed = job(await call("videoforge_claim_hosted_video_job", [...base, item.id, batchClaim]));
    if (claimed.state !== "SUBMITTING" || claimed.claimId !== batchClaim) { stopped = true; return; }
    const input = claimed.inputManifest;
    const fail = (code: string) => call("videoforge_fail_hosted_video_job", [...base, item.id, code]);
    try {
      if (input.taskUUID !== claimed.id || input.model !== "bytedance:2@2" || input.width !== 1248 || input.height !== 704 ||
          Number(input.durationSeconds) !== claimed.durationSeconds || Number(input.videoFrameCount) !== claimed.videoFrameCount)
        throw new RunwareSeedanceJobError("INPUT_INVALID");
      const signed = await signer.sign({ method: "GET",
        objectKey: string(input.sourceImageObjectKey), contentType: string(input.sourceImageContentType),
        contentLength: Number(input.sourceImageContentLength), checksumSha256: string(input.sourceImageSha256),
        lifetimeSeconds: 3600 });
      await submitRunwareSeedanceJob({ taskUUID: claimed.id, apiKey, imageUrl: signed.url,
        prompt: string(input.prompt), durationSeconds: claimed.durationSeconds, claimSubmission: async () => true,
        persistRequestId: async (id) => { await call("videoforge_record_hosted_video_task", [...base, item.id, batchClaim, id]); },
        markSubmissionFailed: async () => { stopped = true; await fail("SEEDANCE_SUBMIT_REJECTED"); },
        markSubmissionUnknown: async () => { stopped = true; await call("videoforge_mark_hosted_video_unknown", [...base, item.id, batchClaim]); } });
      progressed = true;
    } catch (error) {
      stopped = true;
      if (error instanceof RunwareSeedanceJobError && error.code === "INPUT_INVALID") { await fail("SEEDANCE_INPUT_INVALID"); return; }
      if (error instanceof RunwareSeedanceJobError && ["SUBMIT_UNKNOWN", "SUBMIT_REJECTED"].includes(error.code)) {
        if (error.submissionDiagnostic) console.warn("SEEDANCE_SUBMISSION_DIAGNOSTIC", {
          jobId: item.id, kind: error.submissionDiagnostic.kind, httpStatus: error.submissionDiagnostic.httpStatus,
        });
        return;
      }
      throw error;
    }
  }, 250);
  const observations = await settleHostedApiJobsBounded(pending, 1, async (item) => {
    try {
      // SUBMITTING/UNKNOWN retain the pre-POST UUID, even if the acknowledgment was lost.
      const observed = await observeRunwareSeedanceJob({ requestId: item.id, apiKey,
        objectKey: item.outputObjectKey, durationSeconds: item.durationSeconds, bucket,
        recordProviderCost: async (cost) => { await call("videoforge_record_hosted_video_cost", [...base, item.id, cost]); } });
      if (item.state !== "SUBMITTED" && observed.state === "PENDING" && !observed.submissionConfirmed) return;
      if (item.state !== "SUBMITTED") {
        await call("videoforge_record_hosted_video_task", [...base, item.id, string(item.claimId), item.id]);
        progressed = true;
      }
      if (observed.state === "PENDING") return;
      if (observed.state === "FAILED") { await call("videoforge_fail_hosted_video_job", [...base, item.id, "SEEDANCE_PROVIDER_FAILED"]); progressed = true; return; }
      if (observed.state !== "SUCCEEDED") return;
      if (observed.artifact.durationSeconds * 30 + 0.001 < item.videoFrameCount) {
        await call("videoforge_fail_hosted_video_job", [...base, item.id, "SEEDANCE_CLIP_TOO_SHORT"]); progressed = true; return;
      }
      await call("videoforge_commit_hosted_video_output", [...base, item.id, observed.artifact.sha256,
        observed.artifact.byteSize, observed.artifact.contentType, JSON.stringify({ width: observed.artifact.width,
          height: observed.artifact.height, durationMs: Math.round(observed.artifact.durationSeconds * 1000) }), observed.costUsd]);
      progressed = true;
    } catch (error) {
      if (error instanceof RunwareSeedanceJobError && ["POLL_UNAVAILABLE", "RESPONSE_INVALID", "RESULT_STORAGE_UNKNOWN", "RESULT_DOWNLOAD_FAILED"].includes(error.code)) return;
      if (error instanceof RunwareSeedanceJobError && ["RESULT_MP4_INVALID", "RESULT_PRICE_CHANGED"].includes(error.code)) {
        if (item.state !== "SUBMITTED") await call("videoforge_record_hosted_video_task", [...base, item.id, string(item.claimId), item.id]);
        stopped = true;
        await call("videoforge_fail_hosted_video_job", [...base, item.id,
          error.code === "RESULT_PRICE_CHANGED" ? "SEEDANCE_PRICE_CHANGED" : "SEEDANCE_RESULT_INVALID"]); progressed = true; return;
      }
      throw error;
    }
  }, 250);
  for (const settled of [...submissions, ...observations]) if (settled.status === "rejected") throw settled.reason;
  if (result.requestState === "CANCELLING") {
    const settled = object(await call("videoforge_settle_hosted_video_cancellation"));
    return { complete: false, active: settled.state !== "SETTLED", jobCount: current.length, progressed,
      problemCode: settled.state === "SETTLED" ? "OWNER_CANCELLED" : undefined };
  }
  const failed = current.find((item) => item.state === "FAILED");
  const blocked = current.find((item) => ["SUBMITTING", "UNKNOWN_NO_RETRY"].includes(item.state));
  return { complete: current.every((item) => item.state === "SUCCEEDED"),
    active: pending.length > 0 || prepared.length > 0 || progressed, jobCount: current.length, progressed,
    problemCode: failed?.failureCode ?? (failed ? "SEEDANCE_PROVIDER_FAILED" : blocked ? "SEEDANCE_SUBMISSION_UNCERTAIN" : undefined) };
}

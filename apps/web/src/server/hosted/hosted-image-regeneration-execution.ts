import type { TransactionalSqlExecutor } from "@videoforge/control-plane";
import { hostedRuntimeConfiguration, type HostedRuntimeEnvironment } from "./configuration";
import { createHostedImageRegenerationService } from "./hosted-image-regeneration-service";
import { createHostedRunPodPair, type HostedPairLiveEnvironment } from "./hosted-pair-live-wiring";
import { HostedSqlImageRegenerationStore } from "./hosted-image-regeneration-store";
import {
  HostedImageRegenerationRuntime,
  type HostedImageRegenerationRequest,
} from "./hosted-image-regeneration-runtime";
import { createHostedV209TerminalOutputIngestor } from "./hosted-v209-terminal-output-ingestor";
import { readImageRegenerationCost } from "./hosted-image-regeneration-cost";
import { hostedPairProductionBindingState } from "./hosted-pair-production-composition";
import { KieZImageClient, KieZImageError } from "../providers/kie-z-image";
import { KieImageJobError, observeKieImageJob, submitKieImageJob } from "../providers/kie-image-job";
export interface ImageRegenerationParameters {
  schema_version: "videoforge-image-regeneration-workflow/v1";
  accountId: string;
  workspaceId: string;
  requestId: string;
}
async function observeApiImageRegeneration(
  environment: HostedRuntimeEnvironment,
  store: HostedSqlImageRegenerationStore,
  row: Record<string, unknown>,
) {
  const config = hostedRuntimeConfiguration(environment);
  if (!config.apiGeneration || !environment.PRIVATE_ARTIFACTS)
    throw new Error("HOSTED_IMAGE_REGENERATION_API_BINDING_MISSING");
  const requestId = String(row.id);
  const client = new KieZImageClient(config.apiGeneration.kieApiKey);
  if (row.state === "PREPARED") {
    const claimId = crypto.randomUUID();
    try {
      await submitKieImageJob({
        manifest: {
          prompt: String((row.inputManifest as Record<string, unknown>).prompt),
          aspectRatio: "16:9",
        },
        client,
        claimSubmission: async () => {
          const claimed = await store.claimApi(requestId, claimId);
          return claimed.state === "SUBMITTING" && claimed.claimId === claimId;
        },
        persistTaskId: (taskId) => store.recordApiTask(requestId, claimId, taskId).then(() => {}),
        markRequestRejected: () => store.failApi(requestId, "PROVIDER_REQUEST_REJECTED").then(() => {}),
        markSubmissionUnknown: () => store.markApiUnknown(requestId, claimId).then(() => {}),
      });
    } catch {
      // Database state retains the exact claim or definite failure. Never replay this POST.
    }
    row = (await store.loadApi(requestId)) ?? row;
  }
  if (row.state === "SUBMITTING") {
    const updatedAt = Date.parse(String(row.updatedAt));
    if (!Number.isFinite(updatedAt) || typeof row.claimId !== "string")
      throw new Error("HOSTED_IMAGE_REGENERATION_API_CLAIM_INVALID");
    if (Date.now() - updatedAt > 180_000)
      row = await store.markApiUnknown(requestId, row.claimId);
  }
  if (row.state === "SUBMITTED") {
    if (typeof row.providerTaskId !== "string")
      throw new Error("HOSTED_IMAGE_REGENERATION_API_TASK_INVALID");
    try {
      const result = await observeKieImageJob({
        taskId: row.providerTaskId,
        objectKey: String(row.outputObjectKey),
        client,
        bucket: environment.PRIVATE_ARTIFACTS,
      });
      if (result.state === "FAILED")
        row = await store.failApi(requestId, "PROVIDER_TASK_FAILED");
      else if (result.state === "SUCCEEDED")
        row = await store.commitApi(requestId, result.artifact);
    } catch (error) {
      if (
        (error instanceof KieZImageError && error.code === "RESPONSE_INVALID") ||
        (error instanceof KieImageJobError && error.code === "RESULT_MEDIA_INVALID")
      ) row = await store.failApi(requestId, "PROVIDER_OUTPUT_INVALID");
      else if (
        !(error instanceof KieZImageError && error.code === "STATUS_UNKNOWN") &&
        !(error instanceof KieImageJobError && error.code === "RESULT_DOWNLOAD_FAILED")
      ) throw error;
    }
  }
  const released = ["SUCCEEDED", "FAILED"].includes(String(row.state));
  return {
    requestId,
    state: String(row.state),
    providerJobId: typeof row.providerTaskId === "string" ? row.providerTaskId : null,
    replaced: row.state === "SUCCEEDED",
    leaseReleased: released,
  };
}
export async function observeHostedImageRegeneration(
  environment: HostedRuntimeEnvironment & HostedPairLiveEnvironment,
  database: TransactionalSqlExecutor,
  params: ImageRegenerationParameters,
) {
  const store = new HostedSqlImageRegenerationStore(database, params.accountId, params.workspaceId);
  const api = await store.loadApi(params.requestId);
  if (api) return observeApiImageRegeneration(environment, store, api);
  if (hostedPairProductionBindingState(environment).state === "DISABLED_UNQUALIFIED")
    return { requestId: params.requestId, state: "DISABLED_UNQUALIFIED",
      providerJobId: null, replaced: false, leaseReleased: false };
  let row = await store.load(params.requestId);
  if (row.account_id !== params.accountId || row.workspace_id !== params.workspaceId)
    throw new Error("HOSTED_IMAGE_REGENERATION_SCOPE_INVALID");
  if (row.state === "QUEUED") {
    if (Date.now() - Date.parse(String(row.created_at)) > 600_000) {
      await store.failQueued(params.requestId);
      return {
        requestId: params.requestId,
        state: "FAILED",
        providerJobId: null,
        replaced: false,
        leaseReleased: true,
      };
    }
    await createHostedImageRegenerationService({
      database,
      environment,
      config: hostedRuntimeConfiguration(environment),
      scheduleWorkflow: false,
    }).create({
      accountId: params.accountId,
      workspaceId: params.workspaceId,
      projectId: String(row.project_id),
      imageTaskId: String(row.image_task_id),
      revisionId: String(row.project_revision_id),
      prompt: String(row.edited_prompt),
      idempotencyKey: String(row.idempotency_key),
    });
    row = await store.load(params.requestId);
    if (row.state === "QUEUED")
      return {
        requestId: params.requestId,
        state: "QUEUED",
        providerJobId: null,
        replaced: false,
        leaseReleased: false,
      };
  }
  const provider = await createHostedRunPodPair(environment);
  const key = environment.VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY;
  if (
    !environment.PRIVATE_ARTIFACTS ||
    !key ||
    !/^[0-9a-f]{64}$/u.test(key) ||
    !environment.VIDEOFORGE_PROVIDER_PROOF_KEY_ID
  )
    throw new Error("HOSTED_IMAGE_REGENERATION_RECEIPT_CONFIG_INVALID");
  const output = createHostedV209TerminalOutputIngestor({
    database,
    bucket: environment.PRIVATE_ARTIFACTS,
    receiptKeyId: environment.VIDEOFORGE_PROVIDER_PROOF_KEY_ID,
    receiptKey: Uint8Array.from({ length: 32 }, (_, index) =>
      Number.parseInt(key.slice(index * 2, index * 2 + 2), 16),
    ),
    store: store.terminalStore(params.requestId),
  });
  const request: HostedImageRegenerationRequest = {
    accountId: params.accountId,
    workspaceId: params.workspaceId,
    requestId: params.requestId,
    sceneId: String(row.image_task_id),
    editedPrompt: String(row.edited_prompt),
    envelope: row.envelope as Record<string, unknown>,
    requestBody: row.request_body as Record<string, unknown>,
    endpointIdSha256: row.endpoint_id_sha256 as `sha256:${string}`,
    dispatchToken: String(row.dispatch_token),
  };
  const expired = Date.now() >= Date.parse(String(row.deadline_at));
  if (expired && row.state === "PREPARED") await store.cancelUnsent(params.requestId);
  if (!expired && row.state === "PREPARED") {
    try {
      const [, cost] = await Promise.all([
        provider.clients.mage_image.confirmOrdinaryStartupQueueEmpty(),
        readImageRegenerationCost(environment.RUNPOD_API_KEY!, () => store.databaseNow()),
      ]);
      await store.admitCost(params.requestId, cost);
    } catch {
      // No /run has occurred. Fail closed and continue through the normal drain/release path.
      await store.cancelUnsent(params.requestId);
      console.info("hosted_image_regeneration", {
        requestId: params.requestId,
        phase: "PREDISPATCH_CHECK_FAILED",
      });
    }
  }
  const runtime = new HostedImageRegenerationRuntime(store, provider.transports.mage_image, {
    accept: (args) =>
      output.acceptCompleted({
        accountId: params.accountId,
        workspaceId: params.workspaceId,
        attemptId: String(row.attempt_id),
        lane: "mage_image",
        providerJobId: args.providerJobId,
        output: args.output,
        observedAt: new Date().toISOString(),
      }),
  });
  let result = await runtime.run(request);
  console.info("hosted_image_regeneration", {
    requestId: params.requestId,
    phase: "OBSERVED",
    state: result.state,
  });
  if (expired && result.state === "ASSIGNED" && result.providerJobId) {
    await provider.transports.mage_image.cancel(result.providerJobId);
    result = await runtime.run(request);
  }
  if (["COMPLETED", "FAILED", "CANCELLED", "REQUEST_REJECTED"].includes(result.state)) {
    let proof: Awaited<ReturnType<typeof provider.clients.mage_image.confirmDrained>>;
    try {
      proof = await provider.clients.mage_image.confirmDrained(6, {
        allowStandbyWorkers: true,
        deadlineMs: 30_000,
      });
    } catch {
      return { ...result, leaseReleased: false };
    }
    await store.release(params.requestId, proof);
    console.info("hosted_image_regeneration", {
      requestId: params.requestId,
      phase: "PROVIDER_ABSENCE_VERIFIED",
      state: result.state,
    });
    return { ...result, leaseReleased: true };
  }
  return { ...result, leaseReleased: false };
}

import { canonicalSha256 } from "@videoforge/control-plane";

import type {
  V213LiveExecutionRequest,
  V213LiveTransport,
} from "../runtime/v213-live-acceptance.js";
import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration.js";
import { createNeonExecutor, createNeonPool } from "./neon.js";
import { V213SqlAcceptanceWorkflowControl } from "./v213-acceptance-workflow-production.js";
import {
  parseV213AcceptanceWorkflowParameters,
  type V213AcceptanceOperation,
  type V213AcceptanceWorkflowParameters,
} from "./v213-acceptance-workflow-runner.js";
import type { V213OperatorRouteDependencies } from "./v213-live-operator-route.js";
import {
  createV213HostedAcceptanceProductionFactory,
  V213SqlSignedEvidenceStore,
} from "./v213-live-production-adapters.js";

const MAX_STATUS_BYTES = 256 * 1024;
const HEX_KEY = /^[0-9a-f]{64,512}$/u;

export interface V213DatabaseWorkflowExecution {
  readonly schemaVersion: "videoforge.v213-database-acceptance-execution/v2";
  readonly operationId: V213AcceptanceOperation;
  readonly checkpoint: "V2-10" | "V2-11" | "V2-12" | "V2-13";
  readonly workflowId: string;
  readonly workflowParams: V213AcceptanceWorkflowParameters;
  readonly call: Readonly<Record<string, unknown>>;
  readonly pollIntervalMs: number;
  readonly workloadDeadlineAt: string;
}

interface WorkflowOutput {
  readonly rawEvidence: Readonly<Record<string, unknown>>;
  readonly receipt: Readonly<Record<string, unknown>>;
  readonly cleanup: Readonly<Record<string, unknown>>;
}

export function parseV213DatabaseWorkflowExecution(
  value: Readonly<Record<string, unknown>>,
): V213DatabaseWorkflowExecution {
  const operationCheckpoint = {
    "v2-10-operator-free-ranga-pilot": "V2-10",
    "v2-11-two-concurrent-owned-projects": "V2-11",
    "v2-12-long-output": "V2-12",
    "v2-13-final-two-lane-smoke": "V2-13",
  } as const;
  const operationId = value.operationId as keyof typeof operationCheckpoint;
  const workflowParams = parseV213AcceptanceWorkflowParameters(value.workflowParams);
  const call =
    value.call && typeof value.call === "object" && !Array.isArray(value.call)
      ? (value.call as Record<string, unknown>)
      : null;
  const request =
    call?.request && typeof call.request === "object" && !Array.isArray(call.request)
      ? (call.request as Record<string, unknown>)
      : null;
  const expectedCallKeys =
    value.checkpoint === "V2-10" || value.checkpoint === "V2-12" ? "admission,request" : "request";
  const scopes = Array.isArray(request?.scopes) ? request.scopes : [];
  const exactScope = (scope: unknown) =>
    Boolean(
      scope &&
        typeof scope === "object" &&
        !Array.isArray(scope) &&
        Object.keys(scope).sort().join(",") ===
          "accountId,attemptId,projectId,projectRevisionId,requestSha256,workspaceId",
    );
  if (
    value.schemaVersion !== "videoforge.v213-database-acceptance-execution/v2" ||
    !Object.hasOwn(operationCheckpoint, operationId) ||
    operationCheckpoint[operationId] !== value.checkpoint ||
    !["V2-10", "V2-11", "V2-12", "V2-13"].includes(String(value.checkpoint)) ||
    typeof value.workflowId !== "string" ||
    !value.workflowParams ||
    typeof value.workflowParams !== "object" ||
    Array.isArray(value.workflowParams) ||
    !call ||
    Object.keys(call).sort().join(",") !== expectedCallKeys ||
    Object.keys(value).sort().join(",") !==
      "call,checkpoint,operationId,pollIntervalMs,schemaVersion,workflowId,workflowParams,workloadDeadlineAt" ||
    !Number.isInteger(value.pollIntervalMs) ||
    Number(value.pollIntervalMs) < 250 ||
    Number(value.pollIntervalMs) > 10_000 ||
    typeof value.workloadDeadlineAt !== "string" ||
    !Number.isFinite(Date.parse(value.workloadDeadlineAt)) ||
    new Date(value.workloadDeadlineAt).toISOString() !== value.workloadDeadlineAt ||
    workflowParams.operationId !== value.operationId ||
    workflowParams.checkpoint !== value.checkpoint ||
    workflowParams.workflowId !== value.workflowId ||
    !request ||
    Object.keys(request).sort().join(",") !==
      "approvalRecordSha256,authoritySha256,billingBaselineMicroUsd,checkpoint,cumulativeLedgerSha256,cumulativeLedgerSpentBeforeMicroUsd,executionId,executorSha256,maximumCumulativeVariableCostMicroUsd,maximumVariableCostMicroUsd,noRedispatch,promotionDecisionSha256,proposalSha256,retainedVolumeIdSha256s,scopes,sourceCommit" ||
    request.checkpoint !== value.checkpoint ||
    typeof request.executionId !== "string" ||
    value.workflowId !== `v213-${String(value.checkpoint).toLowerCase()}-${request.executionId}` ||
    scopes.length !== (value.checkpoint === "V2-11" ? 2 : 1) ||
    scopes.some((scope) => !exactScope(scope))
  )
    throw new Error("V213_DATABASE_EXECUTION_INVALID");
  return value as unknown as V213DatabaseWorkflowExecution;
}

function workflowOutput(value: unknown): WorkflowOutput | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const status = value as Record<string, unknown>;
    if (status.status !== "complete" || !status.output || typeof status.output !== "object")
      return null;
    const output = status.output as Record<string, unknown>;
    if (
      Object.keys(output).sort().join(",") !== "cleanup,rawEvidence,receipt" ||
      [output.rawEvidence, output.receipt, output.cleanup].some(
        (field) => !field || typeof field !== "object" || Array.isArray(field),
      ) ||
      JSON.stringify(value).length > MAX_STATUS_BYTES
    )
      return null;
    return output as unknown as WorkflowOutput;
  } catch {
    return null;
  }
}

export class V213WorkflowLiveTransport implements V213LiveTransport {
  readonly kind = "CLOUDFLARE_HOSTED_RUNPOD_SERVERLESS" as const;
  constructor(
    private readonly workflow: NonNullable<HostedRuntimeEnvironment["HOSTED_PAIR_WORKFLOW"]>,
    private readonly execution: V213DatabaseWorkflowExecution,
    private readonly evidence: Pick<
      V213SqlSignedEvidenceStore,
      "finalizeVerifierDocument" | "signAndStore"
    >,
    private readonly resumeOnly = false,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly control?: Pick<V213SqlAcceptanceWorkflowControl, "requestCleanup">,
  ) {}

  private expectedWorkflowId(request: V213LiveExecutionRequest) {
    const expected = `v213-${request.checkpoint.toLowerCase()}-${request.executionId}`;
    if (this.execution.workflowId !== expected || this.execution.checkpoint !== request.checkpoint)
      throw new Error("V213_WORKFLOW_IDENTITY_DRIFT");
    return expected;
  }

  async execute(request: V213LiveExecutionRequest) {
    const workflowId = this.expectedWorkflowId(request);
    let instance!: Awaited<ReturnType<typeof this.workflow.get>>;
    if (this.resumeOnly) {
      instance = await this.workflow.get(workflowId);
    } else {
      let created: { id: string } | undefined;
      try {
        created = await this.workflow.create({
          id: workflowId,
          params: structuredClone(this.execution.workflowParams),
        });
      } catch {
        instance = await this.workflow.get(workflowId);
      }
      if (created) {
        if (created.id !== workflowId) throw new Error("V213_WORKFLOW_IDENTITY_DRIFT");
        instance = await this.workflow.get(workflowId);
      }
    }
    let output: WorkflowOutput | null = null;
    const deadline = Date.parse(this.execution.workloadDeadlineAt);
    while (this.now() <= deadline && !output) {
      output = workflowOutput(await instance.status());
      if (!output && this.now() <= deadline) await this.sleep(this.execution.pollIntervalMs);
    }
    if (!output) throw new Error("V213_WORKFLOW_ACK_UNKNOWN");
    const rawEvidence =
      request.checkpoint === "V2-13"
        ? output.rawEvidence
        : await (() => {
            const artifactSha256 = canonicalSha256({ workflowId, kind: "raw-evidence" });
            const kind =
              request.checkpoint === "V2-10"
                ? "V210_OUTPUT"
                : request.checkpoint === "V2-11"
                  ? "V211_EVIDENCE"
                  : "V212_OUTPUT";
            return this.evidence
              .finalizeVerifierDocument(kind, artifactSha256, output.rawEvidence)
              .then((document) => this.evidence.signAndStore(kind, document, artifactSha256));
          })();
    const receiptReferenceSha256 = canonicalSha256({ workflowId, kind: "receipt" });
    const receipt = await this.evidence.finalizeVerifierDocument(
      "RECEIPT",
      receiptReferenceSha256,
      {
        ...output.receipt,
        rawEvidenceSha256: canonicalSha256(rawEvidence),
      },
    );
    const receiptArtifact = await this.evidence.signAndStore(
      "RECEIPT",
      receipt,
      receiptReferenceSha256,
    );
    return { rawEvidence, receiptArtifact };
  }

  async cancelAndReconcile(request: V213LiveExecutionRequest) {
    const workflowId = this.expectedWorkflowId(request);
    const instance = await this.workflow.get(workflowId);
    if (!this.control) throw new Error("V213_WORKFLOW_CLEANUP_CONTROL_MISSING");
    await this.control.requestCleanup(this.execution.workflowParams);
    await instance.sendEvent({
      type: "V213_CANCEL_AND_RECONCILE_ONLY",
      workflowId,
      requestSha256: canonicalSha256(request),
      redispatchAllowed: false,
    });
    const deadline = Math.max(
      Date.parse(this.execution.workloadDeadlineAt),
      this.now() + this.execution.pollIntervalMs * 3,
    );
    const reads: WorkflowOutput[] = [];
    while (this.now() <= deadline && reads.length < 3) {
      const output = workflowOutput(await instance.status());
      if (output) reads.push(output);
      if (reads.length < 3 && this.now() <= deadline)
        await this.sleep(this.execution.pollIntervalMs);
    }
    const output = reads[2];
    if (!output || reads.length !== 3) throw new Error("V213_WORKFLOW_CLEANUP_ACK_UNKNOWN");
    const referenceSha256 = canonicalSha256({ workflowId, kind: "cleanup" });
    const cleanup = await this.evidence.finalizeVerifierDocument(
      "CLEANUP",
      referenceSha256,
      output.cleanup,
    );
    return {
      cleanupArtifact: await this.evidence.signAndStore("CLEANUP", cleanup, referenceSha256),
    };
  }
}

function signingKey(environment: HostedRuntimeEnvironment): Uint8Array {
  const value = environment.VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX;
  if (!value || !HEX_KEY.test(value) || value.length % 2 !== 0)
    throw new Error("V213_EVIDENCE_SIGNING_KEY_UNAVAILABLE");
  return Uint8Array.from(value.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

export function createV213WorkerLiveAcceptanceExecute(
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
): V213OperatorRouteDependencies["execute"] {
  return async (checkpoint, databaseValue, mode) => {
    const execution = parseV213DatabaseWorkflowExecution(databaseValue);
    if (
      execution.checkpoint !== checkpoint ||
      !environment.HOSTED_PAIR_WORKFLOW ||
      !environment.VIDEOFORGE_RECONCILER_DATABASE_URL
    )
      throw new Error("V213_WORKER_EXECUTION_DISABLED");
    const pool = createNeonPool(config.neon.databaseUrl);
    const reconcilerPool = createNeonPool(environment.VIDEOFORGE_RECONCILER_DATABASE_URL);
    try {
      const database = createNeonExecutor(pool);
      const key = signingKey(environment);
      const evidence = new V213SqlSignedEvidenceStore(database, key);
      const control = new V213SqlAcceptanceWorkflowControl(createNeonExecutor(reconcilerPool));
      const transport = new V213WorkflowLiveTransport(
        environment.HOSTED_PAIR_WORKFLOW,
        execution,
        evidence,
        mode === "RECONCILE",
        undefined,
        undefined,
        control,
      );
      const factory = createV213HostedAcceptanceProductionFactory({
        database,
        evidenceSigningKey: key,
        transport,
        now: () => new Date(),
      });
      const call = execution.call;
      const result =
        checkpoint === "V2-10"
          ? await factory.acceptance.executeV210({
              request: call.request as never,
              admission: call.admission as never,
              repository: factory.shortPilotRepository,
              outputVerifier: factory.shortPilotOutputVerifier,
            })
          : checkpoint === "V2-11"
            ? await factory.acceptance.executeV211({
                request: call.request as never,
                evidenceVerifier: factory.v211EvidenceVerifier,
              })
            : checkpoint === "V2-12"
              ? await factory.acceptance.executeV212({
                  request: call.request as never,
                  admission: call.admission as never,
                  repository: factory.productionLengthRepository,
                  outputVerifier: factory.productionLengthOutputVerifier,
                })
              : await factory.acceptance.executeV213({
                  request: call.request as never,
                  releaseIdentity: call.releaseIdentity as never,
                  evidenceArtifacts: call.evidenceArtifacts as never,
                  releaseEvidenceVerifier: factory.releaseEvidenceVerifier,
                  chromeArtifact: call.chromeArtifact as never,
                  chromeVerifier: factory.chromeVerifier,
                });
      return { evidenceSha256: result.summary.evidenceSha256, summary: { ...result.summary } };
    } finally {
      await Promise.allSettled([pool.end(), reconcilerPool.end()]);
    }
  };
}

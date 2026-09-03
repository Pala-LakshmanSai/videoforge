import { canonicalizeJson, type Sha256Digest } from "@videoforge/contracts";
import { PromptExecutionError } from "@videoforge/control-plane";
import type {
  DurablePromptWriterPort,
  DurablePromptWriterResult,
  PromptWriterAttemptFact,
} from "@videoforge/control-plane";
import {
  RunwarePromptWriter,
  validatePromptWriterOutput,
  type PromptBatch,
  type PromptBatchPlan,
  type PromptSceneInput,
  type PromptWriterSceneOutput,
  type RunwarePromptAttemptEvidence,
  type RunwarePromptTransport,
  type RunwarePromptTransportRequest,
  type RunwarePromptTransportResult,
} from "@videoforge/pipeline";

import {
  RunwarePromptHttpTransport,
  RunwareSpendLedger,
  type RunwareSafeDiagnostic,
} from "../providers/runware-http-transport";

export const HOSTED_PROMPT_RESERVATION_MICRO_USD = 40_000 as const;
export const HOSTED_PROMPT_RESERVATION_USD = HOSTED_PROMPT_RESERVATION_MICRO_USD / 1_000_000;

type CapturedAttempt = {
  request: RunwarePromptTransportRequest;
  result: RunwarePromptTransportResult | null;
  evidence: RunwarePromptAttemptEvidence | null;
};

export interface HostedAcceptedPromptBatch {
  /** Zero-based durable transport ordinal. */
  readonly batchOrdinal: number;
  readonly firstSceneOrdinal: number;
  readonly scenes: readonly {
    readonly sceneOrdinal: number;
    readonly scene: PromptSceneInput;
    readonly writerOutput: PromptWriterSceneOutput;
  }[];
  readonly requestBytes: string;
  readonly requestHash: Sha256Digest;
  readonly responseBytes: string;
  readonly responseHash: Sha256Digest;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reportedCostMicroUsd: number;
}

export type HostedPromptFailureState = "FAILED" | "UNKNOWN";
export type HostedPromptProblemCode =
  | "HOSTED_PROMPT_INPUT_INVALID"
  | "HOSTED_PROMPT_PROVIDER_REJECTED"
  | "HOSTED_PROMPT_EXECUTION_UNKNOWN";

/**
 * Carries only bounded, non-secret provider diagnostics through the generic
 * prompt service. PromptExecutionError is intentional: the durable service
 * preserves known prompt errors instead of replacing them with OUTPUT_INVALID.
 */
export class HostedPromptExecutionError extends PromptExecutionError {
  public override readonly name = "HostedPromptExecutionError";

  public constructor(
    public readonly problemCode: HostedPromptProblemCode,
    public readonly terminalState: HostedPromptFailureState,
    public readonly providerMayHaveCharged: boolean,
    public readonly diagnostic: RunwareSafeDiagnostic | null,
    public readonly additionalKnownCostMicroUsd: number = 0,
  ) {
    super("OUTPUT_INVALID", problemCode);
  }
}

async function sha256Utf8(value: string): Promise<Sha256Digest> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function actualCostMicroUsd(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > HOSTED_PROMPT_RESERVATION_USD)
    throw new RangeError("Runware prompt cost exceeds the hosted prompt reservation.");
  return Math.ceil(value * 1_000_000);
}

export class HostedRunwarePromptWriter implements DurablePromptWriterPort {
  public readonly operation = "runware.write" as const;

  public constructor(
    private readonly apiKey: string,
    private readonly plan: PromptBatchPlan,
    private readonly fetcher: typeof fetch = fetch,
    private readonly onBatchAccepted?: (batch: HostedAcceptedPromptBatch) => Promise<void> | void,
  ) {
    if (apiKey.trim().length === 0) throw new TypeError("Runware API key is required.");
  }

  public async write(batch: PromptBatch): Promise<DurablePromptWriterResult> {
    const plannedSceneIds = this.plan.batches.flatMap((entry) => entry.sceneIds);
    if (
      this.plan.totalScenes !== batch.scenes.length ||
      plannedSceneIds.length !== batch.scenes.length ||
      plannedSceneIds.some((sceneId, index) => sceneId !== batch.scenes[index]?.sceneId)
    )
      throw new HostedPromptExecutionError("HOSTED_PROMPT_INPUT_INVALID", "FAILED", false, null);
    const ledger = new RunwareSpendLedger(HOSTED_PROMPT_RESERVATION_USD);
    const diagnosticState: { current: RunwareSafeDiagnostic | null } = { current: null };
    const acceptedScenes: PromptWriterSceneOutput[] = [];
    const batchFacts: HostedAcceptedPromptBatch[] = [];
    const captured: CapturedAttempt[] = [];
    let currentDispatchStart = 0;
    let persistenceStarted = false;
    try {
      for (const entry of this.plan.batches) {
        const remainingReservationUsd = ledger.snapshot().remainingUsd;
        if (remainingReservationUsd <= 0)
          throw new RangeError("Runware prompt reservation is exhausted.");
        const base = new RunwarePromptHttpTransport({
          apiKey: this.apiKey,
          ledger,
          maximumRequestCostUsd: remainingReservationUsd,
          fetch: this.fetcher,
          onDiagnostic(diagnostic) {
            diagnosticState.current = diagnostic;
          },
        });
        currentDispatchStart = captured.length;
        persistenceStarted = false;
        const transport: RunwarePromptTransport = {
          dispatch: async (request) => {
            const row: CapturedAttempt = { request, result: null, evidence: null };
            captured.push(row);
            const result = await base.dispatch(request);
            row.result = result;
            return result;
          },
        };
        const writer = new RunwarePromptWriter({
          transport,
          evidenceSink: {
            record(evidence) {
              const row = captured.at(-1);
              if (!row || row.evidence) throw new Error("PROMPT_ATTEMPT_EVIDENCE_CONFLICT");
              row.evidence = evidence;
            },
          },
          maximumBatchCostUsd: remainingReservationUsd,
          allowPartialRetry: false,
          minimumBatchScenes: 1,
        });
        const output = validatePromptWriterOutput(entry.batch, await writer.write(entry.batch));
        const row = captured.at(-1);
        const result = row?.result;
        const evidence = row?.evidence;
        if (!row || !result || result.status !== "succeeded" || !evidence)
          throw new Error("PROMPT_BATCH_NOT_DURABLY_REPORTABLE");
        const responseBytes = result.outputText;
        const responseHash = await sha256Utf8(responseBytes);
        if (
          responseHash !== evidence.responseSha256 ||
          evidence.acceptedSceneIds.length !== entry.sceneIds.length ||
          evidence.acceptedSceneIds.some((sceneId, index) => sceneId !== entry.sceneIds[index]) ||
          evidence.unresolvedSceneIds.length !== 0
        )
          throw new Error("PROMPT_BATCH_EVIDENCE_MISMATCH");
        const fact = Object.freeze({
          batchOrdinal: entry.ordinal - 1,
          firstSceneOrdinal: entry.sceneStartIndex,
          scenes: Object.freeze(
            entry.batch.scenes.map((scene, index) =>
              Object.freeze({
                sceneOrdinal: entry.sceneStartIndex + index,
                scene,
                writerOutput: output.scenes[index]!,
              }),
            ),
          ),
          requestBytes: row.request.requestBytes,
          requestHash: row.request.requestSha256,
          responseBytes,
          responseHash,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          reportedCostMicroUsd: actualCostMicroUsd(result.costUsd),
        });
        persistenceStarted = true;
        await this.onBatchAccepted?.(fact);
        persistenceStarted = false;
        acceptedScenes.push(...output.scenes);
        batchFacts.push(fact);
      }
      const output = validatePromptWriterOutput(batch, {
        batch_id: batch.batchId,
        scenes: acceptedScenes,
      });
      const requestBytes = canonicalizeJson({
        schema_version: "videoforge.runware-adaptive-batch-request-set/v1",
        requests: batchFacts.map((fact) => ({
          batch_ordinal: fact.batchOrdinal,
          scene_ids: fact.scenes.map((scene) => scene.scene.sceneId),
          request_bytes: fact.requestBytes,
          request_hash: fact.requestHash,
        })),
      });
      const responseBytes = canonicalizeJson({
        schema_version: "videoforge.runware-adaptive-batch-response-set/v1",
        responses: batchFacts.map((fact) => ({
          batch_ordinal: fact.batchOrdinal,
          scene_ids: fact.scenes.map((scene) => scene.scene.sceneId),
          response_bytes: fact.responseBytes,
          response_hash: fact.responseHash,
        })),
      });
      const attempts: readonly PromptWriterAttemptFact[] = Object.freeze([
        Object.freeze({
          attemptIndex: 1,
          requestedSceneIds: Object.freeze(batch.scenes.map((scene) => scene.sceneId)),
          requestBytes,
          requestHash: await sha256Utf8(requestBytes),
          responseBytes,
          responseHash: await sha256Utf8(responseBytes),
          retryOfRequestHash: null,
          acceptedSceneIds: Object.freeze(batch.scenes.map((scene) => scene.sceneId)),
          unresolvedSceneIds: Object.freeze([]),
          inputTokens: batchFacts.reduce((total, fact) => total + fact.inputTokens, 0),
          outputTokens: batchFacts.reduce((total, fact) => total + fact.outputTokens, 0),
          reportedCostMicroUsd: batchFacts.reduce(
            (total, fact) => total + fact.reportedCostMicroUsd,
            0,
          ),
        }),
      ]);
      return Object.freeze({ output, attempts });
    } catch (error) {
      if (error instanceof HostedPromptExecutionError) throw error;
      if (persistenceStarted) {
        throw new HostedPromptExecutionError(
          "HOSTED_PROMPT_EXECUTION_UNKNOWN",
          "UNKNOWN",
          true,
          diagnosticState.current,
        );
      }
      const current = captured.length > currentDispatchStart ? captured.at(-1) : null;
      const preDispatchFailure = current === null;
      const definiteProviderRejection = current?.result?.status === "failed";
      if (preDispatchFailure) {
        throw new HostedPromptExecutionError(
          "HOSTED_PROMPT_INPUT_INVALID",
          "FAILED",
          false,
          diagnosticState.current,
        );
      }
      if (definiteProviderRejection) {
        throw new HostedPromptExecutionError(
          "HOSTED_PROMPT_PROVIDER_REJECTED",
          "FAILED",
          false,
          diagnosticState.current,
        );
      }
      if (current?.result?.status === "succeeded") {
        throw new HostedPromptExecutionError(
          "HOSTED_PROMPT_INPUT_INVALID",
          "FAILED",
          false,
          diagnosticState.current,
          actualCostMicroUsd(current.result.costUsd),
        );
      }
      throw new HostedPromptExecutionError(
        "HOSTED_PROMPT_EXECUTION_UNKNOWN",
        "UNKNOWN",
        true,
        diagnosticState.current,
      );
    }
  }
}

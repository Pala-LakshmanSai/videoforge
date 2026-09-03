import type { Sha256Digest } from "@videoforge/contracts";
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
const PER_ATTEMPT_CAP_USD = HOSTED_PROMPT_RESERVATION_USD / 2;

type CapturedAttempt = {
  request: RunwarePromptTransportRequest;
  result: RunwarePromptTransportResult | null;
  evidence: RunwarePromptAttemptEvidence | null;
};

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
  if (!Number.isFinite(value) || value < 0 || value > PER_ATTEMPT_CAP_USD)
    throw new RangeError("Runware prompt cost exceeds its per-attempt reservation.");
  return Math.ceil(value * 1_000_000);
}

export class HostedRunwarePromptWriter implements DurablePromptWriterPort {
  public readonly operation = "runware.write" as const;

  public constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (apiKey.trim().length === 0) throw new TypeError("Runware API key is required.");
  }

  public async write(batch: PromptBatch): Promise<DurablePromptWriterResult> {
    const ledger = new RunwareSpendLedger(HOSTED_PROMPT_RESERVATION_USD);
    const captured: CapturedAttempt[] = [];
    const diagnosticState: { current: RunwareSafeDiagnostic | null } = { current: null };
    const base = new RunwarePromptHttpTransport({
      apiKey: this.apiKey,
      ledger,
      maximumRequestCostUsd: PER_ATTEMPT_CAP_USD,
      fetch: this.fetcher,
      onDiagnostic(diagnostic) {
        diagnosticState.current = diagnostic;
      },
    });
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
          const row = captured.find(
            (candidate) => candidate.request.attemptIndex === evidence.attemptIndex,
          );
          if (!row || row.evidence) throw new Error("PROMPT_ATTEMPT_EVIDENCE_CONFLICT");
          row.evidence = evidence;
        },
      },
      maximumBatchCostUsd: HOSTED_PROMPT_RESERVATION_USD,
    });
    try {
      const output = validatePromptWriterOutput(batch, await writer.write(batch));
      const attempts: PromptWriterAttemptFact[] = [];
      for (const row of captured) {
        const result = row.result;
        const evidence = row.evidence;
        if (!result || result.status !== "succeeded" || !evidence)
          throw new Error("PROMPT_ATTEMPT_NOT_DURABLY_REPORTABLE");
        const responseBytes = result.outputText;
        const responseHash = await sha256Utf8(responseBytes);
        if (responseHash !== evidence.responseSha256)
          throw new Error("PROMPT_ATTEMPT_RESPONSE_HASH_MISMATCH");
        attempts.push(
          Object.freeze({
            attemptIndex: row.request.attemptIndex,
            requestedSceneIds: row.request.requestedSceneIds,
            requestBytes: row.request.requestBytes,
            requestHash: row.request.requestSha256,
            responseBytes,
            responseHash,
            retryOfRequestHash: row.request.retryOfRequestSha256,
            acceptedSceneIds: evidence.acceptedSceneIds,
            unresolvedSceneIds: evidence.unresolvedSceneIds,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            reportedCostMicroUsd: actualCostMicroUsd(result.costUsd),
          }),
        );
      }
      if (attempts.length < 1 || attempts.length > 2)
        throw new Error("PROMPT_ATTEMPT_COUNT_INVALID");
      return Object.freeze({ output, attempts: Object.freeze(attempts) });
    } catch (error) {
      if (error instanceof HostedPromptExecutionError) throw error;
      const results = captured.flatMap((row) => (row.result ? [row.result] : []));
      const preDispatchFailure = captured.length === 0;
      const definiteProviderRejection =
        results.length === captured.length && results.every((result) => result.status === "failed");
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
      throw new HostedPromptExecutionError(
        "HOSTED_PROMPT_EXECUTION_UNKNOWN",
        "UNKNOWN",
        true,
        diagnosticState.current,
      );
    }
  }
}

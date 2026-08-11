import {
  RunwareDeepSeekPromptWriter,
  RunwareGeminiStyleAnalyzer,
  type RunwareGeminiStyleAnalyzerOptions,
  type RunwarePromptAttemptEvidenceSink,
  type RunwarePromptTransport,
} from "@videoforge/pipeline";

import { loadRunwareApiKeyFromKeychain } from "./keychain";
import {
  RunwarePromptHttpTransport,
  RunwareSpendLedger,
  RunwareStyleHttpTransport,
  type RunwareSafeDiagnostic,
} from "./runware-http-transport";

export const RUNWARE_RUNTIME_CAP_USD = 0.2 as const;
export const RUNWARE_PROMPT_REQUEST_CAP_USD = 0.02 as const;
export const RUNWARE_STYLE_REQUEST_CAP_USD = 0.08 as const;

export interface RunwareRuntimeEnvironment {
  readonly VIDEOFORGE_PROVIDER_MODE?: string;
  readonly VIDEOFORGE_RUNWARE_ENABLED?: string;
  readonly VIDEOFORGE_RUNWARE_CAP_USD?: string;
}

export interface RunwareRuntime {
  readonly ledger: RunwareSpendLedger;
  readonly diagnostics: readonly RunwareSafeDiagnostic[];
  readonly promptTransport: RunwarePromptTransport;
  readonly promptWriter: RunwareDeepSeekPromptWriter;
  createStyleAnalyzer(
    options: Omit<RunwareGeminiStyleAnalyzerOptions, "transport">,
  ): RunwareGeminiStyleAnalyzer;
}

export function isRunwareRuntimeRequested(source: RunwareRuntimeEnvironment): boolean {
  const enabled = source.VIDEOFORGE_RUNWARE_ENABLED;
  const cap = source.VIDEOFORGE_RUNWARE_CAP_USD;
  if (enabled === undefined && cap === undefined) return false;
  if (
    source.VIDEOFORGE_PROVIDER_MODE !== "sandbox" ||
    enabled !== "true" ||
    cap !== RUNWARE_RUNTIME_CAP_USD.toFixed(2)
  ) {
    throw new Error("RUNWARE_RUNTIME_AUTHORITY_INVALID");
  }
  return true;
}

export async function createRunwareRuntime(
  source: RunwareRuntimeEnvironment,
  promptEvidenceSink: RunwarePromptAttemptEvidenceSink,
): Promise<RunwareRuntime | null> {
  if (!isRunwareRuntimeRequested(source)) return null;
  const apiKey = await loadRunwareApiKeyFromKeychain();
  const ledger = new RunwareSpendLedger(RUNWARE_RUNTIME_CAP_USD);
  const diagnostics: RunwareSafeDiagnostic[] = [];
  const onDiagnostic = (diagnostic: RunwareSafeDiagnostic): void => {
    diagnostics.push(diagnostic);
  };
  const promptTransport = new RunwarePromptHttpTransport({
    apiKey,
    ledger,
    maximumRequestCostUsd: RUNWARE_PROMPT_REQUEST_CAP_USD,
    onDiagnostic,
  });
  const styleTransport = new RunwareStyleHttpTransport({
    apiKey,
    ledger,
    maximumRequestCostUsd: RUNWARE_STYLE_REQUEST_CAP_USD,
    onDiagnostic,
  });
  return Object.freeze({
    ledger,
    promptTransport,
    get diagnostics(): readonly RunwareSafeDiagnostic[] {
      return Object.freeze([...diagnostics]);
    },
    promptWriter: new RunwareDeepSeekPromptWriter({
      transport: promptTransport,
      evidenceSink: promptEvidenceSink,
      maximumBatchCostUsd: RUNWARE_PROMPT_REQUEST_CAP_USD * 2,
    }),
    createStyleAnalyzer: (
      options: Omit<RunwareGeminiStyleAnalyzerOptions, "transport">,
    ): RunwareGeminiStyleAnalyzer =>
      new RunwareGeminiStyleAnalyzer({ ...options, transport: styleTransport }),
  });
}

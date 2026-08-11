import type { Sha256Digest } from "@videoforge/contracts";
import type {
  CompiledImagePrompt,
  PromptSceneInput,
  PromptStyleComponents,
  PromptWriterBatchOutput,
} from "@videoforge/pipeline";

export const DURABLE_PROMPT_EXECUTION_VERSION = "videoforge.durable-prompt-execution/v1" as const;

export interface PromptExecutionScope {
  readonly workspaceId: string;
  readonly actorUserId: string;
}

export interface PromptExecutionCommand {
  readonly projectId: string;
  readonly revisionId: string;
  readonly timelineId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly outboxId: string;
  readonly presentedClaimTokenHash: Sha256Digest;
}

export interface PromptExecutionAuthority {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly projectTitle: string;
  readonly revisionState: "GENERATING";
  readonly timelineId: string;
  readonly timelineHash: Sha256Digest;
  readonly timelineState: "CURRENT";
  readonly imageStyleVersionId: string;
  readonly styleProfileHash: Sha256Digest;
  readonly styleState: "PUBLISHED";
  readonly plannerGuidance: string;
  readonly style: PromptStyleComponents;
  readonly extraPromptKeywords: string | null;
  readonly applyExtraPromptKeywords: boolean;
  readonly continuityTags: readonly string[];
  readonly scenes: readonly PromptSceneInput[];
  readonly taskId: string;
  readonly taskState: "RUNNING" | "SUCCEEDED" | "CANCELLED";
  readonly attemptId: string;
  readonly attemptOrdinal: number;
  readonly attemptState: "CLAIMED" | "SUCCEEDED" | "CANCELLED";
  readonly claimTokenHash: Sha256Digest;
  readonly recordedInputHash: Sha256Digest;
  readonly outboxId: string;
  readonly outboxState: "ACKNOWLEDGED";
  readonly reservedCostMicroUsd: number;
  readonly accepted: AcceptedPromptExecution | null;
}

export interface PromptWriterAttemptFact {
  readonly attemptIndex: 1 | 2;
  readonly requestedSceneIds: readonly string[];
  readonly requestBytes: string;
  readonly requestHash: Sha256Digest;
  readonly responseBytes: string;
  readonly responseHash: Sha256Digest;
  readonly retryOfRequestHash: Sha256Digest | null;
  readonly acceptedSceneIds: readonly string[];
  readonly unresolvedSceneIds: readonly string[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reportedCostMicroUsd: number;
}

export interface DurablePromptWriterResult {
  readonly output: PromptWriterBatchOutput;
  readonly attempts: readonly PromptWriterAttemptFact[];
}

export interface DurablePromptWriterPort {
  readonly operation: "fixture.write" | "qualified_fake.write";
  write(batch: import("@videoforge/pipeline").PromptBatch): Promise<DurablePromptWriterResult>;
}

export interface AcceptedPromptExecution {
  readonly schemaVersion: typeof DURABLE_PROMPT_EXECUTION_VERSION;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly timelineId: string;
  readonly timelineHash: Sha256Digest;
  readonly imageStyleVersionId: string;
  readonly styleProfileHash: Sha256Digest;
  readonly taskId: string;
  readonly attemptId: string;
  readonly attemptOrdinal: number;
  readonly outboxId: string;
  readonly inputHash: Sha256Digest;
  readonly requestHash: Sha256Digest;
  readonly responseHash: Sha256Digest;
  readonly compiledOutputHash: Sha256Digest;
  readonly acceptanceFingerprintHash: Sha256Digest;
  readonly writerAttempts: readonly PromptWriterAttemptFact[];
  readonly writerOutput: PromptWriterBatchOutput;
  readonly compiledPrompts: readonly CompiledImagePrompt[];
  readonly reportedCostMicroUsd: number;
  readonly acceptedAt: string;
}

export interface AcceptPromptExecutionCommand {
  readonly authority: PromptExecutionAuthority;
  readonly acceptance: AcceptedPromptExecution;
}

export interface PromptExecutionStore {
  resolve(
    scope: PromptExecutionScope,
    command: PromptExecutionCommand,
  ): Promise<PromptExecutionAuthority | null>;
  accept(
    scope: PromptExecutionScope,
    command: AcceptPromptExecutionCommand,
  ): Promise<{ readonly accepted: AcceptedPromptExecution; readonly replayed: boolean }>;
}

export interface PromptExecutionClock {
  now(): string;
}

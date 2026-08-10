import type {
  CanonicalDocument,
  CommonConflictCode,
  CommonInvariantCode,
  EntityId,
  IdempotentMutation,
  IdempotentRepositoryResult,
  JsonObject,
  RepositoryResult,
  Sha256,
  UtcTimestamp,
  WorkspaceActorScope,
  WorkspaceScope,
} from "./types.js";

export interface CanonicalDocumentIdentity {
  readonly contractName: string;
  readonly contractVersion: string;
  readonly canonicalDocumentSha256: Sha256;
}

export interface TranscriptWordRecord {
  readonly wordId: EntityId;
  readonly index: number;
  readonly text: string;
  readonly startMs: number;
  readonly endMsExclusive: number;
  readonly confidence: number | null;
}

export interface TranscriptSentenceRecord {
  readonly sentenceId: EntityId;
  readonly sentenceKey: string;
  readonly index: number;
  readonly wordStart: number;
  readonly wordEndExclusive: number;
  readonly startMs: number;
  readonly endMsExclusive: number;
  readonly text: string;
}

export interface TranscriptPhraseRecord {
  readonly phraseId: EntityId;
  readonly phraseKey: string;
  readonly sentenceId: EntityId;
  readonly index: number;
  readonly wordStart: number;
  readonly wordEndExclusive: number;
  readonly startMs: number;
  readonly endMsExclusive: number;
  readonly pauseBeforeMs: number;
  readonly pauseAfterMs: number;
  readonly text: string;
}

export interface PersistTranscriptTimingCommand extends IdempotentMutation {
  readonly projectId: EntityId;
  readonly projectRevisionId: EntityId;
  /** Zero means no head exists yet; all later writes use the exact observed head version. */
  readonly expectedHeadVersion: number;
  readonly transcriptId: EntityId;
  readonly lineageSequence: number;
  readonly supersedesTranscriptId: EntityId | null;
  readonly sourceAssetId: EntityId;
  readonly sourceBinarySha256: Sha256;
  readonly sourceDurationMs: number;
  readonly engineName: string;
  readonly engineVersion: string;
  readonly modelName: string;
  readonly modelSha256: Sha256;
  readonly language: string;
  readonly transcriptionConfigHash: Sha256;
  readonly optionalScriptHash: Sha256 | null;
  readonly inputFingerprintHash: Sha256;
  readonly canonicalDocumentAssetId: EntityId;
  readonly canonicalDocument: CanonicalDocument;
  readonly words: readonly TranscriptWordRecord[];
  readonly sentences: readonly TranscriptSentenceRecord[];
  readonly phrases: readonly TranscriptPhraseRecord[];
  readonly createdAt: UtcTimestamp;
}

export interface PersistedTranscriptTiming {
  readonly transcriptId: EntityId;
  readonly projectRevisionId: EntityId;
  readonly lineageSequence: number;
  readonly supersedesTranscriptId: EntityId | null;
  readonly sourceAssetId: EntityId;
  readonly sourceBinarySha256: Sha256;
  readonly sourceDurationMs: number;
  readonly engineName: string;
  readonly engineVersion: string;
  readonly modelName: string;
  readonly modelSha256: Sha256;
  readonly language: string;
  readonly transcriptionConfigHash: Sha256;
  readonly optionalScriptHash: Sha256 | null;
  readonly inputFingerprintHash: Sha256;
  readonly canonicalDocumentAssetId: EntityId;
  readonly canonicalDocument: CanonicalDocumentIdentity;
  readonly words: readonly TranscriptWordRecord[];
  readonly sentences: readonly TranscriptSentenceRecord[];
  readonly phrases: readonly TranscriptPhraseRecord[];
  readonly headVersion: number;
  readonly createdAt: UtcTimestamp;
}

export type TimelineComposition = "AVATAR_FULL" | "IMAGE_FULL" | "AVATAR_SPLIT_IMAGE";
export type InImageShotRole =
  | "ENVIRONMENTAL_WIDE"
  | "HUMAN_MEDIUM"
  | "HANDS_ACTION"
  | "OBJECT_EVIDENCE"
  | "MACRO_DETAIL"
  | "REACTION_RESULT";

export interface TimelineSegmentRecord {
  readonly segmentId: EntityId;
  readonly segmentKey: string;
  readonly index: number;
  readonly startFrame: number;
  readonly endFrameExclusive: number;
  readonly sourceAudioStartMs: number;
  readonly sourceAudioEndMsExclusive: number;
  readonly wordStart: number;
  readonly wordEndExclusive: number;
  readonly timelineComposition: TimelineComposition;
  readonly inImageShotRole: InImageShotRole | null;
  readonly narration: string;
  readonly requiredSlots: JsonObject;
}

export interface SelectedSpanAudioRecord {
  readonly spanId: EntityId;
  readonly spanKey: string;
  readonly timelineSegmentId: EntityId;
  readonly transcriptId: EntityId;
  readonly taskKey: string;
  readonly sourceAssetId: EntityId;
  readonly sourceBinarySha256: Sha256;
  readonly selectedStartMs: number;
  readonly selectedEndMsExclusive: number;
  readonly paddedStartMs: number;
  readonly paddedEndMsExclusive: number;
  readonly trimStartMs: number;
  readonly trimEndMsExclusive: number;
}

export interface PersistTimelinePlanCommand extends IdempotentMutation {
  readonly projectId: EntityId;
  readonly projectRevisionId: EntityId;
  readonly expectedHeadVersion: number;
  readonly timelinePlanId: EntityId;
  readonly transcriptId: EntityId;
  readonly planSequence: number;
  readonly supersedesTimelinePlanId: EntityId | null;
  readonly revisionConfigHash: Sha256;
  readonly transcriptDocumentHash: Sha256;
  readonly schedulerVersion: string;
  readonly schedulerConfigHash: Sha256;
  readonly seed: bigint;
  readonly inputFingerprintHash: Sha256;
  readonly canonicalDocumentAssetId: EntityId;
  readonly canonicalDocument: CanonicalDocument;
  readonly outputFpsNum: 30;
  readonly outputFpsDen: 1;
  readonly totalFrames: number;
  readonly segments: readonly TimelineSegmentRecord[];
  readonly selectedSpanAudio: readonly SelectedSpanAudioRecord[];
  readonly createdAt: UtcTimestamp;
}

export interface PersistedTimelinePlan {
  readonly timelinePlanId: EntityId;
  readonly projectRevisionId: EntityId;
  readonly transcriptId: EntityId;
  readonly planSequence: number;
  readonly supersedesTimelinePlanId: EntityId | null;
  readonly revisionConfigHash: Sha256;
  readonly transcriptDocumentHash: Sha256;
  readonly schedulerVersion: string;
  readonly schedulerConfigHash: Sha256;
  readonly seed: bigint;
  readonly inputFingerprintHash: Sha256;
  readonly canonicalDocumentAssetId: EntityId;
  readonly canonicalDocument: CanonicalDocumentIdentity;
  readonly outputFpsNum: 30;
  readonly outputFpsDen: 1;
  readonly totalFrames: number;
  readonly segments: readonly TimelineSegmentRecord[];
  readonly selectedSpanAudio: readonly SelectedSpanAudioRecord[];
  readonly headVersion: number;
  readonly createdAt: UtcTimestamp;
}

export type TimingInvalidationReason =
  | "SOURCE_CHANGED"
  | "MODEL_CHANGED"
  | "CONFIG_CHANGED"
  | "SCRIPT_CHANGED"
  | "SCHEDULER_CHANGED";

export interface InvalidateTimingCommand extends IdempotentMutation {
  readonly invalidationId: EntityId;
  readonly projectId: EntityId;
  readonly projectRevisionId: EntityId;
  readonly expectedHeadVersion: number;
  readonly nextInputFingerprintHash: Sha256;
  readonly reason: TimingInvalidationReason;
  readonly invalidatedAt: UtcTimestamp;
}

export interface TimingInvalidation {
  readonly invalidationId: EntityId;
  readonly projectRevisionId: EntityId;
  readonly invalidatedHeadVersion: number;
  readonly invalidatedTranscriptId: EntityId;
  readonly invalidatedTimelinePlanId: EntityId | null;
  readonly priorTranscriptInputFingerprintHash: Sha256;
  readonly priorTimelineInputFingerprintHash: Sha256 | null;
  readonly nextInputFingerprintHash: Sha256;
  readonly reason: TimingInvalidationReason;
  readonly createdByUserId: EntityId;
  readonly createdAt: UtcTimestamp;
  readonly headVersion: number;
}

export interface ExactTimingPlanLookup {
  readonly projectId: EntityId;
  readonly projectRevisionId: EntityId;
  readonly transcriptInputFingerprintHash: Sha256;
  readonly timelineInputFingerprintHash: Sha256;
}

export interface TimingPlanResolution {
  readonly projectId: EntityId;
  readonly projectRevisionId: EntityId;
  readonly headVersion: number;
  readonly transcript: PersistedTranscriptTiming;
  readonly timelinePlan: PersistedTimelinePlan;
}

export type TimingConflict =
  | CommonConflictCode
  | "TIMING_HEAD_VERSION_MISMATCH"
  | "TIMING_INPUT_EXISTS";
export type TimingMissing =
  | "ASSET"
  | "PROJECT"
  | "PROJECT_REVISION"
  | "TIMING_HEAD"
  | "TIMELINE_PLAN"
  | "TRANSCRIPT";
export type TimingInvariant =
  | CommonInvariantCode
  | "CANONICAL_DOCUMENT_MISMATCH"
  | "REVISION_NOT_LOCKED"
  | "SELECTED_SPAN_OWNERSHIP_MISMATCH"
  | "TIMELINE_COVERAGE_INVALID"
  | "TIMING_HEAD_NOT_EMPTY"
  | "TIMING_INPUT_MISMATCH"
  | "TRANSCRIPT_COVERAGE_INVALID";

export interface TimingRepository {
  persistTranscriptTiming(
    scope: WorkspaceActorScope,
    command: PersistTranscriptTimingCommand,
  ): Promise<
    IdempotentRepositoryResult<
      PersistedTranscriptTiming,
      TimingConflict,
      TimingMissing,
      TimingInvariant
    >
  >;

  persistTimelinePlan(
    scope: WorkspaceActorScope,
    command: PersistTimelinePlanCommand,
  ): Promise<
    IdempotentRepositoryResult<
      PersistedTimelinePlan,
      TimingConflict,
      TimingMissing,
      TimingInvariant
    >
  >;

  invalidateTiming(
    scope: WorkspaceActorScope,
    command: InvalidateTimingCommand,
  ): Promise<
    IdempotentRepositoryResult<TimingInvalidation, TimingConflict, TimingMissing, TimingInvariant>
  >;

  resolveExactPlan(
    scope: WorkspaceScope,
    lookup: ExactTimingPlanLookup,
  ): Promise<
    RepositoryResult<TimingPlanResolution, TimingConflict, TimingMissing, TimingInvariant>
  >;
}

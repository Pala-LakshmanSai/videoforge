import type { Sha256Digest } from "@videoforge/contracts/canonical-json";
import type { CreateProjectRequest } from "@videoforge/contracts/create-project";

export const LOCAL_PROJECT_ID = "project_local_owned_001";
export const LOCAL_REVISION_ID = "revision_local_owned_001";

export type LocalPipelineStage =
  | "TRANSCRIBING"
  | "SCHEDULING"
  | "RESOLVING_ASSETS"
  | "RENDERING"
  | "PROBING";

export interface LocalOwnedVoiceover {
  readonly assetId: string;
  readonly checksum: Sha256Digest;
  readonly filename: string;
  readonly absolutePath: string;
  readonly bytes: number;
  readonly durationSeconds: number;
  readonly sampleRate: number;
  readonly channels: 1 | 2;
}

export interface LocalPipelineProgress {
  readonly stage: LocalPipelineStage;
  readonly detail: string;
}

export interface LocalPipelineRunRequest {
  readonly projectId: string;
  readonly revisionId: string;
  readonly createRequest: CreateProjectRequest;
  readonly voiceover: LocalOwnedVoiceover;
  readonly signal: AbortSignal;
  readonly onProgress: (progress: LocalPipelineProgress) => void;
}

export interface LocalSelectedSpanAudio {
  readonly spanId: string;
  readonly artifactId: string;
  readonly timelineSegmentId: string;
  readonly taskKey: string;
  readonly selectedStartMs: number;
  readonly selectedEndMsExclusive: number;
  readonly paddedStartMs: number;
  readonly paddedEndMsExclusive: number;
  readonly trimStartMs: number;
  readonly trimEndMsExclusive: number;
  readonly sha256: Sha256Digest;
  readonly bytes: number;
  readonly durationMs: number;
}

export interface LocalPipelineRunResult {
  readonly artifactRoot: string;
  readonly sourceVoiceoverSha256: Sha256Digest;
  readonly filename: string;
  readonly sha256: Sha256Digest;
  readonly bytes: number;
  readonly durationMs: number;
  readonly totalFrames: number;
  readonly transcriptSha256: Sha256Digest;
  readonly timelineSha256: Sha256Digest;
  readonly generationWorkManifestSha256: Sha256Digest;
  readonly renderWorkManifestSha256: Sha256Digest;
  readonly resolvedRenderManifestSha256: Sha256Digest;
  readonly renderResultSha256: Sha256Digest;
  readonly selectedSpanAudio: readonly LocalSelectedSpanAudio[];
  readonly evidencePath: string;
  readonly evidenceSha256: Sha256Digest;
}

export interface LocalSliceRunner {
  prepareOwnedVoiceover(): Promise<LocalOwnedVoiceover>;
  run(request: LocalPipelineRunRequest): Promise<LocalPipelineRunResult>;
  restoreLatest?(): Promise<LocalPipelineRunResult | null>;
}

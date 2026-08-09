import type { CreateProjectRequest, Sha256Digest } from "@videoforge/contracts";

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

export interface LocalPipelineRunResult {
  readonly artifactRoot: string;
  readonly filename: string;
  readonly sha256: Sha256Digest;
  readonly bytes: number;
  readonly durationMs: number;
  readonly totalFrames: number;
  readonly transcriptSha256: Sha256Digest;
  readonly timelineSha256: Sha256Digest;
  readonly resolvedRenderManifestSha256: Sha256Digest;
  readonly renderResultSha256: Sha256Digest;
  readonly evidencePath: string;
}

export interface LocalSliceRunner {
  prepareOwnedVoiceover(): Promise<LocalOwnedVoiceover>;
  run(request: LocalPipelineRunRequest): Promise<LocalPipelineRunResult>;
}

import type {
  ImageStyleAnalyzerOutputDocument,
  ImageStyleProfileDocument,
  Sha256Digest,
} from "@videoforge/contracts";

export const STYLE_TRAITS = [
  "medium",
  "realism",
  "subject_treatment",
  "camera",
  "image_framing",
  "lighting",
  "color",
  "contrast_exposure",
  "depth_of_field",
  "texture_grain",
  "human_rendering",
  "materials_environment",
  "mood",
  "continuity",
] as const;

export type StyleTrait = (typeof STYLE_TRAITS)[number];

export interface StyleReferenceBinding {
  readonly alias: string;
  readonly derivativeSha256: Sha256Digest;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

export interface StyleAnalyzerRequest {
  readonly analyzerVersion: "style-analyzer-v1";
  readonly references: readonly StyleReferenceBinding[];
}

export interface StyleAnalyzerPort {
  analyze(request: StyleAnalyzerRequest): Promise<unknown>;
}

export interface TrustedStyleProfile {
  readonly profile: ImageStyleProfileDocument;
  readonly styleProfileHash: Sha256Digest;
  readonly analyzerOutput: ImageStyleAnalyzerOutputDocument;
  readonly referenceBindings: readonly StyleReferenceBinding[];
}

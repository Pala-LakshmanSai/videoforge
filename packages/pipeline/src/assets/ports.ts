import type { Sha256Digest } from "@videoforge/contracts";

import type { TimelinePlanDocumentRef } from "../documents.js";
import type { PipelineResult } from "../errors.js";

export type AcceptedAssetKind = "AVATAR_CLIP" | "IMAGE" | "VOICEOVER";

/** Accepted immutable media metadata; locations remain adapter-owned. */
export interface AcceptedAssetBinding {
  readonly taskKey: string;
  readonly assetId: string;
  readonly sha256: Sha256Digest;
  readonly kind: AcceptedAssetKind;
  readonly rendererSourceProfile?: string;
}

export interface AcceptedAssetResolutionRequest {
  readonly timeline: TimelinePlanDocumentRef;
  readonly requiredTaskKeys: readonly string[];
  readonly candidates: readonly AcceptedAssetBinding[];
}

export interface AcceptedAssetResolution {
  readonly byTaskKey: Readonly<Record<string, AcceptedAssetBinding>>;
}

/** Pure selected-asset barrier; repositories and artifact stores implement separate adapters. */
export interface AcceptedAssetResolver {
  resolve(request: AcceptedAssetResolutionRequest): PipelineResult<AcceptedAssetResolution>;
}

import type { AcceptedAssetBinding, AcceptedAssetResolution } from "../assets/ports.js";
import type {
  ProjectRevisionDocumentRef,
  ResolvedRenderManifestDocumentRef,
  TimelinePlanDocumentRef,
} from "../documents.js";
import type { PipelineResult } from "../errors.js";
import type { ContractDocumentValidationAuthority } from "@videoforge/contracts";

export interface RenderPlanRequest {
  readonly contractDocumentAuthority?: ContractDocumentValidationAuthority;
  readonly revision: ProjectRevisionDocumentRef;
  readonly timeline: TimelinePlanDocumentRef;
  readonly voiceover: AcceptedAssetBinding;
  readonly acceptedAssets: AcceptedAssetResolution;
  readonly renderProfileVersion: string;
  readonly videoAssets?: readonly {
    readonly segmentId: string;
    readonly sourceTaskKey: string;
    readonly sourceSha256: string;
    readonly videoFrameCount: number;
    readonly assetId: string;
    readonly sha256: AcceptedAssetBinding["sha256"];
    readonly kind: "VIDEO";
  }[];
}

/** Pure render-manifest planning boundary; it never invokes a media process. */
export interface RenderPlanner {
  plan(request: RenderPlanRequest): Promise<PipelineResult<ResolvedRenderManifestDocumentRef>>;
}

export {
  collectRequiredAssetTaskKeys,
  planVNextResolvedRenderManifest,
  resolveVNextAcceptedAssets,
  resolveVNextProviderAcceptedAssets,
  vNextResolvedRenderManifestPlanner,
  VNEXT_PROVIDER_FREE_AVATAR_SOURCE_PROFILE,
  SUPPORTED_RENDER_PROFILE_VERSION,
} from "./vnext-boundary.js";
export { matchesVideoTimelineSegmentId } from "./resolved-manifest.js";

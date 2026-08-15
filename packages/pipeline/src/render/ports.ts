import type { AcceptedAssetBinding, AcceptedAssetResolution } from "../assets/ports.js";
import type {
  ProjectRevisionDocumentRef,
  ResolvedRenderManifestDocumentRef,
  TimelinePlanDocumentRef,
} from "../documents.js";
import type { PipelineResult } from "../errors.js";

export interface RenderPlanRequest {
  readonly revision: ProjectRevisionDocumentRef;
  readonly timeline: TimelinePlanDocumentRef;
  readonly voiceover: AcceptedAssetBinding;
  readonly acceptedAssets: AcceptedAssetResolution;
  readonly renderProfileVersion: string;
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
  VNEXT_ECHO_AVATAR_SOURCE_PROFILE,
  VNEXT_PROVIDER_FREE_AVATAR_SOURCE_PROFILE,
  SUPPORTED_RENDER_PROFILE_VERSION,
} from "./vnext-boundary.js";

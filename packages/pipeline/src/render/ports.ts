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
  plan(request: RenderPlanRequest): PipelineResult<ResolvedRenderManifestDocumentRef>;
}

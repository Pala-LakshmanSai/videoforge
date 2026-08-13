import type {
  AcceptedAssetBinding,
  AcceptedAssetResolution,
  AcceptedAssetResolutionRequest,
  ProviderAcceptedAssetResolutionRequest,
} from "../assets/ports.js";
import { pipelineFailure, type PipelineFailure, type PipelineResult } from "../errors.js";
import type { ResolvedRenderManifestDocumentRef } from "../documents.js";
import type { RenderPlanRequest, RenderPlanner } from "./ports.js";
import {
  collectRequiredAssetTaskKeys,
  planResolvedRenderManifest,
  resolveAcceptedAssets,
  resolveProviderAcceptedAssets,
  SUPPORTED_RENDER_PROFILE_VERSION,
} from "./resolved-manifest.js";

export const VNEXT_PROVIDER_FREE_AVATAR_SOURCE_PROFILE = "local-fixture-centered-832x480p25-v1";

function legacyProfileFailure(path: readonly (string | number)[]): PipelineFailure {
  return {
    code: "RENDER_PROFILE_MISMATCH",
    message:
      "Active vNext rendering accepts only the explicit provider-free local fixture profile until CP-07 publishes an Echo crop profile.",
    path,
  };
}

function hasOnlyVNextAvatarProfiles(candidates: readonly AcceptedAssetBinding[]): boolean {
  return candidates.every(
    (candidate) =>
      candidate.kind !== "AVATAR_CLIP" ||
      candidate.rendererSourceProfile === VNEXT_PROVIDER_FREE_AVATAR_SOURCE_PROFILE,
  );
}

export function resolveVNextAcceptedAssets(
  request: AcceptedAssetResolutionRequest,
): PipelineResult<AcceptedAssetResolution> {
  if (!hasOnlyVNextAvatarProfiles(request.candidates)) {
    return pipelineFailure(legacyProfileFailure(["candidates", "rendererSourceProfile"]));
  }
  return resolveAcceptedAssets(request);
}

export function resolveVNextProviderAcceptedAssets(
  request: ProviderAcceptedAssetResolutionRequest,
): PipelineResult<AcceptedAssetResolution> {
  if (!hasOnlyVNextAvatarProfiles(request.candidates)) {
    return pipelineFailure(legacyProfileFailure(["candidates", "rendererSourceProfile"]));
  }
  return resolveProviderAcceptedAssets(request);
}

export async function planVNextResolvedRenderManifest(
  request: RenderPlanRequest,
): Promise<PipelineResult<ResolvedRenderManifestDocumentRef>> {
  if (!hasOnlyVNextAvatarProfiles(Object.values(request.acceptedAssets.byTaskKey))) {
    return pipelineFailure(legacyProfileFailure(["acceptedAssets", "byTaskKey"]));
  }
  return planResolvedRenderManifest(request);
}

export const vNextResolvedRenderManifestPlanner: RenderPlanner = Object.freeze({
  plan: planVNextResolvedRenderManifest,
});

export { collectRequiredAssetTaskKeys, SUPPORTED_RENDER_PROFILE_VERSION };

/**
 * Historical renderer replay only. Callers must remain provider-free and must never dispatch work.
 * Active vNext code imports the render boundary from `render/ports`, never this module.
 */
export {
  collectRequiredAssetTaskKeys,
  planResolvedRenderManifest,
  resolveAcceptedAssets,
  resolveProviderAcceptedAssets,
  resolvedRenderManifestPlanner,
  timelineAcceptedAssetResolver,
  SUPPORTED_RENDER_PROFILE_VERSION,
} from "../render/resolved-manifest.js";

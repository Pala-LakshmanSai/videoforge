import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalizeJson, validateAndHashContractDocument } from "@videoforge/contracts";
import {
  collectRequiredAssetTaskKeys,
  planResolvedRenderManifest,
  resolveAcceptedAssets,
  SUPPORTED_RENDER_PROFILE_VERSION,
} from "../dist/src/index.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.resolve(packageRoot, "../contracts/generated/fixtures");

const loadFixture = async (filename) =>
  JSON.parse(await readFile(path.join(fixtureRoot, filename), "utf8"));

const CANDIDATES = Object.freeze([
  Object.freeze({
    taskKey: "avatar:seg_0001",
    assetId: "asset_avatar_seg_0001",
    sha256: `sha256:${"4".repeat(64)}`,
    kind: "AVATAR_CLIP",
    rendererSourceProfile: "avatarforcing-centered-832x480p25-v1",
  }),
  Object.freeze({
    taskKey: "image:seg_0002",
    assetId: "asset_image_seg_0002",
    sha256: `sha256:${"5".repeat(64)}`,
    kind: "IMAGE",
  }),
  Object.freeze({
    taskKey: "avatar:seg_0003",
    assetId: "asset_avatar_seg_0003",
    sha256: `sha256:${"6".repeat(64)}`,
    kind: "AVATAR_CLIP",
    rendererSourceProfile: "skyreels-centered-960x960p25-v2",
  }),
  Object.freeze({
    taskKey: "image:seg_0003:right",
    assetId: "asset_image_seg_0003_right",
    sha256: `sha256:${"7".repeat(64)}`,
    kind: "IMAGE",
  }),
]);

async function canonicalInputs() {
  const [revisionValue, timelineValue] = await Promise.all([
    loadFixture("project_revision_config.valid.json"),
    loadFixture("timeline_plan.valid.json"),
  ]);
  const [revision, timeline] = await Promise.all([
    validateAndHashContractDocument("projectRevisionConfig", revisionValue),
    validateAndHashContractDocument("timelinePlan", timelineValue),
  ]);
  return { revision, timeline };
}

function requireSuccess(result) {
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

async function requestWith(candidates = CANDIDATES) {
  const { revision, timeline } = await canonicalInputs();
  const acceptedAssets = requireSuccess(
    resolveAcceptedAssets({
      timeline,
      requiredTaskKeys: collectRequiredAssetTaskKeys(timeline.value),
      candidates,
    }),
  );
  return {
    revision,
    timeline,
    voiceover: {
      taskKey: "voiceover",
      assetId: revision.value.voiceover_asset_id,
      sha256: revision.value.voiceover_sha256,
      kind: "VOICEOVER",
    },
    acceptedAssets,
    renderProfileVersion: SUPPORTED_RENDER_PROFILE_VERSION,
  };
}

test("resolves the golden timeline into the canonical immutable render manifest", async () => {
  const request = await requestWith();
  const first = requireSuccess(await planResolvedRenderManifest(request));
  const second = requireSuccess(await planResolvedRenderManifest(request));
  const golden = await loadFixture("resolved_render_manifest.valid.json");

  assert.equal(first.contractName, "resolvedRenderManifest");
  assert.equal(first.sha256, second.sha256);
  assert.equal(canonicalizeJson(first.value), canonicalizeJson(golden));
  assert.equal(first.value.revision_config_hash, request.revision.sha256);
  assert.equal(first.value.timeline_plan_hash, request.timeline.sha256);
  assert.equal(Object.isFrozen(first.value), true);
});

test("locks exact AvatarForcing and SkyReels full/split renderer geometry", async () => {
  const manifest = requireSuccess(await planResolvedRenderManifest(await requestWith())).value;
  const full = manifest.segments.find((segment) => segment.timeline_composition === "AVATAR_FULL");
  const split = manifest.segments.find(
    (segment) => segment.timeline_composition === "AVATAR_SPLIT_IMAGE",
  );

  assert.deepEqual(full?.render, {
    avatar_source_profile: "avatarforcing-centered-832x480p25-v1",
    avatar_crop: "832:468:0:6",
    avatar_scale: "1920:1080",
    avatar_fps: "30:round=near",
  });
  assert.deepEqual(split?.render, {
    avatar_source_profile: "skyreels-centered-960x960p25-v2",
    avatar_crop: "480:540:240:210",
    avatar_scale: "960:1080",
    avatar_fps: "30:round=near",
    right_image_scale: "960:1080",
    right_image_zoom_profile: "split-right-zoom-v3",
  });
  assert.equal(
    manifest.segments
      .filter((segment) => segment.timeline_composition === "IMAGE_FULL")
      .every((segment) => segment.render.zoom_profile === "image-full-zoom-v3"),
    true,
  );
});

test("fails closed for missing, duplicate, kind-mismatched, and conflicting bindings", async () => {
  const { timeline } = await canonicalInputs();
  const requiredTaskKeys = collectRequiredAssetTaskKeys(timeline.value);

  const missing = resolveAcceptedAssets({
    timeline,
    requiredTaskKeys,
    candidates: CANDIDATES.slice(0, -1),
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "REQUIRED_ASSET_MISSING");

  const duplicate = resolveAcceptedAssets({
    timeline,
    requiredTaskKeys,
    candidates: [...CANDIDATES, CANDIDATES[0]],
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, "DUPLICATE_ASSET_BINDING");

  const wrongKind = resolveAcceptedAssets({
    timeline,
    requiredTaskKeys,
    candidates: CANDIDATES.map((candidate, index) =>
      index === 1 ? { ...candidate, kind: "AVATAR_CLIP" } : candidate,
    ),
  });
  assert.equal(wrongKind.ok, false);
  assert.equal(wrongKind.error.code, "ASSET_KIND_MISMATCH");

  const conflictingHash = resolveAcceptedAssets({
    timeline,
    requiredTaskKeys,
    candidates: CANDIDATES.map((candidate, index) =>
      index === 3
        ? {
            ...candidate,
            assetId: CANDIDATES[1].assetId,
            sha256: `sha256:${"8".repeat(64)}`,
          }
        : candidate,
    ),
  });
  assert.equal(conflictingHash.ok, false);
  assert.equal(conflictingHash.error.code, "ASSET_HASH_MISMATCH");

  const crossKindChecksum = resolveAcceptedAssets({
    timeline,
    requiredTaskKeys,
    candidates: CANDIDATES.map((candidate, index) =>
      index === 3 ? { ...candidate, sha256: CANDIDATES[2].sha256 } : candidate,
    ),
  });
  assert.equal(crossKindChecksum.ok, false);
  assert.equal(crossKindChecksum.error.code, "ASSET_KIND_MISMATCH");
});

test("rejects unsupported avatar profiles and mismatched split identities", async () => {
  const { timeline } = await canonicalInputs();
  const requiredTaskKeys = collectRequiredAssetTaskKeys(timeline.value);
  const unsupported = resolveAcceptedAssets({
    timeline,
    requiredTaskKeys,
    candidates: CANDIDATES.map((candidate, index) =>
      index === 0 ? { ...candidate, rendererSourceProfile: "unknown-profile-v1" } : candidate,
    ),
  });
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error.code, "RENDER_PROFILE_MISMATCH");

  const profileDrift = resolveAcceptedAssets({
    timeline,
    requiredTaskKeys,
    candidates: CANDIDATES.map((candidate, index) =>
      index === 2
        ? {
            ...candidate,
            assetId: CANDIDATES[0].assetId,
            sha256: CANDIDATES[0].sha256,
          }
        : candidate,
    ),
  });
  assert.equal(profileDrift.ok, false);
  assert.equal(profileDrift.error.code, "RENDER_PROFILE_MISMATCH");

  const request = await requestWith();
  const splitAvatar = request.acceptedAssets.byTaskKey["avatar:seg_0003"];
  const splitImage = request.acceptedAssets.byTaskKey["image:seg_0003:right"];
  const mismatchedSplit = {
    ...request,
    acceptedAssets: {
      byTaskKey: {
        ...request.acceptedAssets.byTaskKey,
        "image:seg_0003:right": {
          ...splitImage,
          assetId: splitAvatar.assetId,
          sha256: splitAvatar.sha256,
        },
      },
    },
  };
  const result = await planResolvedRenderManifest(mismatchedSplit);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "ASSET_KIND_MISMATCH");

  const distinctIdsSameBytes = {
    ...request,
    acceptedAssets: {
      byTaskKey: {
        ...request.acceptedAssets.byTaskKey,
        "image:seg_0003:right": {
          ...splitImage,
          sha256: splitAvatar.sha256,
        },
      },
    },
  };
  const duplicateBytes = await planResolvedRenderManifest(distinctIdsSameBytes);
  assert.equal(duplicateBytes.ok, false);
  assert.equal(duplicateBytes.error.code, "ASSET_KIND_MISMATCH");
});

test("rejects revision, narration, and render-profile drift", async () => {
  const request = await requestWith();

  const wrongNarration = await planResolvedRenderManifest({
    ...request,
    voiceover: { ...request.voiceover, sha256: `sha256:${"9".repeat(64)}` },
  });
  assert.equal(wrongNarration.ok, false);
  assert.equal(wrongNarration.error.code, "ASSET_HASH_MISMATCH");

  const wrongProfile = await planResolvedRenderManifest({
    ...request,
    renderProfileVersion: "unapproved-render-profile-v2",
  });
  assert.equal(wrongProfile.ok, false);
  assert.equal(wrongProfile.error.code, "RENDER_PROFILE_MISMATCH");

  const otherRevision = await validateAndHashContractDocument("projectRevisionConfig", {
    ...request.revision.value,
    project_revision_id: "revision_other_001",
  });
  const wrongRevision = await planResolvedRenderManifest({ ...request, revision: otherRevision });
  assert.equal(wrongRevision.ok, false);
  assert.equal(wrongRevision.error.code, "RENDER_PLAN_INVALID");

  const shortTimeline = await validateAndHashContractDocument("timelinePlan", {
    ...request.timeline.value,
    total_frames: 299,
    segments: request.timeline.value.segments.map((segment, index) =>
      index === request.timeline.value.segments.length - 1
        ? { ...segment, end_frame_exclusive: 299, source_audio_end_ms: 9967 }
        : segment,
    ),
  });
  const shortAcceptedAssets = requireSuccess(
    resolveAcceptedAssets({
      timeline: shortTimeline,
      requiredTaskKeys: collectRequiredAssetTaskKeys(shortTimeline.value),
      candidates: CANDIDATES,
    }),
  );
  const shortResult = await planResolvedRenderManifest({
    ...request,
    timeline: shortTimeline,
    acceptedAssets: shortAcceptedAssets,
  });
  assert.equal(shortResult.ok, false);
  assert.equal(shortResult.error.code, "RENDER_PLAN_INVALID");
});

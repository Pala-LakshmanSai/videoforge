import {
  validateAndHashContractDocument,
  type ResolvedRenderManifestDocument,
  type TimelinePlanDocument,
} from "@videoforge/contracts";

import type {
  AcceptedAssetBinding,
  AcceptedAssetKind,
  AcceptedAssetResolution,
  AcceptedAssetResolutionRequest,
  ProviderAcceptedAssetResolutionRequest,
  AcceptedAssetResolver,
} from "../assets/ports.js";
import type { ResolvedRenderManifestDocumentRef } from "../documents.js";
import {
  pipelineFailure,
  pipelineSuccess,
  type PipelineFailure,
  type PipelineResult,
} from "../errors.js";
import type { RenderPlanRequest, RenderPlanner } from "./ports.js";

export const SUPPORTED_RENDER_PROFILE_VERSION = "ffmpeg-render-v3";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export const SOULX_APPROVED_AVATAR_SOURCE_PROFILE = "soulx-pro-vf924u-approved-v1";
export const SOULX_CROP_PROFILE_CANDIDATE_SHA256 =
  "sha256:f6c8dd219c07a26ab67fb13d8dbc103e110b4c045307f8c3e0c70aa3d805d442";
export const SOULX_CROP_PROFILE_APPROVAL_SHA256 =
  "sha256:c3aae03da3f0134e12c2f432951189bd205dcbb7ab26a65d44061cec82984c45";

const SOULX_CROP_PROFILE_APPROVAL = {
  profile_group_id: "soulx-pro-vf924u-full-split-v1",
  candidate_sha256: SOULX_CROP_PROFILE_CANDIDATE_SHA256,
  approval_sha256: SOULX_CROP_PROFILE_APPROVAL_SHA256,
  avatar_source_sha256: "sha256:37f07580badf2c459db496e0a74a15e524534b91432478d5e84e8f084e6b1e83",
  native_sample_sha256: "sha256:db70cd410062572052313278f12d67393aba213ca607fa3a3b9e3f6aad948bf1",
  full_sample_sha256: "sha256:da31d87c2389769272733ff50a9114d4507a36aced1ebe48480c9ccf486de241",
  split_sample_sha256: "sha256:f0b02351e38e2e8570e4e586b314da30813bb0a0eb09a567912bba9725b74993",
} as const;

const AVATAR_GEOMETRY = {
  "local-fixture-centered-832x480p25-v1": {
    AVATAR_FULL: {
      avatar_source_profile: "local-fixture-centered-832x480p25-v1",
      avatar_crop: "832:468:0:6",
      avatar_scale: "1920:1080",
      avatar_fps: "30:round=near",
    },
    AVATAR_SPLIT_IMAGE: {
      avatar_source_profile: "local-fixture-centered-832x480p25-v1",
      avatar_crop: "416:468:208:6",
      avatar_scale: "960:1080",
      avatar_fps: "30:round=near",
    },
  },
  "avatarforcing-centered-832x480p25-v1": {
    AVATAR_FULL: {
      avatar_source_profile: "avatarforcing-centered-832x480p25-v1",
      avatar_crop: "832:468:0:6",
      avatar_scale: "1920:1080",
      avatar_fps: "30:round=near",
    },
    AVATAR_SPLIT_IMAGE: {
      avatar_source_profile: "avatarforcing-centered-832x480p25-v1",
      avatar_crop: "416:468:208:6",
      avatar_scale: "960:1080",
      avatar_fps: "30:round=near",
    },
  },
  "skyreels-centered-960x960p25-v2": {
    AVATAR_FULL: {
      avatar_source_profile: "skyreels-centered-960x960p25-v2",
      avatar_crop: "960:540:0:210",
      avatar_scale: "1920:1080",
      avatar_fps: "30:round=near",
    },
    AVATAR_SPLIT_IMAGE: {
      avatar_source_profile: "skyreels-centered-960x960p25-v2",
      avatar_crop: "480:540:240:210",
      avatar_scale: "960:1080",
      avatar_fps: "30:round=near",
    },
  },
  "echomimic-v3-flash-turbo-fp8-centered-1024x560p25-v1": {
    AVATAR_FULL: {
      avatar_source_profile: "echomimic-v3-flash-turbo-fp8-centered-1024x560p25-v1",
      avatar_crop: "992:558:16:0",
      avatar_scale: "1920:1080",
      avatar_fps: "30:round=near",
    },
    AVATAR_SPLIT_IMAGE: {
      avatar_source_profile: "echomimic-v3-flash-turbo-fp8-centered-1024x560p25-v1",
      avatar_crop: "496:558:280:0",
      avatar_scale: "960:1080",
      avatar_fps: "30:round=near",
    },
  },
  [SOULX_APPROVED_AVATAR_SOURCE_PROFILE]: {
    AVATAR_FULL: {
      avatar_source_profile: SOULX_APPROVED_AVATAR_SOURCE_PROFILE,
      crop_profile_id: "soulx-pro-ranga-full-source-composite-v1",
      crop_profile_evidence_sha256: SOULX_CROP_PROFILE_CANDIDATE_SHA256,
      crop_profile_acceptance_sha256: SOULX_CROP_PROFILE_APPROVAL_SHA256,
      source_background_transform: "scale=1920:1080:flags=lanczos,fps=30",
      native_foreground_transform: "scale=1080:1080:flags=lanczos,fps=30,format=rgba",
      native_foreground_overlay: { x: 420, y: 0 },
      horizontal_alpha_feather_pixels_each_edge: 32,
      avatar_scale: "1920:1080",
      avatar_fps: "30:round=near",
    },
    AVATAR_SPLIT_IMAGE: {
      avatar_source_profile: SOULX_APPROVED_AVATAR_SOURCE_PROFILE,
      crop_profile_id: "soulx-pro-ranga-split-composite-v1",
      crop_profile_evidence_sha256: SOULX_CROP_PROFILE_CANDIDATE_SHA256,
      crop_profile_acceptance_sha256: SOULX_CROP_PROFILE_APPROVAL_SHA256,
      context_transform:
        "scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=960:1080,zoompan=z=min(zoom+0.000133333,1.04):d=300:s=960x1080:fps=30",
      avatar_crop: "448:504:32:4",
      avatar_scale: "960:1080",
      avatar_fps: "30:round=near",
    },
  },
} as const;

type AvatarSourceProfile = keyof typeof AVATAR_GEOMETRY;
type TimelineSegment = TimelinePlanDocument["segments"][number];

interface RequiredAssetSlot {
  readonly taskKey: string;
  readonly kind: Exclude<AcceptedAssetKind, "VOICEOVER">;
  readonly path: readonly (string | number)[];
}

function fail(
  code: PipelineFailure["code"],
  message: string,
  path: PipelineFailure["path"],
  details?: PipelineFailure["details"],
): PipelineFailure {
  return {
    code,
    message,
    path,
    ...(details === undefined ? {} : { details }),
  };
}

function slotsForSegment(segment: TimelineSegment, index: number): readonly RequiredAssetSlot[] {
  const basePath = ["timeline", "segments", index, "required_slots"] as const;
  if (segment.timeline_composition === "AVATAR_FULL") {
    return [
      {
        taskKey: segment.required_slots.avatar.task_key,
        kind: "AVATAR_CLIP",
        path: [...basePath, "avatar", "task_key"],
      },
    ];
  }
  if (segment.timeline_composition === "IMAGE_FULL") {
    return [
      {
        taskKey: segment.required_slots.image.task_key,
        kind: "IMAGE",
        path: [...basePath, "image", "task_key"],
      },
    ];
  }
  return [
    {
      taskKey: segment.required_slots.avatar.task_key,
      kind: "AVATAR_CLIP",
      path: [...basePath, "avatar", "task_key"],
    },
    {
      taskKey: segment.required_slots.right_image.task_key,
      kind: "IMAGE",
      path: [...basePath, "right_image", "task_key"],
    },
  ];
}

function requiredSlots(
  timeline: TimelinePlanDocument,
):
  | { readonly ok: true; readonly slots: ReadonlyMap<string, RequiredAssetSlot> }
  | { readonly ok: false; readonly error: PipelineFailure } {
  const slots = new Map<string, RequiredAssetSlot>();
  for (const [index, segment] of timeline.segments.entries()) {
    for (const slot of slotsForSegment(segment, index)) {
      const previous = slots.get(slot.taskKey);
      if (previous !== undefined && previous.kind !== slot.kind) {
        return {
          ok: false,
          error: fail(
            "ASSET_KIND_MISMATCH",
            `Task key ${slot.taskKey} is reused for incompatible asset kinds.`,
            slot.path,
          ),
        };
      }
      slots.set(slot.taskKey, previous ?? slot);
    }
  }
  return { ok: true, slots };
}

export function collectRequiredAssetTaskKeys(timeline: TimelinePlanDocument): readonly string[] {
  const result = requiredSlots(timeline);
  return result.ok ? Object.freeze([...result.slots.keys()]) : Object.freeze([]);
}

function isAvatarSourceProfile(value: string | undefined): value is AvatarSourceProfile {
  return value !== undefined && Object.hasOwn(AVATAR_GEOMETRY, value);
}

function immutableBinding(binding: AcceptedAssetBinding): AcceptedAssetBinding {
  return Object.freeze({
    taskKey: binding.taskKey,
    assetId: binding.assetId,
    sha256: binding.sha256,
    kind: binding.kind,
    ...(binding.rendererSourceProfile === undefined
      ? {}
      : { rendererSourceProfile: binding.rendererSourceProfile }),
  });
}

export function resolveAcceptedAssets(
  request: AcceptedAssetResolutionRequest,
): PipelineResult<AcceptedAssetResolution> {
  const slotResult = requiredSlots(request.timeline.value);
  if (!slotResult.ok) return pipelineFailure(slotResult.error);
  const slots = slotResult.slots;

  const requestedTaskKeys = new Set<string>();
  for (const [index, taskKey] of request.requiredTaskKeys.entries()) {
    if (requestedTaskKeys.has(taskKey)) {
      return pipelineFailure(
        fail("DUPLICATE_ASSET_BINDING", `Required task key ${taskKey} is listed more than once.`, [
          "requiredTaskKeys",
          index,
        ]),
      );
    }
    requestedTaskKeys.add(taskKey);
  }
  for (const [taskKey, slot] of slots) {
    if (!requestedTaskKeys.has(taskKey)) {
      return pipelineFailure(
        fail("REQUIRED_ASSET_MISSING", `Required task key ${taskKey} was omitted.`, slot.path),
      );
    }
  }
  for (const [index, taskKey] of request.requiredTaskKeys.entries()) {
    if (!slots.has(taskKey)) {
      return pipelineFailure(
        fail("RENDER_PLAN_INVALID", `Task key ${taskKey} is not required by the timeline.`, [
          "requiredTaskKeys",
          index,
        ]),
      );
    }
  }

  const byTaskKey: Record<string, AcceptedAssetBinding> = Object.create(null) as Record<
    string,
    AcceptedAssetBinding
  >;
  const hashesByAssetId = new Map<string, string>();
  const kindsBySha256 = new Map<string, AcceptedAssetKind>();
  const avatarProfilesByAssetId = new Map<string, AvatarSourceProfile>();
  const avatarProfilesBySha256 = new Map<string, AvatarSourceProfile>();
  for (const [index, candidate] of request.candidates.entries()) {
    if (Object.hasOwn(byTaskKey, candidate.taskKey)) {
      return pipelineFailure(
        fail(
          "DUPLICATE_ASSET_BINDING",
          `Task key ${candidate.taskKey} has multiple accepted bindings.`,
          ["candidates", index, "taskKey"],
        ),
      );
    }
    const slot = slots.get(candidate.taskKey);
    if (slot === undefined) {
      return pipelineFailure(
        fail(
          "RENDER_PLAN_INVALID",
          `Accepted binding ${candidate.taskKey} is not required by the timeline.`,
          ["candidates", index, "taskKey"],
        ),
      );
    }
    if (candidate.kind !== slot.kind) {
      return pipelineFailure(
        fail(
          "ASSET_KIND_MISMATCH",
          `Task key ${candidate.taskKey} requires ${slot.kind}, not ${candidate.kind}.`,
          ["candidates", index, "kind"],
        ),
      );
    }
    if (candidate.assetId.trim().length === 0 || !SHA256_PATTERN.test(candidate.sha256)) {
      return pipelineFailure(
        fail(
          "ASSET_HASH_MISMATCH",
          `Accepted binding ${candidate.taskKey} has invalid immutable identity metadata.`,
          ["candidates", index],
        ),
      );
    }
    if (candidate.kind === "AVATAR_CLIP") {
      if (!isAvatarSourceProfile(candidate.rendererSourceProfile)) {
        return pipelineFailure(
          fail(
            "RENDER_PROFILE_MISMATCH",
            `Avatar binding ${candidate.taskKey} has an unsupported renderer source profile.`,
            ["candidates", index, "rendererSourceProfile"],
          ),
        );
      }
      const priorIdProfile = avatarProfilesByAssetId.get(candidate.assetId);
      const priorHashProfile = avatarProfilesBySha256.get(candidate.sha256);
      if (
        (priorIdProfile !== undefined && priorIdProfile !== candidate.rendererSourceProfile) ||
        (priorHashProfile !== undefined && priorHashProfile !== candidate.rendererSourceProfile)
      ) {
        return pipelineFailure(
          fail(
            "RENDER_PROFILE_MISMATCH",
            `Avatar binding ${candidate.taskKey} conflicts with the immutable source profile of reused bytes.`,
            ["candidates", index, "rendererSourceProfile"],
          ),
        );
      }
      avatarProfilesByAssetId.set(candidate.assetId, candidate.rendererSourceProfile);
      avatarProfilesBySha256.set(candidate.sha256, candidate.rendererSourceProfile);
    } else if (candidate.rendererSourceProfile !== undefined) {
      return pipelineFailure(
        fail(
          "RENDER_PROFILE_MISMATCH",
          `Image binding ${candidate.taskKey} cannot carry an avatar renderer source profile.`,
          ["candidates", index, "rendererSourceProfile"],
        ),
      );
    }

    const priorHash = hashesByAssetId.get(candidate.assetId);
    if (priorHash !== undefined && priorHash !== candidate.sha256) {
      return pipelineFailure(
        fail(
          "ASSET_HASH_MISMATCH",
          `Asset ${candidate.assetId} is bound to conflicting checksums.`,
          ["candidates", index, "sha256"],
        ),
      );
    }
    const priorKind = kindsBySha256.get(candidate.sha256);
    if (priorKind !== undefined && priorKind !== candidate.kind) {
      return pipelineFailure(
        fail(
          "ASSET_KIND_MISMATCH",
          `Checksum ${candidate.sha256} is reused for incompatible asset kinds.`,
          ["candidates", index, "sha256"],
        ),
      );
    }
    hashesByAssetId.set(candidate.assetId, candidate.sha256);
    kindsBySha256.set(candidate.sha256, candidate.kind);
    byTaskKey[candidate.taskKey] = immutableBinding(candidate);
  }

  for (const [taskKey, slot] of slots) {
    if (!Object.hasOwn(byTaskKey, taskKey)) {
      return pipelineFailure(
        fail(
          "REQUIRED_ASSET_MISSING",
          `No accepted asset is bound to task key ${taskKey}.`,
          slot.path,
        ),
      );
    }
  }

  return pipelineSuccess(Object.freeze({ byTaskKey: Object.freeze(byTaskKey) }));
}

export const timelineAcceptedAssetResolver: AcceptedAssetResolver = Object.freeze({
  resolve: resolveAcceptedAssets,
});

export function resolveProviderAcceptedAssets(
  request: ProviderAcceptedAssetResolutionRequest,
): PipelineResult<AcceptedAssetResolution> {
  const proofs: Record<string, (typeof request.candidates)[number]["acceptance"]> = {};
  for (const [index, candidate] of request.candidates.entries()) {
    const acceptance = candidate.acceptance;
    const expectedSchema =
      candidate.kind === "IMAGE"
        ? "videoforge.mage-image-acceptance/v1"
        : "videoforge.avatar-fixture-acceptance/v1";
    if (
      candidate.kind === "VOICEOVER" ||
      acceptance.schemaVersion !== expectedSchema ||
      !SHA256_PATTERN.test(acceptance.acceptanceFingerprintHash) ||
      acceptance.acceptedAttemptId.trim().length === 0 ||
      acceptance.qaResultId.trim().length === 0 ||
      acceptance.acceptedAssetId !== candidate.assetId ||
      acceptance.acceptedBinarySha256 !== candidate.sha256 ||
      acceptance.qaState !== "PASSED" ||
      acceptance.resultDisposition !== "ACCEPTED" ||
      acceptance.providerOperation.trim().length === 0 ||
      !Number.isSafeInteger(acceptance.cost.reservedMicroUsd) ||
      !Number.isSafeInteger(acceptance.cost.reportedMicroUsd) ||
      !Number.isSafeInteger(acceptance.cost.settledMicroUsd) ||
      acceptance.cost.reservedMicroUsd < acceptance.cost.reportedMicroUsd ||
      acceptance.cost.reportedMicroUsd !== acceptance.cost.settledMicroUsd
    ) {
      return pipelineFailure(
        fail(
          "REQUIRED_ASSET_MISSING",
          `Provider artifact ${candidate.taskKey} is not durably accepted with passed QA.`,
          ["candidates", index, "acceptance"],
        ),
      );
    }
    proofs[candidate.taskKey] = acceptance;
  }
  const resolved = resolveAcceptedAssets(request);
  if (!resolved.ok) return resolved;
  return pipelineSuccess(
    Object.freeze({
      byTaskKey: resolved.value.byTaskKey,
      acceptanceProofsByTaskKey: Object.freeze(proofs),
    }),
  );
}

function validateTimelineBinding(request: RenderPlanRequest): PipelineFailure | null {
  const revision = request.revision.value;
  const timeline = request.timeline.value;
  if (
    timeline.project_revision_id !== revision.project_revision_id ||
    timeline.revision_config_hash !== request.revision.sha256
  ) {
    return fail(
      "RENDER_PLAN_INVALID",
      "The timeline is not hash-bound to the supplied project revision.",
      ["timeline"],
    );
  }
  if (request.renderProfileVersion !== SUPPORTED_RENDER_PROFILE_VERSION) {
    return fail(
      "RENDER_PROFILE_MISMATCH",
      `Unsupported render profile ${request.renderProfileVersion}.`,
      ["renderProfileVersion"],
      { supportedVersion: SUPPORTED_RENDER_PROFILE_VERSION },
    );
  }
  if (
    request.voiceover.kind !== "VOICEOVER" ||
    request.voiceover.assetId !== revision.voiceover_asset_id ||
    request.voiceover.sha256 !== revision.voiceover_sha256
  ) {
    return fail(
      "ASSET_HASH_MISMATCH",
      "The accepted voiceover does not match the revision-pinned original narration.",
      ["voiceover"],
    );
  }
  if (timeline.total_frames < 300 || timeline.total_frames > 108_000) {
    return fail(
      "RENDER_PLAN_INVALID",
      "The fixed local render profile supports timelines from 10 seconds through 1 hour.",
      ["timeline", "total_frames"],
    );
  }

  const segmentIds = new Set<string>();
  let expectedFrame = 0;
  for (const [index, segment] of timeline.segments.entries()) {
    if (segmentIds.has(segment.segment_id)) {
      return fail("RENDER_PLAN_INVALID", "Timeline segment IDs must be unique.", [
        "timeline",
        "segments",
        index,
        "segment_id",
      ]);
    }
    segmentIds.add(segment.segment_id);
    if (segment.start_frame !== expectedFrame || segment.end_frame_exclusive <= expectedFrame) {
      return fail(
        "RENDER_PLAN_INVALID",
        "Timeline segments must be positive-duration and contiguous.",
        ["timeline", "segments", index],
      );
    }
    expectedFrame = segment.end_frame_exclusive;
  }
  if (expectedFrame !== timeline.total_frames) {
    return fail(
      "RENDER_PLAN_INVALID",
      "Timeline segments must cover the declared total frame count.",
      ["timeline", "total_frames"],
    );
  }
  return null;
}

function bindingFor(resolution: AcceptedAssetResolution, taskKey: string): AcceptedAssetBinding {
  return resolution.byTaskKey[taskKey]!;
}

function acceptedAsset(binding: AcceptedAssetBinding): {
  readonly asset_id: string;
  readonly sha256: AcceptedAssetBinding["sha256"];
} {
  return Object.freeze({ asset_id: binding.assetId, sha256: binding.sha256 });
}

function resolvedSegment(
  segment: TimelineSegment,
  index: number,
  resolution: AcceptedAssetResolution,
  revision: RenderPlanRequest["revision"]["value"],
): ResolvedRenderManifestDocument["segments"][number] | PipelineFailure {
  const base = {
    segment_id: segment.segment_id,
    start_frame: segment.start_frame,
    end_frame_exclusive: segment.end_frame_exclusive,
  } as const;

  if (segment.timeline_composition === "IMAGE_FULL") {
    const image = bindingFor(resolution, segment.required_slots.image.task_key);
    return {
      ...base,
      timeline_composition: "IMAGE_FULL",
      accepted_assets: { image: acceptedAsset(image) },
      render: { image_scale: "1920:1080", zoom_profile: "image-full-zoom-v3" },
    };
  }

  const avatarTaskKey = segment.required_slots.avatar.task_key;
  const avatar = bindingFor(resolution, avatarTaskKey);
  if (!isAvatarSourceProfile(avatar.rendererSourceProfile)) {
    return fail(
      "RENDER_PROFILE_MISMATCH",
      `Avatar binding ${avatarTaskKey} has no supported renderer source profile.`,
      ["acceptedAssets", "byTaskKey", avatarTaskKey, "rendererSourceProfile"],
    );
  }
  if (segment.timeline_composition === "AVATAR_FULL") {
    const geometry = AVATAR_GEOMETRY[avatar.rendererSourceProfile].AVATAR_FULL;
    const isApprovedSoulx = avatar.rendererSourceProfile === SOULX_APPROVED_AVATAR_SOURCE_PROFILE;
    if (
      isApprovedSoulx &&
      revision.avatar_binding.runtime_source_sha256 !==
        SOULX_CROP_PROFILE_APPROVAL.avatar_source_sha256
    ) {
      return fail(
        "ASSET_HASH_MISMATCH",
        "The SoulX full-layout source background does not match the approved avatar source.",
        ["revision", "avatar_binding", "runtime_source_sha256"],
      );
    }
    return {
      ...base,
      timeline_composition: "AVATAR_FULL",
      accepted_assets: {
        avatar: acceptedAsset(avatar),
        ...(isApprovedSoulx
          ? {
              source_background: {
                asset_id: revision.avatar_binding.runtime_source_asset_id,
                sha256: SOULX_CROP_PROFILE_APPROVAL.avatar_source_sha256,
              },
            }
          : {}),
      },
      render: geometry,
    };
  }

  const imageTaskKey = segment.required_slots.right_image.task_key;
  const rightImage = bindingFor(resolution, imageTaskKey);
  if (
    avatarTaskKey === imageTaskKey ||
    avatar.assetId === rightImage.assetId ||
    avatar.sha256 === rightImage.sha256
  ) {
    return fail(
      "ASSET_KIND_MISMATCH",
      "A split segment requires distinct accepted avatar and right-image assets.",
      ["timeline", "segments", index, "required_slots"],
    );
  }
  const geometry = AVATAR_GEOMETRY[avatar.rendererSourceProfile].AVATAR_SPLIT_IMAGE;
  return {
    ...base,
    timeline_composition: "AVATAR_SPLIT_IMAGE",
    accepted_assets: {
      avatar: acceptedAsset(avatar),
      right_image: acceptedAsset(rightImage),
    },
    render: {
      ...geometry,
      right_image_scale: "960:1080",
      right_image_zoom_profile: "split-right-zoom-v3",
    },
  };
}

export async function planResolvedRenderManifest(
  request: RenderPlanRequest,
): Promise<PipelineResult<ResolvedRenderManifestDocumentRef>> {
  const bindingFailure = validateTimelineBinding(request);
  if (bindingFailure !== null) return pipelineFailure(bindingFailure);

  const requiredTaskKeys = collectRequiredAssetTaskKeys(request.timeline.value);
  const resolution = resolveAcceptedAssets({
    timeline: request.timeline,
    requiredTaskKeys,
    candidates: Object.values(request.acceptedAssets.byTaskKey),
  });
  if (!resolution.ok) return resolution;
  const voiceoverCollision = Object.values(resolution.value.byTaskKey).find(
    (binding) => binding.sha256 === request.voiceover.sha256,
  );
  if (voiceoverCollision !== undefined) {
    return pipelineFailure(
      fail(
        "ASSET_KIND_MISMATCH",
        "The original voiceover checksum cannot also identify a visual asset.",
        ["acceptedAssets", "byTaskKey", voiceoverCollision.taskKey, "sha256"],
      ),
    );
  }

  const segments: ResolvedRenderManifestDocument["segments"][number][] = [];
  for (const [index, segment] of request.timeline.value.segments.entries()) {
    const resolved = resolvedSegment(segment, index, resolution.value, request.revision.value);
    if ("code" in resolved) return pipelineFailure(resolved);
    segments.push(resolved);
  }

  const manifest: ResolvedRenderManifestDocument = {
    schema_version: "resolved-render-manifest/v1",
    project_revision_id: request.revision.value.project_revision_id,
    revision_config_hash: request.revision.sha256,
    timeline_plan_hash: request.timeline.sha256,
    render_profile_version: SUPPORTED_RENDER_PROFILE_VERSION,
    voiceover: acceptedAsset(request.voiceover),
    output: {
      width: 1920,
      height: 1080,
      fps_num: 30,
      fps_den: 1,
      video_codec: "h264",
      pixel_format: "yuv420p",
      audio_codec: "aac",
      audio_sample_rate_hz: 48_000,
      loudness_profile: "voiceover-minus16lufs-v1",
    },
    total_frames: request.timeline.value.total_frames,
    segments,
    ...(segments.some(
      (segment) =>
        segment.timeline_composition !== "IMAGE_FULL" &&
        segment.render.avatar_source_profile === SOULX_APPROVED_AVATAR_SOURCE_PROFILE,
    )
      ? { soulx_crop_profile_approval: SOULX_CROP_PROFILE_APPROVAL }
      : {}),
  };

  try {
    return pipelineSuccess(
      await validateAndHashContractDocument("resolvedRenderManifest", manifest),
    );
  } catch {
    return pipelineFailure(
      fail(
        "CONTRACT_INVALID",
        "The resolved render manifest failed canonical contract validation.",
        ["manifest"],
      ),
    );
  }
}

export const resolvedRenderManifestPlanner: RenderPlanner = Object.freeze({
  plan: planResolvedRenderManifest,
});

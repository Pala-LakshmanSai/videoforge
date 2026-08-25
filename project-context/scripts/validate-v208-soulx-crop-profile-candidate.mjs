import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultCandidatePath = path.join(
  repositoryRoot,
  "project-context/evidence/candidates/VF-10-08/soulx-crop-profile-candidate.json",
);
const candidatePath = process.argv[2]
  ? path.resolve(repositoryRoot, process.argv[2])
  : defaultCandidatePath;
const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));

const fail = (code) => {
  throw new Error(`V208_SOULX_CROP_CANDIDATE_${code}`);
};
const assert = (condition, code) => {
  if (!condition) fail(code);
};
const exactKeys = (value, keys, code) => {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${code}_OBJECT`);
  assert(
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()),
    `${code}_KEYS`,
  );
};
const sha256 = (relativePath) => {
  const bytes = readFileSync(path.join(repositoryRoot, relativePath));
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
};

assert(
  candidate.schema_version === "videoforge.v2-08-soulx-crop-profile-candidate/v1",
  "SCHEMA",
);
assert(candidate.checkpoint === "V2-08", "CHECKPOINT");
assert(
  candidate.candidate_id === "soulx-pro-vf924u-full-split-candidate-v1",
  "CANDIDATE_ID",
);
assert(candidate.recorded_at === "2026-08-25T14:26:21Z", "RECORDED_AT");
assert(candidate.candidate_status === "PENDING_USER_VISUAL_APPROVAL", "VISUAL_STATUS");
assert(candidate.authority_status === "NO_LIVE_AUTHORITY", "AUTHORITY_STATUS");
assert(candidate.qualification_status === "NOT_QUALIFIED", "QUALIFICATION_STATUS");
assert(candidate.scope?.non_authorizing_candidate_only === true, "NON_AUTHORIZING_SCOPE");
assert(candidate.scope?.provider_calls_performed === false, "PROVIDER_CALL_SCOPE");
assert(candidate.scope?.remote_mutations_performed === false, "REMOTE_MUTATION_SCOPE");
assert(candidate.scope?.external_spend_usd === 0, "SPEND_SCOPE");
assert(candidate.scope?.renderer_activation_authorized === false, "RENDERER_ACTIVATION_SCOPE");
assert(candidate.scope?.canonical_schema_or_decision_changed === false, "CANONICAL_SCOPE");
assert(candidate.scope?.user_visual_approval_recorded === false, "USER_APPROVAL_SCOPE");

exactKeys(
  candidate,
  [
    "schema_version",
    "checkpoint",
    "candidate_id",
    "recorded_at",
    "candidate_status",
    "authority_status",
    "qualification_status",
    "scope",
    "evidence_basis",
    "sealed_lineage",
    "owned_inputs",
    "samples",
    "profile_candidates",
    "activation_boundary",
  ],
  "CANDIDATE",
);
exactKeys(
  candidate.scope,
  [
    "non_authorizing_candidate_only",
    "provider_calls_performed",
    "remote_mutations_performed",
    "external_spend_usd",
    "renderer_activation_authorized",
    "canonical_schema_or_decision_changed",
    "user_visual_approval_recorded",
  ],
  "SCOPE",
);
assert(Array.isArray(candidate.evidence_basis), "EVIDENCE_ARRAY");
for (const entry of candidate.evidence_basis) exactKeys(entry, ["path", "sha256"], "EVIDENCE");
exactKeys(
  candidate.sealed_lineage,
  [
    "source_revision",
    "model_revision",
    "immutable_pod_image",
    "model_manifest_sha256",
    "model_manifest_total_bytes",
    "retained_volume_id_sha256",
    "retained_volume_size_gb",
    "runtime_settings",
  ],
  "LINEAGE",
);
exactKeys(
  candidate.sealed_lineage.runtime_settings,
  [
    "model_type",
    "precision",
    "width",
    "height",
    "fps",
    "sampling_steps",
    "shift",
    "color_correction_strength",
    "seed",
    "torch_compile",
    "audio_encode_mode",
    "face_crop",
  ],
  "RUNTIME_SETTINGS",
);
exactKeys(
  candidate.owned_inputs,
  [
    "avatar_source_sha256",
    "avatar_source_geometry",
    "avatar_source_probe",
    "native_audio_sha256",
    "native_audio_probe",
    "split_context_image_sha256",
    "split_context_geometry",
    "split_context_probe",
  ],
  "OWNED_INPUTS",
);
exactKeys(candidate.owned_inputs.avatar_source_geometry, ["width", "height"], "AVATAR_GEOMETRY");
exactKeys(candidate.owned_inputs.split_context_geometry, ["width", "height"], "CONTEXT_GEOMETRY");
for (const [name, probe] of [
  ["AVATAR_SOURCE", candidate.owned_inputs.avatar_source_probe],
  ["SPLIT_CONTEXT", candidate.owned_inputs.split_context_probe],
]) {
  exactKeys(
    probe,
    ["container", "codec", "pixel_format", "width", "height", "bytes"],
    `${name}_PROBE`,
  );
}
exactKeys(
  candidate.owned_inputs.native_audio_probe,
  [
    "container",
    "codec",
    "sample_format",
    "sample_rate_hz",
    "channels",
    "duration_seconds",
    "bytes",
  ],
  "SOURCE_AUDIO_PROBE",
);
exactKeys(candidate.samples, ["native", "full", "split"], "SAMPLES");
for (const [name, sample] of Object.entries(candidate.samples)) {
  exactKeys(sample, ["path", "sha256", "bytes", "probe"], `${name}_SAMPLE`);
  exactKeys(
    sample.probe,
    ["container", "video", "audio", "format_duration_seconds", "av_duration_delta_seconds"],
    `${name}_PROBE`,
  );
  exactKeys(
    sample.probe.video,
    [
      "codec",
      "pixel_format",
      "width",
      "height",
      "fps",
      "time_base",
      "frames",
      "duration_seconds",
    ],
    `${name}_VIDEO`,
  );
  exactKeys(
    sample.probe.audio,
    [
      "codec",
      "sample_rate_hz",
      "channels",
      "channel_layout",
      "time_base",
      "duration_seconds",
    ],
    `${name}_AUDIO`,
  );
}
exactKeys(candidate.profile_candidates, ["full", "split"], "PROFILE_CANDIDATES");
const closedFull = candidate.profile_candidates.full;
exactKeys(
  closedFull,
  ["profile_id", "native_clip_reused", "source_background", "native_foreground", "output_geometry"],
  "FULL_PROFILE",
);
exactKeys(
  closedFull.source_background,
  ["input_geometry", "transform", "output_geometry"],
  "FULL_BACKGROUND",
);
exactKeys(closedFull.source_background.input_geometry, ["width", "height"], "FULL_BG_GEOMETRY");
exactKeys(closedFull.source_background.output_geometry, ["width", "height"], "FULL_BG_OUTPUT");
exactKeys(
  closedFull.native_foreground,
  [
    "input_geometry",
    "transform",
    "output_geometry",
    "overlay",
    "horizontal_alpha_feather_pixels_each_edge",
  ],
  "FULL_FOREGROUND",
);
exactKeys(closedFull.native_foreground.input_geometry, ["width", "height"], "FULL_FG_GEOMETRY");
exactKeys(closedFull.native_foreground.output_geometry, ["width", "height"], "FULL_FG_OUTPUT");
exactKeys(closedFull.native_foreground.overlay, ["x", "y"], "FULL_OVERLAY");
exactKeys(closedFull.output_geometry, ["width", "height", "fps"], "FULL_OUTPUT");
const closedSplit = candidate.profile_candidates.split;
exactKeys(
  closedSplit,
  ["profile_id", "native_clip_reused", "avatar_panel", "context_panel", "layout", "output_geometry"],
  "SPLIT_PROFILE",
);
exactKeys(
  closedSplit.avatar_panel,
  ["source_geometry", "crop", "transform", "output_geometry"],
  "SPLIT_AVATAR_PANEL",
);
exactKeys(closedSplit.avatar_panel.source_geometry, ["width", "height"], "SPLIT_SOURCE");
exactKeys(closedSplit.avatar_panel.crop, ["x", "y", "width", "height"], "SPLIT_CROP");
exactKeys(closedSplit.avatar_panel.output_geometry, ["width", "height"], "SPLIT_AVATAR_OUTPUT");
exactKeys(
  closedSplit.context_panel,
  [
    "source_geometry",
    "transform",
    "scaled_geometry",
    "center_crop",
    "output_geometry",
    "position",
  ],
  "SPLIT_CONTEXT_PANEL",
);
exactKeys(closedSplit.context_panel.source_geometry, ["width", "height"], "CONTEXT_SOURCE");
exactKeys(closedSplit.context_panel.scaled_geometry, ["width", "height"], "CONTEXT_SCALED");
exactKeys(
  closedSplit.context_panel.center_crop,
  ["x", "y", "width", "height"],
  "CONTEXT_CROP",
);
exactKeys(closedSplit.context_panel.output_geometry, ["width", "height"], "CONTEXT_OUTPUT");
exactKeys(closedSplit.context_panel.position, ["x", "y"], "CONTEXT_POSITION");
exactKeys(closedSplit.output_geometry, ["width", "height", "fps"], "SPLIT_OUTPUT");
exactKeys(
  candidate.activation_boundary,
  [
    "active_avatar_profile_version_id",
    "active_crop_profile",
    "serverless_image_published",
    "serverless_endpoint_created",
    "qualification_claimed",
    "required_next_decision",
    "user_visual_approval_would_not_grant_live_authority",
    "new_live_authority_required_for_any_prohibited_operation",
    "prohibited_without_new_authority",
  ],
  "ACTIVATION_BOUNDARY",
);

const exactEvidence = new Map([
  [
    "project-context/evidence/acceptance/VF-9-24U/preflight.json",
    "sha256:1efa2ec95d113655c4dea5bddbcfc69aa3dea90762d9eb4be5374375af8e2ca2",
  ],
  [
    "project-context/evidence/acceptance/VF-9-24U/acceptance.json",
    "sha256:1bb5334c011d4599ce68590068dce3dc528e8b337d73d82617eb9880d179c54b",
  ],
  [
    "outputs/soulx-flashhead-pro/vf-9-24u/new-avatar-third-10.00s/qualification.json",
    "sha256:060ee6f8260032bfae4470233f7a9df4ed6002f3053a8ff80844bc5f28260511",
  ],
  [
    "apps/web/src/server/providers/runpod-soulx-vf924s-live.ts",
    "sha256:30bedc5e5a90f802816bbfe06eee2ee1e48d1827631d8b2e21ace8253d8f9307",
  ],
  [
    "apps/web/src/server/providers/runpod-soulx-vf924u-execute.ts",
    "sha256:4f5a535b01d683eab8cef57980dd5aa61916306bff6fb6c81fadb89d2983bd91",
  ],
]);
assert(candidate.evidence_basis?.length === exactEvidence.size, "EVIDENCE_COUNT");
for (const entry of candidate.evidence_basis) {
  assert(exactEvidence.get(entry.path) === entry.sha256, "EVIDENCE_DECLARATION");
  assert(sha256(entry.path) === entry.sha256, "EVIDENCE_HASH");
  exactEvidence.delete(entry.path);
}
assert(exactEvidence.size === 0, "EVIDENCE_COMPLETENESS");

const preflight = JSON.parse(
  readFileSync(
    path.join(repositoryRoot, "project-context/evidence/acceptance/VF-9-24U/preflight.json"),
    "utf8",
  ),
);
const acceptance = JSON.parse(
  readFileSync(
    path.join(repositoryRoot, "project-context/evidence/acceptance/VF-9-24U/acceptance.json"),
    "utf8",
  ),
);
const qualification = JSON.parse(
  readFileSync(
    path.join(
      repositoryRoot,
      "outputs/soulx-flashhead-pro/vf-9-24u/new-avatar-third-10.00s/qualification.json",
    ),
    "utf8",
  ),
);
const executorSource = readFileSync(
  path.join(repositoryRoot, "apps/web/src/server/providers/runpod-soulx-vf924u-execute.ts"),
  "utf8",
);
const lineage = candidate.sealed_lineage;
const qualifiedRuntime = qualification.runtime_health;
assert(lineage.source_revision === qualifiedRuntime.source_revision, "SOURCE_LINEAGE_EVIDENCE");
assert(lineage.model_revision === preflight.runtime.model_revision, "MODEL_LINEAGE_PREFLIGHT");
assert(lineage.model_revision === acceptance.runtime.model_revision, "MODEL_LINEAGE_ACCEPTANCE");
assert(lineage.immutable_pod_image === preflight.runtime.immutable_image_digest, "IMAGE_PREFLIGHT");
assert(lineage.immutable_pod_image === acceptance.runtime.image_digest, "IMAGE_ACCEPTANCE");
assert(lineage.immutable_pod_image === qualification.image_digest, "IMAGE_QUALIFICATION");
assert(lineage.model_manifest_sha256 === preflight.runtime.manifest_sha256, "MANIFEST_PREFLIGHT");
assert(lineage.model_manifest_sha256 === acceptance.runtime.manifest_sha256, "MANIFEST_ACCEPTANCE");
assert(
  lineage.model_manifest_sha256 === `sha256:${qualifiedRuntime.manifest_sha256}`,
  "MANIFEST_QUALIFICATION",
);
assert(
  lineage.model_manifest_total_bytes === acceptance.runtime.manifest_total_bytes,
  "MANIFEST_BYTES_ACCEPTANCE",
);
assert(
  lineage.model_manifest_total_bytes === qualifiedRuntime.timings.manifest_total_bytes,
  "MANIFEST_BYTES_QUALIFICATION",
);
assert(
  lineage.retained_volume_id_sha256 === preflight.runtime.retained_volume_id_sha256,
  "VOLUME_PREFLIGHT",
);
assert(
  lineage.retained_volume_id_sha256 === qualification.volume.retained_soulx_volume_id_sha256,
  "VOLUME_QUALIFICATION",
);
assert(
  lineage.retained_volume_size_gb === preflight.runtime.retained_volume_size_gb,
  "VOLUME_SIZE_PREFLIGHT",
);
assert(lineage.retained_volume_size_gb === qualification.volume.size_gb, "VOLUME_SIZE_QUALIFICATION");
assert(
  JSON.stringify(lineage.runtime_settings) === JSON.stringify(qualifiedRuntime.settings),
  "RUNTIME_SETTINGS_QUALIFICATION",
);

assert(
  sha256(".videoforge/private/vf-9-24u/new-avatar-sample.png") ===
    candidate.owned_inputs?.avatar_source_sha256,
  "AVATAR_SOURCE_HASH",
);
assert(
  sha256(".videoforge/private/vf-9-24u/new-avatar-third-10.00s.wav") ===
    candidate.owned_inputs?.native_audio_sha256,
  "NATIVE_AUDIO_HASH",
);
assert(
  sha256("apps/web/.videoforge/cp06-phase-b/outputs/samples/cp06-owned-04.png") ===
    candidate.owned_inputs?.split_context_image_sha256,
  "SPLIT_CONTEXT_HASH",
);
assert(
  candidate.owned_inputs.avatar_source_sha256 === preflight.sample.avatar_image_sha256,
  "AVATAR_HASH_PREFLIGHT",
);
assert(
  candidate.owned_inputs.avatar_source_sha256 === qualification.inputs.source_image_sha256,
  "AVATAR_HASH_QUALIFICATION",
);
assert(
  candidate.owned_inputs.native_audio_sha256 === preflight.sample.audio_sha256,
  "AUDIO_HASH_PREFLIGHT",
);
assert(
  candidate.owned_inputs.native_audio_sha256 === qualification.inputs.source_audio_sha256,
  "AUDIO_HASH_QUALIFICATION",
);
assert(
  candidate.owned_inputs.split_context_image_sha256 === preflight.sample.split_context_image_sha256,
  "CONTEXT_HASH_PREFLIGHT",
);
assert(
  candidate.owned_inputs.split_context_image_sha256 ===
    qualification.inputs.split_context_image_sha256,
  "CONTEXT_HASH_QUALIFICATION",
);
for (const [field, expected] of [
  ["expectedSourceImageSha256", candidate.owned_inputs.avatar_source_sha256],
  ["expectedSourceAudioSha256", candidate.owned_inputs.native_audio_sha256],
  ["expectedSplitContextImageSha256", candidate.owned_inputs.split_context_image_sha256],
]) {
  const match = new RegExp(`${field}:\\s*\\n?\\s*"(sha256:[a-f0-9]{64})"`, "u").exec(
    executorSource,
  );
  assert(match?.[1] === expected, `EXECUTOR_${field}`);
}

const probeInput = (relativePath) =>
  JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_name,codec_type,width,height,pix_fmt,sample_fmt,sample_rate,channels,duration:format=format_name,duration,size",
        "-of",
        "json",
        path.join(repositoryRoot, relativePath),
      ],
      { encoding: "utf8" },
    ),
  );
const avatarProbe = probeInput(".videoforge/private/vf-9-24u/new-avatar-sample.png");
const avatarStream = avatarProbe.streams.find((stream) => stream.codec_type === "video");
const recordedAvatarProbe = candidate.owned_inputs.avatar_source_probe;
assert(
  JSON.stringify(recordedAvatarProbe) ===
    JSON.stringify({
      container: avatarProbe.format?.format_name,
      codec: avatarStream?.codec_name,
      pixel_format: avatarStream?.pix_fmt,
      width: avatarStream?.width,
      height: avatarStream?.height,
      bytes: Number(avatarProbe.format?.size),
    }),
  "AVATAR_PROBE",
);
assert(
  avatarStream.width === candidate.owned_inputs.avatar_source_geometry.width &&
    avatarStream.height === candidate.owned_inputs.avatar_source_geometry.height,
  "AVATAR_GEOMETRY_PROBE",
);
assert(
  JSON.stringify(preflight.sample.avatar_geometry) ===
    JSON.stringify([avatarStream.width, avatarStream.height]),
  "AVATAR_GEOMETRY_PREFLIGHT",
);
const contextProbe = probeInput(
  "apps/web/.videoforge/cp06-phase-b/outputs/samples/cp06-owned-04.png",
);
const contextStream = contextProbe.streams.find((stream) => stream.codec_type === "video");
const recordedContextProbe = candidate.owned_inputs.split_context_probe;
assert(
  JSON.stringify(recordedContextProbe) ===
    JSON.stringify({
      container: contextProbe.format?.format_name,
      codec: contextStream?.codec_name,
      pixel_format: contextStream?.pix_fmt,
      width: contextStream?.width,
      height: contextStream?.height,
      bytes: Number(contextProbe.format?.size),
    }),
  "CONTEXT_PROBE",
);
assert(
  contextStream.width === candidate.owned_inputs.split_context_geometry.width &&
    contextStream.height === candidate.owned_inputs.split_context_geometry.height,
  "CONTEXT_GEOMETRY_PROBE",
);
const audioProbe = probeInput(".videoforge/private/vf-9-24u/new-avatar-third-10.00s.wav");
const audioStream = audioProbe.streams.find((stream) => stream.codec_type === "audio");
const recordedAudioProbe = candidate.owned_inputs.native_audio_probe;
assert(audioProbe.format?.format_name === recordedAudioProbe.container, "SOURCE_AUDIO_CONTAINER");
assert(audioStream?.codec_name === recordedAudioProbe.codec, "SOURCE_AUDIO_CODEC");
assert(audioStream?.sample_fmt === recordedAudioProbe.sample_format, "SOURCE_AUDIO_FORMAT");
assert(Number(audioStream?.sample_rate) === recordedAudioProbe.sample_rate_hz, "SOURCE_AUDIO_RATE");
assert(audioStream?.channels === recordedAudioProbe.channels, "SOURCE_AUDIO_CHANNELS");
assert(Number(audioStream?.duration) === recordedAudioProbe.duration_seconds, "SOURCE_AUDIO_DURATION");
assert(Number(audioProbe.format?.size) === recordedAudioProbe.bytes, "SOURCE_AUDIO_BYTES");
assert(recordedAudioProbe.codec === preflight.sample.audio_codec, "SOURCE_AUDIO_PREFLIGHT_CODEC");
assert(
  recordedAudioProbe.sample_rate_hz === preflight.sample.audio_sample_rate_hz,
  "SOURCE_AUDIO_PREFLIGHT_RATE",
);
assert(recordedAudioProbe.channels === preflight.sample.audio_channels, "SOURCE_AUDIO_PREFLIGHT_CHANNELS");
assert(
  recordedAudioProbe.duration_seconds === preflight.sample.audio_duration_seconds,
  "SOURCE_AUDIO_PREFLIGHT_DURATION",
);
assert(recordedAudioProbe.bytes === preflight.sample.audio_bytes, "SOURCE_AUDIO_PREFLIGHT_BYTES");

const expectedSamples = {
  native: {
    path: "outputs/soulx-flashhead-pro/vf-9-24u/new-avatar-third-10.00s/soulx-flashhead-pro-new-avatar-third-10.00s.mp4",
    sha256: "sha256:db70cd410062572052313278f12d67393aba213ca607fa3a3b9e3f6aad948bf1",
    bytes: 1796677,
    video: ["h264", "yuv420p", 512, 512, "25/1", "1/12800", 250, 10],
    audio: ["aac", 16000, 1, "mono", "1/16000", 10],
  },
  full: {
    path: "outputs/soulx-flashhead-pro/vf-9-24u/new-avatar-third-10.00s/ranga-style-full-16x9-corrected.mp4",
    sha256: "sha256:da31d87c2389769272733ff50a9114d4507a36aced1ebe48480c9ccf486de241",
    bytes: 6129069,
    video: ["h264", "yuv420p", 1920, 1080, "30/1", "1/15360", 300, 10],
    audio: ["aac", 48000, 2, "stereo", "1/48000", 10],
  },
  split: {
    path: "outputs/soulx-flashhead-pro/vf-9-24u/new-avatar-third-10.00s/ranga-style-split-composite-16x9-corrected.mp4",
    sha256: "sha256:f0b02351e38e2e8570e4e586b314da30813bb0a0eb09a567912bba9725b74993",
    bytes: 6980593,
    video: ["h264", "yuv420p", 1920, 1080, "30/1", "1/15360", 300, 10],
    audio: ["aac", 48000, 2, "stereo", "1/48000", 10],
  },
};

for (const [name, expected] of Object.entries(expectedSamples)) {
  const sample = candidate.samples?.[name];
  const acceptedSample = acceptance.outputs[name];
  const qualifiedSample = name === "native" ? qualification.output : qualification.crop_previews[name];
  assert(sample?.path === expected.path, `${name.toUpperCase()}_PATH`);
  assert(sample?.sha256 === expected.sha256, `${name.toUpperCase()}_DECLARED_HASH`);
  assert(sha256(sample.path) === expected.sha256, `${name.toUpperCase()}_HASH`);
  assert(statSync(path.join(repositoryRoot, sample.path)).size === expected.bytes, `${name}_BYTES`);
  assert(acceptedSample.path === sample.path, `${name}_ACCEPTANCE_PATH`);
  assert(acceptedSample.sha256 === sample.sha256, `${name}_ACCEPTANCE_HASH`);
  assert(acceptedSample.bytes === sample.bytes, `${name}_ACCEPTANCE_BYTES`);
  assert(qualifiedSample.path.endsWith(sample.path), `${name}_QUALIFICATION_PATH`);
  assert(qualifiedSample.sha256 === sample.sha256, `${name}_QUALIFICATION_HASH`);
  assert(qualifiedSample.bytes === sample.bytes, `${name}_QUALIFICATION_BYTES`);

  const observed = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-count_frames",
        "-show_entries",
        "stream=codec_name,codec_type,pix_fmt,width,height,r_frame_rate,time_base,duration,nb_read_frames,sample_rate,channels,channel_layout:format=format_name,duration,size",
        "-of",
        "json",
        path.join(repositoryRoot, sample.path),
      ],
      { encoding: "utf8" },
    ),
  );
  const video = observed.streams.find((stream) => stream.codec_type === "video");
  const audio = observed.streams.find((stream) => stream.codec_type === "audio");
  const observedVideo = [
    video?.codec_name,
    video?.pix_fmt,
    video?.width,
    video?.height,
    video?.r_frame_rate,
    video?.time_base,
    Number(video?.nb_read_frames),
    Number(video?.duration),
  ];
  const observedAudio = [
    audio?.codec_name,
    Number(audio?.sample_rate),
    audio?.channels,
    audio?.channel_layout,
    audio?.time_base,
    Number(audio?.duration),
  ];
  assert(JSON.stringify(observedVideo) === JSON.stringify(expected.video), `${name}_VIDEO_PROBE`);
  assert(JSON.stringify(observedAudio) === JSON.stringify(expected.audio), `${name}_AUDIO_PROBE`);
  assert(observed.format?.format_name === "mov,mp4,m4a,3gp,3g2,mj2", `${name}_CONTAINER`);
  assert(Number(observed.format?.duration) === 10, `${name}_FORMAT_DURATION`);
  assert(Number(observed.format?.size) === expected.bytes, `${name}_PROBE_BYTES`);
  assert(JSON.stringify(sample.probe.video) === JSON.stringify({
    codec: expected.video[0],
    pixel_format: expected.video[1],
    width: expected.video[2],
    height: expected.video[3],
    fps: expected.video[4],
    time_base: expected.video[5],
    frames: expected.video[6],
    duration_seconds: expected.video[7],
  }), `${name}_RECORDED_VIDEO_PROBE`);
  assert(JSON.stringify(sample.probe.audio) === JSON.stringify({
    codec: expected.audio[0],
    sample_rate_hz: expected.audio[1],
    channels: expected.audio[2],
    channel_layout: expected.audio[3],
    time_base: expected.audio[4],
    duration_seconds: expected.audio[5],
  }), `${name}_RECORDED_AUDIO_PROBE`);
  assert(sample.probe.container === "mov,mp4,m4a,3gp,3g2,mj2", `${name}_RECORDED_CONTAINER`);
  assert(sample.probe.format_duration_seconds === 10, `${name}_RECORDED_FORMAT_DURATION`);
  assert(sample.probe.av_duration_delta_seconds === 0, `${name}_RECORDED_AV_DELTA`);
}

const full = candidate.profile_candidates?.full;
assert(
  full?.profile_id === "soulx-pro-ranga-full-source-composite-v1-candidate",
  "FULL_PROFILE_ID",
);
assert(full?.native_clip_reused === true, "FULL_NATIVE_REUSE");
assert(full?.source_background?.transform === "scale=1920:1080:flags=lanczos,fps=30", "FULL_BACKGROUND");
assert(
  full?.native_foreground?.transform === "scale=1080:1080:flags=lanczos,fps=30,format=rgba",
  "FULL_NATIVE_TRANSFORM",
);
assert(full?.native_foreground?.overlay?.x === 420, "FULL_OVERLAY_X");
assert(full?.native_foreground?.overlay?.y === 0, "FULL_OVERLAY_Y");
assert(full?.native_foreground?.horizontal_alpha_feather_pixels_each_edge === 32, "FULL_FEATHER");
assert(
  JSON.stringify(full?.output_geometry) === JSON.stringify({ width: 1920, height: 1080, fps: 30 }),
  "FULL_OUTPUT_GEOMETRY",
);
assert(
  JSON.stringify(full.source_background.input_geometry) ===
    JSON.stringify(candidate.owned_inputs.avatar_source_geometry),
  "FULL_SOURCE_INPUT_GEOMETRY",
);
assert(
  JSON.stringify(full.native_foreground.input_geometry) ===
    JSON.stringify({
      width: candidate.samples.native.probe.video.width,
      height: candidate.samples.native.probe.video.height,
    }),
  "FULL_NATIVE_INPUT_GEOMETRY",
);
assert(
  full.source_background.output_geometry.width === full.output_geometry.width &&
    full.source_background.output_geometry.height === full.output_geometry.height,
  "FULL_BACKGROUND_OUTPUT_MATH",
);
assert(
  full.native_foreground.overlay.x ===
    (full.output_geometry.width - full.native_foreground.output_geometry.width) / 2,
  "FULL_CENTERED_OVERLAY_X_MATH",
);
assert(
  full.native_foreground.overlay.y ===
    (full.output_geometry.height - full.native_foreground.output_geometry.height) / 2,
  "FULL_CENTERED_OVERLAY_Y_MATH",
);
assert(
  full.native_foreground.output_geometry.width === 1080 &&
    full.native_foreground.output_geometry.height === full.output_geometry.height,
  "FULL_FOREGROUND_OUTPUT_MATH",
);
assert(
  Number.isInteger(full.native_foreground.horizontal_alpha_feather_pixels_each_edge) &&
    full.native_foreground.horizontal_alpha_feather_pixels_each_edge > 0 &&
    full.native_foreground.horizontal_alpha_feather_pixels_each_edge * 2 <
      full.native_foreground.output_geometry.width,
  "FULL_FEATHER_BOUNDS",
);

const split = candidate.profile_candidates?.split;
assert(
  split?.profile_id === "soulx-pro-ranga-split-composite-v1-candidate",
  "SPLIT_PROFILE_ID",
);
assert(split?.native_clip_reused === true, "SPLIT_NATIVE_REUSE");
assert(
  JSON.stringify(split?.avatar_panel?.crop) ===
    JSON.stringify({ x: 32, y: 4, width: 448, height: 504 }),
  "SPLIT_CROP",
);
assert(
  split?.avatar_panel?.transform ===
    "crop=448:504:32:4,scale=960:1080:flags=lanczos,fps=30",
  "SPLIT_AVATAR_TRANSFORM",
);
assert(
  split?.context_panel?.transform ===
    "scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=960:1080,zoompan=z=min(zoom+0.000133333,1.04):d=300:s=960x1080:fps=30",
  "SPLIT_CONTEXT_TRANSFORM",
);
assert(split?.layout === "left-right-hstack-no-divider", "SPLIT_LAYOUT");
assert(
  JSON.stringify(split?.output_geometry) === JSON.stringify({ width: 1920, height: 1080, fps: 30 }),
  "SPLIT_OUTPUT_GEOMETRY",
);
const crop = split.avatar_panel.crop;
const cropSource = split.avatar_panel.source_geometry;
assert(
  JSON.stringify(cropSource) ===
    JSON.stringify({
      width: candidate.samples.native.probe.video.width,
      height: candidate.samples.native.probe.video.height,
    }),
  "SPLIT_SOURCE_GEOMETRY",
);
assert(
  [crop.x, crop.y, crop.width, crop.height].every(Number.isInteger) &&
    crop.width > 0 &&
    crop.height > 0 &&
    crop.x >= 0 &&
    crop.y >= 0 &&
    crop.x + crop.width <= cropSource.width &&
    crop.y + crop.height <= cropSource.height,
  "SPLIT_CROP_BOUNDS",
);
assert(crop.x === (cropSource.width - crop.width) / 2, "SPLIT_CROP_CENTER_X");
assert(crop.y === (cropSource.height - crop.height) / 2, "SPLIT_CROP_CENTER_Y");
assert(
  split.avatar_panel.output_geometry.width === 960 &&
    split.avatar_panel.output_geometry.height === 1080,
  "SPLIT_AVATAR_PANEL_SIZE",
);
assert(
  JSON.stringify(split.context_panel.source_geometry) ===
    JSON.stringify(candidate.owned_inputs.split_context_geometry),
  "CONTEXT_SOURCE_GEOMETRY",
);
const scaledContext = split.context_panel.scaled_geometry;
assert(
  scaledContext.width === 1920 &&
    scaledContext.height === 1080 &&
  scaledContext.width / split.context_panel.source_geometry.width ===
      scaledContext.height / split.context_panel.source_geometry.height &&
    scaledContext.width === split.output_geometry.width &&
    scaledContext.height === split.output_geometry.height,
  "CONTEXT_SCALE_MATH",
);
const contextCrop = split.context_panel.center_crop;
assert(
  contextCrop.width === 960 &&
    contextCrop.height === 1080 &&
  contextCrop.x === (scaledContext.width - contextCrop.width) / 2 &&
    contextCrop.y === (scaledContext.height - contextCrop.height) / 2 &&
    contextCrop.x + contextCrop.width <= scaledContext.width &&
    contextCrop.y + contextCrop.height <= scaledContext.height,
  "CONTEXT_CENTER_CROP_MATH",
);
assert(
  contextCrop.width === split.context_panel.output_geometry.width &&
    contextCrop.height === split.context_panel.output_geometry.height &&
    split.context_panel.output_geometry.width === 960 &&
    split.context_panel.output_geometry.height === 1080,
  "CONTEXT_PANEL_OUTPUT_MATH",
);
assert(
  split.avatar_panel.output_geometry.width + split.context_panel.output_geometry.width ===
      split.output_geometry.width &&
    split.avatar_panel.output_geometry.height === split.output_geometry.height &&
    split.context_panel.output_geometry.height === split.output_geometry.height,
  "HSTACK_OUTPUT_MATH",
);
assert(
  split.context_panel.position.x === split.avatar_panel.output_geometry.width &&
    split.context_panel.position.y === 0,
  "HSTACK_POSITION_MATH",
);

const renderer = readFileSync(
  path.join(repositoryRoot, "apps/web/src/server/providers/runpod-soulx-vf924s-live.ts"),
  "utf8",
);
for (const exactFragment of [
  "[0:v]scale=1920:1080:flags=lanczos,fps=30[bg];",
  "[1:v]scale=1080:1080:flags=lanczos,fps=30,format=rgba[fg];",
  "[fg][mask]alphamerge[fgf];[bg][fgf]overlay=420:0:shortest=1[v]",
  "[0:v]crop=448:504:32:4,scale=960:1080:flags=lanczos,fps=30[left];",
  "crop=960:1080,zoompan=z=min(zoom+0.000133333\\\\,1.04):d=300:s=960x1080:fps=30[right];",
  "[left][right]hstack=inputs=2[v]",
]) {
  assert(renderer.includes(exactFragment), "RENDERER_TRANSFORM_DRIFT");
}
assert(
  executorSource.includes('fullPreviewProfile: "source-16x9-v1"'),
  "FULL_PROFILE_BINDING",
);
assert(executorSource.includes("renderCropPreviews: true"), "PREVIEW_BINDING");

const boundary = candidate.activation_boundary;
assert(boundary?.active_avatar_profile_version_id === null, "ACTIVE_PROFILE_ID");
assert(boundary?.active_crop_profile === null, "ACTIVE_CROP");
assert(boundary?.serverless_image_published === false, "IMAGE_PUBLICATION");
assert(boundary?.serverless_endpoint_created === false, "ENDPOINT");
assert(boundary?.qualification_claimed === false, "QUALIFICATION_CLAIM");
assert(
  boundary?.required_next_decision === "EXPLICIT_USER_VISUAL_APPROVAL_OR_ONE_PRECISE_REJECTION_NOTE",
  "NEXT_DECISION",
);
assert(
  boundary?.user_visual_approval_would_not_grant_live_authority === true,
  "VISUAL_APPROVAL_LIVE_AUTHORITY_FENCE",
);
assert(
  boundary?.new_live_authority_required_for_any_prohibited_operation === true,
  "NEW_AUTHORITY_FENCE",
);
assert(
  JSON.stringify(boundary?.prohibited_without_new_authority) ===
    JSON.stringify([
      "image_publication",
      "provider_endpoint_or_template_mutation",
      "live_serverless_dispatch",
      "paid_compute_or_spend",
      "model_download_or_substitution",
      "retained_volume_mutation",
      "crop_profile_activation",
      "canonical_schema_or_decision_activation",
    ]),
  "PROHIBITED_WITHOUT_NEW_AUTHORITY",
);

console.log(
  "V2-08 SoulX crop candidate PASS (exact local samples/probes/transforms; PENDING_USER_VISUAL_APPROVAL; NO_LIVE_AUTHORITY)",
);

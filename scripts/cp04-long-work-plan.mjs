import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  canonicalizeJson,
  sha256CanonicalJson,
  validateAndHashContractDocument,
} from "../packages/contracts/dist/src/index.js";
import {
  compileCompleteWorkPlan,
  scheduleTimeline,
  SUPPORTED_SCHEDULER_CONFIG,
  SUPPORTED_SCHEDULER_VERSION,
} from "../packages/pipeline/dist/src/index.js";

const run = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const cp03EvidencePath = path.join(
  repoRoot,
  "project-context/evidence/acceptance/VF-9-24N/cp03-word-transcript/real-owned-fixtures.json",
);
const outputRoot = path.join(repoRoot, "artifacts/cp04-long-owned-work-plan");
const revisionId = "revision_cp04_owned_long";
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function stableId(namespace, stableKey) {
  let hash = 0x811c9dc5;
  for (const character of `${namespace}:${stableKey}`) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `seg_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function requireSuccess(result) {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function revisionValue(transcript) {
  const shaA = `sha256:${"a".repeat(64)}`;
  const shaB = `sha256:${"b".repeat(64)}`;
  return {
    schema_version: "project-revision-config/v2",
    project_id: "project_cp04_owned_long",
    project_revision_id: revisionId,
    title: "CP-04 owned long voiceover scheduler acceptance",
    voiceover_asset_id: transcript.source.asset_id,
    voiceover_sha256: transcript.source.sha256,
    avatar_binding: {
      avatar_profile_id: "avatar_profile_fixture_001",
      avatar_profile_version_id: "avatar_profile_version_fixture_001",
      avatar_display_name_snapshot: "Owned Presenter",
      avatar_profile_hash: shaA,
      runtime_source_asset_id: "asset_avatar_runtime_001",
      runtime_source_sha256: shaB,
      source_preparation_version: "avatar-source-prep-v1",
      source_validation_profile_version: "avatar-source-validation-v1",
      compatibility_state_at_preflight: "UNTESTED",
      compatibility_evidence: null,
    },
    optional_script: null,
    image_style_version_id: "style_version_documentary_stock_v1",
    style_profile_hash: shaA,
    extra_prompt_keywords: null,
    apply_extra_prompt_keywords: false,
    generation_mode: "BALANCED",
    execution_profiles: {
      image_media_profile_id: "exec_image_media_balanced_v1",
      avatar_primary_profile_id: "exec_avatar_primary_balanced_v1",
      avatar_repair_profile_id: null,
      avatar_quality_profile_id: null,
    },
    spend_cap_usd: 1.5,
    scheduler_version: SUPPORTED_SCHEDULER_VERSION,
    scheduler_seed: 982_341,
    prompt_writer_version: "fixture-prompt-writer-v1",
    prompt_compiler_version: "fixture-prompt-compiler-v1",
  };
}

async function materializeSpans(timeline, sourcePath, sourceDurationMs) {
  const spansRoot = path.join(outputRoot, "selected-spans");
  await mkdir(spansRoot, { recursive: true });
  const avatarSegments = timeline.value.segments.filter(
    (segment) => segment.timeline_composition !== "IMAGE_FULL",
  );
  const spans = [];
  for (const [index, segment] of avatarSegments.entries()) {
    const selectedStartMs = segment.source_audio_start_ms;
    const selectedEndMsExclusive = segment.source_audio_end_ms;
    const paddedStartMs = Math.max(
      0,
      selectedStartMs - SUPPORTED_SCHEDULER_CONFIG.selected_span_context_padding_ms,
    );
    const paddedEndMsExclusive = Math.min(
      sourceDurationMs,
      selectedEndMsExclusive + SUPPORTED_SCHEDULER_CONFIG.selected_span_context_padding_ms,
    );
    const durationMs = paddedEndMsExclusive - paddedStartMs;
    const outputPath = path.join(spansRoot, `span-${String(index + 1).padStart(3, "0")}.wav`);
    await run("/opt/homebrew/bin/ffmpeg", [
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      (paddedStartMs / 1_000).toFixed(3),
      "-i",
      sourcePath,
      "-t",
      (durationMs / 1_000).toFixed(3),
      "-map",
      "0:a:0",
      "-vn",
      "-map_metadata",
      "-1",
      "-fflags",
      "+bitexact",
      "-flags:a",
      "+bitexact",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      outputPath,
    ]);
    const probe = JSON.parse(
      (
        await run("/opt/homebrew/bin/ffprobe", [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_name,sample_rate,channels",
          "-show_entries",
          "format=duration,size",
          "-of",
          "json",
          outputPath,
        ])
      ).stdout,
    );
    const stream = probe.streams?.[0];
    if (
      stream?.codec_name !== "pcm_s16le" ||
      stream.sample_rate !== "16000" ||
      stream.channels !== 1 ||
      Math.round(Number(probe.format?.duration) * 1_000) !== durationMs
    ) {
      throw new Error(`Selected span ${String(index + 1)} failed exact WAV probe.`);
    }
    const bytes = await readFile(outputPath);
    const sha256 = digest(bytes);
    spans.push({
      spanId: `span_cp04_${String(index + 1).padStart(3, "0")}`,
      timelineSegmentId: segment.segment_id,
      taskKey: segment.required_slots.avatar.span_audio_task_key,
      artifactId: `asset_span_audio_${sha256.slice(7, 31)}`,
      sha256,
      selectedStartMs,
      selectedEndMsExclusive,
      paddedStartMs,
      paddedEndMsExclusive,
      trimStartMs: selectedStartMs - paddedStartMs,
      trimEndMsExclusive:
        selectedStartMs - paddedStartMs + selectedEndMsExclusive - selectedStartMs,
    });
  }
  return spans;
}

async function main() {
  const cp03Evidence = JSON.parse(await readFile(cp03EvidencePath, "utf8"));
  const cp03Root = cp03Evidence.artifactRoot;
  const sourcePath = path.join(cp03Root, "owned-fixtures/long-30m.wav");
  const asrResultPath = path.join(
    cp03Root,
    "mac/videoforge-private-fixture/runs/revision_cp03_long/attempt_cp03_long/asr-result.json",
  );
  const asrResult = JSON.parse(await readFile(asrResultPath, "utf8"));
  const transcriptValue = { ...asrResult.transcript, project_revision_id: revisionId };
  const [revision, transcript] = await Promise.all([
    validateAndHashContractDocument("projectRevisionConfig", revisionValue(transcriptValue)),
    validateAndHashContractDocument("transcriptTiming", transcriptValue),
  ]);
  const request = {
    revision,
    transcript,
    determinism: Object.freeze({
      clock: Object.freeze({
        nowIso: () => {
          throw new Error("clock access forbidden");
        },
      }),
      ids: Object.freeze({ idFor: stableId }),
    }),
  };
  const firstTimeline = requireSuccess(await scheduleTimeline(request));
  const replayTimeline = requireSuccess(await scheduleTimeline(request));
  if (firstTimeline.sha256 !== replayTimeline.sha256) throw new Error("Timeline replay drifted.");
  const selectedSpanAudio = await materializeSpans(
    firstTimeline,
    sourcePath,
    transcriptValue.source.duration_ms,
  );
  const workPlan = requireSuccess(
    await compileCompleteWorkPlan({
      revision,
      transcript,
      timeline: firstTimeline,
      schedulerConfigHash: await sha256CanonicalJson(SUPPORTED_SCHEDULER_CONFIG),
      selectedSpanAudio,
    }),
  );
  const generation = workPlan.generationWorkManifest;
  const render = workPlan.renderWorkManifest;
  const framesByComposition = Object.fromEntries(
    ["IMAGE_FULL", "AVATAR_FULL", "AVATAR_SPLIT_IMAGE"].map((composition) => [
      composition,
      firstTimeline.value.segments
        .filter((segment) => segment.timeline_composition === composition)
        .reduce((sum, segment) => sum + segment.end_frame_exclusive - segment.start_frame, 0),
    ]),
  );
  const avatarFrames = framesByComposition.AVATAR_FULL + framesByComposition.AVATAR_SPLIT_IMAGE;
  const summary = {
    schemaVersion: "videoforge.cp04-long-owned-work-plan/v1",
    status: "SUCCEEDED",
    source: {
      durationMs: transcriptValue.source.duration_ms,
      sha256: transcriptValue.source.sha256,
      words: transcriptValue.words.length,
      phrases: transcriptValue.phrases.length,
    },
    timeline: {
      sha256: firstTimeline.sha256,
      replaySha256: replayTimeline.sha256,
      totalFrames: firstTimeline.value.total_frames,
      segmentCount: firstTimeline.value.segments.length,
      framesByComposition,
      avatarCoveragePercent: Number(
        ((avatarFrames / firstTimeline.value.total_frames) * 100).toFixed(4),
      ),
      fullSplitDifferenceFrames: Math.abs(
        framesByComposition.AVATAR_FULL - framesByComposition.AVATAR_SPLIT_IMAGE,
      ),
    },
    work: {
      generationManifestSha256: generation.sha256,
      renderManifestSha256: render.sha256,
      promptBatchSizes: generation.value.prompt_batches.map(
        (batch) => batch.scene_task_keys.length,
      ),
      imageSlotCount: generation.value.image_slots.length,
      avatarSpanCount: generation.value.avatar_spans.length,
      selectedSpanAudioMs: generation.value.cost_counts.selected_span_audio_ms,
      renderSegmentCount: generation.value.cost_counts.render_segment_count,
      shotRoleCount: new Set(generation.value.image_slots.map((slot) => slot.in_image_shot_role))
        .size,
      fullVoiceoverDispatched: generation.value.echo_audio_policy.full_voiceover_dispatched,
      spanAudioProbe: "all pcm_s16le 16000 Hz mono exact duration",
      transitionPolicy: render.value.transition_policy,
      slowImageZoomRequired: render.value.segments
        .filter((segment) => segment.timeline_composition !== "AVATAR_FULL")
        .every((segment) => segment.image_zoom_profile === "SLOW_SMOOTH_CENTERED_ZOOM"),
    },
    authority: {
      selection: "DETERMINISTIC_CODE",
      providerCallsAuthorized: false,
      providerCalls: 0,
      externalSpendUsd: 0,
      gpuUsed: false,
      cloudMutations: 0,
    },
  };
  await mkdir(outputRoot, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(outputRoot, "timeline-plan.json"),
      `${canonicalizeJson(firstTimeline.value)}\n`,
    ),
    writeFile(
      path.join(outputRoot, "generation-work-manifest.json"),
      `${canonicalizeJson(generation.value)}\n`,
    ),
    writeFile(
      path.join(outputRoot, "render-work-manifest.json"),
      `${canonicalizeJson(render.value)}\n`,
    ),
    writeFile(
      path.join(outputRoot, "acceptance-summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    ),
  ]);
  console.log(JSON.stringify(summary, null, 2));
}

await main();

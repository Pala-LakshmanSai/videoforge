import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeJson, validateAndHashContractDocument } from "@videoforge/contracts";
import {
  deterministicTimelineScheduler,
  scheduleTimeline,
  SUPPORTED_SCHEDULER_VERSION,
} from "../dist/src/index.js";

const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const SHA_C = `sha256:${"c".repeat(64)}`;
const REVISION_ID = "revision_local_owned_001";
const VOICEOVER_ASSET_ID = "asset_voiceover_local_owned_001";

const PHRASES = [
  [0, 4_500, "A ripe watermelon gives several small clues before it is opened."],
  [4_500, 8_000, "Begin by looking for a creamy yellow field spot"],
  [8_000, 12_000, "where the fruit rested on the ground."],
  [12_000, 16_000, "Next, compare the weight with another melon of similar size;"],
  [16_000, 20_500, "the heavier one usually holds more water."],
  [20_500, 24_000, "Run your fingers across the rind"],
  [24_000, 28_000, "and choose a surface that feels firm rather than soft."],
  [28_000, 32_000, "Finally, inspect the stem and listen for a deep, steady sound"],
  [32_000, 36_000, "when you tap the center."],
  [
    36_000,
    40_000,
    "These simple checks work best when considered together, not as isolated promises.",
  ],
];

function createTranscriptValue() {
  const words = [];
  const phrases = [];

  for (const [phraseIndex, [startMs, endMs, text]] of PHRASES.entries()) {
    const tokens = text.split(/\s+/u);
    const wordStart = words.length;
    for (const [tokenIndex, token] of tokens.entries()) {
      words.push({
        index: words.length,
        text: token,
        start_ms: startMs + Math.floor(((endMs - startMs) * tokenIndex) / tokens.length),
        end_ms: startMs + Math.floor(((endMs - startMs) * (tokenIndex + 1)) / tokens.length),
        confidence: 1,
      });
    }
    phrases.push({
      phrase_id: `owned_phrase_${String(phraseIndex + 1).padStart(2, "0")}`,
      sentence_id: `owned_sentence_${String(Math.floor(phraseIndex / 2) + 1).padStart(2, "0")}`,
      word_start: wordStart,
      word_end_exclusive: words.length,
      start_ms: startMs,
      end_ms: endMs,
      pause_before_ms: 0,
      pause_after_ms: 0,
      text,
    });
  }

  return {
    schema_version: "transcript-timing/v1",
    project_revision_id: REVISION_ID,
    source: {
      asset_id: VOICEOVER_ASSET_ID,
      sha256: SHA_A,
      duration_ms: 40_000,
    },
    engine: {
      name: "whisper.cpp",
      version: "fixture-1.0.0",
      model_name: "base.en",
      model_sha256: SHA_B,
      language: "en",
    },
    text: PHRASES.map(([, , text]) => text).join(" "),
    words,
    phrases,
  };
}

function createRevisionValue(seed) {
  return {
    schema_version: "project-revision-config/v2",
    project_id: "project_local_owned_001",
    project_revision_id: REVISION_ID,
    title: "How to Recognize a Sweet Watermelon",
    voiceover_asset_id: VOICEOVER_ASSET_ID,
    voiceover_sha256: SHA_A,
    avatar_binding: {
      avatar_profile_id: "avatar_profile_fixture_001",
      avatar_profile_version_id: "avatar_profile_version_fixture_001",
      avatar_display_name_snapshot: "Amish Farm Host",
      avatar_profile_hash: SHA_C,
      runtime_source_asset_id: "asset_avatar_runtime_001",
      runtime_source_sha256: SHA_B,
      source_preparation_version: "avatar-source-prep-v1",
      source_validation_profile_version: "avatar-source-validation-v1",
      compatibility_state_at_preflight: "UNTESTED",
      compatibility_evidence: null,
    },
    optional_script: null,
    image_style_version_id: "style_version_documentary_stock_v1",
    style_profile_hash: SHA_C,
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
    scheduler_seed: seed,
    prompt_writer_version: "fixture-prompt-writer-v1",
    prompt_compiler_version: "fixture-prompt-compiler-v1",
  };
}

function stableId(namespace, stableKey) {
  let hash = 0x811c9dc5;
  for (const character of `${namespace}:${stableKey}`) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `seg_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

const determinism = Object.freeze({
  clock: Object.freeze({
    nowIso() {
      throw new Error("The timeline scheduler must not read a clock.");
    },
  }),
  ids: Object.freeze({ idFor: stableId }),
});

async function requestFor(seed) {
  const [revision, transcript] = await Promise.all([
    validateAndHashContractDocument("projectRevisionConfig", createRevisionValue(seed)),
    validateAndHashContractDocument("transcriptTiming", createTranscriptValue()),
  ]);
  return { revision, transcript, determinism };
}

function requireSuccess(result) {
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function editorialFingerprint(plan) {
  return plan.segments.map((segment) => ({
    start: segment.start_frame,
    end: segment.end_frame_exclusive,
    composition: segment.timeline_composition,
    role: segment.in_image_shot_role ?? null,
  }));
}

test("same revision and seed produce byte-equivalent validated plans", async () => {
  const request = await requestFor(982_341);
  const first = requireSuccess(await scheduleTimeline(request));
  const second = requireSuccess(await deterministicTimelineScheduler.schedule(request));

  assert.equal(first.contractName, "timelinePlan");
  assert.equal(first.sha256, second.sha256);
  assert.equal(canonicalizeJson(first.value), canonicalizeJson(second.value));
  assert.equal(first.value.revision_config_hash, request.revision.sha256);
});

test("a different explicit seed produces a different valid editorial plan", async () => {
  const first = requireSuccess(await scheduleTimeline(await requestFor(982_341)));
  const second = requireSuccess(await scheduleTimeline(await requestFor(123_456_789)));

  assert.notEqual(first.sha256, second.sha256);
  assert.notDeepEqual(editorialFingerprint(first.value), editorialFingerprint(second.value));
  await validateAndHashContractDocument("timelinePlan", first.value);
  await validateAndHashContractDocument("timelinePlan", second.value);
});

test("the owned 40-second fixture has exact coverage, legal slots, and all compositions", async () => {
  const timeline = requireSuccess(await scheduleTimeline(await requestFor(982_341))).value;
  const transcript = createTranscriptValue();
  const phraseWordStarts = new Set(transcript.phrases.map((phrase) => phrase.word_start));
  const compositions = new Set(timeline.segments.map((segment) => segment.timeline_composition));

  assert.equal(timeline.output_fps_num, 30);
  assert.equal(timeline.output_fps_den, 1);
  assert.equal(timeline.total_frames, 1_200);
  assert.equal(timeline.segments[0].timeline_composition, "AVATAR_FULL");
  assert.deepEqual([...compositions].sort(), ["AVATAR_FULL", "AVATAR_SPLIT_IMAGE", "IMAGE_FULL"]);

  let frame = 0;
  let sourceMs = 0;
  let word = 0;
  const avatarCompositions = [];
  const segmentIds = new Set();

  for (const segment of timeline.segments) {
    assert.equal(segment.start_frame, frame);
    assert.equal(segment.source_audio_start_ms, sourceMs);
    assert.equal(segment.word_start, word);
    assert.ok(segment.end_frame_exclusive > segment.start_frame);
    assert.ok(segment.source_audio_end_ms > segment.source_audio_start_ms);
    assert.ok(phraseWordStarts.has(segment.word_start));
    assert.equal(segmentIds.has(segment.segment_id), false);
    segmentIds.add(segment.segment_id);

    const durationMs = segment.source_audio_end_ms - segment.source_audio_start_ms;
    if (segment.timeline_composition === "IMAGE_FULL") {
      assert.ok(durationMs >= 3_000 && durationMs <= 7_000);
      assert.deepEqual(Object.keys(segment.required_slots), ["image"]);
      assert.match(segment.required_slots.image.task_key, /^image:/u);
    } else if (segment.timeline_composition === "AVATAR_FULL") {
      avatarCompositions.push(segment.timeline_composition);
      assert.deepEqual(Object.keys(segment.required_slots), ["avatar"]);
      assert.match(segment.required_slots.avatar.task_key, /^avatar:/u);
      assert.match(segment.required_slots.avatar.span_audio_task_key, /^audio-span:/u);
    } else {
      avatarCompositions.push(segment.timeline_composition);
      assert.deepEqual(Object.keys(segment.required_slots), ["avatar", "right_image"]);
      assert.match(segment.required_slots.right_image.task_key, /^image:.+:right$/u);
    }

    frame = segment.end_frame_exclusive;
    sourceMs = segment.source_audio_end_ms;
    word = segment.word_end_exclusive;
  }

  assert.equal(frame, timeline.total_frames);
  assert.equal(sourceMs, transcript.source.duration_ms);
  assert.equal(word, transcript.words.length);
  assert.deepEqual(avatarCompositions, ["AVATAR_FULL", "AVATAR_SPLIT_IMAGE"]);
  assert.doesNotMatch(JSON.stringify(timeline), /"asset_id"/u);

  const avatarFrames = timeline.segments
    .filter((segment) => segment.timeline_composition !== "IMAGE_FULL")
    .reduce((sum, segment) => sum + segment.end_frame_exclusive - segment.start_frame, 0);
  assert.ok(avatarFrames / timeline.total_frames >= 0.2);
  assert.ok(avatarFrames / timeline.total_frames <= 0.24);
});

test("cross-revision transcript bindings fail closed", async () => {
  const request = await requestFor(982_341);
  const mismatchedTranscript = await validateAndHashContractDocument("transcriptTiming", {
    ...request.transcript.value,
    project_revision_id: "revision_other_001",
  });
  const result = await scheduleTimeline({ ...request, transcript: mismatchedTranscript });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "TRANSCRIPT_INVALID");
  assert.deepEqual(result.error.path, ["transcript", "project_revision_id"]);
});

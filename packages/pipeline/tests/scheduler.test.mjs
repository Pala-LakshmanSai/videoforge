import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeJson, validateAndHashContractDocument } from "@videoforge/contracts";
import {
  deterministicTimelineScheduler,
  scheduleTimeline,
  SUPPORTED_SCHEDULER_CONFIG,
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

function createPropertyTranscript({
  durationMs,
  phraseStarts,
  silentTailMs = 0,
  punctuation = true,
}) {
  const words = [];
  const phrases = phraseStarts.map((startMs, index) => {
    const nextBoundary = phraseStarts[index + 1] ?? durationMs;
    const endMs = Math.max(startMs + 1, nextBoundary - silentTailMs);
    const word = punctuation ? `phrase-${String(index)}.` : `phrase-${String(index)}`;
    words.push({
      index,
      text: word,
      start_ms: startMs,
      end_ms: endMs,
      confidence: 0.99,
    });
    return {
      phrase_id: `property_phrase_${String(index).padStart(5, "0")}`,
      sentence_id: `property_sentence_${String(Math.floor(index / 2)).padStart(5, "0")}`,
      word_start: index,
      word_end_exclusive: index + 1,
      start_ms: startMs,
      end_ms: endMs,
      pause_before_ms: index === 0 ? startMs : silentTailMs,
      pause_after_ms: silentTailMs,
      text: word,
    };
  });
  return {
    schema_version: "transcript-timing/v1",
    project_revision_id: REVISION_ID,
    source: {
      asset_id: VOICEOVER_ASSET_ID,
      sha256: SHA_A,
      duration_ms: durationMs,
    },
    engine: {
      name: "whisper.cpp",
      version: "fixture-1.0.0",
      model_name: "base.en",
      model_sha256: SHA_B,
      language: "en",
    },
    text: words.map((word) => word.text).join(" "),
    words,
    phrases,
  };
}

async function propertyRequest(seed, transcriptValue) {
  const [revision, transcript] = await Promise.all([
    validateAndHashContractDocument("projectRevisionConfig", createRevisionValue(seed)),
    validateAndHashContractDocument("transcriptTiming", transcriptValue),
  ]);
  return { revision, transcript, determinism };
}

function assertExactTimelineCoverage(plan, transcript) {
  let nextFrame = 0;
  let nextSourceMs = 0;
  let nextWord = 0;
  let previousAvatar = null;
  let avatarFrames = 0;
  for (const segment of plan.segments) {
    assert.equal(segment.start_frame, nextFrame);
    assert.equal(segment.source_audio_start_ms, nextSourceMs);
    assert.equal(segment.word_start, nextWord);
    assert.ok(segment.end_frame_exclusive > segment.start_frame);
    assert.ok(segment.source_audio_end_ms > segment.source_audio_start_ms);
    if (segment.timeline_composition !== "IMAGE_FULL") {
      assert.notEqual(segment.timeline_composition, previousAvatar);
      previousAvatar = segment.timeline_composition;
      avatarFrames += segment.end_frame_exclusive - segment.start_frame;
    }
    nextFrame = segment.end_frame_exclusive;
    nextSourceMs = segment.source_audio_end_ms;
    nextWord = segment.word_end_exclusive;
  }
  assert.equal(nextFrame, plan.total_frames);
  assert.equal(nextSourceMs, transcript.source.duration_ms);
  assert.equal(nextWord, transcript.words.length);
  return avatarFrames / plan.total_frames;
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

test("scheduler-v1 publishes every behavior-bearing constant as one immutable config", () => {
  assert.equal(
    SUPPORTED_SCHEDULER_CONFIG.schema_version,
    "deterministic-timeline-scheduler-config/v1",
  );
  assert.equal(SUPPORTED_SCHEDULER_CONFIG.output_fps_num, 30);
  assert.deepEqual(SUPPORTED_SCHEDULER_CONFIG.shot_roles, [
    "ENVIRONMENTAL_WIDE",
    "HUMAN_MEDIUM",
    "HANDS_ACTION",
    "OBJECT_EVIDENCE",
    "MACRO_DETAIL",
    "REACTION_RESULT",
  ]);
  assert.equal(SUPPORTED_SCHEDULER_CONFIG.target_avatar_ratio_minimum, 0.21);
  assert.equal(SUPPORTED_SCHEDULER_CONFIG.target_avatar_ratio_maximum, 0.22);
  assert.equal(SUPPORTED_SCHEDULER_CONFIG.selected_span_context_padding_ms, 500);
  assert.equal(Object.isFrozen(SUPPORTED_SCHEDULER_CONFIG), true);
  assert.equal(Object.isFrozen(SUPPORTED_SCHEDULER_CONFIG.shot_roles), true);
});

test("short, silent, fast, slow, unpunctuated and 30-minute fixtures remain deterministic", async () => {
  const starts = (durationMs, stepMs, offsetMs = 0) =>
    Array.from(
      { length: Math.ceil((durationMs - offsetMs) / stepMs) },
      (_, index) => offsetMs + index * stepMs,
    );
  const fixtures = [
    {
      name: "short",
      value: createPropertyTranscript({ durationMs: 12_000, phraseStarts: [0, 4_000, 8_000] }),
    },
    {
      name: "silent",
      value: createPropertyTranscript({
        durationMs: 40_000,
        phraseStarts: starts(40_000, 4_000, 500),
        silentTailMs: 1_000,
      }),
    },
    {
      name: "fast",
      value: createPropertyTranscript({
        durationMs: 40_000,
        phraseStarts: starts(40_000, 500),
        silentTailMs: 25,
      }),
    },
    {
      name: "slow",
      value: createPropertyTranscript({ durationMs: 40_000, phraseStarts: starts(40_000, 5_000) }),
    },
    {
      name: "unpunctuated",
      value: createPropertyTranscript({
        durationMs: 40_000,
        phraseStarts: starts(40_000, 4_000),
        punctuation: false,
      }),
    },
    {
      name: "thirty-minute",
      value: createPropertyTranscript({
        durationMs: 1_800_000,
        phraseStarts: starts(1_800_000, 5_000),
      }),
    },
  ];

  for (const fixture of fixtures) {
    for (const seed of [0, 982_341, 4_294_967_295]) {
      const request = await propertyRequest(seed, fixture.value);
      const firstResult = await scheduleTimeline(request);
      const secondResult = await scheduleTimeline(request);
      assert.equal(
        firstResult.ok,
        true,
        `${fixture.name} seed ${String(seed)}: ${firstResult.ok ? "" : JSON.stringify(firstResult.error)}`,
      );
      assert.equal(
        secondResult.ok,
        true,
        `${fixture.name} replay seed ${String(seed)}: ${secondResult.ok ? "" : JSON.stringify(secondResult.error)}`,
      );
      if (!firstResult.ok || !secondResult.ok) continue;
      const first = firstResult.value;
      const second = secondResult.value;
      assert.equal(first.sha256, second.sha256, `${fixture.name} seed ${String(seed)}`);
      assert.equal(
        canonicalizeJson(first.value),
        canonicalizeJson(second.value),
        `${fixture.name} seed ${String(seed)}`,
      );
      const avatarRatio = assertExactTimelineCoverage(first.value, fixture.value);
      if (fixture.name !== "short") {
        assert.ok(
          avatarRatio >= 0.19 && avatarRatio <= (fixture.name === "slow" ? 0.26 : 0.24),
          `${fixture.name}: ${String(avatarRatio)}`,
        );
      }
    }
  }
});

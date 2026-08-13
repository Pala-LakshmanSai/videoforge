import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeJson,
  sha256CanonicalJson,
  validateAndHashContractDocument,
} from "@videoforge/contracts";
import {
  compileCompleteWorkPlan,
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
    const wordStart = words.length;
    const wordQuantumMs = durationMs <= 20_000 ? 200 : 500;
    const wordCount = Math.max(1, Math.ceil((endMs - startMs) / wordQuantumMs));
    for (let wordIndex = 0; wordIndex < wordCount; wordIndex += 1) {
      const final = wordIndex === wordCount - 1;
      words.push({
        index: words.length,
        text: `phrase-${String(index)}-word-${String(wordIndex)}${final && punctuation ? "." : ""}`,
        start_ms: startMs + Math.floor(((endMs - startMs) * wordIndex) / wordCount),
        end_ms: startMs + Math.floor(((endMs - startMs) * (wordIndex + 1)) / wordCount),
        confidence: 0.99,
      });
    }
    return {
      phrase_id: `property_phrase_${String(index).padStart(5, "0")}`,
      sentence_id: `property_sentence_${String(Math.floor(index / 2)).padStart(5, "0")}`,
      word_start: wordStart,
      word_end_exclusive: words.length,
      start_ms: startMs,
      end_ms: endMs,
      pause_before_ms: index === 0 ? startMs : silentTailMs,
      pause_after_ms: silentTailMs,
      text: words
        .slice(wordStart)
        .map((word) => word.text)
        .join(" "),
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
  let fullAvatarFrames = 0;
  let splitAvatarFrames = 0;
  for (const segment of plan.segments) {
    assert.equal(segment.start_frame, nextFrame);
    assert.equal(segment.source_audio_start_ms, nextSourceMs);
    assert.equal(segment.word_start, nextWord);
    assert.ok(segment.end_frame_exclusive > segment.start_frame);
    assert.ok(segment.source_audio_end_ms > segment.source_audio_start_ms);
    if (segment.timeline_composition !== "IMAGE_FULL") {
      assert.notEqual(segment.timeline_composition, previousAvatar);
      previousAvatar = segment.timeline_composition;
      const durationFrames = segment.end_frame_exclusive - segment.start_frame;
      avatarFrames += durationFrames;
      if (segment.timeline_composition === "AVATAR_FULL") fullAvatarFrames += durationFrames;
      else splitAvatarFrames += durationFrames;
    }
    nextFrame = segment.end_frame_exclusive;
    nextSourceMs = segment.source_audio_end_ms;
    nextWord = segment.word_end_exclusive;
  }
  assert.equal(nextFrame, plan.total_frames);
  assert.equal(nextSourceMs, transcript.source.duration_ms);
  assert.equal(nextWord, transcript.words.length);
  return {
    avatarRatio: avatarFrames / plan.total_frames,
    fullSplitDifferenceFrames: Math.abs(fullAvatarFrames - splitAvatarFrames),
  };
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
    assert.equal(
      segment.source_audio_start_ms,
      segment.word_start === 0 ? 0 : transcript.words[segment.word_start].start_ms,
    );
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
  assert.ok(avatarFrames / timeline.total_frames >= 0.21);
  assert.ok(avatarFrames / timeline.total_frames <= 0.22);
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

test("scheduler-v2 publishes every behavior-bearing constant as one immutable config", () => {
  assert.equal(
    SUPPORTED_SCHEDULER_CONFIG.schema_version,
    "deterministic-timeline-scheduler-config/v2",
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
  assert.equal(SUPPORTED_SCHEDULER_CONFIG.avatar_coverage_pace_score_weight, 5);
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
      const coverage = assertExactTimelineCoverage(first.value, fixture.value);
      assert.ok(
        coverage.avatarRatio >= 0.21 && coverage.avatarRatio <= 0.22,
        `${fixture.name}: ${String(coverage.avatarRatio)}`,
      );
      assert.ok(
        coverage.fullSplitDifferenceFrames <= 210,
        `${fixture.name} full/split difference: ${String(coverage.fullSplitDifferenceFrames)}`,
      );
    }
  }
});

function materializedSpans(plan, sourceDurationMs) {
  return plan.segments.flatMap((segment, index) => {
    if (segment.timeline_composition === "IMAGE_FULL") return [];
    const paddedStartMs = Math.max(
      0,
      segment.source_audio_start_ms - SUPPORTED_SCHEDULER_CONFIG.selected_span_context_padding_ms,
    );
    const paddedEndMsExclusive = Math.min(
      sourceDurationMs,
      segment.source_audio_end_ms + SUPPORTED_SCHEDULER_CONFIG.selected_span_context_padding_ms,
    );
    return [
      {
        spanId: `span_${String(index).padStart(5, "0")}`,
        timelineSegmentId: segment.segment_id,
        taskKey: segment.required_slots.avatar.span_audio_task_key,
        artifactId: `asset-span:${String(index).padStart(5, "0")}`,
        sha256: `sha256:${(index % 16).toString(16).repeat(64)}`,
        selectedStartMs: segment.source_audio_start_ms,
        selectedEndMsExclusive: segment.source_audio_end_ms,
        paddedStartMs,
        paddedEndMsExclusive,
        trimStartMs: segment.source_audio_start_ms - paddedStartMs,
        trimEndMsExclusive:
          segment.source_audio_start_ms -
          paddedStartMs +
          segment.source_audio_end_ms -
          segment.source_audio_start_ms,
      },
    ];
  });
}

test("owned 30-minute work plan is complete, immutable, replayable, and provider inert", async (t) => {
  const transcriptValue = createPropertyTranscript({
    durationMs: 1_800_000,
    phraseStarts: Array.from({ length: 360 }, (_, index) => index * 5_000),
  });
  const request = await propertyRequest(982_341, transcriptValue);
  const timeline = requireSuccess(await scheduleTimeline(request));
  const schedulerConfigHash = await sha256CanonicalJson(SUPPORTED_SCHEDULER_CONFIG);
  const selectedSpanAudio = materializedSpans(timeline.value, transcriptValue.source.duration_ms);
  const compileRequest = {
    revision: request.revision,
    transcript: request.transcript,
    timeline,
    schedulerConfigHash,
    selectedSpanAudio,
  };
  const first = requireSuccess(await compileCompleteWorkPlan(compileRequest));
  const second = requireSuccess(await compileCompleteWorkPlan(compileRequest));
  const work = first.generationWorkManifest.value;
  const render = first.renderWorkManifest.value;

  assert.equal(first.generationWorkManifest.sha256, second.generationWorkManifest.sha256);
  assert.equal(first.renderWorkManifest.sha256, second.renderWorkManifest.sha256);
  assert.equal(work.selection_authority, "DETERMINISTIC_CODE");
  assert.equal(work.echo_audio_policy.full_voiceover_dispatched, false);
  assert.equal(work.echo_audio_policy.sample_rate_hz, 16_000);
  assert.equal(work.cost_counts.image_prompt_count, work.image_slots.length);
  assert.equal(work.cost_counts.image_generation_count, work.image_slots.length);
  assert.equal(work.cost_counts.avatar_generation_count, work.avatar_spans.length);
  assert.equal(work.cost_counts.selected_span_audio_count, selectedSpanAudio.length);
  assert.equal(work.cost_counts.render_segment_count, timeline.value.segments.length);
  assert.equal(
    new Set(work.image_slots.map((slot) => slot.task_key)).size,
    work.image_slots.length,
  );
  assert.equal(
    new Set(work.avatar_spans.map((span) => span.task_key)).size,
    work.avatar_spans.length,
  );
  assert.ok(work.prompt_batches.every((batch) => batch.scene_task_keys.length >= 25));
  assert.ok(work.prompt_batches.every((batch) => batch.scene_task_keys.length <= 50));
  assert.ok(new Set(work.image_slots.map((slot) => slot.in_image_shot_role)).size >= 4);
  assert.ok(
    work.avatar_spans.every(
      (span) => span.padded_end_ms_exclusive - span.padded_start_ms < 1_800_000,
    ),
  );

  assert.equal(render.transition_policy, "HARD_CUTS_ONLY");
  assert.equal(render.output.total_frames, timeline.value.total_frames);
  assert.equal(render.generation_work_manifest_hash, first.generationWorkManifest.sha256);
  assert.equal(render.segments.length, timeline.value.segments.length);
  let nextFrame = 0;
  for (const segment of render.segments) {
    assert.equal(segment.start_frame, nextFrame);
    assert.equal(
      segment.image_zoom_profile,
      segment.timeline_composition === "AVATAR_FULL" ? "NONE" : "SLOW_SMOOTH_CENTERED_ZOOM",
    );
    nextFrame = segment.end_frame_exclusive;
  }
  assert.equal(nextFrame, render.output.total_frames);

  const missing = await compileCompleteWorkPlan({
    ...compileRequest,
    selectedSpanAudio: selectedSpanAudio.slice(1),
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "WORK_PLAN_INVALID");

  const framesByComposition = Object.fromEntries(
    ["IMAGE_FULL", "AVATAR_FULL", "AVATAR_SPLIT_IMAGE"].map((composition) => [
      composition,
      timeline.value.segments
        .filter((segment) => segment.timeline_composition === composition)
        .reduce((sum, segment) => sum + segment.end_frame_exclusive - segment.start_frame, 0),
    ]),
  );
  const avatarFrames = framesByComposition.AVATAR_FULL + framesByComposition.AVATAR_SPLIT_IMAGE;
  const avatarDurations = timeline.value.segments
    .filter((segment) => segment.timeline_composition !== "IMAGE_FULL")
    .map((segment) => segment.source_audio_end_ms - segment.source_audio_start_ms);
  t.diagnostic(
    JSON.stringify({
      fixtureDurationMs: transcriptValue.source.duration_ms,
      totalFrames: timeline.value.total_frames,
      timelineSha256: timeline.sha256,
      generationWorkManifestSha256: first.generationWorkManifest.sha256,
      renderWorkManifestSha256: first.renderWorkManifest.sha256,
      segmentCount: timeline.value.segments.length,
      framesByComposition,
      avatarCoveragePercent: Number(
        ((avatarFrames / timeline.value.total_frames) * 100).toFixed(4),
      ),
      fullSplitDifferenceFrames: Math.abs(
        framesByComposition.AVATAR_FULL - framesByComposition.AVATAR_SPLIT_IMAGE,
      ),
      avatarSpanCount: work.avatar_spans.length,
      avatarSpanDurationMs: {
        minimum: Math.min(...avatarDurations),
        maximum: Math.max(...avatarDurations),
      },
      imageSlotCount: work.image_slots.length,
      promptBatchSizes: work.prompt_batches.map((batch) => batch.scene_task_keys.length),
      shotRoleCount: new Set(work.image_slots.map((slot) => slot.in_image_shot_role)).size,
      fullVoiceoverDispatched: work.echo_audio_policy.full_voiceover_dispatched,
      transitionPolicy: render.transition_policy,
      imageZoomProfiles: [...new Set(render.segments.map((segment) => segment.image_zoom_profile))],
    }),
  );
});

test("complete work plans reject forged scheduler identity, word cuts, and duplicate work", async () => {
  const transcriptValue = createPropertyTranscript({
    durationMs: 1_800_000,
    phraseStarts: Array.from({ length: 360 }, (_, index) => index * 5_000),
  });
  const request = await propertyRequest(982_341, transcriptValue);
  const timeline = requireSuccess(await scheduleTimeline(request));
  const schedulerConfigHash = await sha256CanonicalJson(SUPPORTED_SCHEDULER_CONFIG);

  const wrongConfig = await compileCompleteWorkPlan({
    revision: request.revision,
    transcript: request.transcript,
    timeline,
    schedulerConfigHash: SHA_C,
    selectedSpanAudio: materializedSpans(timeline.value, transcriptValue.source.duration_ms),
  });
  assert.equal(wrongConfig.ok, false);
  assert.deepEqual(wrongConfig.error.path, ["schedulerConfigHash"]);

  const cutTimelineValue = structuredClone(timeline.value);
  const cutIndex = cutTimelineValue.segments.findIndex((segment, index) => {
    const next = cutTimelineValue.segments[index + 1];
    return (
      next !== undefined &&
      Math.round((segment.source_audio_end_ms * 30) / 1_000) ===
        Math.round(((segment.source_audio_end_ms + 1) * 30) / 1_000)
    );
  });
  assert.notEqual(cutIndex, -1);
  cutTimelineValue.segments[cutIndex].source_audio_end_ms += 1;
  cutTimelineValue.segments[cutIndex + 1].source_audio_start_ms += 1;
  const cutTimeline = await validateAndHashContractDocument("timelinePlan", cutTimelineValue);
  const cutResult = await compileCompleteWorkPlan({
    revision: request.revision,
    transcript: request.transcript,
    timeline: cutTimeline,
    schedulerConfigHash,
    selectedSpanAudio: materializedSpans(cutTimeline.value, transcriptValue.source.duration_ms),
  });
  assert.equal(cutResult.ok, false);
  assert.deepEqual(cutResult.error.path, ["timeline"]);

  const duplicateTimelineValue = structuredClone(timeline.value);
  const avatarSegments = duplicateTimelineValue.segments.filter(
    (segment) => segment.timeline_composition !== "IMAGE_FULL",
  );
  assert.ok(avatarSegments.length >= 2);
  avatarSegments[1].required_slots.avatar.task_key =
    avatarSegments[0].required_slots.avatar.task_key;
  const duplicateTimeline = await validateAndHashContractDocument(
    "timelinePlan",
    duplicateTimelineValue,
  );
  const duplicateResult = await compileCompleteWorkPlan({
    revision: request.revision,
    transcript: request.transcript,
    timeline: duplicateTimeline,
    schedulerConfigHash,
    selectedSpanAudio: materializedSpans(
      duplicateTimeline.value,
      transcriptValue.source.duration_ms,
    ),
  });
  assert.equal(duplicateResult.ok, false);
  assert.deepEqual(duplicateResult.error.path, ["timeline"]);
});

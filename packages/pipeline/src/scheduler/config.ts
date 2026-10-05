export const SUPPORTED_SCHEDULER_VERSION = "scheduler-v2";

export const SCHEDULER_SHOT_ROLES = Object.freeze([
  "ENVIRONMENTAL_WIDE",
  "HUMAN_MEDIUM",
  "HANDS_ACTION",
  "OBJECT_EVIDENCE",
  "MACRO_DETAIL",
  "REACTION_RESULT",
] as const);

/** Immutable behavior-bearing scheduler-v2 inputs. */
export const SUPPORTED_SCHEDULER_CONFIG = Object.freeze({
  schema_version: "deterministic-timeline-scheduler-config/v2",
  output_fps_num: 30,
  output_fps_den: 1,
  image_minimum_ms: 3_000,
  image_maximum_ms: 7_000,
  avatar_minimum_ms: 2_000,
  avatar_maximum_ms: 6_000,
  opener_maximum_ms: 7_000,
  desired_opener_minimum_ms: 4_000,
  desired_opener_maximum_ms: 6_000,
  minimum_avatar_start_delta_ms: 11_000,
  maximum_avatar_start_delta_ms: 23_000,
  desired_avatar_start_delta_minimum_ms: 14_000,
  desired_avatar_start_delta_maximum_ms: 20_000,
  desired_avatar_duration_minimum_ms: 3_400,
  desired_avatar_duration_maximum_ms: 4_100,
  avatar_duration_jitter_minimum_ms: -600,
  avatar_duration_jitter_maximum_ms: 600,
  avatar_duration_score_weight: 0.7,
  avatar_coverage_score_weight: 0.2,
  avatar_coverage_pace_score_weight: 5,
  avatar_balance_score_weight: 0.35,
  target_avatar_ratio_minimum: 0.21,
  target_avatar_ratio_maximum: 0.22,
  selected_span_context_padding_ms: 500,
  shot_roles: SCHEDULER_SHOT_ROLES,
});

export const SHORT_FORM_SCHEDULER_VERSION = "scheduler-v3";

/** V3 widens short-form coverage while preserving the exact immutable V2 config and hash. */
export const SHORT_FORM_SCHEDULER_CONFIG = Object.freeze({
  ...SUPPORTED_SCHEDULER_CONFIG,
  schema_version: "deterministic-timeline-scheduler-config/v3",
  short_form_maximum_ms: 15_000,
  short_form_target_avatar_ratio_minimum: 0.2,
  short_form_target_avatar_ratio_maximum: 0.24,
});

export const SCRIPT_SHORT_FORM_SCHEDULER_VERSION = "scheduler-v4";

/** Extend the established short coverage envelope without changing V2 or V3 identities. */
export const SCRIPT_SHORT_FORM_SCHEDULER_CONFIG = Object.freeze({
  ...SHORT_FORM_SCHEDULER_CONFIG,
  schema_version: "deterministic-timeline-scheduler-config/v4",
  short_form_maximum_ms: 30_000,
});

export const WORD_BOUNDARY_SCHEDULER_VERSION = "scheduler-v5";

/** New short projects try the V4 envelope first; an impossible word boundary may use at most 26%. */
export const WORD_BOUNDARY_SCHEDULER_CONFIG = Object.freeze({
  ...SCRIPT_SHORT_FORM_SCHEDULER_CONFIG,
  schema_version: "deterministic-timeline-scheduler-config/v5",
  short_form_boundary_fallback_maximum: 0.26,
});

/** Fresh revisions keep their predecessor's timing/seed behavior; only shot eligibility changes. */
export const NARRATION_SHOT_SCHEDULER_VERSION = "scheduler-v6";
export const NARRATION_SHOT_SHORT_SCHEDULER_VERSION = "scheduler-v7";
export const NARRATION_SHOT_SCHEDULER_CONFIG = Object.freeze({
  ...SUPPORTED_SCHEDULER_CONFIG,
  schema_version: "deterministic-timeline-scheduler-config/v6",
  timing_scheduler_version: SUPPORTED_SCHEDULER_VERSION,
  shot_role_policy: "physical-hands-only-v1",
});
export const NARRATION_SHOT_SHORT_SCHEDULER_CONFIG = Object.freeze({
  ...WORD_BOUNDARY_SCHEDULER_CONFIG,
  schema_version: "deterministic-timeline-scheduler-config/v7",
  timing_scheduler_version: WORD_BOUNDARY_SCHEDULER_VERSION,
  shot_role_policy: "physical-hands-only-v1",
});

export const AI_VIDEO_OPENING_SECONDS = 180;
export const AI_VIDEO_OPENING_SCHEDULER_VERSION = "scheduler-v8";
export const AI_VIDEO_OPENING_SHORT_SCHEDULER_VERSION = "scheduler-v9";
export const CONFIGURABLE_AI_VIDEO_OPENING_SCHEDULER_VERSION = "scheduler-v10";
export const CONFIGURABLE_AI_VIDEO_OPENING_SHORT_SCHEDULER_VERSION = "scheduler-v11";

/** Preserve predecessor timing, then reserve the opening scenes for full-screen AI video. */
export const AI_VIDEO_OPENING_SCHEDULER_CONFIG = Object.freeze({
  ...NARRATION_SHOT_SCHEDULER_CONFIG,
  schema_version: "deterministic-timeline-scheduler-config/v8",
  opening_seconds: AI_VIDEO_OPENING_SECONDS,
  opening_scene_boundary_policy: "whole-scene-start-before-opening-end-v1",
  opening_image_minimum_ms: SUPPORTED_SCHEDULER_CONFIG.avatar_minimum_ms,
});
export const AI_VIDEO_OPENING_SHORT_SCHEDULER_CONFIG = Object.freeze({
  ...NARRATION_SHOT_SHORT_SCHEDULER_CONFIG,
  schema_version: "deterministic-timeline-scheduler-config/v9",
  opening_seconds: AI_VIDEO_OPENING_SECONDS,
  opening_scene_boundary_policy: "whole-scene-start-before-opening-end-v1",
  opening_image_minimum_ms: SUPPORTED_SCHEDULER_CONFIG.avatar_minimum_ms,
});

export function schedulerHasAiVideoOpening(version: string): boolean {
  return (
    version === AI_VIDEO_OPENING_SCHEDULER_VERSION ||
    version === AI_VIDEO_OPENING_SHORT_SCHEDULER_VERSION ||
    schedulerHasConfigurableAiVideoOpening(version)
  );
}

export function schedulerHasConfigurableAiVideoOpening(version: string): boolean {
  return (
    version === CONFIGURABLE_AI_VIDEO_OPENING_SCHEDULER_VERSION ||
    version === CONFIGURABLE_AI_VIDEO_OPENING_SHORT_SCHEDULER_VERSION
  );
}

/** UI tenths of a minute are pinned as exact whole seconds before scheduling. */
export function isValidAiVideoOpeningSeconds(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= 6 &&
    Number(value) <= 3_600 &&
    Number(value) % 6 === 0
  );
}

/** Historical versions never acquire configurable fields or a new default. */
export function schedulerAiVideoOpeningSeconds(
  version: string,
  openingSeconds?: number,
): number | null {
  if (schedulerHasConfigurableAiVideoOpening(version))
    return isValidAiVideoOpeningSeconds(openingSeconds) ? openingSeconds : null;
  if (openingSeconds !== undefined) return null;
  return schedulerHasAiVideoOpening(version) ? AI_VIDEO_OPENING_SECONDS : 0;
}

/** Preserve timing draws and segment identities when selecting the new role policy. */
export function schedulerTimingVersion(version: string): string {
  if (version === CONFIGURABLE_AI_VIDEO_OPENING_SCHEDULER_VERSION)
    return SUPPORTED_SCHEDULER_VERSION;
  if (version === CONFIGURABLE_AI_VIDEO_OPENING_SHORT_SCHEDULER_VERSION)
    return WORD_BOUNDARY_SCHEDULER_VERSION;
  if (version === AI_VIDEO_OPENING_SCHEDULER_VERSION) return SUPPORTED_SCHEDULER_VERSION;
  if (version === AI_VIDEO_OPENING_SHORT_SCHEDULER_VERSION) return WORD_BOUNDARY_SCHEDULER_VERSION;
  if (version === NARRATION_SHOT_SCHEDULER_VERSION) return SUPPORTED_SCHEDULER_VERSION;
  if (version === NARRATION_SHOT_SHORT_SCHEDULER_VERSION) return WORD_BOUNDARY_SCHEDULER_VERSION;
  return version;
}

export function schedulerConfigForVersion(version: string, openingSeconds?: number) {
  if (schedulerAiVideoOpeningSeconds(version, openingSeconds) === null) return null;
  if (schedulerHasConfigurableAiVideoOpening(version)) {
    const short = version === CONFIGURABLE_AI_VIDEO_OPENING_SHORT_SCHEDULER_VERSION;
    return Object.freeze({
      ...(short ? AI_VIDEO_OPENING_SHORT_SCHEDULER_CONFIG : AI_VIDEO_OPENING_SCHEDULER_CONFIG),
      schema_version: short
        ? "deterministic-timeline-scheduler-config/v11"
        : "deterministic-timeline-scheduler-config/v10",
      opening_seconds: openingSeconds!,
    });
  }
  if (version === AI_VIDEO_OPENING_SCHEDULER_VERSION) return AI_VIDEO_OPENING_SCHEDULER_CONFIG;
  if (version === AI_VIDEO_OPENING_SHORT_SCHEDULER_VERSION)
    return AI_VIDEO_OPENING_SHORT_SCHEDULER_CONFIG;
  if (version === NARRATION_SHOT_SCHEDULER_VERSION) return NARRATION_SHOT_SCHEDULER_CONFIG;
  if (version === NARRATION_SHOT_SHORT_SCHEDULER_VERSION)
    return NARRATION_SHOT_SHORT_SCHEDULER_CONFIG;
  if (version === WORD_BOUNDARY_SCHEDULER_VERSION) return WORD_BOUNDARY_SCHEDULER_CONFIG;
  if (version === SUPPORTED_SCHEDULER_VERSION) return SUPPORTED_SCHEDULER_CONFIG;
  if (version === SHORT_FORM_SCHEDULER_VERSION) return SHORT_FORM_SCHEDULER_CONFIG;
  if (version === SCRIPT_SHORT_FORM_SCHEDULER_VERSION) return SCRIPT_SHORT_FORM_SCHEDULER_CONFIG;
  return null;
}

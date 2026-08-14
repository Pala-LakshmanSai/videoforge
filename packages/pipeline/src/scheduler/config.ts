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

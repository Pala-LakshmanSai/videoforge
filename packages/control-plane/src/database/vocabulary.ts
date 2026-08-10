export const MIGRATION_TABLE_NAME = "videoforge_schema_migrations" as const;

export const RELATIONAL_TABLE_NAMES = [
  "users",
  "workspaces",
  "memberships",
  "assets",
  "execution_profiles",
  "avatar_profiles",
  "avatar_profile_versions",
  "avatar_profile_assets",
  "avatar_compatibility_assessments",
  "avatar_profile_test_attempts",
  "image_styles",
  "image_style_versions",
  "image_style_references",
  "image_style_analysis_attempts",
  "image_style_previews",
  "projects",
  "project_inputs",
  "project_revisions",
  "transcripts",
  "transcript_words",
  "timeline_segments",
  "generation_tasks",
  "attempts",
  "qa_results",
  "render_jobs",
  "cost_events",
  "callback_receipts",
  "workflow_instances",
  "workflow_events",
  "outbox",
] as const;

export type RelationalTableName = (typeof RELATIONAL_TABLE_NAMES)[number];

export const OWNER_TYPES = [
  "PROJECT_REVISION",
  "IMAGE_STYLE_VERSION",
  "AVATAR_PROFILE_VERSION",
] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

export const TASK_LANES = [
  "PREPARE",
  "TRANSCRIBE",
  "PLAN",
  "PROMPT",
  "IMAGE",
  "AVATAR",
  "RENDER",
  "QA",
] as const;
export type TaskLane = (typeof TASK_LANES)[number];

export const TASK_STATES = [
  "PENDING",
  "READY",
  "DISPATCHING",
  "RUNNING",
  "RETRY_WAIT",
  "BLOCKED",
  "FAILED",
  "CANCEL_REQUESTED",
  "CANCELLED",
  "COMPLETE",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const ATTEMPT_STATES = [
  "CREATED",
  "CLAIMED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "UNKNOWN",
] as const;
export type AttemptState = (typeof ATTEMPT_STATES)[number];

export const DISPATCH_STATES = [
  "NOT_SENT",
  "SENDING",
  "ACKNOWLEDGED",
  "AMBIGUOUS",
  "RECONCILED",
] as const;
export type DispatchState = (typeof DISPATCH_STATES)[number];

export const CLAIM_STATES = ["UNCLAIMED", "CLAIMED", "REJECTED", "EXPIRED"] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

export const OUTBOX_STATES = [
  "PENDING",
  "LEASED",
  "DELIVERED",
  "RETRY_WAIT",
  "DEAD_LETTER",
] as const;
export type OutboxState = (typeof OUTBOX_STATES)[number];

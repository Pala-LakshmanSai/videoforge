export const MIGRATION_TABLE_NAME = "videoforge_schema_migrations" as const;

export const RELATIONAL_TABLE_NAMES = [
  "users",
  "accounts",
  "app_admissions",
  "workspaces",
  "memberships",
  "assets",
  "artifact_reservations",
  "artifact_receipts",
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
  "image_style_profile_artifacts",
  "image_style_profile_edits",
  "image_style_previews",
  "projects",
  "project_inputs",
  "project_revisions",
  "generation_requests",
  "preset_preview_requests",
  "provider_workload_leases",
  "generation_queue_audits",
  "transcripts",
  "transcript_words",
  "transcript_sentences",
  "transcript_phrases",
  "timeline_plans",
  "timeline_segments",
  "selected_span_audio",
  "timing_invalidations",
  "revision_timing_heads",
  "generation_tasks",
  "attempts",
  "qa_results",
  "render_jobs",
  "cost_events",
  "callback_receipts",
  "repository_mutation_receipts",
  "workflow_instances",
  "workflow_events",
  "outbox",
  "prompt_executions",
  "prompt_writer_attempts",
  "prompt_scene_results",
  "image_generation_acceptances",
  "avatar_generation_acceptances",
  "avatar_renderer_bindings",
  "model_volumes",
  "model_volume_manifests",
  "gpu_inventory_receipts",
  "generation_sessions",
  "session_gpu_bindings",
  "session_gpu_revalidations",
  "global_queue_entries",
  "compute_run_plans",
  "pod_lifecycle_attempts",
  "pod_dispatch_authorizations",
  "lane_demands",
  "durable_generation_outputs",
  "global_session_cost_events",
  "global_session_events",
  "auth_identity_bindings",
  "invite_codes",
  "invite_redemptions",
  "global_queue_audits",
  "global_generation_capacity",
  "account_queue_heads",
  "serverless_endpoint_deployments",
  "serverless_attempts",
  "serverless_predispatch_authorities",
  "serverless_dispatch_outbox",
  "serverless_provider_assignments",
  "serverless_progress_events",
  "serverless_provenance_receipts",
  "serverless_output_receipts",
  "serverless_cancellations",
  "serverless_reconciliations",
  "serverless_cost_ledgers",
  "serverless_cost_events",
] as const;

export type RelationalTableName = (typeof RELATIONAL_TABLE_NAMES)[number];

/**
 * Tenant read views filter on the trusted principal recorded in `videoforge.account_id`. Preset
 * views additionally expose the immutable `scope_kind = 'SYSTEM'` built-ins.
 */
export const TENANT_VIEW_NAMES = [
  "videoforge_tenant_assets",
  "videoforge_tenant_account_queue_heads",
  "videoforge_tenant_artifact_receipts",
  "videoforge_tenant_artifact_reservations",
  "videoforge_tenant_attempts",
  "videoforge_tenant_avatar_profile_versions",
  "videoforge_tenant_avatar_profiles",
  "videoforge_tenant_cost_events",
  "videoforge_tenant_durable_generation_outputs",
  "videoforge_tenant_generation_tasks",
  "videoforge_tenant_generation_requests",
  "videoforge_tenant_preset_preview_requests",
  "videoforge_tenant_provider_workload_leases",
  "videoforge_tenant_generation_queue_audits",
  "videoforge_tenant_global_queue_audits",
  "videoforge_tenant_global_queue_entries",
  "videoforge_tenant_global_session_cost_events",
  "videoforge_tenant_global_session_events",
  "videoforge_tenant_image_style_versions",
  "videoforge_tenant_image_styles",
  "videoforge_tenant_project_inputs",
  "videoforge_tenant_project_revisions",
  "videoforge_tenant_projects",
  "videoforge_tenant_qa_results",
  "videoforge_tenant_render_jobs",
  "videoforge_tenant_serverless_attempts",
  "videoforge_tenant_serverless_cancellations",
  "videoforge_tenant_serverless_cost_events",
  "videoforge_tenant_serverless_cost_ledgers",
  "videoforge_tenant_serverless_dispatch_outbox",
  "videoforge_tenant_serverless_output_receipts",
  "videoforge_tenant_serverless_predispatch_authorities",
  "videoforge_tenant_serverless_progress_events",
  "videoforge_tenant_serverless_provenance_receipts",
  "videoforge_tenant_serverless_provider_assignments",
  "videoforge_tenant_serverless_reconciliations",
  "videoforge_tenant_workflow_events",
  "videoforge_tenant_workflow_instances",
] as const;

export type TenantViewName = (typeof TENANT_VIEW_NAMES)[number];

/** The reserved scopes migration 0018 seeds into every database. */
export const RESERVED_SYSTEM_ACCOUNT_ID = "ffffffff-ffff-4fff-8fff-000000000001" as const;
export const RESERVED_LEGACY_ACCOUNT_ID = "ffffffff-ffff-4fff-8fff-000000000002" as const;
export const RESERVED_SYSTEM_WORKSPACE_ID = "ffffffff-ffff-4fff-8fff-000000000011" as const;
/** Author of the built-in catalog. It owns no account, so no login can resolve to it. */
export const RESERVED_SYSTEM_USER_ID = "ffffffff-ffff-4fff-8fff-000000000021" as const;
export const RESERVED_LEGACY_WORKSPACE_ID = "ffffffff-ffff-4fff-8fff-000000000012" as const;

/** The session setting every application transaction binds to its trusted principal. */
export const TENANT_PRINCIPAL_SETTING = "videoforge.account_id" as const;

export const GLOBAL_SESSION_LANES = ["mage_image", "echo_avatar"] as const;
export type GlobalSessionLane = (typeof GLOBAL_SESSION_LANES)[number];

export const GLOBAL_SESSION_STATES = ["LOCKING", "ACTIVE", "DRAINING", "CLOSED"] as const;
export type GlobalSessionState = (typeof GLOBAL_SESSION_STATES)[number];

export const GLOBAL_QUEUE_ENTRY_STATES = ["ACTIVE", "WAITING", "TERMINAL", "REMOVED"] as const;
export type GlobalQueueEntryState = (typeof GLOBAL_QUEUE_ENTRY_STATES)[number];

export const LANE_DEMAND_STATES = ["ACTIVE", "WAITING_WARM", "ZERO"] as const;
export type LaneDemandState = (typeof LANE_DEMAND_STATES)[number];

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

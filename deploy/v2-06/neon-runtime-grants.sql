-- Run only after the exact V2-06 activation proposal is approved.
-- The Neon login role is created/credentialed outside this file and passed as psql variable:
--   psql --variable=runtime_role=... --file=deploy/v2-06/neon-runtime-grants.sql

\if :{?runtime_role}
\else
\quit
\endif

-- Disposable restore databases may inherit an empty search_path from the Neon template. Pin the
-- exact application schema before resolving any otherwise-unqualified relation names below.
SET search_path = public, pg_catalog;

GRANT USAGE ON SCHEMA public TO :"runtime_role";

-- The application role must be created beforehand as a NOSUPERUSER/NOCREATEDB/NOCREATEROLE/
-- NOINHERIT/NOREPLICATION/NOBYPASSRLS role.  Neon hosted owners cannot ALTER ROLE attributes;
-- apply-migrations-and-grants.mjs verifies those flags before this object-grant phase.
REVOKE CREATE ON SCHEMA public FROM :"runtime_role";
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"runtime_role";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM :"runtime_role";
-- PostgreSQL grants EXECUTE on newly-created functions to PUBLIC by default.  Remove that
-- ambient capability before granting the small, explicit hosted-runtime routine surface below.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM :"runtime_role";

GRANT SELECT, INSERT, UPDATE, DELETE ON
  hosted_auth_users,
  hosted_auth_accounts,
  hosted_auth_sessions,
  hosted_auth_verifications
TO :"runtime_role";

GRANT EXECUTE ON FUNCTION public.videoforge_hosted_session_scope(text)
TO :"runtime_role";
-- Migration 0047 is the sole hosted invite-redemption capability.  The browser submits only
-- the authenticated session token and exact verifier hash; the SECURITY DEFINER function keeps
-- invite consumption and admission atomic while the runtime receives no direct invite-table DML.
GRANT EXECUTE ON FUNCTION public.videoforge_redeem_hosted_invite(text, text)
TO :"runtime_role";
-- Migration 0048 is the sole hosted-runtime path to immutable SYSTEM avatar source metadata.
-- The exact version UUID is the only input; arbitrary SYSTEM asset lookup and table access remain
-- unavailable to the runtime through this read-only SECURITY DEFINER routine.
GRANT EXECUTE ON FUNCTION public.videoforge_read_system_avatar_version_assets(uuid)
TO :"runtime_role";
-- Migration 0048 also exposes one database-atomic authenticated throttle. The operation policy,
-- window, and identity key are resolved inside the SECURITY DEFINER routine; callers cannot set
-- limits or bypass the session-token lookup.
GRANT EXECUTE ON FUNCTION public.videoforge_consume_hosted_rate_limit(text, text)
TO :"runtime_role";
-- RLS policies call this stable tenant-principal helper while evaluating every tenant row.
GRANT EXECUTE ON FUNCTION public.videoforge_current_account_id()
TO :"runtime_role";
-- Migration 0051 is the only hosted-runtime path for tenant-owned preset removal. It archives the
-- parent row, keeps immutable versions/media for historical revisions, and refuses SYSTEM built-ins;
-- the runtime receives no direct preset DELETE capability.
GRANT EXECUTE ON FUNCTION public.videoforge_archive_hosted_preset(uuid, uuid, text, uuid)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_reserve_hosted_style_analysis(uuid, text, uuid)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_finish_hosted_style_analysis(uuid, text, text, text, bigint, bigint, bigint)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_authorize_hosted_cpu_upload(
  uuid, text, text, text, text, bigint, text, timestamptz
)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_hosted_cpu_expected_primary_output(uuid, text)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_media_worker_device_scope(text)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_media_worker_enrollment_poll(uuid, text, timestamptz)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_media_worker_enrollment_consume(uuid, text)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_due_hosted_cpu_retention(integer)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_finish_hosted_cpu_retention(uuid, text)
TO :"runtime_role";
-- Migration 0038 exposes the only hosted-runtime render-plan write capability.  Keep the table
-- itself read-only and grant this exact tenant-scoped, idempotent append contract instead.
GRANT EXECUTE ON FUNCTION public.videoforge_append_hosted_render_plan(
  uuid, uuid, uuid, uuid, text, jsonb, text
)
TO :"runtime_role";
-- Migration 0039 exposes one atomic, provider-inert hosted ASR-to-canonical-timing append. The
-- runtime receives no direct timing/task table writes and cannot create dispatch state.
GRANT EXECUTE ON FUNCTION public.videoforge_append_hosted_canonical_timing(
  uuid, uuid, uuid, uuid, uuid, uuid, jsonb
)
TO :"runtime_role";
-- Migration 0056 first extracts one cost-capped story context, then writes one cost-capped prompt
-- batch. Runtime gets only the exact lifecycle functions, no direct DML, and cannot blind-retry an
-- ambiguous provider result.
GRANT EXECUTE ON FUNCTION public.videoforge_prepare_hosted_voiceover_context(jsonb)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_complete_hosted_voiceover_context(jsonb)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_fail_hosted_voiceover_context(uuid,text,text,boolean)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_load_hosted_prompt_plan(uuid,uuid,uuid,uuid)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_prepare_hosted_prompt_run(jsonb)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_complete_hosted_prompt_run(jsonb)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_fail_hosted_prompt_run(uuid,text,text,boolean)
TO :"runtime_role";
-- Migration 0040's direct claim stays owner-only. Runtime access would allow an approval to be
-- consumed outside the atomic 0042 pair and is therefore intentionally absent.
-- Migration 0041 atomically appends the exact provider-inert two-lane batches. Qualification,
-- paid claiming, predispatch, and transport remain separate fail-closed gates.
GRANT EXECUTE ON FUNCTION public.videoforge_materialize_hosted_lane_batches(
  uuid, uuid, uuid, uuid, uuid, text, jsonb
)
TO :"runtime_role";
-- Migration 0042 is the sole paid sendable-state capability. It rechecks durable independent
-- qualification, consumes the 0040 approval, and commits both lanes in one DB-time transaction.
GRANT EXECUTE ON FUNCTION public.videoforge_commit_hosted_atomic_pair_predispatch(
  uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,numeric,timestamptz,jsonb,jsonb
)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_recover_hosted_atomic_pair_tokens(uuid,uuid,uuid)
TO :"runtime_role";
-- Migration 0043 is the only runtime transition surface for the paid pair. Runtime keeps no direct
-- attempt/outbox/assignment/pair-state table DML.
GRANT EXECUTE ON FUNCTION public.videoforge_prepare_hosted_pair_send(uuid,uuid,uuid)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_begin_hosted_pair_send(uuid,uuid,uuid,text,uuid,text)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_finish_hosted_pair_send(uuid,uuid,uuid,text,text,text,uuid,text)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_load_hosted_pair_activation(uuid,uuid,uuid)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_load_hosted_pair_activation_v2(uuid,uuid,uuid)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_load_hosted_gpu_activation_v1()
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_claim_v213_workflow_start(jsonb)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_complete_v213_workflow_start(jsonb)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_load_v213_workflow_start(jsonb)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_claim_v213_operator_acceptance(jsonb)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_complete_v213_operator_acceptance(jsonb)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_claim_v213_live_acceptance(jsonb)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_complete_v213_live_acceptance(jsonb)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_fail_v213_live_acceptance(jsonb)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_record_v213_signed_evidence(jsonb)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_load_v213_signed_evidence(jsonb)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_v213_short_pilot_repository(jsonb)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_v213_production_length_repository(jsonb)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_load_hosted_pair_workflow_schedule(uuid,uuid,uuid)
TO :"runtime_role";
-- Final settlement is intentionally absent. A separately privileged reconciler must own that
-- capability; runtime cannot self-attest provider absence or release its own slot.

GRANT SELECT, INSERT, UPDATE ON
  hosted_cpu_job_attempts,
  hosted_cpu_upload_authorities,
  hosted_project_create_requests,
  media_worker_enrollments,
  media_worker_devices,
  media_worker_leases,
  projects,
  project_revisions,
  assets,
  artifact_reservations
TO :"runtime_role";

-- Hosted preset creation writes only the tenant-owned preset parents/versions and their immutable
-- asset links.  Keep DELETE unavailable: removal uses the archive SECURITY DEFINER function above.
GRANT SELECT, INSERT, UPDATE ON
  avatar_profiles,
  avatar_profile_versions,
  image_styles,
  image_style_versions
TO :"runtime_role";
GRANT SELECT, INSERT ON
  avatar_profile_assets,
  image_style_references
TO :"runtime_role";

GRANT SELECT ON workspaces TO :"runtime_role";

-- Render plans are immutable provenance.  The hosted runtime may read the exact tenant/revision
-- plan but never receives direct INSERT, UPDATE, or DELETE; the append function above is its only
-- narrowly scoped write capability.
GRANT SELECT ON
  hosted_render_plans,
  timeline_plans,
  generation_tasks,
  generation_requests,
  video_runtime_states,
  video_runtime_lane_states,
  serverless_attempts,
  serverless_progress_events,
  serverless_cost_ledgers,
  serverless_output_receipts,
  hosted_pair_zero_worker_observations,
  hosted_voiceover_contexts,
  hosted_prompt_runs,
  prompt_executions,
  prompt_scene_results,
  timeline_segments,
  cost_events
TO :"runtime_role";

GRANT SELECT, INSERT ON
  media_worker_input_objects,
  hosted_cpu_job_events,
  media_worker_events,
  artifact_receipts
TO :"runtime_role";

GRANT SELECT, INSERT ON hosted_project_reviews
TO :"runtime_role";

GRANT DELETE ON
  hosted_auth_sessions,
  hosted_auth_verifications
TO :"runtime_role";

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
-- RLS policies call this stable tenant-principal helper while evaluating every tenant row.
GRANT EXECUTE ON FUNCTION public.videoforge_current_account_id()
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
  uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,numeric,timestamptz,jsonb
)
TO :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_recover_hosted_atomic_pair_tokens(uuid,uuid,uuid)
TO :"runtime_role";

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

GRANT SELECT ON
  avatar_profiles,
  avatar_profile_versions,
  image_styles,
  image_style_versions
TO :"runtime_role";

GRANT SELECT ON workspaces TO :"runtime_role";

-- Render plans are immutable provenance.  The hosted runtime may read the exact tenant/revision
-- plan but never receives direct INSERT, UPDATE, or DELETE; the append function above is its only
-- narrowly scoped write capability.
GRANT SELECT ON hosted_render_plans TO :"runtime_role";

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

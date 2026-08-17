-- Run only after the exact V2-06 activation proposal is approved.
-- The Neon login role is created/credentialed outside this file and passed as psql variable:
--   psql --variable=runtime_role=... --file=deploy/v2-06/neon-runtime-grants.sql

\if :{?runtime_role}
\else
\quit
\endif

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

-- Render plans are activation-owned immutable provenance.  The hosted runtime may read the exact
-- tenant/revision plan but never inserts, updates, or deletes one.
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

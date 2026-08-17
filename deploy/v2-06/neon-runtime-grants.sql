-- Run only after the exact V2-06 activation proposal is approved.
-- The Neon login role is created/credentialed outside this file and passed as psql variable:
--   psql --variable=runtime_role=... --file=deploy/v2-06/neon-runtime-grants.sql

\if :{?runtime_role}
\else
\quit
\endif

GRANT USAGE ON SCHEMA public TO :"runtime_role";

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
  media_worker_enrollments,
  media_worker_devices,
  media_worker_input_objects,
  media_worker_leases,
  projects,
  project_inputs,
  project_revisions,
  assets,
  artifact_reservations,
  artifact_receipts,
  avatar_profiles,
  avatar_profile_versions,
  avatar_profile_assets,
  avatar_compatibility_assessments,
  image_styles,
  image_style_versions,
  image_style_references,
  generation_requests,
  preset_preview_requests,
  provider_workload_leases,
  generation_queue_audits,
  account_queue_heads,
  global_generation_capacity,
  video_runtime_states,
  video_runtime_lane_states,
  video_runtime_accepted_units,
  video_runtime_events,
  transcripts,
  transcript_words,
  transcript_sentences,
  transcript_phrases,
  timeline_plans,
  timeline_segments,
  selected_span_audio,
  timing_invalidations,
  revision_timing_heads,
  render_jobs,
  qa_results,
  workflow_instances,
  workflow_events,
  outbox,
  cost_events
TO :"runtime_role";

GRANT SELECT, INSERT ON
  hosted_cpu_job_events,
  media_worker_events
TO :"runtime_role";

GRANT DELETE ON
  hosted_auth_sessions,
  hosted_auth_verifications
TO :"runtime_role";

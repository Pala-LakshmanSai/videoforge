-- Deferred timing validators execute when the surrounding transaction commits. At that point a
-- SECURITY DEFINER append function has already returned, so PostgreSQL restores the unprivileged
-- hosted runtime role before firing these constraint triggers. Keep the validators tenant-neutral,
-- read-only, and owner-executed without granting the runtime direct SELECT on immutable timing rows.

ALTER FUNCTION public.videoforge_enforce_transcript_completeness() SECURITY DEFINER;
ALTER FUNCTION public.videoforge_enforce_transcript_completeness()
  SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.videoforge_enforce_transcript_completeness() FROM PUBLIC;

ALTER FUNCTION public.videoforge_validate_timeline_plan() SECURITY DEFINER;
ALTER FUNCTION public.videoforge_validate_timeline_plan()
  SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.videoforge_validate_timeline_plan() FROM PUBLIC;

-- Give real usage room in the hosted mutation bucket.
--
-- `videoforge_consume_hosted_rate_limit` capped `hosted_mutation` at 30 requests per 600 s per
-- session. That bucket covers every non-read hosted action -- delete, cancel, retry, reconcile,
-- dispatch and the pipeline's own stage handoffs -- so a page that polls, retries a stage and then
-- presses Delete exhausts it and the user sees `HOSTED_RATE_LIMITED` on an action that has nothing
-- to do with load: a project delete was rejected for a rate limit it did not cause.
--
-- 240 per 10 minutes keeps the bucket meaningful for abuse protection while no longer being
-- reachable by normal product use by a single operator. The read bucket (120/min) is untouched:
-- reads stay cheap and frequent.
--
-- This replaces the function with only that one constant changed. The declaration and the conflict
-- target are load-bearing and must stay exactly as 0048 wrote them:
--   * `SECURITY DEFINER` with `search_path = pg_catalog, public` -- the runtime role has no grants
--     on `hosted_auth_rate_limits` (REVOKE ALL ... FROM PUBLIC), so a plain invoker function fails
--     with `permission denied for table hosted_auth_rate_limits` (42501) and every hosted request
--     dies inside `sessionScope`.
--   * `ON CONFLICT (hosted_auth_user_id, operation)` -- that primary key is the table's only unique
--     index. Naming the per-window column in the conflict target matches no unique or exclusion
--     constraint, so Postgres rejects the statement with 42P10 on every call.
-- The window rollover is handled by updating `window_started_at` and resetting `request_count` in
-- the DO UPDATE branch, so the arbiter stays the (user, operation) key.
CREATE OR REPLACE FUNCTION public.videoforge_consume_hosted_rate_limit(
  supplied_session_token text,
  supplied_operation text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  authenticated_user_id text;
  now_at timestamptz := clock_timestamp();
  window_seconds integer;
  maximum_requests integer;
  window_start timestamptz;
  allowed boolean := false;
BEGIN
  IF supplied_session_token IS NULL OR supplied_operation IS NULL THEN
    RETURN false;
  END IF;

  CASE supplied_operation
    WHEN 'invite_redeem' THEN
      window_seconds := 600;
      maximum_requests := 5;
    WHEN 'hosted_read' THEN
      window_seconds := 60;
      maximum_requests := 120;
    WHEN 'project_create' THEN
      window_seconds := 3600;
      maximum_requests := 10;
    WHEN 'project_commit' THEN
      window_seconds := 900;
      maximum_requests := 5;
    WHEN 'project_review' THEN
      window_seconds := 600;
      maximum_requests := 30;
    WHEN 'hosted_mutation' THEN
      window_seconds := 600;
      maximum_requests := 240;
    ELSE
      RETURN false;
  END CASE;

  SELECT session.user_id
    INTO authenticated_user_id
    FROM public.hosted_auth_sessions AS session
   WHERE session.token = supplied_session_token
     AND session.expires_at > now_at;
  IF authenticated_user_id IS NULL THEN
    RETURN false;
  END IF;

  window_start := to_timestamp(
    floor(extract(epoch FROM now_at) / window_seconds::numeric) * window_seconds::numeric
  );

  INSERT INTO public.hosted_auth_rate_limits (
    hosted_auth_user_id, operation, window_started_at, request_count, updated_at
  ) VALUES (
    authenticated_user_id, supplied_operation, window_start, 1, now_at
  )
  ON CONFLICT (hosted_auth_user_id, operation) DO UPDATE
     SET window_started_at = EXCLUDED.window_started_at,
         request_count = CASE
           WHEN hosted_auth_rate_limits.window_started_at = EXCLUDED.window_started_at
             THEN hosted_auth_rate_limits.request_count + 1
           ELSE 1
         END,
         updated_at = EXCLUDED.updated_at
  RETURNING request_count <= maximum_requests INTO allowed;

  RETURN COALESCE(allowed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_consume_hosted_rate_limit(text, text) FROM PUBLIC;

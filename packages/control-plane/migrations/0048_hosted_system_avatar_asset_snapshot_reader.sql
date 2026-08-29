-- V2-13 hosted runtime read boundary for immutable SYSTEM avatar materialization.
-- The caller supplies exactly one avatar_profile_versions.id.  A non-SYSTEM, non-active,
-- non-READY version, or a version whose retained ORIGINAL/RUNTIME links no longer match the
-- version's immutable asset references, returns no rows.  The routine never accepts an asset id
-- and never exposes arbitrary asset lookup or table privileges.

CREATE FUNCTION public.videoforge_read_system_avatar_version_assets(
  supplied_avatar_profile_version_id uuid
) RETURNS TABLE (
  avatar_profile_id uuid,
  avatar_profile_version_id uuid,
  avatar_profile_version_number integer,
  original_asset_id uuid,
  original_object_key text,
  original_binary_sha256 text,
  original_content_type text,
  original_byte_size bigint,
  original_width_px integer,
  original_height_px integer,
  original_duration_ms bigint,
  original_metadata jsonb,
  runtime_source_asset_id uuid,
  runtime_object_key text,
  runtime_binary_sha256 text,
  runtime_content_type text,
  runtime_byte_size bigint,
  runtime_width_px integer,
  runtime_height_px integer,
  runtime_duration_ms bigint,
  runtime_metadata jsonb
)
LANGUAGE sql STABLE STRICT SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    profile.id,
    version.id,
    version.version_number,
    original.id,
    original.object_key,
    original.binary_sha256,
    original.content_type,
    original.byte_size,
    original.width_px,
    original.height_px,
    original.duration_ms,
    original.metadata,
    runtime.id,
    runtime.object_key,
    runtime.binary_sha256,
    runtime.content_type,
    runtime.byte_size,
    runtime.width_px,
    runtime.height_px,
    runtime.duration_ms,
    runtime.metadata
  FROM public.avatar_profile_versions AS version
  JOIN public.avatar_profiles AS profile
    ON profile.account_id = version.account_id
   AND profile.workspace_id = version.workspace_id
   AND profile.id = version.profile_id
   AND profile.scope_kind = version.scope_kind
  JOIN public.assets AS original
    ON original.account_id = version.account_id
   AND original.workspace_id = version.workspace_id
   AND original.id = version.original_asset_id
  JOIN public.assets AS runtime
    ON runtime.account_id = version.account_id
   AND runtime.workspace_id = version.workspace_id
   AND runtime.id = version.runtime_source_asset_id
  JOIN public.avatar_profile_assets AS original_link
    ON original_link.account_id = version.account_id
   AND original_link.workspace_id = version.workspace_id
   AND original_link.profile_id = version.profile_id
   AND original_link.version_id = version.id
   AND original_link.asset_id = original.id
   AND original_link.role = 'ORIGINAL'
   AND original_link.retention_state = 'RETAIN'
   AND original_link.binary_sha256 = original.binary_sha256
  JOIN public.avatar_profile_assets AS runtime_link
    ON runtime_link.account_id = version.account_id
   AND runtime_link.workspace_id = version.workspace_id
   AND runtime_link.profile_id = version.profile_id
   AND runtime_link.version_id = version.id
   AND runtime_link.asset_id = runtime.id
   AND runtime_link.role = 'RUNTIME'
   AND runtime_link.retention_state = 'RETAIN'
   AND runtime_link.binary_sha256 = runtime.binary_sha256
  WHERE version.id = supplied_avatar_profile_version_id
    AND version.account_id = 'ffffffff-ffff-4fff-8fff-000000000001'::uuid
    AND version.workspace_id = 'ffffffff-ffff-4fff-8fff-000000000011'::uuid
    AND version.scope_kind = 'SYSTEM'
    AND version.state = 'READY'
    AND profile.account_id = 'ffffffff-ffff-4fff-8fff-000000000001'::uuid
    AND profile.workspace_id = 'ffffffff-ffff-4fff-8fff-000000000011'::uuid
    AND profile.scope_kind = 'SYSTEM'
    AND profile.status = 'ACTIVE'
    AND profile.active_version_id = version.id
    AND original.kind = 'AVATAR_ORIGINAL'
    AND original.state IN ('VERIFIED', 'ACCEPTED')
    AND runtime.kind = 'AVATAR_RUNTIME'
    AND runtime.state IN ('VERIFIED', 'ACCEPTED')
    AND version.runtime_source_binary_sha256 = runtime.binary_sha256;
$$;

COMMENT ON FUNCTION public.videoforge_read_system_avatar_version_assets(uuid) IS
  'Read-only exact SYSTEM ACTIVE READY avatar version ORIGINAL/RUNTIME asset metadata for hosted materialization; zero rows for any non-system, inactive, non-ready, unretained, or mismatched snapshot.';

REVOKE ALL ON FUNCTION public.videoforge_read_system_avatar_version_assets(uuid) FROM PUBLIC;

-- A single durable counter per Better Auth identity and closed-world operation provides the
-- authenticated admission boundary with database-atomic throttling.  Pre-admission sessions are
-- deliberately accepted here: they may redeem an invite, but they cannot reach tenant-scoped
-- product routes until videoforge_hosted_session_scope resolves a durable admission link.
CREATE TABLE public.hosted_auth_rate_limits (
  hosted_auth_user_id text NOT NULL REFERENCES public.hosted_auth_users (id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN (
    'invite_redeem', 'hosted_read', 'project_create', 'project_commit', 'project_review',
    'hosted_mutation'
  )),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count >= 1),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (hosted_auth_user_id, operation)
);

REVOKE ALL ON TABLE public.hosted_auth_rate_limits FROM PUBLIC;

CREATE FUNCTION public.videoforge_consume_hosted_rate_limit(
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
      maximum_requests := 30;
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

COMMENT ON FUNCTION public.videoforge_consume_hosted_rate_limit(text, text) IS
  'Atomically consume one fixed-window rate-limit token for an unexpired Better Auth session; only the closed-world operation policies in the function are accepted, and the counter is keyed by the resolved auth user.';

REVOKE ALL ON FUNCTION public.videoforge_consume_hosted_rate_limit(text, text) FROM PUBLIC;

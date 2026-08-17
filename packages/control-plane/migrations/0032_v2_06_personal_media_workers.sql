-- V2-06 personal media workers. Hosted orchestration remains durable while ASR/render
-- execution moves from Cloud Run to an account-owned Windows or macOS device.

ALTER TABLE hosted_cpu_job_attempts
  ADD COLUMN execution_backend text NOT NULL DEFAULT 'CLOUD_RUN'
    CHECK (execution_backend IN ('CLOUD_RUN', 'PERSONAL_WORKER')),
  ADD COLUMN execution_bundle_sha256 text
    CHECK (execution_bundle_sha256 IS NULL OR execution_bundle_sha256 ~ '^sha256:[0-9a-f]{64}$');

CREATE TABLE media_worker_enrollments (
  id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (display_name = btrim(display_name) AND length(display_name) BETWEEN 1 AND 120),
  platform text NOT NULL CHECK (platform IN ('WINDOWS', 'MACOS')),
  architecture text NOT NULL CHECK (architecture IN ('X86_64', 'AARCH64')),
  worker_version text NOT NULL CHECK (worker_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$'),
  protocol_version integer NOT NULL CHECK (protocol_version > 0),
  execution_bundle_sha256 text NOT NULL CHECK (execution_bundle_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  installation_id uuid NOT NULL,
  pkce_challenge text NOT NULL CHECK (pkce_challenge ~ '^[A-Za-z0-9_-]{43,128}$'),
  poll_token_sha256 text NOT NULL UNIQUE CHECK (poll_token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  credential_token_sha256 text CHECK (
    credential_token_sha256 IS NULL OR credential_token_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  state text NOT NULL CHECK (state IN ('PENDING', 'APPROVED', 'CONSUMED', 'EXPIRED')),
  account_id uuid,
  workspace_id uuid,
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, workspace_id, id),
  FOREIGN KEY (account_id, workspace_id) REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at),
  CHECK (state <> 'PENDING' OR (account_id IS NULL AND workspace_id IS NULL AND approved_at IS NULL AND credential_token_sha256 IS NULL)),
  CHECK ((account_id IS NULL) = (workspace_id IS NULL)),
  CHECK (state NOT IN ('APPROVED', 'CONSUMED') OR (account_id IS NOT NULL AND approved_at IS NOT NULL AND credential_token_sha256 IS NOT NULL)),
  CHECK ((state = 'CONSUMED') = (consumed_at IS NOT NULL))
);

CREATE INDEX media_worker_enrollments_expiry_idx
  ON media_worker_enrollments (state, expires_at)
  WHERE state IN ('PENDING', 'APPROVED');
CREATE INDEX media_worker_enrollments_installation_idx
  ON media_worker_enrollments (installation_id, created_at DESC);

ALTER TABLE media_worker_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_worker_enrollments FORCE ROW LEVEL SECURITY;
CREATE POLICY media_worker_enrollments_tenant_rls ON media_worker_enrollments
  USING (
    account_id IS NULL OR account_id = public.videoforge_current_account_id()
  ) WITH CHECK (
    account_id IS NULL OR account_id = public.videoforge_current_account_id()
  );
CREATE TRIGGER media_worker_enrollments_tenant_write_guard
  BEFORE INSERT OR UPDATE ON media_worker_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();

CREATE TABLE media_worker_devices (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  enrollment_id uuid NOT NULL UNIQUE,
  display_name text NOT NULL CHECK (display_name = btrim(display_name) AND length(display_name) BETWEEN 1 AND 120),
  platform text NOT NULL CHECK (platform IN ('WINDOWS', 'MACOS')),
  architecture text NOT NULL CHECK (architecture IN ('X86_64', 'AARCH64')),
  worker_version text NOT NULL CHECK (worker_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$'),
  protocol_version integer NOT NULL CHECK (protocol_version > 0),
  execution_bundle_sha256 text NOT NULL CHECK (execution_bundle_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  installation_id uuid NOT NULL UNIQUE,
  credential_token_sha256 text NOT NULL UNIQUE CHECK (credential_token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('OFFLINE', 'ONLINE', 'BUSY', 'UPDATE_REQUIRED', 'REVOKED')),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, workspace_id, id),
  FOREIGN KEY (account_id, workspace_id) REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, enrollment_id)
    REFERENCES media_worker_enrollments (account_id, workspace_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);

CREATE INDEX media_worker_devices_ready_idx
  ON media_worker_devices (account_id, workspace_id, status, last_seen_at)
  WHERE status IN ('ONLINE', 'BUSY');

CREATE TRIGGER media_worker_devices_tenant_account_derived
  BEFORE INSERT OR UPDATE ON media_worker_devices
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_workspace_account();
CREATE TRIGGER media_worker_devices_tenant_write_guard
  BEFORE INSERT OR UPDATE ON media_worker_devices
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE media_worker_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_worker_devices FORCE ROW LEVEL SECURITY;
CREATE POLICY media_worker_devices_tenant_rls ON media_worker_devices
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());

CREATE TABLE media_worker_input_objects (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  uri text NOT NULL CHECK (
    uri ~ '^vf-local://objects/sha256/[0-9a-f]{2}/[0-9a-f]{64}\.[a-z0-9]{1,10}$'
  ),
  object_key text NOT NULL CHECK (
    object_key ~ '^tenant/[A-Za-z0-9._:-]+/workspace/[A-Za-z0-9._:-]+/project/[A-Za-z0-9._:-]+/revision/[A-Za-z0-9._:-]+/lane/(input|render)/job/[A-Za-z0-9._:-]+/artifact/[A-Za-z0-9._:-]+$'
  ),
  content_type text NOT NULL CHECK (
    content_type ~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
  ),
  content_length bigint NOT NULL CHECK (content_length BETWEEN 1 AND 10737418240),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, workspace_id, attempt_id, uri),
  UNIQUE (account_id, workspace_id, attempt_id, object_key),
  FOREIGN KEY (account_id, workspace_id, attempt_id)
    REFERENCES hosted_cpu_job_attempts (account_id, workspace_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER media_worker_input_objects_tenant_account_derived
  BEFORE INSERT OR UPDATE ON media_worker_input_objects
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_workspace_account();
CREATE TRIGGER media_worker_input_objects_tenant_write_guard
  BEFORE INSERT OR UPDATE ON media_worker_input_objects
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE media_worker_input_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_worker_input_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY media_worker_input_objects_tenant_rls ON media_worker_input_objects
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());

CREATE TABLE media_worker_leases (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  device_id uuid NOT NULL,
  lease_token_sha256 text NOT NULL UNIQUE CHECK (lease_token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('CLAIMED', 'RUNNING', 'COMPLETING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED')),
  lease_expires_at timestamptz NOT NULL,
  last_heartbeat_at timestamptz NOT NULL,
  claimed_at timestamptz NOT NULL,
  completed_at timestamptz,
  failure_code text CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, workspace_id, id),
  FOREIGN KEY (account_id, workspace_id, attempt_id)
    REFERENCES hosted_cpu_job_attempts (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, device_id)
    REFERENCES media_worker_devices (account_id, workspace_id, id) ON DELETE RESTRICT,
  CHECK (lease_expires_at > claimed_at),
  CHECK ((state IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED')) = (completed_at IS NOT NULL)),
  CHECK ((state = 'FAILED') = (failure_code IS NOT NULL))
);

CREATE UNIQUE INDEX media_worker_leases_active_attempt_uq
  ON media_worker_leases (account_id, workspace_id, attempt_id)
  WHERE state IN ('CLAIMED', 'RUNNING', 'COMPLETING');
CREATE UNIQUE INDEX media_worker_leases_active_device_uq
  ON media_worker_leases (account_id, workspace_id, device_id)
  WHERE state IN ('CLAIMED', 'RUNNING', 'COMPLETING');
CREATE INDEX media_worker_leases_expiry_idx
  ON media_worker_leases (state, lease_expires_at)
  WHERE state IN ('CLAIMED', 'RUNNING', 'COMPLETING');

CREATE TRIGGER media_worker_leases_tenant_account_derived
  BEFORE INSERT OR UPDATE ON media_worker_leases
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_workspace_account();
CREATE TRIGGER media_worker_leases_tenant_write_guard
  BEFORE INSERT OR UPDATE ON media_worker_leases
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE media_worker_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_worker_leases FORCE ROW LEVEL SECURITY;
CREATE POLICY media_worker_leases_tenant_rls ON media_worker_leases
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());

CREATE TABLE media_worker_events (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  device_id uuid NOT NULL,
  lease_id uuid,
  sequence integer NOT NULL CHECK (sequence > 0),
  kind text NOT NULL CHECK (kind IN (
    'ENROLLED', 'ONLINE', 'OFFLINE', 'UPDATE_REQUIRED', 'REVOKED', 'CLAIMED',
    'LEASE_RENEWED', 'CANCEL_OBSERVED', 'SUCCEEDED', 'FAILED', 'EXPIRED'
  )),
  facts_sha256 text NOT NULL CHECK (facts_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL,
  UNIQUE (account_id, workspace_id, device_id, sequence),
  FOREIGN KEY (account_id, workspace_id, device_id)
    REFERENCES media_worker_devices (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, lease_id)
    REFERENCES media_worker_leases (account_id, workspace_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER media_worker_events_tenant_account_derived
  BEFORE INSERT OR UPDATE ON media_worker_events
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_workspace_account();
CREATE TRIGGER media_worker_events_tenant_write_guard
  BEFORE INSERT OR UPDATE ON media_worker_events
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE media_worker_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_worker_events FORCE ROW LEVEL SECURITY;
CREATE POLICY media_worker_events_tenant_rls ON media_worker_events
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());

CREATE TRIGGER media_worker_events_append_only
  BEFORE UPDATE OR DELETE ON media_worker_events
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();

CREATE FUNCTION public.videoforge_media_worker_device_scope(supplied_credential_sha256 text)
RETURNS TABLE (
  device_id uuid,
  account_id uuid,
  workspace_id uuid,
  status text,
  protocol_version integer,
  execution_bundle_sha256 text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
  SELECT device.id, device.account_id, device.workspace_id, device.status,
         device.protocol_version, device.execution_bundle_sha256
    FROM media_worker_devices AS device
   WHERE device.credential_token_sha256 = supplied_credential_sha256
     AND supplied_credential_sha256 ~ '^sha256:[0-9a-f]{64}$'
     AND device.status <> 'REVOKED';
$$;
REVOKE ALL ON FUNCTION public.videoforge_media_worker_device_scope(text) FROM PUBLIC;

CREATE FUNCTION public.videoforge_media_worker_enrollment_poll(
  target_enrollment_id uuid,
  supplied_poll_token_sha256 text,
  observed_at timestamptz
) RETURNS TABLE (
  state text,
  expires_at timestamptz,
  credential_ready boolean,
  pkce_challenge text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  target media_worker_enrollments%ROWTYPE;
BEGIN
  SELECT * INTO target
    FROM media_worker_enrollments
   WHERE id = target_enrollment_id
     AND poll_token_sha256 = supplied_poll_token_sha256
   FOR UPDATE;
  IF target.id IS NULL THEN
    RETURN;
  END IF;
  IF target.state IN ('PENDING', 'APPROVED') AND target.expires_at <= observed_at THEN
    UPDATE media_worker_enrollments
       SET state = 'EXPIRED'
     WHERE id = target.id;
    target.state := 'EXPIRED';
  END IF;
  RETURN QUERY SELECT target.state, target.expires_at,
    target.state = 'APPROVED' AND target.credential_token_sha256 IS NOT NULL,
    target.pkce_challenge;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_media_worker_enrollment_poll(uuid, text, timestamptz)
FROM PUBLIC;

CREATE FUNCTION public.videoforge_media_worker_enrollment_consume(
  target_enrollment_id uuid,
  supplied_poll_token_sha256 text
) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
  WITH consumed AS (
    UPDATE media_worker_enrollments
       SET state = 'CONSUMED', consumed_at = COALESCE(consumed_at, now())
     WHERE id = target_enrollment_id
       AND poll_token_sha256 = supplied_poll_token_sha256
       AND state IN ('APPROVED', 'CONSUMED')
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM consumed);
$$;
REVOKE ALL ON FUNCTION public.videoforge_media_worker_enrollment_consume(uuid, text)
FROM PUBLIC;

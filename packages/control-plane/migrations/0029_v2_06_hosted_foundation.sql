-- V2-06 production-shaped hosted identity and CPU orchestration foundation.
-- Additive only. Provider resources are created only by the separately approved staging activation.

DROP INDEX workspaces_active_name_uq;
CREATE UNIQUE INDEX workspaces_account_active_name_uq
  ON workspaces (account_id, normalized_name)
  WHERE status = 'ACTIVE';

CREATE TABLE hosted_auth_users (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 160),
  name text NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 160),
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (email),
  CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 320),
  CHECK (image IS NULL OR length(image) BETWEEN 1 AND 2048)
);

CREATE TABLE hosted_auth_accounts (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 160),
  provider_account_id text NOT NULL CHECK (length(provider_account_id) BETWEEN 1 AND 512),
  provider_id text NOT NULL CHECK (provider_id IN ('credential', 'google')),
  user_id text NOT NULL REFERENCES hosted_auth_users (id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (provider_id, provider_account_id),
  UNIQUE (user_id, provider_id),
  CHECK ((provider_id = 'credential') = (password IS NOT NULL))
);

CREATE TABLE hosted_auth_sessions (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 160),
  expires_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE CHECK (length(token) BETWEEN 32 AND 512),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES hosted_auth_users (id) ON DELETE CASCADE,
  CHECK (expires_at > created_at),
  CHECK (ip_address IS NULL OR length(ip_address) <= 128),
  CHECK (user_agent IS NULL OR length(user_agent) <= 1024)
);

CREATE INDEX hosted_auth_sessions_user_idx ON hosted_auth_sessions (user_id, expires_at);

CREATE TABLE hosted_auth_verifications (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 160),
  identifier text NOT NULL CHECK (length(identifier) BETWEEN 1 AND 512),
  value text NOT NULL CHECK (length(value) BETWEEN 16 AND 4096),
  expires_at timestamptz NOT NULL,
  created_at timestamptz,
  updated_at timestamptz,
  UNIQUE (identifier, value)
);

CREATE TABLE hosted_auth_links (
  hosted_auth_user_id text PRIMARY KEY REFERENCES hosted_auth_users (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE RESTRICT,
  admitted_account_id uuid NOT NULL UNIQUE REFERENCES accounts (id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL UNIQUE,
  admission_id uuid NOT NULL UNIQUE REFERENCES app_admissions (id) ON DELETE RESTRICT,
  admitted_at timestamptz NOT NULL,
  FOREIGN KEY (admitted_account_id, workspace_id) REFERENCES workspaces (account_id, id) ON DELETE RESTRICT
);

CREATE FUNCTION public.videoforge_require_hosted_invite() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
BEGIN
  NEW.email := lower(btrim(NEW.email));
  IF NOT EXISTS (
    SELECT 1
      FROM invite_codes AS invite
     WHERE invite.intended_normalized_email = NEW.email
       AND invite.state = 'ACTIVE'
       AND invite.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'hosted identity is not invited' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER hosted_auth_users_invite_gate
  BEFORE INSERT ON hosted_auth_users
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_require_hosted_invite();

CREATE FUNCTION public.videoforge_admit_hosted_session() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  auth_user hosted_auth_users%ROWTYPE;
  invite invite_codes%ROWTYPE;
  auth_method text;
  vf_user_id uuid;
  vf_admission_id uuid;
  vf_account_id uuid;
  vf_workspace_id uuid;
  vf_membership_id uuid;
  vf_binding_id uuid;
  vf_redemption_id uuid;
BEGIN
  SELECT * INTO auth_user FROM hosted_auth_users WHERE id = NEW.user_id FOR UPDATE;
  IF auth_user.id IS NULL OR auth_user.email_verified IS NOT TRUE THEN
    RAISE EXCEPTION 'hosted session requires a verified identity' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM hosted_auth_links WHERE hosted_auth_user_id = auth_user.id) THEN
    RETURN NEW;
  END IF;

  SELECT CASE
    WHEN bool_or(provider_id = 'google') THEN 'GOOGLE'
    WHEN bool_or(provider_id = 'credential') THEN 'EMAIL_PASSWORD'
    ELSE NULL
  END INTO auth_method
    FROM hosted_auth_accounts
   WHERE user_id = auth_user.id;
  IF auth_method IS NULL THEN
    RAISE EXCEPTION 'hosted identity has no supported auth account' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO invite
    FROM invite_codes
   WHERE intended_normalized_email = auth_user.email
     AND state = 'ACTIVE'
     AND expires_at > now()
   FOR UPDATE;
  IF invite.id IS NULL THEN
    RAISE EXCEPTION 'hosted invite is unavailable' USING ERRCODE = '42501';
  END IF;

  vf_user_id := md5('hosted-user:' || auth_user.id)::uuid;
  vf_admission_id := md5('hosted-admission:' || auth_user.id)::uuid;
  vf_account_id := md5('hosted-account:' || auth_user.id)::uuid;
  vf_workspace_id := md5('hosted-workspace:' || auth_user.id)::uuid;
  vf_membership_id := md5('hosted-membership:' || auth_user.id)::uuid;
  vf_binding_id := md5('hosted-binding:' || auth_user.id)::uuid;
  vf_redemption_id := md5('hosted-redemption:' || auth_user.id)::uuid;

  INSERT INTO users (id, email, normalized_email, display_name, status)
  VALUES (vf_user_id, auth_user.email, auth_user.email, auth_user.name, 'ACTIVE');
  INSERT INTO accounts (id, scope_kind, owner_user_id, normalized_email, status)
  VALUES (vf_account_id, 'USER', vf_user_id, auth_user.email, 'ACTIVE');
  PERFORM set_config('videoforge.account_id', vf_account_id::text, true);

  UPDATE invite_codes
     SET state = 'CONSUMED', consumed_at = now(), version = version + 1
   WHERE id = invite.id AND state = 'ACTIVE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hosted invite was consumed concurrently' USING ERRCODE = '40001';
  END IF;

  INSERT INTO invite_redemptions (
    id, invite_code_id, user_id, normalized_email, auth_method, verifier_sha256, redeemed_at,
    account_id
  ) VALUES (
    vf_redemption_id, invite.id, vf_user_id, auth_user.email, auth_method,
    invite.verifier_sha256, now(), vf_account_id
  );
  INSERT INTO app_admissions (
    id, user_id, normalized_email, email_verified_at, invite_redemption_id, auth_methods,
    status, version, admitted_at, account_id
  ) VALUES (
    vf_admission_id, vf_user_id, auth_user.email, now(), vf_redemption_id, ARRAY[auth_method],
    'ADMITTED', 1, now(), vf_account_id
  );
  INSERT INTO auth_identity_bindings (
    id, user_id, normalized_email, auth_method, provider_subject_sha256, email_verified_at,
    bound_at, account_id
  ) VALUES (
    vf_binding_id, vf_user_id, auth_user.email, auth_method,
    'sha256:' || md5(auth_method || ':' || auth_user.id) || md5(auth_user.id || ':' || auth_method),
    now(), now(), vf_account_id
  );
  INSERT INTO workspaces (
    id, name, normalized_name, status, account_id, is_default
  ) VALUES (
    vf_workspace_id, 'My workspace', 'my workspace', 'ACTIVE', vf_account_id, true
  );
  INSERT INTO memberships (
    id, workspace_id, account_id, user_id, normalized_name, role, status, version
  ) VALUES (
    vf_membership_id, vf_workspace_id, vf_account_id, vf_user_id, 'owner', 'ADMIN', 'ACTIVE', 1
  );
  INSERT INTO hosted_auth_links (
    hosted_auth_user_id, user_id, admitted_account_id, workspace_id, admission_id, admitted_at
  ) VALUES (
    auth_user.id, vf_user_id, vf_account_id, vf_workspace_id, vf_admission_id, now()
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER hosted_auth_session_atomic_admission
  BEFORE INSERT ON hosted_auth_sessions
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_admit_hosted_session();

CREATE FUNCTION public.videoforge_hosted_session_scope(session_token text)
RETURNS TABLE (
  hosted_auth_user_id text,
  user_id uuid,
  account_id uuid,
  workspace_id uuid,
  normalized_email text,
  expires_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
  SELECT link.hosted_auth_user_id, link.user_id, link.admitted_account_id, link.workspace_id,
         auth_user.email, session.expires_at
    FROM hosted_auth_sessions AS session
    JOIN hosted_auth_users AS auth_user ON auth_user.id = session.user_id
    JOIN hosted_auth_links AS link ON link.hosted_auth_user_id = auth_user.id
   WHERE session.token = session_token
     AND session.expires_at > now();
$$;
REVOKE ALL ON FUNCTION public.videoforge_hosted_session_scope(text) FROM PUBLIC;

CREATE TABLE hosted_cpu_job_attempts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ASR', 'RENDER')),
  state text NOT NULL CHECK (state IN (
    'PLANNED', 'OUTBOXED', 'SUBMITTED', 'RUNNING', 'RECONCILING', 'CANCEL_REQUESTED',
    'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'
  )),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  job_spec_object_key text NOT NULL CHECK (
    job_spec_object_key ~ '^tenant/[A-Za-z0-9._:-]+/workspace/[A-Za-z0-9._:-]+/project/[A-Za-z0-9._:-]+/revision/[A-Za-z0-9._:-]+/lane/(input|render)/job/[A-Za-z0-9._:-]+/artifact/[A-Za-z0-9._:-]+$'
  ),
  job_spec_content_length bigint NOT NULL CHECK (
    job_spec_content_length BETWEEN 1 AND 1048576
  ),
  job_spec_checksum_sha256 text NOT NULL CHECK (
    job_spec_checksum_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  result_object_key text NOT NULL CHECK (
    result_object_key ~ '^tenant/[A-Za-z0-9._:-]+/workspace/[A-Za-z0-9._:-]+/project/[A-Za-z0-9._:-]+/revision/[A-Za-z0-9._:-]+/lane/(input|render)/job/[A-Za-z0-9._:-]+/artifact/[A-Za-z0-9._:-]+$'
  ),
  result_content_type text NOT NULL DEFAULT 'application/json' CHECK (
    result_content_type = 'application/json'
  ),
  result_max_bytes bigint NOT NULL DEFAULT 1048576 CHECK (
    result_max_bytes BETWEEN 1 AND 1048576
  ),
  image_digest text NOT NULL CHECK (image_digest ~ '^sha256:[0-9a-f]{64}$'),
  provider_operation_name text CHECK (
    provider_operation_name IS NULL OR provider_operation_name ~ '^projects/[a-z][a-z0-9-]{4,62}/locations/[a-z0-9-]+/operations/[A-Za-z0-9._-]+$'
  ),
  provider_operation_name_sha256 text CHECK (
    provider_operation_name_sha256 IS NULL OR provider_operation_name_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  provider_execution_name text CHECK (
    provider_execution_name IS NULL OR provider_execution_name ~ '^projects/[a-z][a-z0-9-]{4,62}/locations/[a-z0-9-]+/jobs/[a-z][a-z0-9-]{0,62}/executions/[A-Za-z0-9._-]+$'
  ),
  execution_name_sha256 text CHECK (
    execution_name_sha256 IS NULL OR execution_name_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  callback_token_sha256 text NOT NULL CHECK (callback_token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  result_receipt_sha256 text CHECK (
    result_receipt_sha256 IS NULL OR result_receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  result_content_length bigint CHECK (
    result_content_length IS NULL OR result_content_length BETWEEN 1 AND 1048576
  ),
  result_checksum_sha256 text CHECK (
    result_checksum_sha256 IS NULL OR result_checksum_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  deadline_at timestamptz NOT NULL,
  retain_until timestamptz,
  retention_deleted_at timestamptz,
  cancellation_requested_at timestamptz,
  submitted_at timestamptz,
  terminal_at timestamptz,
  poll_after timestamptz,
  replay_count integer NOT NULL DEFAULT 0 CHECK (replay_count BETWEEN 0 AND 32),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (provider_operation_name),
  UNIQUE (provider_execution_name),
  FOREIGN KEY (account_id, workspace_id) REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_id)
    REFERENCES projects (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_revision_id)
    REFERENCES project_revisions (account_id, workspace_id, id) ON DELETE RESTRICT,
  CHECK (deadline_at > created_at),
  CHECK (retain_until IS NULL OR retain_until >= deadline_at),
  CHECK ((state IN ('SUBMITTED', 'RUNNING', 'RECONCILING', 'CANCEL_REQUESTED', 'SUCCEEDED',
                    'FAILED', 'CANCELLED', 'EXPIRED')) = (submitted_at IS NOT NULL)),
  CHECK (state NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED') OR terminal_at IS NOT NULL),
  CHECK (state <> 'SUCCEEDED' OR result_receipt_sha256 IS NOT NULL)
);

CREATE UNIQUE INDEX hosted_cpu_job_execution_uq
  ON hosted_cpu_job_attempts (execution_name_sha256)
  WHERE execution_name_sha256 IS NOT NULL;
CREATE INDEX hosted_cpu_job_reconcile_idx
  ON hosted_cpu_job_attempts (state, poll_after)
  WHERE state IN ('SUBMITTED', 'RUNNING', 'RECONCILING', 'CANCEL_REQUESTED');

CREATE TRIGGER hosted_cpu_job_attempts_tenant_account_derived
  BEFORE INSERT OR UPDATE ON hosted_cpu_job_attempts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_workspace_account();
CREATE TRIGGER hosted_cpu_job_attempts_tenant_write_guard
  BEFORE INSERT OR UPDATE ON hosted_cpu_job_attempts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE hosted_cpu_job_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted_cpu_job_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_cpu_job_attempts_tenant_rls ON hosted_cpu_job_attempts
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());

CREATE TABLE hosted_cpu_job_events (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  kind text NOT NULL CHECK (kind IN (
    'OUTBOXED', 'SUBMITTED', 'OBSERVED_RUNNING', 'CALLBACK_HINT', 'POLL_OBSERVATION',
    'REPLAYED', 'CANCEL_REQUESTED', 'CANCELLED', 'SUCCEEDED', 'FAILED', 'EXPIRED',
    'RETENTION_DELETED'
  )),
  facts_sha256 text NOT NULL CHECK (facts_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL,
  UNIQUE (account_id, workspace_id, attempt_id, sequence),
  FOREIGN KEY (account_id, workspace_id, attempt_id)
    REFERENCES hosted_cpu_job_attempts (account_id, workspace_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER hosted_cpu_job_events_tenant_account_derived
  BEFORE INSERT OR UPDATE ON hosted_cpu_job_events
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_workspace_account();
CREATE TRIGGER hosted_cpu_job_events_tenant_write_guard
  BEFORE INSERT OR UPDATE ON hosted_cpu_job_events
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE hosted_cpu_job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted_cpu_job_events FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_cpu_job_events_tenant_rls ON hosted_cpu_job_events
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());

CREATE TRIGGER hosted_cpu_job_events_append_only
  BEFORE UPDATE OR DELETE ON hosted_cpu_job_events
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();

CREATE FUNCTION public.videoforge_accept_hosted_cpu_callback(
  target_attempt_id uuid,
  supplied_callback_token_sha256 text,
  supplied_execution_name text,
  observed_status text,
  supplied_result_object_key text,
  supplied_result_content_length bigint,
  supplied_result_checksum_sha256 text,
  supplied_result_receipt_sha256 text,
  supplied_facts_sha256 text,
  observed_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  target hosted_cpu_job_attempts%ROWTYPE;
  next_sequence integer;
BEGIN
  IF supplied_callback_token_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_facts_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR observed_status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
     OR (observed_status = 'SUCCEEDED'
         AND (supplied_result_receipt_sha256 !~ '^sha256:[0-9a-f]{64}$'
              OR supplied_result_checksum_sha256 !~ '^sha256:[0-9a-f]{64}$')) THEN
    RETURN false;
  END IF;
  SELECT * INTO target FROM hosted_cpu_job_attempts WHERE id = target_attempt_id FOR UPDATE;
  IF target.id IS NULL
     OR target.callback_token_sha256 <> supplied_callback_token_sha256
     OR target.provider_execution_name IS DISTINCT FROM supplied_execution_name
     OR (observed_status = 'SUCCEEDED' AND (
       target.result_object_key IS DISTINCT FROM supplied_result_object_key
       OR supplied_result_content_length < 1
       OR supplied_result_content_length > target.result_max_bytes
     ))
     OR target.state IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED')
     OR target.deadline_at <= observed_at THEN
    RETURN false;
  END IF;
  IF target.result_receipt_sha256 IS NOT NULL
     AND target.result_receipt_sha256 IS DISTINCT FROM supplied_result_receipt_sha256 THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM hosted_cpu_job_events
     WHERE account_id = target.account_id
       AND workspace_id = target.workspace_id
       AND attempt_id = target.id
       AND kind = 'CALLBACK_HINT'
       AND facts_sha256 = supplied_facts_sha256
  ) THEN
    RETURN true;
  END IF;

  PERFORM set_config('videoforge.account_id', target.account_id::text, true);
  SELECT COALESCE(max(sequence), 0) + 1 INTO next_sequence
    FROM hosted_cpu_job_events
   WHERE account_id = target.account_id
     AND workspace_id = target.workspace_id
     AND attempt_id = target.id;
  INSERT INTO hosted_cpu_job_events (
    id, account_id, workspace_id, attempt_id, sequence, kind, facts_sha256, occurred_at
  ) VALUES (
    md5(target.id::text || ':callback:' || next_sequence::text)::uuid,
    target.account_id, target.workspace_id, target.id, next_sequence, 'CALLBACK_HINT',
    supplied_facts_sha256, observed_at
  );
  UPDATE hosted_cpu_job_attempts
     SET state = CASE WHEN state = 'CANCEL_REQUESTED' THEN state ELSE 'RECONCILING' END,
         result_receipt_sha256 = CASE
           WHEN state <> 'CANCEL_REQUESTED' AND observed_status = 'SUCCEEDED'
             THEN supplied_result_receipt_sha256
           ELSE result_receipt_sha256
         END,
         result_content_length = CASE
           WHEN state <> 'CANCEL_REQUESTED' AND observed_status = 'SUCCEEDED'
             THEN supplied_result_content_length
           ELSE result_content_length
         END,
         result_checksum_sha256 = CASE
           WHEN state <> 'CANCEL_REQUESTED' AND observed_status = 'SUCCEEDED'
             THEN supplied_result_checksum_sha256
           ELSE result_checksum_sha256
         END,
         poll_after = observed_at,
         replay_count = replay_count + 1,
         version = version + 1,
         updated_at = observed_at
   WHERE id = target.id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_accept_hosted_cpu_callback(
  uuid, text, text, text, text, bigint, text, text, text, timestamptz
) FROM PUBLIC;

CREATE FUNCTION public.videoforge_due_hosted_cpu_retention(batch_limit integer)
RETURNS TABLE (
  attempt_id uuid,
  account_id uuid,
  workspace_id uuid,
  object_prefix text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
  SELECT attempt.id, attempt.account_id, attempt.workspace_id,
         regexp_replace(attempt.result_object_key, '/artifact/[^/]+$', '/artifact/')
    FROM hosted_cpu_job_attempts AS attempt
   WHERE attempt.state IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED')
     AND attempt.retain_until IS NOT NULL
     AND attempt.retain_until <= now()
     AND attempt.retention_deleted_at IS NULL
   ORDER BY attempt.retain_until, attempt.id
   LIMIT LEAST(GREATEST(batch_limit, 1), 50);
$$;
REVOKE ALL ON FUNCTION public.videoforge_due_hosted_cpu_retention(integer) FROM PUBLIC;

CREATE FUNCTION public.videoforge_finish_hosted_cpu_retention(
  target_attempt_id uuid,
  supplied_facts_sha256 text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  target hosted_cpu_job_attempts%ROWTYPE;
  next_sequence integer;
BEGIN
  IF supplied_facts_sha256 !~ '^sha256:[0-9a-f]{64}$' THEN RETURN false; END IF;
  SELECT * INTO target FROM hosted_cpu_job_attempts WHERE id = target_attempt_id FOR UPDATE;
  IF target.id IS NULL OR target.retain_until IS NULL OR target.retain_until > now()
     OR target.retention_deleted_at IS NOT NULL
     OR target.state NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED') THEN
    RETURN false;
  END IF;
  PERFORM set_config('videoforge.account_id', target.account_id::text, true);
  SELECT COALESCE(max(sequence), 0) + 1 INTO next_sequence
    FROM hosted_cpu_job_events
   WHERE account_id = target.account_id AND workspace_id = target.workspace_id
     AND attempt_id = target.id;
  INSERT INTO hosted_cpu_job_events (
    id, account_id, workspace_id, attempt_id, sequence, kind, facts_sha256, occurred_at
  ) VALUES (
    md5(target.id::text || ':retention:' || next_sequence::text)::uuid,
    target.account_id, target.workspace_id, target.id, next_sequence,
    'RETENTION_DELETED', supplied_facts_sha256, now()
  );
  UPDATE hosted_cpu_job_attempts
     SET retention_deleted_at = now(), version = version + 1, updated_at = now()
   WHERE id = target.id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_finish_hosted_cpu_retention(uuid, text) FROM PUBLIC;

-- V2-03 fair tenant admission (DEC_QUEUE_001, DEC_QUEUE_003, GATE_QUEUE_001).
--
-- Product fairness and capacity are PostgreSQL truth. Waiting rows are deliberately inert: this
-- migration creates no generation task, provider outbox, artifact reservation, or dispatch row.

CREATE TABLE global_generation_capacity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  active_lease_count smallint NOT NULL DEFAULT 0 CHECK (active_lease_count BETWEEN 0 AND 2),
  schedule_sequence bigint NOT NULL DEFAULT 0 CHECK (schedule_sequence >= 0),
  video_fair_cursor bigint NOT NULL DEFAULT 0 CHECK (video_fair_cursor >= 0),
  preview_fair_cursor bigint NOT NULL DEFAULT 0 CHECK (preview_fair_cursor >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO global_generation_capacity (singleton) VALUES (true);

CREATE TABLE account_queue_heads (
  account_id uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE RESTRICT,
  video_last_served_sequence bigint NOT NULL DEFAULT 0 CHECK (video_last_served_sequence >= 0),
  preview_last_served_sequence bigint NOT NULL DEFAULT 0 CHECK (preview_last_served_sequence >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE generation_requests (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN (
    'WAITING', 'ADMITTED', 'ACTIVE', 'CANCELLING', 'RETRY_WAIT',
    'SUCCEEDED', 'FAILED', 'CANCELLED'
  )),
  queue_order bigint NOT NULL CHECK (queue_order > 0),
  available_at timestamptz NOT NULL,
  attempt_ordinal integer NOT NULL DEFAULT 1 CHECK (attempt_ordinal > 0),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 240),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  admitted_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (account_id, idempotency_key),
  UNIQUE (account_id, queue_order) DEFERRABLE INITIALLY IMMEDIATE,
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_id)
    REFERENCES projects (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_revision_id)
    REFERENCES project_revisions (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, created_by_user_id)
    REFERENCES memberships (workspace_id, user_id) ON DELETE RESTRICT,
  CHECK ((state IN ('ADMITTED', 'ACTIVE', 'CANCELLING')) = (admitted_at IS NOT NULL AND terminal_at IS NULL)),
  CHECK ((state IN ('SUCCEEDED', 'FAILED', 'CANCELLED')) = (terminal_at IS NOT NULL))
);

CREATE UNIQUE INDEX generation_requests_one_active_video_per_account_uq
  ON generation_requests (account_id)
  WHERE state IN ('ADMITTED', 'ACTIVE', 'CANCELLING');
CREATE INDEX generation_requests_fair_head_idx
  ON generation_requests (state, available_at, account_id, queue_order, id);

CREATE TABLE preset_preview_requests (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  lane text NOT NULL CHECK (lane IN ('MAGE', 'SOULX')),
  preset_version_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN (
    'WAITING', 'ADMITTED', 'ACTIVE', 'CANCELLING', 'RETRY_WAIT',
    'SUCCEEDED', 'FAILED', 'CANCELLED'
  )),
  queue_order bigint NOT NULL CHECK (queue_order > 0),
  available_at timestamptz NOT NULL,
  attempt_ordinal integer NOT NULL DEFAULT 1 CHECK (attempt_ordinal > 0),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 240),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  admitted_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (account_id, idempotency_key),
  UNIQUE (account_id, queue_order) DEFERRABLE INITIALLY IMMEDIATE,
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, created_by_user_id)
    REFERENCES memberships (workspace_id, user_id) ON DELETE RESTRICT,
  CHECK ((state IN ('ADMITTED', 'ACTIVE', 'CANCELLING')) = (admitted_at IS NOT NULL AND terminal_at IS NULL)),
  CHECK ((state IN ('SUCCEEDED', 'FAILED', 'CANCELLED')) = (terminal_at IS NOT NULL))
);

CREATE INDEX preset_preview_requests_fair_head_idx
  ON preset_preview_requests (state, available_at, account_id, queue_order, id);

CREATE TABLE provider_workload_leases (
  id uuid PRIMARY KEY,
  slot smallint NOT NULL CHECK (slot IN (1, 2)),
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  request_kind text NOT NULL CHECK (request_kind IN ('VIDEO', 'PRESET_PREVIEW')),
  generation_request_id uuid,
  preset_preview_request_id uuid,
  owner_token_sha256 text NOT NULL CHECK (owner_token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('ACTIVE', 'RELEASED', 'EXPIRED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  acquired_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  release_reason text,
  UNIQUE (account_id, workspace_id, id),
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, generation_request_id)
    REFERENCES generation_requests (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, preset_preview_request_id)
    REFERENCES preset_preview_requests (account_id, workspace_id, id) ON DELETE RESTRICT,
  CHECK (
    (request_kind = 'VIDEO' AND generation_request_id IS NOT NULL AND preset_preview_request_id IS NULL)
    OR
    (request_kind = 'PRESET_PREVIEW' AND generation_request_id IS NULL AND preset_preview_request_id IS NOT NULL)
  ),
  CHECK (heartbeat_at >= acquired_at AND expires_at > heartbeat_at),
  CHECK (
    (state = 'ACTIVE' AND released_at IS NULL AND release_reason IS NULL)
    OR
    (state <> 'ACTIVE' AND released_at IS NOT NULL AND release_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX provider_workload_leases_one_active_account_uq
  ON provider_workload_leases (account_id) WHERE state = 'ACTIVE';
CREATE UNIQUE INDEX provider_workload_leases_one_active_slot_uq
  ON provider_workload_leases (slot) WHERE state = 'ACTIVE';
CREATE UNIQUE INDEX provider_workload_leases_one_active_video_request_uq
  ON provider_workload_leases (generation_request_id)
  WHERE state = 'ACTIVE' AND generation_request_id IS NOT NULL;
CREATE UNIQUE INDEX provider_workload_leases_one_active_preview_request_uq
  ON provider_workload_leases (preset_preview_request_id)
  WHERE state = 'ACTIVE' AND preset_preview_request_id IS NOT NULL;

CREATE TABLE generation_queue_audits (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN (
    'ENQUEUE', 'PROMOTE', 'REORDER', 'CANCEL_WAITING', 'CANCEL_ACTIVE',
    'RETRY', 'HEARTBEAT', 'TERMINAL_RELEASE', 'LEASE_EXPIRE', 'RECONSTRUCT'
  )),
  request_kind text NOT NULL CHECK (request_kind IN ('VIDEO', 'PRESET_PREVIEW', 'CAPACITY')),
  request_id uuid,
  lease_id uuid,
  request_version_before integer,
  request_version_after integer,
  video_cursor_before bigint NOT NULL CHECK (video_cursor_before >= 0),
  video_cursor_after bigint NOT NULL CHECK (video_cursor_after >= 0),
  preview_cursor_before bigint NOT NULL CHECK (preview_cursor_before >= 0),
  preview_cursor_after bigint NOT NULL CHECK (preview_cursor_after >= 0),
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, workspace_id, id),
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, actor_user_id)
    REFERENCES memberships (workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, lease_id)
    REFERENCES provider_workload_leases (account_id, workspace_id, id) ON DELETE RESTRICT,
  CHECK ((request_kind = 'CAPACITY') = (request_id IS NULL))
);

CREATE FUNCTION public.videoforge_validate_provider_workload_lease() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  capacity_count integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'ACTIVE' THEN
      RAISE EXCEPTION 'a provider workload lease must begin ACTIVE' USING ERRCODE = '23514';
    END IF;
    SELECT active_lease_count INTO capacity_count
      FROM global_generation_capacity WHERE singleton FOR UPDATE;
    IF capacity_count >= 2 THEN
      RAISE EXCEPTION 'both global provider workload slots are occupied' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM provider_workload_leases
       WHERE account_id = NEW.account_id AND state = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'account already owns an active provider workload' USING ERRCODE = '23505';
    END IF;
    UPDATE global_generation_capacity
       SET active_lease_count = active_lease_count + 1,
           version = version + 1,
           updated_at = NEW.acquired_at
     WHERE singleton;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.slot <> OLD.slot OR NEW.account_id <> OLD.account_id
     OR NEW.workspace_id <> OLD.workspace_id OR NEW.request_kind <> OLD.request_kind
     OR NEW.generation_request_id IS DISTINCT FROM OLD.generation_request_id
     OR NEW.preset_preview_request_id IS DISTINCT FROM OLD.preset_preview_request_id
     OR NEW.owner_token_sha256 <> OLD.owner_token_sha256 OR NEW.acquired_at <> OLD.acquired_at
     OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'provider workload lease identity or version changed' USING ERRCODE = '23514';
  END IF;

  IF OLD.state = 'ACTIVE' AND NEW.state = 'ACTIVE' THEN
    IF NEW.heartbeat_at < OLD.heartbeat_at OR NEW.expires_at <= NEW.heartbeat_at
       OR NEW.released_at IS NOT NULL OR NEW.release_reason IS NOT NULL THEN
      RAISE EXCEPTION 'invalid provider workload heartbeat' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.state = 'ACTIVE' AND NEW.state IN ('RELEASED', 'EXPIRED') THEN
    IF NEW.released_at IS NULL OR NEW.release_reason IS NULL THEN
      RAISE EXCEPTION 'terminal provider workload lease requires release evidence' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM global_generation_capacity WHERE singleton FOR UPDATE;
    UPDATE global_generation_capacity
       SET active_lease_count = active_lease_count - 1,
           version = version + 1,
           updated_at = NEW.released_at
     WHERE singleton AND active_lease_count > 0;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'global capacity underflow' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'provider workload lease is terminal' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER provider_workload_leases_validate
  BEFORE INSERT OR UPDATE ON provider_workload_leases
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_validate_provider_workload_lease();

CREATE TRIGGER generation_requests_tenant_account_derived
  BEFORE INSERT OR UPDATE ON generation_requests
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_revision_account();
CREATE TRIGGER preset_preview_requests_tenant_account_derived
  BEFORE INSERT OR UPDATE ON preset_preview_requests
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_workspace_account();
CREATE TRIGGER provider_workload_leases_tenant_account_derived
  BEFORE INSERT OR UPDATE ON provider_workload_leases
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_workspace_account();
CREATE TRIGGER generation_queue_audits_tenant_account_derived
  BEFORE INSERT OR UPDATE ON generation_queue_audits
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_workspace_account();

CREATE TRIGGER generation_requests_tenant_write_guard
  BEFORE INSERT OR UPDATE ON generation_requests
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER account_queue_heads_tenant_write_guard
  BEFORE INSERT OR UPDATE ON account_queue_heads
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER preset_preview_requests_tenant_write_guard
  BEFORE INSERT OR UPDATE ON preset_preview_requests
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER provider_workload_leases_tenant_write_guard
  BEFORE INSERT OR UPDATE ON provider_workload_leases
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER generation_queue_audits_tenant_write_guard
  BEFORE INSERT OR UPDATE ON generation_queue_audits
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();

CREATE TRIGGER generation_queue_audits_append_only
  BEFORE UPDATE OR DELETE ON generation_queue_audits
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();

DO $tenant_rls$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'account_queue_heads',
    'generation_requests', 'preset_preview_requests',
    'provider_workload_leases', 'generation_queue_audits'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I
         USING (account_id = public.videoforge_current_account_id())
         WITH CHECK (account_id = public.videoforge_current_account_id())',
      target || '_tenant_rls', target
    );
    EXECUTE format(
      'CREATE VIEW public.%I WITH (security_barrier) AS
         SELECT * FROM public.%I
          WHERE account_id = public.videoforge_current_account_id()',
      'videoforge_tenant_' || target, target
    );
  END LOOP;
END
$tenant_rls$;

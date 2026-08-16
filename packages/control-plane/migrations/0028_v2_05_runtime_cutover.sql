-- V2-05 provider-free runtime cutover.
--
-- Each admitted video owns its own durable stage state. CPU preparation may only begin after
-- database admission, each exact lane may only be dispatched after its own items manifest and
-- predispatch authority are durable, and accepted units survive bounded retries because they are
-- append-only facts of the video rather than of one attempt.
--
-- The superseded global session, Pod lifecycle, and shared GPU-pair contracts stay readable for
-- compatibility evidence but can no longer be written by ordinary application code: their fence
-- requires an explicit compatibility-fixture session setting that production never sets.

CREATE TABLE video_runtime_states (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  generation_request_id uuid NOT NULL,
  stage text NOT NULL CHECK (stage IN (
    'QUEUED', 'PREPARING', 'WAITING_FOR_WORKER', 'INITIALIZING', 'GENERATING_IMAGES',
    'GENERATING_AVATAR', 'RENDERING', 'COMPLETE', 'FAILED', 'CANCELED'
  )),
  preparation_manifest_sha256 text
    CHECK (preparation_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  render_manifest_sha256 text
    CHECK (render_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  final_output_sha256 text
    CHECK (final_output_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  terminal_reason text CHECK (terminal_reason IN (
    'SUCCEEDED', 'LANE_PERMANENT_FAILURE', 'RENDER_FAILURE', 'OWNER_CANCELLED', 'SYSTEM_CANCELLED'
  )),
  admitted_at timestamptz,
  prepared_at timestamptz,
  terminal_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (generation_request_id),
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_id)
    REFERENCES projects (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_revision_id)
    REFERENCES project_revisions (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, generation_request_id)
    REFERENCES generation_requests (account_id, workspace_id, id) ON DELETE RESTRICT,
  -- No stage past QUEUED exists without a durable admission timestamp.
  CHECK ((stage = 'QUEUED') = (admitted_at IS NULL)),
  -- CPU preparation output is required before any worker-facing stage.
  CHECK (
    stage IN ('QUEUED', 'PREPARING', 'FAILED', 'CANCELED')
    OR (preparation_manifest_sha256 IS NOT NULL AND prepared_at IS NOT NULL)
  ),
  CHECK ((stage IN ('COMPLETE', 'FAILED', 'CANCELED')) = (terminal_at IS NOT NULL)),
  CHECK ((stage IN ('COMPLETE', 'FAILED', 'CANCELED')) = (terminal_reason IS NOT NULL)),
  CHECK ((stage = 'COMPLETE') = (final_output_sha256 IS NOT NULL)),
  CHECK (stage <> 'COMPLETE' OR render_manifest_sha256 IS NOT NULL),
  CHECK (stage <> 'COMPLETE' OR terminal_reason = 'SUCCEEDED')
);

CREATE INDEX video_runtime_states_account_stage_idx
  ON video_runtime_states (account_id, stage, created_at, id);

CREATE TABLE video_runtime_lane_states (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  runtime_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  lane text NOT NULL CHECK (lane IN ('mage_image', 'soulx_avatar')),
  state text NOT NULL CHECK (state IN (
    'BLOCKED_ON_PREPARATION', 'MANIFEST_DURABLE', 'WAITING_FOR_WORKER', 'INITIALIZING',
    'GENERATING', 'SUCCEEDED', 'FAILED', 'CANCELED'
  )),
  items_manifest_sha256 text CHECK (items_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  planned_item_count integer NOT NULL DEFAULT 0 CHECK (planned_item_count BETWEEN 0 AND 4096),
  accepted_item_count integer NOT NULL DEFAULT 0 CHECK (accepted_item_count >= 0),
  attempt_ordinal integer NOT NULL DEFAULT 0 CHECK (attempt_ordinal BETWEEN 0 AND 3),
  max_attempt_ordinal integer NOT NULL DEFAULT 2 CHECK (max_attempt_ordinal BETWEEN 1 AND 3),
  current_attempt_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (runtime_id, lane),
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, runtime_id)
    REFERENCES video_runtime_states (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, current_attempt_id)
    REFERENCES serverless_attempts (account_id, workspace_id, id) ON DELETE RESTRICT,
  CHECK (accepted_item_count <= planned_item_count),
  CHECK (state <> 'BLOCKED_ON_PREPARATION' OR items_manifest_sha256 IS NULL),
  CHECK (state <> 'BLOCKED_ON_PREPARATION' OR planned_item_count = 0),
  CHECK (
    state NOT IN ('MANIFEST_DURABLE', 'WAITING_FOR_WORKER', 'INITIALIZING', 'GENERATING', 'SUCCEEDED')
    OR items_manifest_sha256 IS NOT NULL
  ),
  CHECK (attempt_ordinal <= max_attempt_ordinal),
  -- A lane can only be worker-facing while it names its exact live attempt.
  CHECK (
    (state IN ('WAITING_FOR_WORKER', 'INITIALIZING', 'GENERATING')) = (current_attempt_id IS NOT NULL)
  ),
  CHECK (state <> 'SUCCEEDED' OR accepted_item_count = planned_item_count)
);

-- Accepted units belong to the video and its lane, never to one attempt, so a bounded retry
-- resumes the remaining work instead of regenerating accepted output.
CREATE TABLE video_runtime_accepted_units (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  runtime_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  lane text NOT NULL CHECK (lane IN ('mage_image', 'soulx_avatar')),
  item_id text NOT NULL CHECK (length(item_id) BETWEEN 1 AND 240),
  object_key text NOT NULL CHECK (object_key ~ '^tenant/[A-Za-z0-9._:/-]+$'),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  content_length bigint NOT NULL CHECK (content_length > 0),
  accepted_attempt_id uuid NOT NULL,
  accepted_at timestamptz NOT NULL,
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (runtime_id, lane, item_id),
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, runtime_id)
    REFERENCES video_runtime_states (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, accepted_attempt_id)
    REFERENCES serverless_attempts (account_id, workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE video_runtime_events (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  runtime_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  lane text CHECK (lane IS NULL OR lane IN ('mage_image', 'soulx_avatar')),
  from_state text NOT NULL CHECK (length(from_state) BETWEEN 1 AND 64),
  to_state text NOT NULL CHECK (length(to_state) BETWEEN 1 AND 64),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 120),
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  occurred_at timestamptz NOT NULL,
  UNIQUE (account_id, workspace_id, id),
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, runtime_id)
    REFERENCES video_runtime_states (account_id, workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX video_runtime_events_runtime_idx
  ON video_runtime_events (runtime_id, occurred_at, id);

-- ------------------------------------------------------------------------------------------------
-- Stage machine
-- ------------------------------------------------------------------------------------------------

CREATE FUNCTION public.videoforge_validate_video_runtime_state() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  admission_state text;
  admission_admitted_at timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A runtime row may only exist past QUEUED when its request carries a durable admission, so a
    -- restored or replayed row can never claim unadmitted preparation, lane, or render work.
    IF NEW.stage <> 'QUEUED' THEN
      SELECT state, admitted_at INTO admission_state, admission_admitted_at
        FROM public.generation_requests
       WHERE id = NEW.generation_request_id;
      IF admission_admitted_at IS NULL OR admission_state = 'WAITING' THEN
        RAISE EXCEPTION 'video runtime work requires a durable admission' USING ERRCODE = '55000';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.account_id <> OLD.account_id OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.project_id <> OLD.project_id OR NEW.project_revision_id <> OLD.project_revision_id
     OR NEW.generation_request_id <> OLD.generation_request_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'video runtime identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'video runtime version must advance by exactly one' USING ERRCODE = '23514';
  END IF;
  IF OLD.stage IN ('COMPLETE', 'FAILED', 'CANCELED') THEN
    RAISE EXCEPTION 'video runtime % is terminal', OLD.id USING ERRCODE = '55000';
  END IF;
  IF OLD.preparation_manifest_sha256 IS NOT NULL
     AND NEW.preparation_manifest_sha256 IS DISTINCT FROM OLD.preparation_manifest_sha256 THEN
    RAISE EXCEPTION 'the durable preparation manifest is immutable' USING ERRCODE = '55000';
  END IF;

  -- No CPU preparation, lane work, or render may begin before durable database admission.
  IF OLD.stage = 'QUEUED' AND NEW.stage <> 'QUEUED' THEN
    SELECT state, admitted_at INTO admission_state, admission_admitted_at
      FROM public.generation_requests
     WHERE id = NEW.generation_request_id
     FOR UPDATE;
    IF admission_state IS NULL OR admission_admitted_at IS NULL
       OR admission_state NOT IN ('ADMITTED', 'ACTIVE', 'CANCELLING') THEN
      RAISE EXCEPTION 'video runtime work requires a durable admission, not queue state %',
        coalesce(admission_state, 'MISSING') USING ERRCODE = '55000';
    END IF;
    IF NEW.stage <> 'PREPARING' AND NEW.stage NOT IN ('FAILED', 'CANCELED') THEN
      RAISE EXCEPTION 'an admitted video runtime must enter PREPARING first' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.stage IN ('FAILED', 'CANCELED') OR NEW.stage = OLD.stage THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.stage = 'PREPARING' AND NEW.stage = 'WAITING_FOR_WORKER')
    OR (OLD.stage = 'WAITING_FOR_WORKER' AND NEW.stage = 'INITIALIZING')
    OR (OLD.stage = 'INITIALIZING' AND NEW.stage IN ('GENERATING_IMAGES', 'GENERATING_AVATAR'))
    OR (OLD.stage = 'GENERATING_IMAGES' AND NEW.stage IN ('GENERATING_AVATAR', 'RENDERING', 'WAITING_FOR_WORKER'))
    OR (OLD.stage = 'GENERATING_AVATAR' AND NEW.stage IN ('GENERATING_IMAGES', 'RENDERING', 'WAITING_FOR_WORKER'))
    OR (OLD.stage IN ('WAITING_FOR_WORKER', 'INITIALIZING') AND NEW.stage = 'RENDERING')
    OR (OLD.stage = 'RENDERING' AND NEW.stage = 'COMPLETE')
  ) THEN
    RAISE EXCEPTION 'illegal video runtime stage transition % -> %', OLD.stage, NEW.stage
      USING ERRCODE = '23514';
  END IF;

  -- The render barrier requires every planned lane unit to be an accepted durable fact.
  IF NEW.stage = 'RENDERING' AND EXISTS (
    SELECT 1 FROM public.video_runtime_lane_states AS lane
     WHERE lane.runtime_id = NEW.id AND lane.state <> 'SUCCEEDED'
  ) THEN
    RAISE EXCEPTION 'render cannot start before every lane succeeded' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER video_runtime_states_validate
  BEFORE INSERT OR UPDATE ON video_runtime_states
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_validate_video_runtime_state();

CREATE FUNCTION public.videoforge_validate_video_runtime_lane() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  bound_attempt public.serverless_attempts%ROWTYPE;
  authority_count integer;
  runtime_stage text;
  accepted_units integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.runtime_id <> OLD.runtime_id OR NEW.lane <> OLD.lane
       OR NEW.account_id <> OLD.account_id OR NEW.workspace_id <> OLD.workspace_id THEN
      RAISE EXCEPTION 'video runtime lane identity is immutable' USING ERRCODE = '55000';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'video runtime lane version must advance by exactly one' USING ERRCODE = '23514';
    END IF;
    IF OLD.items_manifest_sha256 IS NOT NULL
       AND NEW.items_manifest_sha256 IS DISTINCT FROM OLD.items_manifest_sha256 THEN
      RAISE EXCEPTION 'the durable lane items manifest is immutable' USING ERRCODE = '55000';
    END IF;
    IF NEW.accepted_item_count < OLD.accepted_item_count THEN
      RAISE EXCEPTION 'accepted lane units can never be discarded' USING ERRCODE = '55000';
    END IF;
    IF OLD.state IN ('SUCCEEDED', 'FAILED', 'CANCELED') AND NEW.state <> OLD.state THEN
      RAISE EXCEPTION 'video runtime lane % is terminal', OLD.id USING ERRCODE = '55000';
    END IF;
    IF NEW.attempt_ordinal < OLD.attempt_ordinal THEN
      RAISE EXCEPTION 'lane attempt ordinals never decrease' USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT stage INTO runtime_stage
    FROM public.video_runtime_states WHERE id = NEW.runtime_id;
  IF runtime_stage IS NULL THEN
    RAISE EXCEPTION 'video runtime % is missing', NEW.runtime_id USING ERRCODE = '23503';
  END IF;
  IF NEW.items_manifest_sha256 IS NOT NULL AND runtime_stage = 'QUEUED' THEN
    RAISE EXCEPTION 'lane preparation cannot precede admission' USING ERRCODE = '55000';
  END IF;

  IF NEW.current_attempt_id IS NOT NULL THEN
    SELECT * INTO bound_attempt
      FROM public.serverless_attempts WHERE id = NEW.current_attempt_id;
    IF bound_attempt.id IS NULL THEN
      RAISE EXCEPTION 'lane attempt % is missing', NEW.current_attempt_id USING ERRCODE = '23503';
    END IF;
    IF bound_attempt.lane <> NEW.lane
       OR bound_attempt.account_id <> NEW.account_id
       OR bound_attempt.workspace_id <> NEW.workspace_id
       OR bound_attempt.project_revision_id <> NEW.project_revision_id THEN
      RAISE EXCEPTION 'lane attempt does not belong to this tenant lane' USING ERRCODE = '23514';
    END IF;
    -- Dispatch is only legal after this lane's own manifest and durable authority exist. A first
    -- attempt covers the exact durable plan; a bounded retry covers exactly the unaccepted units.
    IF NEW.items_manifest_sha256 IS NULL THEN
      RAISE EXCEPTION 'lane dispatch requires its durable items manifest' USING ERRCODE = '55000';
    END IF;
    -- The coverage rules bind one attempt to this lane; later progress on an already bound attempt
    -- only accumulates accepted units.
    IF TG_OP = 'INSERT' OR NEW.current_attempt_id IS DISTINCT FROM OLD.current_attempt_id THEN
      IF NEW.accepted_item_count = 0
         AND bound_attempt.items_manifest_sha256 <> NEW.items_manifest_sha256 THEN
        RAISE EXCEPTION 'a first lane attempt must carry the exact durable items manifest'
          USING ERRCODE = '55000';
      END IF;
      IF bound_attempt.item_count <> NEW.planned_item_count - NEW.accepted_item_count THEN
        RAISE EXCEPTION 'a lane attempt must cover exactly the unaccepted planned units'
          USING ERRCODE = '55000';
      END IF;
    END IF;
    SELECT count(*) INTO authority_count
      FROM public.serverless_predispatch_authorities
     WHERE attempt_id = NEW.current_attempt_id;
    IF authority_count <> 1 THEN
      RAISE EXCEPTION 'lane dispatch requires exactly one durable predispatch authority'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.attempt_ordinal <> bound_attempt.attempt_ordinal THEN
      RAISE EXCEPTION 'lane attempt ordinal must match its bound attempt' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.state = 'SUCCEEDED' THEN
    SELECT count(*) INTO accepted_units
      FROM public.video_runtime_accepted_units
     WHERE runtime_id = NEW.runtime_id AND lane = NEW.lane;
    IF accepted_units <> NEW.planned_item_count OR NEW.planned_item_count = 0 THEN
      RAISE EXCEPTION 'a lane succeeds only when every planned unit is durably accepted'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER video_runtime_lane_states_validate
  BEFORE INSERT OR UPDATE ON video_runtime_lane_states
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_validate_video_runtime_lane();

-- An accepted unit must name an attempt of the same video lane and a committed tenant artifact.
CREATE FUNCTION public.videoforge_validate_video_runtime_accepted_unit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  bound_attempt public.serverless_attempts%ROWTYPE;
  runtime_revision uuid;
BEGIN
  SELECT project_revision_id INTO runtime_revision
    FROM public.video_runtime_states WHERE id = NEW.runtime_id;
  IF runtime_revision IS NULL OR runtime_revision <> NEW.project_revision_id THEN
    RAISE EXCEPTION 'accepted unit does not bind its video revision' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO bound_attempt
    FROM public.serverless_attempts WHERE id = NEW.accepted_attempt_id;
  IF bound_attempt.id IS NULL OR bound_attempt.lane <> NEW.lane
     OR bound_attempt.project_revision_id <> NEW.project_revision_id
     OR bound_attempt.account_id <> NEW.account_id THEN
    RAISE EXCEPTION 'accepted unit does not bind an attempt of this video lane' USING ERRCODE = '23514';
  END IF;
  IF NEW.object_key <> bound_attempt.output_prefix || '/artifact/' || NEW.item_id THEN
    RAISE EXCEPTION 'accepted unit key is outside its attempt output prefix' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.artifact_receipts AS receipt
      JOIN public.artifact_reservations AS reservation
        ON reservation.account_id = receipt.account_id
       AND reservation.workspace_id = receipt.workspace_id
       AND reservation.id = receipt.reservation_id
     WHERE receipt.account_id = NEW.account_id
       AND receipt.workspace_id = NEW.workspace_id
       AND receipt.deleted_at IS NULL
       AND receipt.object_key = NEW.object_key
       AND receipt.checksum_sha256 = NEW.checksum_sha256
       AND receipt.content_length = NEW.content_length
       AND reservation.project_revision_id = NEW.project_revision_id
       AND reservation.artifact_id = NEW.item_id
  ) THEN
    RAISE EXCEPTION 'accepted unit has no live tenant artifact commit receipt' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER video_runtime_accepted_units_validate
  BEFORE INSERT ON video_runtime_accepted_units
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_validate_video_runtime_accepted_unit();

CREATE TRIGGER video_runtime_accepted_units_append_only
  BEFORE UPDATE OR DELETE ON video_runtime_accepted_units
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();

CREATE TRIGGER video_runtime_events_append_only
  BEFORE UPDATE OR DELETE ON video_runtime_events
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();

-- ------------------------------------------------------------------------------------------------
-- Superseded contract quarantine
-- ------------------------------------------------------------------------------------------------

CREATE TABLE superseded_runtime_contracts (
  table_name text PRIMARY KEY,
  superseded_by text NOT NULL,
  checkpoint text NOT NULL,
  reason text NOT NULL
);

INSERT INTO superseded_runtime_contracts (table_name, superseded_by, checkpoint, reason) VALUES
  ('generation_sessions', 'video_runtime_states', 'V2-05',
   'one singleton global session is superseded by independent per-video runtime state'),
  ('session_gpu_bindings', 'serverless_endpoint_deployments', 'V2-05',
   'user or session GPU pair selection is superseded by operator-owned endpoint deployments'),
  ('session_gpu_revalidations', 'serverless_endpoint_deployments', 'V2-05',
   'GPU revalidation belongs to the superseded Pod-era session contract'),
  ('global_queue_entries', 'generation_requests', 'V2-05',
   'the shared global queue is superseded by tenant-private fair admission'),
  ('compute_run_plans', 'serverless_predispatch_authorities', 'V2-05',
   'Pod-bound run plans are superseded by Serverless v3 predispatch authority'),
  ('pod_lifecycle_attempts', 'serverless_attempts', 'V2-05',
   'Pod create/delete lifecycle is superseded by queue-endpoint dispatch'),
  ('pod_dispatch_authorizations', 'serverless_predispatch_authorities', 'V2-05',
   'Pod dispatch authorization is superseded by Serverless v3 predispatch authority'),
  ('durable_generation_outputs', 'serverless_output_receipts', 'V2-05',
   'Pod-era outputs are superseded by signed provenance plus tenant commit receipts');

CREATE FUNCTION public.videoforge_fence_superseded_runtime_contract() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('videoforge.legacy_compatibility_fixture', true), '') <> 'on' THEN
    RAISE EXCEPTION 'table % is superseded by the V2-05 runtime and is not writable by production code',
      TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DO $fence$
DECLARE
  target text;
BEGIN
  FOR target IN SELECT table_name FROM superseded_runtime_contracts LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.videoforge_fence_superseded_runtime_contract()',
      target || '_v2_05_superseded_fence', target
    );
  END LOOP;
END
$fence$;

-- ------------------------------------------------------------------------------------------------
-- Tenant derivation, write guard, row level security, and tenant views
-- ------------------------------------------------------------------------------------------------

CREATE TRIGGER video_runtime_states_tenant_account_derived
  BEFORE INSERT OR UPDATE ON video_runtime_states
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_revision_account();
CREATE TRIGGER video_runtime_lane_states_tenant_account_derived
  BEFORE INSERT OR UPDATE ON video_runtime_lane_states
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_revision_account();
CREATE TRIGGER video_runtime_accepted_units_tenant_account_derived
  BEFORE INSERT OR UPDATE ON video_runtime_accepted_units
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_revision_account();
CREATE TRIGGER video_runtime_events_tenant_account_derived
  BEFORE INSERT OR UPDATE ON video_runtime_events
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_revision_account();

CREATE TRIGGER video_runtime_states_tenant_write_guard
  BEFORE INSERT OR UPDATE ON video_runtime_states
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER video_runtime_lane_states_tenant_write_guard
  BEFORE INSERT OR UPDATE ON video_runtime_lane_states
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER video_runtime_accepted_units_tenant_write_guard
  BEFORE INSERT OR UPDATE ON video_runtime_accepted_units
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER video_runtime_events_tenant_write_guard
  BEFORE INSERT OR UPDATE ON video_runtime_events
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();

DO $tenant_rls$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'video_runtime_states', 'video_runtime_lane_states',
    'video_runtime_accepted_units', 'video_runtime_events'
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

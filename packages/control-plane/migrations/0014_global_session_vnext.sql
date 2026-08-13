-- CP-01 provider-free global-session vNext persistence (DEC_QUEUE_002, DEC_RUNPOD_002).
-- Additive only. Existing v1 rows, migrations, and provider evidence keep their original meaning.

CREATE TABLE app_admissions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE RESTRICT,
  normalized_email text NOT NULL UNIQUE,
  email_verified_at timestamptz NOT NULL,
  invite_redemption_id uuid NOT NULL UNIQUE,
  auth_methods text[] NOT NULL,
  status text NOT NULL DEFAULT 'ADMITTED' CHECK (status = 'ADMITTED'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  admitted_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    normalized_email = lower(btrim(normalized_email))
    AND length(normalized_email) BETWEEN 3 AND 320
  ),
  CHECK (
    cardinality(auth_methods) BETWEEN 1 AND 2
    AND auth_methods <@ ARRAY['EMAIL_PASSWORD', 'GOOGLE']::text[]
  )
);

CREATE TABLE model_volumes (
  id uuid PRIMARY KEY,
  provider_volume_id text NOT NULL UNIQUE CHECK (length(provider_volume_id) BETWEEN 1 AND 160),
  lane text NOT NULL UNIQUE CHECK (lane IN ('mage_image', 'echo_avatar')),
  region text NOT NULL CHECK (region = 'EU-RO-1'),
  mount_path text NOT NULL UNIQUE CHECK (mount_path IN ('/models/mage', '/models/echo')),
  model_id text NOT NULL CHECK (length(model_id) BETWEEN 1 AND 240),
  model_revision text NOT NULL CHECK (length(model_revision) BETWEEN 1 AND 240),
  precision text NOT NULL CHECK (precision IN ('int8-convrot', 'fp8')),
  retention_state text NOT NULL DEFAULT 'RETAINED' CHECK (retention_state = 'RETAINED'),
  routine_deletion_allowed boolean NOT NULL DEFAULT false CHECK (routine_deletion_allowed = false),
  registered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, lane),
  CHECK (
    (lane = 'mage_image'
      AND mount_path = '/models/mage'
      AND model_id = 'Comfy-Org/Mage-Flow'
      AND model_revision = 'd8c99241f6fa80fbd453014234af2bf337ea21e6'
      AND precision = 'int8-convrot')
    OR
    (lane = 'echo_avatar'
      AND mount_path = '/models/echo'
      AND model_id = 'EchoMimicV3-Flash'
      AND precision = 'fp8')
  )
);

CREATE TABLE model_volume_manifests (
  id uuid PRIMARY KEY,
  model_volume_id uuid NOT NULL,
  lane text NOT NULL CHECK (lane IN ('mage_image', 'echo_avatar')),
  manifest_contract_version text NOT NULL CHECK (manifest_contract_version = 'model-volume-manifest/v2'),
  manifest_sha256 text NOT NULL UNIQUE CHECK (manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  file_count integer NOT NULL CHECK (file_count > 0),
  total_bytes bigint NOT NULL CHECK (total_bytes > 0),
  state text NOT NULL CHECK (state = 'VERIFIED'),
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, model_volume_id, lane),
  FOREIGN KEY (model_volume_id, lane) REFERENCES model_volumes (id, lane) ON DELETE RESTRICT
);

CREATE TABLE gpu_inventory_receipts (
  id uuid PRIMARY KEY,
  lane text NOT NULL CHECK (lane IN ('mage_image', 'echo_avatar')),
  provider text NOT NULL CHECK (provider = 'RUNPOD'),
  cloud_type text NOT NULL CHECK (cloud_type = 'SECURE_CLOUD'),
  region text NOT NULL CHECK (region = 'EU-RO-1'),
  offering_id text NOT NULL CHECK (length(offering_id) BETWEEN 1 AND 160),
  gpu_sku text NOT NULL CHECK (
    length(gpu_sku) BETWEEN 2 AND 120
    AND lower(gpu_sku) <> 'auto'
  ),
  gpu_count integer NOT NULL CHECK (gpu_count = 1),
  available_count integer NOT NULL CHECK (available_count > 0),
  observed_rate_micro_usd_per_hour bigint NOT NULL CHECK (observed_rate_micro_usd_per_hour > 0),
  normalized_payload_sha256 text NOT NULL CHECK (normalized_payload_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > observed_at),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, lane),
  UNIQUE (lane, offering_id, observed_at)
);

CREATE TABLE generation_sessions (
  id uuid PRIMARY KEY,
  singleton_key text NOT NULL DEFAULT 'GLOBAL' CHECK (singleton_key = 'GLOBAL'),
  state text NOT NULL CHECK (state IN ('LOCKING', 'ACTIVE', 'DRAINING', 'CLOSED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  queue_version integer NOT NULL DEFAULT 0 CHECK (queue_version >= 0),
  gpu_pair_hash text NOT NULL CHECK (gpu_pair_hash ~ '^sha256:[0-9a-f]{64}$'),
  selected_by_admission_id uuid NOT NULL REFERENCES app_admissions (id) ON DELETE RESTRICT,
  opened_at timestamptz NOT NULL,
  closing_at timestamptz,
  closed_at timestamptz,
  CHECK ((state IN ('LOCKING', 'ACTIVE')) = (closing_at IS NULL AND closed_at IS NULL)),
  CHECK (state <> 'DRAINING' OR (closing_at IS NOT NULL AND closed_at IS NULL)),
  CHECK (state <> 'CLOSED' OR (closing_at IS NOT NULL AND closed_at IS NOT NULL))
);

CREATE UNIQUE INDEX generation_sessions_one_open_uq
  ON generation_sessions (singleton_key)
  WHERE state IN ('LOCKING', 'ACTIVE', 'DRAINING');

CREATE TABLE session_gpu_bindings (
  generation_session_id uuid NOT NULL REFERENCES generation_sessions (id) ON DELETE RESTRICT,
  lane text NOT NULL CHECK (lane IN ('mage_image', 'echo_avatar')),
  inventory_receipt_id uuid NOT NULL,
  model_volume_id uuid NOT NULL,
  manifest_id uuid NOT NULL,
  offering_id text NOT NULL CHECK (length(offering_id) BETWEEN 1 AND 160),
  selected_gpu_sku text NOT NULL CHECK (length(selected_gpu_sku) BETWEEN 2 AND 120),
  rate_ceiling_micro_usd_per_hour bigint NOT NULL CHECK (rate_ceiling_micro_usd_per_hour > 0),
  selected_at timestamptz NOT NULL,
  PRIMARY KEY (generation_session_id, lane),
  FOREIGN KEY (inventory_receipt_id, lane)
    REFERENCES gpu_inventory_receipts (id, lane) ON DELETE RESTRICT,
  FOREIGN KEY (model_volume_id, lane)
    REFERENCES model_volumes (id, lane) ON DELETE RESTRICT,
  FOREIGN KEY (manifest_id, model_volume_id, lane)
    REFERENCES model_volume_manifests (id, model_volume_id, lane) ON DELETE RESTRICT
);

CREATE TABLE session_gpu_revalidations (
  id uuid PRIMARY KEY,
  generation_session_id uuid NOT NULL,
  lane text NOT NULL CHECK (lane IN ('mage_image', 'echo_avatar')),
  inventory_receipt_id uuid NOT NULL,
  revalidated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_session_id, lane, inventory_receipt_id),
  FOREIGN KEY (generation_session_id, lane)
    REFERENCES session_gpu_bindings (generation_session_id, lane) ON DELETE RESTRICT,
  FOREIGN KEY (inventory_receipt_id, lane)
    REFERENCES gpu_inventory_receipts (id, lane) ON DELETE RESTRICT
);

CREATE TABLE global_queue_entries (
  id uuid PRIMARY KEY,
  generation_session_id uuid NOT NULL REFERENCES generation_sessions (id) ON DELETE RESTRICT,
  project_revision_id uuid NOT NULL REFERENCES project_revisions (id) ON DELETE RESTRICT,
  submitted_by_admission_id uuid NOT NULL REFERENCES app_admissions (id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position >= 0),
  state text NOT NULL CHECK (state IN ('ACTIVE', 'WAITING', 'TERMINAL', 'REMOVED')),
  inherited_gpu_pair_hash text NOT NULL CHECK (inherited_gpu_pair_hash ~ '^sha256:[0-9a-f]{64}$'),
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 1 AND 240),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  terminal_at timestamptz,
  removed_at timestamptz,
  UNIQUE (generation_session_id, project_revision_id),
  UNIQUE (generation_session_id, id),
  CHECK ((state = 'ACTIVE') = (activated_at IS NOT NULL AND terminal_at IS NULL AND removed_at IS NULL)),
  CHECK (state <> 'WAITING' OR (activated_at IS NULL AND terminal_at IS NULL AND removed_at IS NULL)),
  CHECK (state <> 'TERMINAL' OR (activated_at IS NOT NULL AND terminal_at IS NOT NULL AND removed_at IS NULL)),
  CHECK (state <> 'REMOVED' OR (activated_at IS NULL AND terminal_at IS NULL AND removed_at IS NOT NULL))
);

CREATE UNIQUE INDEX global_queue_entries_one_active_uq
  ON global_queue_entries (generation_session_id)
  WHERE state = 'ACTIVE';
CREATE UNIQUE INDEX global_queue_entries_live_position_uq
  ON global_queue_entries (generation_session_id, position)
  WHERE state IN ('ACTIVE', 'WAITING');

CREATE TABLE compute_run_plans (
  id uuid PRIMARY KEY,
  generation_session_id uuid NOT NULL,
  queue_entry_id uuid NOT NULL UNIQUE,
  contract_version text NOT NULL CHECK (contract_version = 'compute-run-plan/v2'),
  plan_sha256 text NOT NULL CHECK (plan_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('ACTIVE', 'TERMINAL')),
  created_at timestamptz NOT NULL DEFAULT now(),
  terminal_at timestamptz,
  UNIQUE (generation_session_id, id),
  FOREIGN KEY (generation_session_id, queue_entry_id)
    REFERENCES global_queue_entries (generation_session_id, id) ON DELETE RESTRICT,
  CHECK ((state = 'TERMINAL') = (terminal_at IS NOT NULL))
);

CREATE TABLE lane_demands (
  generation_session_id uuid NOT NULL,
  lane text NOT NULL CHECK (lane IN ('mage_image', 'echo_avatar')),
  demand text NOT NULL CHECK (demand IN ('ACTIVE', 'WAITING_WARM', 'ZERO')),
  active_queue_entry_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (generation_session_id, lane),
  FOREIGN KEY (generation_session_id, lane)
    REFERENCES session_gpu_bindings (generation_session_id, lane) ON DELETE RESTRICT,
  FOREIGN KEY (generation_session_id, active_queue_entry_id)
    REFERENCES global_queue_entries (generation_session_id, id) ON DELETE RESTRICT,
  CHECK ((demand = 'ACTIVE') = (active_queue_entry_id IS NOT NULL))
);

CREATE TABLE pod_lifecycle_attempts (
  id uuid PRIMARY KEY,
  generation_session_id uuid NOT NULL,
  lane text NOT NULL CHECK (lane IN ('mage_image', 'echo_avatar')),
  origin_queue_entry_id uuid NOT NULL,
  create_attempt_key text NOT NULL UNIQUE CHECK (length(create_attempt_key) BETWEEN 1 AND 240),
  expected_pod_tag text NOT NULL UNIQUE CHECK (length(expected_pod_tag) BETWEEN 1 AND 240),
  create_state text NOT NULL CHECK (create_state IN (
    'REQUESTED', 'ACKNOWLEDGED', 'ACK_UNKNOWN', 'AMBIGUOUS', 'RECONCILED_ABSENT'
  )),
  provider_pod_id text UNIQUE CHECK (provider_pod_id IS NULL OR length(provider_pod_id) BETWEEN 1 AND 160),
  model_volume_id uuid NOT NULL,
  manifest_id uuid NOT NULL,
  selected_gpu_sku text NOT NULL CHECK (length(selected_gpu_sku) BETWEEN 2 AND 120),
  actual_gpu_sku text CHECK (actual_gpu_sku IS NULL OR length(actual_gpu_sku) BETWEEN 2 AND 120),
  container_ready_at timestamptz,
  volume_verified_at timestamptz,
  warmup_passed_at timestamptz,
  model_ready_at timestamptz,
  delete_state text NOT NULL DEFAULT 'NOT_REQUESTED' CHECK (delete_state IN (
    'NOT_REQUESTED', 'REQUESTED', 'ACKNOWLEDGED', 'ACK_UNKNOWN', 'ABSENCE_VERIFIED'
  )),
  delete_requested_at timestamptz,
  delete_acknowledged_at timestamptz,
  absence_receipt_sha256 text CHECK (
    absence_receipt_sha256 IS NULL OR absence_receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  absence_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generation_session_id, id),
  FOREIGN KEY (generation_session_id, lane)
    REFERENCES session_gpu_bindings (generation_session_id, lane) ON DELETE RESTRICT,
  FOREIGN KEY (generation_session_id, origin_queue_entry_id)
    REFERENCES global_queue_entries (generation_session_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (manifest_id, model_volume_id, lane)
    REFERENCES model_volume_manifests (id, model_volume_id, lane) ON DELETE RESTRICT,
  CHECK (create_state <> 'ACKNOWLEDGED' OR provider_pod_id IS NOT NULL),
  CHECK (
    model_ready_at IS NULL OR (
      create_state = 'ACKNOWLEDGED'
      AND provider_pod_id IS NOT NULL
      AND container_ready_at IS NOT NULL
      AND volume_verified_at IS NOT NULL
      AND warmup_passed_at IS NOT NULL
      AND actual_gpu_sku IS NOT NULL
    )
  ),
  CHECK (
    create_state NOT IN ('ACK_UNKNOWN', 'AMBIGUOUS')
    OR (model_ready_at IS NULL AND delete_state <> 'ABSENCE_VERIFIED')
  ),
  CHECK ((delete_state = 'NOT_REQUESTED') = (delete_requested_at IS NULL)),
  CHECK (delete_state NOT IN ('ACKNOWLEDGED', 'ABSENCE_VERIFIED') OR delete_acknowledged_at IS NOT NULL),
  CHECK (
    (delete_state = 'ABSENCE_VERIFIED') =
    (absence_receipt_sha256 IS NOT NULL AND absence_verified_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX pod_lifecycle_attempts_one_unresolved_lane_uq
  ON pod_lifecycle_attempts (generation_session_id, lane)
  WHERE delete_state <> 'ABSENCE_VERIFIED' AND create_state <> 'RECONCILED_ABSENT';

CREATE TABLE durable_generation_outputs (
  id uuid PRIMARY KEY,
  generation_session_id uuid NOT NULL,
  queue_entry_id uuid NOT NULL,
  lane text NOT NULL CHECK (lane IN ('mage_image', 'echo_avatar', 'render')),
  pod_attempt_id uuid,
  artifact_id text NOT NULL CHECK (length(artifact_id) BETWEEN 1 AND 240),
  artifact_sha256 text NOT NULL CHECK (artifact_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  durability_state text NOT NULL CHECK (durability_state = 'VERIFIED'),
  verified_at timestamptz NOT NULL,
  UNIQUE (generation_session_id, artifact_id),
  FOREIGN KEY (generation_session_id, queue_entry_id)
    REFERENCES global_queue_entries (generation_session_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (generation_session_id, pod_attempt_id)
    REFERENCES pod_lifecycle_attempts (generation_session_id, id) ON DELETE RESTRICT,
  CHECK ((lane = 'render') = (pod_attempt_id IS NULL))
);

CREATE TABLE global_session_cost_events (
  id uuid PRIMARY KEY,
  generation_session_id uuid NOT NULL REFERENCES generation_sessions (id) ON DELETE RESTRICT,
  queue_entry_id uuid,
  lane text NOT NULL CHECK (lane IN ('mage_image', 'echo_avatar', 'cpu', 'session')),
  stage text NOT NULL CHECK (stage IN ('RESERVED', 'REPORTED', 'SETTLED')),
  sequence integer NOT NULL CHECK (sequence > 0),
  amount_micro_usd bigint NOT NULL CHECK (amount_micro_usd >= 0),
  hard_ceiling_micro_usd bigint NOT NULL CHECK (
    hard_ceiling_micro_usd BETWEEN 1 AND 2000000
    AND amount_micro_usd <= hard_ceiling_micro_usd
  ),
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 1 AND 240),
  occurred_at timestamptz NOT NULL,
  UNIQUE (generation_session_id, sequence),
  FOREIGN KEY (generation_session_id, queue_entry_id)
    REFERENCES global_queue_entries (generation_session_id, id) ON DELETE RESTRICT
);

CREATE TABLE global_session_events (
  id uuid PRIMARY KEY,
  generation_session_id uuid NOT NULL REFERENCES generation_sessions (id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  kind text NOT NULL CHECK (kind IN (
    'GENERATION_SESSION_OPENED', 'QUEUE_ENTRY_ADDED', 'QUEUE_ENTRY_MOVED',
    'QUEUE_ENTRY_REMOVED', 'QUEUE_ENTRY_ACTIVATED', 'GPU_SELECTION_REVALIDATED',
    'LANE_DEMAND_POSITIVE', 'LANE_DEMAND_ZERO', 'LANE_WARM_RETAINED',
    'POD_CREATE_REQUESTED', 'POD_CREATE_ACKNOWLEDGED', 'POD_CREATE_RECONCILING',
    'MODEL_VOLUME_VERIFIED', 'CONTAINER_READY', 'MODEL_READY', 'OUTPUT_DURABLE',
    'POD_DELETE_REQUESTED', 'POD_DELETE_ACKNOWLEDGED', 'POD_DELETE_RECONCILING',
    'POD_ABSENCE_VERIFIED', 'GENERATION_SESSION_CLOSING', 'GENERATION_SESSION_CLOSED'
  )),
  actor_admission_id uuid REFERENCES app_admissions (id) ON DELETE RESTRICT,
  queue_entry_id uuid,
  lane text CHECK (lane IS NULL OR lane IN ('mage_image', 'echo_avatar')),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL,
  UNIQUE (generation_session_id, sequence),
  FOREIGN KEY (generation_session_id, queue_entry_id)
    REFERENCES global_queue_entries (generation_session_id, id) ON DELETE RESTRICT
);

CREATE FUNCTION videoforge_vnext_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER app_admissions_append_only
  BEFORE UPDATE OR DELETE ON app_admissions
  FOR EACH ROW EXECUTE FUNCTION videoforge_vnext_append_only();
CREATE TRIGGER gpu_inventory_receipts_append_only
  BEFORE UPDATE OR DELETE ON gpu_inventory_receipts
  FOR EACH ROW EXECUTE FUNCTION videoforge_vnext_append_only();
CREATE TRIGGER model_volume_manifests_append_only
  BEFORE UPDATE OR DELETE ON model_volume_manifests
  FOR EACH ROW EXECUTE FUNCTION videoforge_vnext_append_only();
CREATE TRIGGER session_gpu_bindings_immutable
  BEFORE UPDATE OR DELETE ON session_gpu_bindings
  FOR EACH ROW EXECUTE FUNCTION videoforge_vnext_append_only();
CREATE TRIGGER session_gpu_revalidations_append_only
  BEFORE UPDATE OR DELETE ON session_gpu_revalidations
  FOR EACH ROW EXECUTE FUNCTION videoforge_vnext_append_only();
CREATE TRIGGER durable_generation_outputs_append_only
  BEFORE UPDATE OR DELETE ON durable_generation_outputs
  FOR EACH ROW EXECUTE FUNCTION videoforge_vnext_append_only();
CREATE TRIGGER global_session_cost_events_append_only
  BEFORE UPDATE OR DELETE ON global_session_cost_events
  FOR EACH ROW EXECUTE FUNCTION videoforge_vnext_append_only();
CREATE TRIGGER global_session_events_append_only
  BEFORE UPDATE OR DELETE ON global_session_events
  FOR EACH ROW EXECUTE FUNCTION videoforge_vnext_append_only();

CREATE FUNCTION videoforge_reject_model_volume_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'model volumes are retained; routine mutation/deletion is forbidden'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER model_volumes_retained
  BEFORE UPDATE OR DELETE ON model_volumes
  FOR EACH ROW EXECUTE FUNCTION videoforge_reject_model_volume_mutation();

CREATE FUNCTION videoforge_validate_session_gpu_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  receipt gpu_inventory_receipts%ROWTYPE;
BEGIN
  SELECT * INTO STRICT receipt FROM gpu_inventory_receipts WHERE id = NEW.inventory_receipt_id;
  IF receipt.offering_id <> NEW.offering_id
     OR receipt.gpu_sku <> NEW.selected_gpu_sku
     OR receipt.observed_rate_micro_usd_per_hour > NEW.rate_ceiling_micro_usd_per_hour
     OR NEW.selected_at < receipt.observed_at
     OR NEW.selected_at > receipt.expires_at THEN
    RAISE EXCEPTION 'session GPU binding must use one live exact offering below its rate ceiling'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER session_gpu_bindings_validate
  BEFORE INSERT ON session_gpu_bindings
  FOR EACH ROW EXECUTE FUNCTION videoforge_validate_session_gpu_binding();

CREATE FUNCTION videoforge_validate_session_revalidation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  receipt gpu_inventory_receipts%ROWTYPE;
  binding session_gpu_bindings%ROWTYPE;
BEGIN
  SELECT * INTO STRICT receipt FROM gpu_inventory_receipts WHERE id = NEW.inventory_receipt_id;
  SELECT * INTO STRICT binding
    FROM session_gpu_bindings
   WHERE generation_session_id = NEW.generation_session_id AND lane = NEW.lane;
  IF receipt.offering_id <> binding.offering_id
     OR receipt.gpu_sku <> binding.selected_gpu_sku
     OR receipt.observed_rate_micro_usd_per_hour > binding.rate_ceiling_micro_usd_per_hour
     OR NEW.revalidated_at < receipt.observed_at
     OR NEW.revalidated_at > receipt.expires_at THEN
    RAISE EXCEPTION 'GPU revalidation must prove the same live offering below the locked ceiling'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER session_gpu_revalidations_validate
  BEFORE INSERT ON session_gpu_revalidations
  FOR EACH ROW EXECUTE FUNCTION videoforge_validate_session_revalidation();

CREATE FUNCTION videoforge_validate_queue_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE session_hash text;
BEGIN
  SELECT gpu_pair_hash INTO STRICT session_hash FROM generation_sessions WHERE id = NEW.generation_session_id;
  IF NEW.inherited_gpu_pair_hash <> session_hash THEN
    RAISE EXCEPTION 'queue entry must inherit the immutable session GPU pair'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER global_queue_entries_validate
  BEFORE INSERT OR UPDATE ON global_queue_entries
  FOR EACH ROW EXECUTE FUNCTION videoforge_validate_queue_entry();

CREATE FUNCTION videoforge_guard_active_queue_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.state = 'ACTIVE' THEN
    RAISE EXCEPTION 'active queue entry cannot be removed' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.state = 'ACTIVE' THEN
    IF NEW.position <> OLD.position OR NEW.state NOT IN ('ACTIVE', 'TERMINAL') THEN
      RAISE EXCEPTION 'active queue entry cannot be reordered or removed' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER global_queue_entries_active_guard
  BEFORE UPDATE OR DELETE ON global_queue_entries
  FOR EACH ROW EXECUTE FUNCTION videoforge_guard_active_queue_mutation();

CREATE FUNCTION videoforge_validate_compute_run_plan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM global_queue_entries
     WHERE generation_session_id = NEW.generation_session_id
       AND id = NEW.queue_entry_id
       AND state = NEW.state
  ) THEN
    RAISE EXCEPTION 'compute run plan state must match its queue entry' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER compute_run_plans_active_only
  BEFORE INSERT ON compute_run_plans
  FOR EACH ROW EXECUTE FUNCTION videoforge_validate_compute_run_plan();

CREATE FUNCTION videoforge_validate_lane_demand() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.demand = 'ACTIVE' AND NOT EXISTS (
    SELECT 1 FROM global_queue_entries
     WHERE generation_session_id = NEW.generation_session_id
       AND id = NEW.active_queue_entry_id
       AND state = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'active lane demand requires the active queue entry' USING ERRCODE = '23514';
  END IF;
  IF NEW.demand = 'WAITING_WARM' THEN
    IF NOT EXISTS (
      SELECT 1 FROM global_queue_entries
       WHERE generation_session_id = NEW.generation_session_id AND state = 'WAITING'
    ) OR NOT EXISTS (
      SELECT 1 FROM pod_lifecycle_attempts
       WHERE generation_session_id = NEW.generation_session_id
         AND lane = NEW.lane
         AND model_ready_at IS NOT NULL
         AND delete_state = 'NOT_REQUESTED'
    ) THEN
      RAISE EXCEPTION 'waiting demand may retain only an existing model-ready Pod'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER lane_demands_validate
  BEFORE INSERT OR UPDATE ON lane_demands
  FOR EACH ROW EXECUTE FUNCTION videoforge_validate_lane_demand();

CREATE FUNCTION videoforge_validate_pod_attempt() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE binding session_gpu_bindings%ROWTYPE;
BEGIN
  SELECT * INTO STRICT binding
    FROM session_gpu_bindings
   WHERE generation_session_id = NEW.generation_session_id AND lane = NEW.lane;
  IF TG_OP = 'INSERT' AND NEW.create_state = 'REQUESTED' AND NOT EXISTS (
    SELECT 1 FROM global_queue_entries
     WHERE generation_session_id = NEW.generation_session_id
       AND id = NEW.origin_queue_entry_id
       AND state = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Pod create/recreate requires the active queue entry' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT'
     AND NEW.create_state <> 'REQUESTED'
     AND NEW.delete_state <> 'ABSENCE_VERIFIED' THEN
    RAISE EXCEPTION 'new Pod attempts must begin with a durable create request'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.model_volume_id <> binding.model_volume_id
     OR NEW.manifest_id <> binding.manifest_id
     OR NEW.selected_gpu_sku <> binding.selected_gpu_sku THEN
    RAISE EXCEPTION 'Pod attempt must use the immutable session GPU and isolated volume'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.actual_gpu_sku IS NOT NULL AND NEW.actual_gpu_sku <> binding.selected_gpu_sku THEN
    RAISE EXCEPTION 'actual Pod GPU must equal the session-selected GPU' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pod_lifecycle_attempts_validate
  BEFORE INSERT OR UPDATE ON pod_lifecycle_attempts
  FOR EACH ROW EXECUTE FUNCTION videoforge_validate_pod_attempt();

CREATE FUNCTION videoforge_validate_session_activation_close() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.singleton_key <> OLD.singleton_key
     OR NEW.gpu_pair_hash <> OLD.gpu_pair_hash
     OR NEW.selected_by_admission_id <> OLD.selected_by_admission_id
     OR NEW.opened_at <> OLD.opened_at THEN
    RAISE EXCEPTION 'global session identity and GPU pair are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
    (OLD.state = 'LOCKING' AND NEW.state = 'ACTIVE')
    OR (OLD.state = 'ACTIVE' AND NEW.state = 'DRAINING')
    OR (OLD.state = 'DRAINING' AND NEW.state = 'CLOSED')
  ) THEN
    RAISE EXCEPTION 'invalid global session lifecycle transition'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.state = 'ACTIVE' AND OLD.state = 'LOCKING' THEN
    IF (SELECT count(*) FROM session_gpu_bindings WHERE generation_session_id = NEW.id) <> 2
       OR (SELECT count(*) FROM global_queue_entries WHERE generation_session_id = NEW.id AND state = 'ACTIVE') <> 1
       OR (SELECT count(*) FROM compute_run_plans WHERE generation_session_id = NEW.id AND state = 'ACTIVE') <> 1
       OR (SELECT count(*) FROM lane_demands WHERE generation_session_id = NEW.id AND demand = 'ACTIVE') <> 2
       OR (SELECT count(*) FROM pod_lifecycle_attempts WHERE generation_session_id = NEW.id AND create_state = 'REQUESTED') <> 2 THEN
      RAISE EXCEPTION 'session activation requires complete pair, active run, lane demand, and create intents'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.state = 'CLOSED' THEN
    IF EXISTS (
      SELECT 1 FROM global_queue_entries
       WHERE generation_session_id = NEW.id AND state IN ('ACTIVE', 'WAITING')
    ) OR (SELECT count(*) FROM lane_demands WHERE generation_session_id = NEW.id AND demand = 'ZERO') <> 2
      OR (SELECT count(DISTINCT lane) FROM pod_lifecycle_attempts
           WHERE generation_session_id = NEW.id AND delete_state = 'ABSENCE_VERIFIED') <> 2
      OR EXISTS (
        SELECT 1 FROM pod_lifecycle_attempts
         WHERE generation_session_id = NEW.id
           AND create_state <> 'RECONCILED_ABSENT'
           AND delete_state <> 'ABSENCE_VERIFIED'
      )
      OR (SELECT count(*) FROM session_gpu_bindings binding
            JOIN model_volumes volume ON volume.id = binding.model_volume_id
           WHERE binding.generation_session_id = NEW.id AND volume.retention_state = 'RETAINED') <> 2 THEN
      RAISE EXCEPTION 'session close requires empty queue, zero demand, both Pods absent, and volumes retained'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER generation_sessions_transition_guard
  BEFORE UPDATE ON generation_sessions
  FOR EACH ROW EXECUTE FUNCTION videoforge_validate_session_activation_close();

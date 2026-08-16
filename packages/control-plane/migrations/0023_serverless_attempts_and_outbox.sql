-- V2-04 provider-free Serverless v3 authority, transport, outbox, assignment, and receipt records
-- (DEC_DISPATCH_001, DEC_RUNPOD_003, DEC_QUEUE_001, GATE_SERVERLESS_CONTRACT_001).
--
-- These tables describe transport only. They never authorize a Pod lifecycle, a model download, a
-- model-volume mutation, or an endpoint-wide queue purge. VideoForge accepts at most one canonical
-- durable output per attempt and never records a provider exactly-once execution or billing claim.

-- Immutable published endpoint deployment. One active record per lane; supersession appends a new
-- version rather than editing history.
CREATE TABLE serverless_endpoint_deployments (
  id uuid PRIMARY KEY,
  lane text NOT NULL CHECK (lane IN ('mage_image', 'soulx_avatar')),
  endpoint_profile_id text NOT NULL CHECK (length(endpoint_profile_id) BETWEEN 1 AND 160),
  endpoint_id_sha256 text NOT NULL CHECK (endpoint_id_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  endpoint_config_sha256 text NOT NULL CHECK (endpoint_config_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  worker_image_digest text NOT NULL CHECK (worker_image_digest ~ '^sha256:[0-9a-f]{64}$'),
  model_manifest_sha256 text NOT NULL CHECK (model_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  region text NOT NULL CHECK (region = 'EU-RO-1'),
  volume_id_sha256 text NOT NULL CHECK (volume_id_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  volume_manifest_sha256 text NOT NULL CHECK (volume_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  volume_mount text NOT NULL CHECK (volume_mount = '/runpod-volume'),
  volume_size_gb integer NOT NULL CHECK (volume_size_gb = 50),
  gpu_allowlist text[] NOT NULL CHECK (gpu_allowlist = ARRAY['NVIDIA GeForce RTX 4090']::text[]),
  gpu_count_per_worker smallint NOT NULL CHECK (gpu_count_per_worker = 1),
  -- workersMin is modelled as zero retained Active workers; the ceiling counts Active plus Flex.
  worker_count_min smallint NOT NULL CHECK (worker_count_min = 0),
  worker_count_max smallint NOT NULL CHECK (worker_count_max = 2),
  worker_ceiling_scope text NOT NULL CHECK (worker_ceiling_scope = 'ACTIVE_PLUS_FLEX'),
  retained_active_workers smallint NOT NULL CHECK (retained_active_workers = 0),
  scaler_type text NOT NULL CHECK (scaler_type = 'REQUEST_COUNT'),
  scaler_value smallint NOT NULL CHECK (scaler_value = 1),
  handler_concurrency smallint NOT NULL CHECK (handler_concurrency = 1),
  idle_timeout_seconds integer NOT NULL CHECK (idle_timeout_seconds BETWEEN 1 AND 3600),
  init_timeout_seconds integer NOT NULL CHECK (init_timeout_seconds BETWEEN 1 AND 3600),
  execution_timeout_seconds integer NOT NULL CHECK (execution_timeout_seconds BETWEEN 1 AND 7200),
  -- Provider TTL covers provider queue time, cold start, handler execution, and output upload.
  request_ttl_seconds integer NOT NULL CHECK (request_ttl_seconds BETWEEN 1 AND 10800),
  request_ttl_scope text NOT NULL
    CHECK (request_ttl_scope = 'PROVIDER_QUEUE_PLUS_EXECUTION_PLUS_OUTPUT_UPLOAD'),
  -- Control-plane reconciliation is a separate bounded deadline inside the async result window.
  reconciliation_deadline_seconds integer NOT NULL
    CHECK (reconciliation_deadline_seconds BETWEEN 1 AND 1500),
  provider_result_window_seconds integer NOT NULL CHECK (provider_result_window_seconds = 1800),
  polling_interval_seconds integer NOT NULL CHECK (polling_interval_seconds BETWEEN 1 AND 60),
  max_replacement_attempts smallint NOT NULL CHECK (max_replacement_attempts BETWEEN 0 AND 2),
  blind_resubmit_permitted boolean NOT NULL CHECK (NOT blind_resubmit_permitted),
  timeout_evidence jsonb NOT NULL CHECK (jsonb_typeof(timeout_evidence) = 'object'),
  deployment_version integer NOT NULL CHECK (deployment_version > 0),
  is_active boolean NOT NULL,
  record_sha256 text NOT NULL CHECK (record_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (lane, deployment_version),
  UNIQUE (id, lane),
  CHECK (reconciliation_deadline_seconds < provider_result_window_seconds),
  CHECK (timeout_evidence ->> 'provider_defaults_accepted' = 'false')
);

CREATE UNIQUE INDEX serverless_endpoint_deployments_active_lane_uq
  ON serverless_endpoint_deployments (lane) WHERE is_active;

CREATE TABLE serverless_attempts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  generation_request_id uuid NOT NULL,
  task_id uuid NOT NULL,
  deployment_id uuid NOT NULL,
  lane text NOT NULL CHECK (lane IN ('mage_image', 'soulx_avatar')),
  attempt_ordinal integer NOT NULL CHECK (attempt_ordinal BETWEEN 1 AND 3),
  state text NOT NULL CHECK (state IN (
    'PLANNED', 'OUTBOXED', 'DISPATCHING', 'ASSIGNED', 'IN_QUEUE', 'IN_PROGRESS', 'UPLOADING',
    'RECONCILING', 'SUCCEEDED', 'RETRYABLE_FAILED', 'PERMANENT_FAILED', 'CANCELLING', 'CANCELLED'
  )),
  dispatch_token_sha256 text NOT NULL CHECK (dispatch_token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  items_manifest_sha256 text NOT NULL CHECK (items_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  item_count integer NOT NULL CHECK (item_count BETWEEN 1 AND 4096),
  input_manifest_sha256 text NOT NULL CHECK (input_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  output_prefix text NOT NULL CHECK (output_prefix ~ '^tenant/[A-Za-z0-9._:/-]+$'),
  deadline_at timestamptz NOT NULL,
  reconciliation_deadline_at timestamptz NOT NULL,
  submitted_at timestamptz,
  ttl_expires_at timestamptz,
  terminal_at timestamptz,
  possible_duplicate_executions smallint NOT NULL DEFAULT 0
    CHECK (possible_duplicate_executions BETWEEN 0 AND 8),
  possible_duplicate_cost_usd numeric(12, 6) NOT NULL DEFAULT 0
    CHECK (possible_duplicate_cost_usd >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (dispatch_token_sha256),
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_id)
    REFERENCES projects (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_revision_id)
    REFERENCES project_revisions (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, generation_request_id)
    REFERENCES generation_requests (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (deployment_id, lane)
    REFERENCES serverless_endpoint_deployments (id, lane) ON DELETE RESTRICT,
  CHECK ((state IN ('SUCCEEDED', 'PERMANENT_FAILED', 'CANCELLED')) = (terminal_at IS NOT NULL)),
  CHECK (ttl_expires_at IS NULL OR submitted_at IS NOT NULL),
  CHECK (reconciliation_deadline_at <= deadline_at)
);

-- Exactly one live attempt per admitted video and lane. A classified replacement can only be
-- inserted after the prior attempt is terminal.
CREATE UNIQUE INDEX serverless_attempts_one_live_lane_uq
  ON serverless_attempts (generation_request_id, lane)
  WHERE state NOT IN ('SUCCEEDED', 'PERMANENT_FAILED', 'CANCELLED');
CREATE INDEX serverless_attempts_reconciliation_idx
  ON serverless_attempts (state, reconciliation_deadline_at, id);

-- Immutable predispatch authority. It is committed before any transport call exists.
CREATE TABLE serverless_predispatch_authorities (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  dispatch_token_sha256 text NOT NULL CHECK (dispatch_token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  checkpoint_id text NOT NULL CHECK (checkpoint_id ~ '^V2-(0[0-9]|1[0-3])$'),
  authority_mode text NOT NULL
    CHECK (authority_mode IN ('provider_free_fixture', 'read_only', 'paid')),
  non_transferable boolean NOT NULL CHECK (non_transferable),
  allowed_operations text[] NOT NULL CHECK (
    cardinality(allowed_operations) > 0
    AND allowed_operations
        <@ ARRAY['serverless_run', 'serverless_status', 'serverless_cancel']::text[]
  ),
  deployment_id uuid NOT NULL,
  endpoint_id_sha256 text NOT NULL CHECK (endpoint_id_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  endpoint_config_sha256 text NOT NULL CHECK (endpoint_config_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  worker_image_digest text NOT NULL CHECK (worker_image_digest ~ '^sha256:[0-9a-f]{64}$'),
  model_manifest_sha256 text NOT NULL CHECK (model_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  volume_id_sha256 text NOT NULL CHECK (volume_id_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  volume_manifest_sha256 text NOT NULL CHECK (volume_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  region text NOT NULL CHECK (region = 'EU-RO-1'),
  gpu_allowlist text[] NOT NULL CHECK (gpu_allowlist = ARRAY['NVIDIA GeForce RTX 4090']::text[]),
  items_manifest_sha256 text NOT NULL CHECK (items_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  input_manifest_sha256 text NOT NULL CHECK (input_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  request_body_sha256 text NOT NULL CHECK (request_body_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  envelope_sha256 text NOT NULL CHECK (envelope_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  deadline_at timestamptz NOT NULL,
  reconciliation_deadline_at timestamptz NOT NULL,
  request_ttl_seconds integer NOT NULL CHECK (request_ttl_seconds BETWEEN 1 AND 10800),
  execution_timeout_seconds integer NOT NULL CHECK (execution_timeout_seconds BETWEEN 1 AND 7200),
  init_timeout_seconds integer NOT NULL CHECK (init_timeout_seconds BETWEEN 1 AND 3600),
  spend_ceiling_usd numeric(12, 6) NOT NULL CHECK (spend_ceiling_usd > 0 AND spend_ceiling_usd <= 2),
  reservation_usd numeric(12, 6) NOT NULL CHECK (reservation_usd >= 0),
  rate_source text NOT NULL CHECK (length(rate_source) BETWEEN 1 AND 400),
  rate_checked_at timestamptz NOT NULL,
  fixed_retained_volume_usd_excluded boolean NOT NULL CHECK (fixed_retained_volume_usd_excluded),
  authority_sha256 text NOT NULL CHECK (authority_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  committed_at timestamptz NOT NULL,
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (dispatch_token_sha256),
  UNIQUE (authority_sha256),
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, attempt_id)
    REFERENCES serverless_attempts (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (deployment_id)
    REFERENCES serverless_endpoint_deployments (id) ON DELETE RESTRICT,
  CHECK (reservation_usd <= spend_ceiling_usd)
);

CREATE TABLE serverless_dispatch_outbox (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  dispatch_token_sha256 text NOT NULL CHECK (dispatch_token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  authority_sha256 text NOT NULL CHECK (authority_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  request_body_sha256 text NOT NULL CHECK (request_body_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN (
    'READY_TO_DISPATCH', 'LEASED', 'SENT', 'DISPATCH_ACK_UNKNOWN', 'ASSIGNED', 'TERMINAL',
    'DEAD_LETTER'
  )),
  -- One logical attempt is sent at most once. A replacement requires a new token, never a retry
  -- of this row, because the provider documents no client idempotency key.
  send_attempt_count smallint NOT NULL DEFAULT 0 CHECK (send_attempt_count BETWEEN 0 AND 1),
  max_send_attempts smallint NOT NULL DEFAULT 1 CHECK (max_send_attempts = 1),
  lease_id uuid,
  lease_holder_sha256 text CHECK (lease_holder_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  leased_at timestamptz,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (dispatch_token_sha256),
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, attempt_id)
    REFERENCES serverless_attempts (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (authority_sha256)
    REFERENCES serverless_predispatch_authorities (authority_sha256) ON DELETE RESTRICT,
  CHECK ((lease_id IS NULL) = (lease_holder_sha256 IS NULL)),
  CHECK ((lease_id IS NULL) = (leased_at IS NULL)),
  CHECK ((lease_id IS NULL) = (lease_expires_at IS NULL)),
  CHECK (lease_expires_at IS NULL OR lease_expires_at > leased_at),
  CHECK (state <> 'READY_TO_DISPATCH' OR send_attempt_count = 0),
  CHECK (state NOT IN ('SENT', 'DISPATCH_ACK_UNKNOWN', 'ASSIGNED') OR send_attempt_count = 1)
);

CREATE INDEX serverless_dispatch_outbox_ready_idx
  ON serverless_dispatch_outbox (state, created_at, id);

-- Post-assignment authority. Only the current assignment may advance status or accept output.
CREATE TABLE serverless_provider_assignments (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  dispatch_token_sha256 text NOT NULL CHECK (dispatch_token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  provider_job_id text NOT NULL CHECK (provider_job_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
  provider_job_id_sha256 text NOT NULL CHECK (provider_job_id_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  -- A webhook is advisory and can never mint its own assignment.
  assignment_source text NOT NULL
    CHECK (assignment_source IN ('RUN_RESPONSE', 'BOUNDED_RECONCILIATION')),
  worker_id text CHECK (worker_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
  assigned_at timestamptz NOT NULL,
  is_current boolean NOT NULL,
  superseded_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (provider_job_id),
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, attempt_id)
    REFERENCES serverless_attempts (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (dispatch_token_sha256)
    REFERENCES serverless_dispatch_outbox (dispatch_token_sha256) ON DELETE RESTRICT,
  CHECK (is_current = (superseded_at IS NULL))
);

CREATE UNIQUE INDEX serverless_provider_assignments_one_current_uq
  ON serverless_provider_assignments (attempt_id) WHERE is_current;

CREATE TABLE serverless_progress_events (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  assignment_id uuid,
  sequence bigint NOT NULL CHECK (sequence > 0),
  advisory_source text NOT NULL CHECK (advisory_source IN ('POLL_STATUS', 'WEBHOOK')),
  authoritative boolean NOT NULL,
  provider_status text NOT NULL CHECK (provider_status IN (
    'IN_QUEUE', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'
  )),
  attempt_state text NOT NULL CHECK (attempt_state IN (
    'ASSIGNED', 'IN_QUEUE', 'IN_PROGRESS', 'UPLOADING', 'RECONCILING', 'SUCCEEDED',
    'RETRYABLE_FAILED', 'PERMANENT_FAILED', 'CANCELLING', 'CANCELLED'
  )),
  items_completed integer NOT NULL CHECK (items_completed >= 0),
  items_total integer NOT NULL CHECK (items_total > 0),
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (attempt_id, sequence),
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, attempt_id)
    REFERENCES serverless_attempts (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, assignment_id)
    REFERENCES serverless_provider_assignments (account_id, workspace_id, id) ON DELETE RESTRICT,
  -- Polled status is authoritative; a webhook is only an acceleration hint.
  CHECK ((advisory_source = 'POLL_STATUS') = authoritative),
  CHECK (items_completed <= items_total)
);

CREATE TABLE serverless_provenance_receipts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  receipt_nonce bigint NOT NULL CHECK (receipt_nonce > 0),
  -- Application-signed VideoForge provenance. This is not a provider hardware attestation.
  attestation_scope text NOT NULL CHECK (
    attestation_scope = 'VIDEOFORGE_APPLICATION_SIGNED_FACTS_NOT_PROVIDER_HARDWARE_ATTESTATION'
  ),
  worker_id text CHECK (worker_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
  provider_job_id text CHECK (provider_job_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
  gpu_name text NOT NULL CHECK (length(gpu_name) BETWEEN 1 AND 200),
  gpu_uuid_sha256 text CHECK (gpu_uuid_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  driver_version text NOT NULL CHECK (length(driver_version) BETWEEN 1 AND 64),
  cuda_version text NOT NULL CHECK (length(cuda_version) BETWEEN 1 AND 64),
  intended_region text NOT NULL CHECK (intended_region = 'EU-RO-1'),
  intended_volume_id_sha256 text NOT NULL
    CHECK (intended_volume_id_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  manifest_sha256_before text NOT NULL CHECK (manifest_sha256_before ~ '^sha256:[0-9a-f]{64}$'),
  manifest_sha256_after text NOT NULL CHECK (manifest_sha256_after ~ '^sha256:[0-9a-f]{64}$'),
  mutation_detected boolean NOT NULL CHECK (NOT mutation_detected),
  cross_mount_detected boolean NOT NULL CHECK (NOT cross_mount_detected),
  model_ready boolean NOT NULL CHECK (model_ready),
  timings jsonb NOT NULL CHECK (jsonb_typeof(timings) = 'object'),
  -- Item facts only. The signed receipt bytes stay in private R2; the row keeps their hash.
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  receipt_sha256 text NOT NULL CHECK (receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  signature_key_id text NOT NULL CHECK (length(signature_key_id) BETWEEN 1 AND 160),
  signature_value text NOT NULL CHECK (signature_value ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL,
  accepted_at timestamptz NOT NULL,
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (attempt_id, receipt_nonce),
  UNIQUE (receipt_sha256),
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, attempt_id)
    REFERENCES serverless_attempts (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, assignment_id)
    REFERENCES serverless_provider_assignments (account_id, workspace_id, id) ON DELETE RESTRICT,
  CHECK (manifest_sha256_before = manifest_sha256_after)
);

CREATE TABLE serverless_output_receipts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  lane text NOT NULL CHECK (lane IN ('mage_image', 'soulx_avatar')),
  acceptance text NOT NULL CHECK (acceptance IN (
    'ACCEPTED_CANONICAL', 'QUARANTINED_DUPLICATE', 'QUARANTINED_FOREIGN',
    'QUARANTINED_SUPERSEDED', 'QUARANTINED_UNBOUND'
  )),
  -- A signed private-R2 receipt is durable truth; a provider status or webhook is not.
  durable_truth_source text NOT NULL CHECK (durable_truth_source = 'SIGNED_PRIVATE_R2_RECEIPT'),
  artifacts jsonb NOT NULL CHECK (jsonb_typeof(artifacts) = 'array'),
  provenance_receipt_sha256 text NOT NULL
    CHECK (provenance_receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  artifact_commit_receipt_sha256 text NOT NULL
    CHECK (artifact_commit_receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  quarantine_reason text CHECK (length(quarantine_reason) BETWEEN 1 AND 400),
  accepted_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (account_id, workspace_id, id),
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, attempt_id)
    REFERENCES serverless_attempts (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, assignment_id)
    REFERENCES serverless_provider_assignments (account_id, workspace_id, id) ON DELETE RESTRICT,
  CHECK ((acceptance = 'ACCEPTED_CANONICAL') = (quarantine_reason IS NULL))
);

-- At most one canonical durable output per attempt. Duplicate, foreign, superseded, and unbound
-- deliveries are recorded as quarantine rows instead of being promoted.
CREATE UNIQUE INDEX serverless_output_receipts_one_canonical_uq
  ON serverless_output_receipts (attempt_id) WHERE acceptance = 'ACCEPTED_CANONICAL';

CREATE FUNCTION public.videoforge_validate_serverless_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'READY_TO_DISPATCH' THEN
      RAISE EXCEPTION 'a dispatch outbox row must begin READY_TO_DISPATCH' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.attempt_id <> OLD.attempt_id
     OR NEW.dispatch_token_sha256 <> OLD.dispatch_token_sha256
     OR NEW.authority_sha256 <> OLD.authority_sha256
     OR NEW.request_body_sha256 <> OLD.request_body_sha256
     OR NEW.account_id <> OLD.account_id OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'dispatch outbox identity or version changed' USING ERRCODE = '23514';
  END IF;

  IF NEW.send_attempt_count < OLD.send_attempt_count THEN
    RAISE EXCEPTION 'dispatch send attempts cannot decrease' USING ERRCODE = '23514';
  END IF;

  IF OLD.state IN ('TERMINAL', 'DEAD_LETTER') THEN
    RAISE EXCEPTION 'dispatch outbox row is terminal' USING ERRCODE = '55000';
  END IF;

  -- An unknown acknowledgement is never proof that no job exists, so it can only move forward
  -- through reconciliation. It can never return to a sendable state.
  IF OLD.state = 'DISPATCH_ACK_UNKNOWN'
     AND NEW.state NOT IN ('DISPATCH_ACK_UNKNOWN', 'ASSIGNED', 'TERMINAL', 'DEAD_LETTER') THEN
    RAISE EXCEPTION 'an unknown acknowledgement cannot be blindly resubmitted' USING ERRCODE = '23514';
  END IF;

  IF OLD.state IN ('SENT', 'ASSIGNED') AND NEW.state = 'READY_TO_DISPATCH' THEN
    RAISE EXCEPTION 'a sent dispatch cannot return to READY_TO_DISPATCH' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER serverless_dispatch_outbox_validate
  BEFORE INSERT OR UPDATE ON serverless_dispatch_outbox
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_validate_serverless_outbox();

CREATE FUNCTION public.videoforge_validate_serverless_assignment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT NEW.is_current THEN
      RAISE EXCEPTION 'a provider assignment must begin current' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.attempt_id <> OLD.attempt_id
     OR NEW.dispatch_token_sha256 <> OLD.dispatch_token_sha256
     OR NEW.provider_job_id <> OLD.provider_job_id
     OR NEW.assignment_source <> OLD.assignment_source
     OR NEW.assigned_at <> OLD.assigned_at
     OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'provider assignment identity or version changed' USING ERRCODE = '23514';
  END IF;
  IF OLD.is_current AND NEW.is_current AND NEW.worker_id IS DISTINCT FROM OLD.worker_id
     AND OLD.worker_id IS NOT NULL THEN
    RAISE EXCEPTION 'observed worker identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT OLD.is_current THEN
    RAISE EXCEPTION 'a superseded provider assignment is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER serverless_provider_assignments_validate
  BEFORE INSERT OR UPDATE ON serverless_provider_assignments
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_validate_serverless_assignment();

-- A published deployment is immutable except for retirement. Superseding an endpoint appends a new
-- version; it never edits the record a committed authority already bound.
CREATE FUNCTION public.videoforge_validate_serverless_deployment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_active = NEW.is_active OR NEW.is_active THEN
    RAISE EXCEPTION 'a published endpoint deployment can only be retired' USING ERRCODE = '55000';
  END IF;
  IF to_jsonb(NEW) - 'is_active' <> to_jsonb(OLD) - 'is_active' THEN
    RAISE EXCEPTION 'a published endpoint deployment is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER serverless_endpoint_deployments_retire_only
  BEFORE UPDATE ON serverless_endpoint_deployments
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_validate_serverless_deployment();
CREATE TRIGGER serverless_endpoint_deployments_append_only
  BEFORE DELETE ON serverless_endpoint_deployments
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER serverless_predispatch_authorities_append_only
  BEFORE UPDATE OR DELETE ON serverless_predispatch_authorities
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER serverless_progress_events_append_only
  BEFORE UPDATE OR DELETE ON serverless_progress_events
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER serverless_provenance_receipts_append_only
  BEFORE UPDATE OR DELETE ON serverless_provenance_receipts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER serverless_output_receipts_append_only
  BEFORE UPDATE OR DELETE ON serverless_output_receipts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();

CREATE TRIGGER serverless_attempts_tenant_account_derived
  BEFORE INSERT OR UPDATE ON serverless_attempts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_revision_account();
CREATE TRIGGER serverless_predispatch_authorities_tenant_account_derived
  BEFORE INSERT OR UPDATE ON serverless_predispatch_authorities
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_revision_account();
CREATE TRIGGER serverless_dispatch_outbox_tenant_account_derived
  BEFORE INSERT OR UPDATE ON serverless_dispatch_outbox
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_revision_account();
CREATE TRIGGER serverless_provider_assignments_tenant_account_derived
  BEFORE INSERT OR UPDATE ON serverless_provider_assignments
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_revision_account();
CREATE TRIGGER serverless_progress_events_tenant_account_derived
  BEFORE INSERT OR UPDATE ON serverless_progress_events
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_revision_account();
CREATE TRIGGER serverless_provenance_receipts_tenant_account_derived
  BEFORE INSERT OR UPDATE ON serverless_provenance_receipts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_revision_account();
CREATE TRIGGER serverless_output_receipts_tenant_account_derived
  BEFORE INSERT OR UPDATE ON serverless_output_receipts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_revision_account();

CREATE TRIGGER serverless_attempts_tenant_write_guard
  BEFORE INSERT OR UPDATE ON serverless_attempts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER serverless_predispatch_authorities_tenant_write_guard
  BEFORE INSERT OR UPDATE ON serverless_predispatch_authorities
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER serverless_dispatch_outbox_tenant_write_guard
  BEFORE INSERT OR UPDATE ON serverless_dispatch_outbox
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER serverless_provider_assignments_tenant_write_guard
  BEFORE INSERT OR UPDATE ON serverless_provider_assignments
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER serverless_progress_events_tenant_write_guard
  BEFORE INSERT OR UPDATE ON serverless_progress_events
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER serverless_provenance_receipts_tenant_write_guard
  BEFORE INSERT OR UPDATE ON serverless_provenance_receipts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER serverless_output_receipts_tenant_write_guard
  BEFORE INSERT OR UPDATE ON serverless_output_receipts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();

DO $tenant_rls$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'serverless_attempts', 'serverless_predispatch_authorities', 'serverless_dispatch_outbox',
    'serverless_provider_assignments', 'serverless_progress_events',
    'serverless_provenance_receipts', 'serverless_output_receipts'
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

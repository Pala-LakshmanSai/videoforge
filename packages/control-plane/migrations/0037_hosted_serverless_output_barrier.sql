-- V2-09 ordinary-tenant hosted Serverless output callback replay barrier.
-- Provider-free: this stores only durable hashes and lineage already committed in PostgreSQL.

CREATE TABLE hosted_serverless_output_barrier_completions (
  attempt_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  lane text NOT NULL CHECK (lane IN ('mage_image', 'soulx_avatar')),
  assignment_id uuid NOT NULL,
  provider_job_id text NOT NULL CHECK (provider_job_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
  dispatch_token_sha256 text NOT NULL CHECK (dispatch_token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  deployment_id uuid NOT NULL,
  endpoint_id_sha256 text NOT NULL CHECK (endpoint_id_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  endpoint_config_sha256 text NOT NULL CHECK (endpoint_config_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  worker_image_digest text NOT NULL CHECK (worker_image_digest ~ '^sha256:[0-9a-f]{64}$'),
  model_manifest_sha256 text NOT NULL CHECK (model_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  volume_id_sha256 text NOT NULL CHECK (volume_id_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  volume_manifest_sha256 text NOT NULL CHECK (volume_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  region text NOT NULL CHECK (region = 'EU-RO-1'),
  gpu_allowlist text[] NOT NULL
    CHECK (gpu_allowlist = ARRAY['NVIDIA GeForce RTX 4090']::text[]),
  expected_objects jsonb NOT NULL CHECK (
    jsonb_typeof(expected_objects) = 'array'
    AND jsonb_array_length(expected_objects) BETWEEN 1 AND 4096
  ),
  binding_components jsonb NOT NULL CHECK (jsonb_typeof(binding_components) = 'object'),
  binding_sha256 text NOT NULL CHECK (binding_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  callback_sha256 text NOT NULL CHECK (callback_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  provenance_receipt_sha256 text NOT NULL
    CHECK (provenance_receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  artifact_commit_receipt_sha256s jsonb NOT NULL CHECK (
    jsonb_typeof(artifact_commit_receipt_sha256s) = 'array'
    AND jsonb_array_length(artifact_commit_receipt_sha256s) BETWEEN 1 AND 4096
  ),
  completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hosted_output_barrier_tenant_attempt_uq
    UNIQUE (account_id, workspace_id, attempt_id),
  CONSTRAINT hosted_output_barrier_callback_uq UNIQUE (callback_sha256),
  CONSTRAINT hosted_output_barrier_provenance_uq UNIQUE (provenance_receipt_sha256),
  CONSTRAINT hosted_serverless_output_barrier_workspace_fk
    FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  CONSTRAINT hosted_serverless_output_barrier_project_fk
    FOREIGN KEY (account_id, workspace_id, project_id)
    REFERENCES projects (account_id, workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT hosted_serverless_output_barrier_revision_fk
    FOREIGN KEY (account_id, workspace_id, project_revision_id)
    REFERENCES project_revisions (account_id, workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT hosted_serverless_output_barrier_attempt_fk
    FOREIGN KEY (account_id, workspace_id, attempt_id)
    REFERENCES serverless_attempts (account_id, workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT hosted_serverless_output_barrier_assignment_fk
    FOREIGN KEY (account_id, workspace_id, assignment_id)
    REFERENCES serverless_provider_assignments (account_id, workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT hosted_serverless_output_barrier_deployment_fk
    FOREIGN KEY (deployment_id, lane)
    REFERENCES serverless_endpoint_deployments (id, lane) ON DELETE RESTRICT,
  CONSTRAINT hosted_serverless_output_barrier_provenance_fk
    FOREIGN KEY (provenance_receipt_sha256)
    REFERENCES serverless_provenance_receipts (receipt_sha256) ON DELETE RESTRICT
);

CREATE INDEX hosted_serverless_output_barrier_tenant_completed_idx
  ON hosted_serverless_output_barrier_completions
  (account_id, workspace_id, completed_at, attempt_id);

CREATE FUNCTION public.videoforge_derive_hosted_output_barrier_completion() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  bound_attempt serverless_attempts%ROWTYPE;
  bound_assignment serverless_provider_assignments%ROWTYPE;
  bound_deployment serverless_endpoint_deployments%ROWTYPE;
  bound_provenance serverless_provenance_receipts%ROWTYPE;
  canonical_objects jsonb;
  derived_binding_components jsonb;
  canonical_count integer;
  distinct_hash_count integer;
BEGIN
  SELECT * INTO bound_attempt
    FROM serverless_attempts
   WHERE id = NEW.attempt_id
   FOR UPDATE;
  IF bound_attempt.id IS NULL
     OR bound_attempt.account_id <> NEW.account_id
     OR bound_attempt.workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'hosted output completion is foreign to the bound attempt'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO bound_assignment
    FROM serverless_provider_assignments
   WHERE attempt_id = bound_attempt.id AND is_current
   FOR SHARE;
  SELECT * INTO bound_deployment
    FROM serverless_endpoint_deployments
   WHERE id = bound_attempt.deployment_id AND lane = bound_attempt.lane
   FOR SHARE;
  SELECT * INTO bound_provenance
    FROM serverless_provenance_receipts
   WHERE account_id = bound_attempt.account_id
     AND workspace_id = bound_attempt.workspace_id
     AND attempt_id = bound_attempt.id
     AND assignment_id = bound_assignment.id
     AND receipt_sha256 = NEW.provenance_receipt_sha256
   FOR SHARE;
  IF bound_assignment.id IS NULL OR bound_deployment.id IS NULL OR bound_provenance.id IS NULL THEN
    RAISE EXCEPTION 'hosted output completion lacks exact assignment, deployment, or provenance'
      USING ERRCODE = '23514';
  END IF;
  IF bound_assignment.dispatch_token_sha256 <> bound_attempt.dispatch_token_sha256
     OR bound_assignment.project_revision_id <> bound_attempt.project_revision_id
     OR bound_provenance.project_revision_id <> bound_attempt.project_revision_id
     OR bound_provenance.provider_job_id IS DISTINCT FROM bound_assignment.provider_job_id
     OR NOT (bound_provenance.gpu_name = ANY(bound_deployment.gpu_allowlist))
     OR bound_provenance.intended_region <> bound_deployment.region
     OR bound_provenance.intended_volume_id_sha256 <> bound_deployment.volume_id_sha256
     OR bound_provenance.manifest_sha256_before <> bound_deployment.volume_manifest_sha256
     OR bound_provenance.manifest_sha256_after <> bound_deployment.volume_manifest_sha256
     OR bound_provenance.mutation_detected OR bound_provenance.cross_mount_detected THEN
    RAISE EXCEPTION 'hosted output provenance differs from current assignment or deployment'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(DISTINCT value), count(*)
    INTO distinct_hash_count, canonical_count
    FROM jsonb_array_elements_text(NEW.artifact_commit_receipt_sha256s);
  IF canonical_count <> bound_attempt.item_count OR distinct_hash_count <> canonical_count
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(NEW.artifact_commit_receipt_sha256s) AS value
        WHERE value !~ '^sha256:[0-9a-f]{64}$'
     ) THEN
    RAISE EXCEPTION 'hosted output completion commit receipt set is not exact'
      USING ERRCODE = '23514';
  END IF;

  SELECT jsonb_agg(
           jsonb_build_object(
             'item_id', reservation.artifact_id,
             'object_key', receipt.object_key,
             'content_type', receipt.content_type,
             'content_length', receipt.content_length,
             'checksum_sha256', receipt.checksum_sha256
           ) ORDER BY reservation.artifact_id COLLATE "C"
         ), count(*)
    INTO canonical_objects, canonical_count
    FROM artifact_receipts AS receipt
    JOIN artifact_reservations AS reservation
      ON reservation.account_id = receipt.account_id
     AND reservation.workspace_id = receipt.workspace_id
     AND reservation.id = receipt.reservation_id
   WHERE receipt.account_id = bound_attempt.account_id
     AND receipt.workspace_id = bound_attempt.workspace_id
     AND receipt.deleted_at IS NULL
     AND receipt.receipt_sha256 IN (
       SELECT jsonb_array_elements_text(NEW.artifact_commit_receipt_sha256s)
     )
     AND reservation.project_id = bound_attempt.project_id
     AND reservation.project_revision_id = bound_attempt.project_revision_id
     AND reservation.job_id = bound_attempt.id::text
     AND reservation.lane = CASE bound_attempt.lane
       WHEN 'mage_image' THEN 'MAGE_IMAGE'
       WHEN 'soulx_avatar' THEN 'SOULX_AVATAR'
     END
     AND reservation.state = 'COMMITTED'
     AND reservation.object_key = bound_attempt.output_prefix || '/artifact/' || reservation.artifact_id
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(bound_provenance.items) AS signed_item
        WHERE signed_item->>'item_id' = reservation.artifact_id
          AND signed_item->>'state' = 'SUCCEEDED'
          AND signed_item->>'output_object_key' = receipt.object_key
          AND signed_item->>'output_sha256' = receipt.checksum_sha256
          AND (signed_item->>'output_bytes')::bigint = receipt.content_length
          AND signed_item->'probe' = receipt.probe
     );
  IF canonical_count <> bound_attempt.item_count
     OR jsonb_array_length(bound_provenance.items) <> bound_attempt.item_count THEN
    RAISE EXCEPTION 'hosted output completion object binding is incomplete or foreign'
      USING ERRCODE = '23514';
  END IF;

  NEW.project_id := bound_attempt.project_id;
  NEW.project_revision_id := bound_attempt.project_revision_id;
  NEW.lane := bound_attempt.lane;
  NEW.assignment_id := bound_assignment.id;
  NEW.provider_job_id := bound_assignment.provider_job_id;
  NEW.dispatch_token_sha256 := bound_attempt.dispatch_token_sha256;
  NEW.deployment_id := bound_deployment.id;
  NEW.endpoint_id_sha256 := bound_deployment.endpoint_id_sha256;
  NEW.endpoint_config_sha256 := bound_deployment.endpoint_config_sha256;
  NEW.worker_image_digest := bound_deployment.worker_image_digest;
  NEW.model_manifest_sha256 := bound_deployment.model_manifest_sha256;
  NEW.volume_id_sha256 := bound_deployment.volume_id_sha256;
  NEW.volume_manifest_sha256 := bound_deployment.volume_manifest_sha256;
  NEW.region := bound_deployment.region;
  NEW.gpu_allowlist := bound_deployment.gpu_allowlist;
  NEW.expected_objects := canonical_objects;
  derived_binding_components := jsonb_build_object(
    'account_id', NEW.account_id,
    'workspace_id', NEW.workspace_id,
    'project_id', NEW.project_id,
    'project_revision_id', NEW.project_revision_id,
    'lane', NEW.lane,
    'attempt_id', NEW.attempt_id,
    'provider_job_id', NEW.provider_job_id,
    'dispatch_token_sha256', NEW.dispatch_token_sha256,
    'deployment_id', NEW.deployment_id,
    'endpoint_id_sha256', NEW.endpoint_id_sha256,
    'endpoint_config_sha256', NEW.endpoint_config_sha256,
    'worker_image_digest', NEW.worker_image_digest,
    'model_manifest_sha256', NEW.model_manifest_sha256,
    'volume_id_sha256', NEW.volume_id_sha256,
    'volume_manifest_sha256', NEW.volume_manifest_sha256,
    'expected_objects', NEW.expected_objects
  );
  IF NEW.binding_components IS DISTINCT FROM derived_binding_components THEN
    RAISE EXCEPTION 'hosted output binding components differ from database-derived lineage'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER hosted_serverless_output_barrier_completions_derive
  BEFORE INSERT ON hosted_serverless_output_barrier_completions
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_hosted_output_barrier_completion();
CREATE TRIGGER hosted_serverless_output_barrier_completions_append_only
  BEFORE UPDATE OR DELETE ON hosted_serverless_output_barrier_completions
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_serverless_output_barrier_completions_tenant_write_guard
  BEFORE INSERT ON hosted_serverless_output_barrier_completions
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();

ALTER TABLE hosted_serverless_output_barrier_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted_serverless_output_barrier_completions FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_serverless_output_barrier_completions_tenant_rls
  ON hosted_serverless_output_barrier_completions
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());

CREATE VIEW public.videoforge_tenant_hosted_serverless_output_barrier_completions
WITH (security_barrier) AS
  SELECT * FROM hosted_serverless_output_barrier_completions
   WHERE account_id = public.videoforge_current_account_id();

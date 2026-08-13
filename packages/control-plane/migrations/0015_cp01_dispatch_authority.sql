-- CP-01 audit hardening: durable exact-envelope authority and output ownership.
-- Additive only. Migration 0014 and every legacy byte remain unchanged.

CREATE TABLE pod_dispatch_authorizations (
  id uuid PRIMARY KEY,
  envelope_sha256 text NOT NULL UNIQUE CHECK (envelope_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  envelope_document jsonb NOT NULL CHECK (jsonb_typeof(envelope_document) = 'object'),
  generation_session_id uuid NOT NULL,
  queue_entry_id uuid NOT NULL,
  compute_run_plan_id uuid NOT NULL,
  pod_attempt_id uuid NOT NULL,
  lane text NOT NULL CHECK (lane IN ('mage_image', 'echo_avatar')),
  authorized_at timestamptz NOT NULL,
  deadline_at timestamptz NOT NULL CHECK (deadline_at > authorized_at),
  state text NOT NULL DEFAULT 'AUTHORIZED' CHECK (state = 'AUTHORIZED'),
  UNIQUE (generation_session_id, id),
  FOREIGN KEY (generation_session_id, queue_entry_id)
    REFERENCES global_queue_entries (generation_session_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (generation_session_id, compute_run_plan_id)
    REFERENCES compute_run_plans (generation_session_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (generation_session_id, pod_attempt_id)
    REFERENCES pod_lifecycle_attempts (generation_session_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (generation_session_id, lane)
    REFERENCES session_gpu_bindings (generation_session_id, lane) ON DELETE RESTRICT
);

CREATE FUNCTION videoforge_validate_pod_dispatch_authorization() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  document jsonb := NEW.envelope_document;
BEGIN
  IF document->>'schema_version' <> 'pod-worker-job-envelope/v2'
     OR document->>'dispatch_target' <> 'RUNPOD_POD'
     OR document->>'provider_api' <> 'runpod-pods/v1'
     OR document->>'generation_session_id' <> NEW.generation_session_id::text
     OR document->>'queue_entry_id' <> NEW.queue_entry_id::text
     OR document->>'compute_run_plan_id' <> NEW.compute_run_plan_id::text
     OR document->>'lane' <> NEW.lane
     OR document#>>'{pod_resource_binding,pod_attempt_id}' <> NEW.pod_attempt_id::text
     OR document#>>'{pod_resource_binding,lane}' <> NEW.lane
     OR document#>>'{input_manifest,generation_session_id}' <> NEW.generation_session_id::text
     OR document#>>'{input_manifest,queue_entry_id}' <> NEW.queue_entry_id::text
     OR document#>>'{input_manifest,compute_run_plan_id}' <> NEW.compute_run_plan_id::text
     OR document#>>'{input_manifest,pod_attempt_id}' <> NEW.pod_attempt_id::text
     OR document#>>'{input_manifest,lane}' <> NEW.lane THEN
    RAISE EXCEPTION 'dispatch authorization document lineage must equal its durable authority row'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM generation_sessions session
      JOIN global_queue_entries queue
        ON queue.generation_session_id = session.id
       AND queue.id = NEW.queue_entry_id
      JOIN compute_run_plans plan
        ON plan.generation_session_id = session.id
       AND plan.id = NEW.compute_run_plan_id
       AND plan.queue_entry_id = queue.id
      JOIN pod_lifecycle_attempts pod
        ON pod.generation_session_id = session.id
       AND pod.id = NEW.pod_attempt_id
       AND pod.origin_queue_entry_id = queue.id
       AND pod.lane = NEW.lane
      JOIN session_gpu_bindings binding
        ON binding.generation_session_id = session.id
       AND binding.lane = NEW.lane
      JOIN model_volumes volume
        ON volume.id = binding.model_volume_id
       AND volume.lane = binding.lane
      JOIN model_volume_manifests manifest
        ON manifest.id = binding.manifest_id
       AND manifest.model_volume_id = binding.model_volume_id
       AND manifest.lane = binding.lane
      JOIN gpu_inventory_receipts receipt
        ON receipt.id = binding.inventory_receipt_id
       AND receipt.lane = binding.lane
     WHERE session.id = NEW.generation_session_id
       AND plan.plan_sha256 = document->>'compute_run_plan_sha256'
       AND pod.actual_gpu_sku = binding.selected_gpu_sku
       AND pod.create_attempt_key = document#>>'{pod_resource_binding,create_attempt_id}'
       AND binding.model_volume_id::text = document#>>'{pod_resource_binding,model_volume_id}'
       AND binding.manifest_id::text = document#>>'{pod_resource_binding,manifest_id}'
       AND binding.inventory_receipt_id::text = document#>>'{pod_resource_binding,inventory_receipt_id}'
       AND binding.offering_id = document#>>'{pod_resource_binding,offering_id}'
       AND binding.selected_gpu_sku = document#>>'{pod_resource_binding,selected_gpu_sku}'
       AND binding.rate_ceiling_micro_usd_per_hour =
           (document#>>'{pod_resource_binding,rate_ceiling_micro_usd_per_hour}')::bigint
       AND volume.provider_volume_id = document#>>'{pod_resource_binding,provider_volume_id}'
       AND volume.model_id = document#>>'{pod_resource_binding,model_id}'
       AND volume.model_revision = document#>>'{pod_resource_binding,model_revision}'
       AND volume.precision = document#>>'{pod_resource_binding,precision}'
       AND volume.region = document#>>'{pod_resource_binding,region}'
       AND volume.mount_path = document#>>'{pod_resource_binding,mount_path}'
       AND manifest.manifest_sha256 = document#>>'{pod_resource_binding,manifest_sha256}'
       AND receipt.gpu_count = (document#>>'{pod_resource_binding,gpu_count}')::integer
       AND receipt.offering_id = document#>>'{pod_resource_binding,offering_id}'
       AND receipt.gpu_sku = document#>>'{pod_resource_binding,selected_gpu_sku}'
  ) THEN
    RAISE EXCEPTION 'dispatch authorization requires one exact live persisted session tuple'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pod_dispatch_authorizations_validate
  BEFORE INSERT ON pod_dispatch_authorizations
  FOR EACH ROW EXECUTE FUNCTION videoforge_validate_pod_dispatch_authorization();

CREATE TRIGGER pod_dispatch_authorizations_append_only
  BEFORE UPDATE OR DELETE ON pod_dispatch_authorizations
  FOR EACH ROW EXECUTE FUNCTION videoforge_vnext_append_only();

CREATE FUNCTION videoforge_validate_durable_output_ownership() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lane <> 'render' AND NOT EXISTS (
    SELECT 1
      FROM pod_lifecycle_attempts pod
     WHERE pod.generation_session_id = NEW.generation_session_id
       AND pod.id = NEW.pod_attempt_id
       AND pod.origin_queue_entry_id = NEW.queue_entry_id
       AND pod.lane = NEW.lane
       AND pod.create_state = 'ACKNOWLEDGED'
       AND pod.model_ready_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'durable model output must belong to the exact queue entry and Pod lane'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER durable_generation_outputs_validate_ownership
  BEFORE INSERT ON durable_generation_outputs
  FOR EACH ROW EXECUTE FUNCTION videoforge_validate_durable_output_ownership();

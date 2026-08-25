-- Provider-free hosted paid-dispatch authority gate. Approval rows are written by the migration
-- owner/operator. The hosted runtime receives only the SECURITY DEFINER claim function: it cannot
-- select, insert, update, or delete either table directly.

CREATE TABLE public.hosted_paid_dispatch_approvals (
  id uuid PRIMARY KEY,
  approval_sha256 text NOT NULL UNIQUE CHECK (approval_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  generation_request_id uuid NOT NULL,
  generation_plan_sha256 text NOT NULL CHECK (generation_plan_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  lease_id uuid NOT NULL,
  lane_bindings jsonb NOT NULL CHECK (
    jsonb_typeof(lane_bindings) = 'array' AND jsonb_array_length(lane_bindings) = 2
  ),
  maximum_cumulative_finite_cap_usd numeric(12,6) NOT NULL
    CHECK (maximum_cumulative_finite_cap_usd > 0),
  expires_at timestamptz NOT NULL,
  approved_by_operator text NOT NULL CHECK (length(approved_by_operator) BETWEEN 1 AND 200),
  approved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (account_id, workspace_id, id),
  FOREIGN KEY (account_id, workspace_id) REFERENCES public.workspaces (account_id, id),
  FOREIGN KEY (account_id, workspace_id, project_id)
    REFERENCES public.projects (account_id, workspace_id, id),
  FOREIGN KEY (account_id, workspace_id, project_revision_id)
    REFERENCES public.project_revisions (account_id, workspace_id, id),
  FOREIGN KEY (account_id, workspace_id, generation_request_id)
    REFERENCES public.generation_requests (account_id, workspace_id, id),
  FOREIGN KEY (account_id, workspace_id, lease_id)
    REFERENCES public.provider_workload_leases (account_id, workspace_id, id),
  CHECK (expires_at > approved_at AND expires_at <= approved_at + interval '24 hours')
);

CREATE TABLE public.hosted_paid_dispatch_claims (
  id uuid PRIMARY KEY,
  approval_id uuid NOT NULL UNIQUE REFERENCES public.hosted_paid_dispatch_approvals (id),
  approval_sha256 text NOT NULL,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  generation_request_id uuid NOT NULL UNIQUE,
  generation_plan_sha256 text NOT NULL CHECK (generation_plan_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  lease_id uuid NOT NULL,
  lane_bindings jsonb NOT NULL,
  total_cap_usd numeric(12,6) NOT NULL CHECK (total_cap_usd > 0),
  cumulative_reservation_usd numeric(12,6) NOT NULL CHECK (
    cumulative_reservation_usd >= 0 AND cumulative_reservation_usd <= total_cap_usd
  ),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz NOT NULL,
  UNIQUE (account_id, workspace_id, id),
  FOREIGN KEY (account_id, workspace_id) REFERENCES public.workspaces (account_id, id),
  FOREIGN KEY (account_id, workspace_id, generation_request_id)
    REFERENCES public.generation_requests (account_id, workspace_id, id),
  FOREIGN KEY (account_id, workspace_id, lease_id)
    REFERENCES public.provider_workload_leases (account_id, workspace_id, id),
  CHECK (claimed_at < expires_at)
);

CREATE TRIGGER hosted_paid_dispatch_approvals_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_paid_dispatch_approvals
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_paid_dispatch_approvals_tenant_write_guard
  BEFORE INSERT ON public.hosted_paid_dispatch_approvals
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER hosted_paid_dispatch_claims_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_paid_dispatch_claims
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_paid_dispatch_claims_tenant_write_guard
  BEFORE INSERT ON public.hosted_paid_dispatch_claims
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();

ALTER TABLE public.hosted_paid_dispatch_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_paid_dispatch_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_paid_dispatch_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_paid_dispatch_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_paid_dispatch_approvals_tenant_rls
  ON public.hosted_paid_dispatch_approvals
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());
CREATE POLICY hosted_paid_dispatch_claims_tenant_rls
  ON public.hosted_paid_dispatch_claims
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());

-- RFC 8785-compatible for the I-JSON deployment records VideoForge persists: ASCII property names,
-- strings, booleans, null, safe integers, arrays, and nested objects. Focused migration tests compare
-- this database result to the shared TypeScript canonicalSha256 implementation.
CREATE FUNCTION public.videoforge_canonical_jsonb(value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path = public, pg_catalog AS $$
DECLARE
  kind text := jsonb_typeof(value);
  rendered text;
BEGIN
  IF kind IN ('null', 'boolean', 'number', 'string') THEN
    RETURN value::text;
  ELSIF kind = 'array' THEN
    SELECT '[' || coalesce(string_agg(public.videoforge_canonical_jsonb(item), ',' ORDER BY ordinal), '') || ']'
      INTO rendered
      FROM jsonb_array_elements(value) WITH ORDINALITY AS element(item, ordinal);
    RETURN rendered;
  ELSIF kind = 'object' THEN
    SELECT '{' || coalesce(string_agg(to_jsonb(key)::text || ':' ||
             public.videoforge_canonical_jsonb(item), ',' ORDER BY key COLLATE "C"), '') || '}'
      INTO rendered
      FROM jsonb_each(value) AS member(key, item);
    RETURN rendered;
  END IF;
  RAISE EXCEPTION 'unsupported canonical json value' USING ERRCODE = '22023';
END;
$$;

CREATE FUNCTION public.videoforge_hosted_deployment_snapshot_sha256(supplied_deployment_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE STRICT SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  deployment public.serverless_endpoint_deployments%ROWTYPE;
  lineage jsonb;
  lineage_sha256 text;
  snapshot jsonb;
BEGIN
  SELECT * INTO deployment FROM public.serverless_endpoint_deployments
   WHERE id = supplied_deployment_id;
  lineage := deployment.timeout_evidence->'sealed_lineage';
  IF deployment.id IS NULL OR jsonb_typeof(lineage) <> 'object' THEN
    RAISE EXCEPTION 'sealed deployment snapshot is unavailable' USING ERRCODE = '23514';
  END IF;
  lineage_sha256 := 'sha256:' || encode(
    sha256(convert_to(public.videoforge_canonical_jsonb(lineage), 'UTF8')), 'hex'
  );
  snapshot := jsonb_build_object(
    'deployment', jsonb_build_object(
      'deploymentId', deployment.id::text,
      'lane', deployment.lane,
      'endpointProfileId', deployment.endpoint_profile_id,
      'endpointIdSha256', deployment.endpoint_id_sha256,
      'endpointConfigSha256', deployment.endpoint_config_sha256,
      'workerImageDigest', deployment.worker_image_digest,
      'modelManifestSha256', deployment.model_manifest_sha256,
      'volumeIdSha256', deployment.volume_id_sha256,
      'volumeManifestSha256', deployment.volume_manifest_sha256,
      'idleTimeoutSeconds', deployment.idle_timeout_seconds,
      'initTimeoutSeconds', deployment.init_timeout_seconds,
      'executionTimeoutSeconds', deployment.execution_timeout_seconds,
      'requestTtlSeconds', deployment.request_ttl_seconds,
      'reconciliationDeadlineSeconds', deployment.reconciliation_deadline_seconds,
      'pollingIntervalSeconds', deployment.polling_interval_seconds,
      'maxReplacementAttempts', deployment.max_replacement_attempts,
      'timeoutEvidence', deployment.timeout_evidence,
      'deploymentVersion', deployment.deployment_version,
      'createdAt', to_char(deployment.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    'sealedLineage', lineage,
    'sealedLineageSha256', lineage_sha256
  );
  RETURN 'sha256:' || encode(
    sha256(convert_to(public.videoforge_canonical_jsonb(snapshot), 'UTF8')), 'hex'
  );
END;
$$;

CREATE FUNCTION public.videoforge_claim_hosted_paid_dispatch(
  supplied_approval_id uuid,
  supplied_approval_sha256 text,
  supplied_claim_id uuid,
  supplied_account_id uuid,
  supplied_workspace_id uuid,
  supplied_project_id uuid,
  supplied_project_revision_id uuid,
  supplied_generation_request_id uuid,
  supplied_generation_plan_sha256 text,
  supplied_lease_id uuid,
  supplied_lane_bindings jsonb,
  supplied_total_cap_usd numeric,
  supplied_cumulative_reservation_usd numeric,
  supplied_expires_at timestamptz
) RETURNS TABLE (
  approval_id uuid,
  approval_sha256 text,
  claim_id uuid,
  account_id uuid,
  workspace_id uuid,
  generation_request_id uuid,
  total_cap_usd numeric,
  cumulative_reservation_usd numeric,
  expires_at timestamptz,
  claimed_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  approval public.hosted_paid_dispatch_approvals%ROWTYPE;
  current_request public.generation_requests%ROWTYPE;
  current_revision public.project_revisions%ROWTYPE;
  current_lease public.provider_workload_leases%ROWTYPE;
  current_bridge public.hosted_canonical_timing_bridges%ROWTYPE;
  deployment public.serverless_endpoint_deployments%ROWTYPE;
  db_now timestamptz := transaction_timestamp();
  binding jsonb;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR supplied_approval_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_generation_plan_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(supplied_lane_bindings) <> 'array'
     OR jsonb_array_length(supplied_lane_bindings) <> 2
     OR supplied_total_cap_usd <= 0
     OR supplied_cumulative_reservation_usd < 0
     OR supplied_cumulative_reservation_usd > supplied_total_cap_usd THEN
    RAISE EXCEPTION 'hosted paid dispatch claim input is invalid' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO approval
    FROM public.hosted_paid_dispatch_approvals
   WHERE id = supplied_approval_id
   FOR UPDATE;
  IF approval.id IS NULL
     OR approval.approval_sha256 <> supplied_approval_sha256
     OR approval.account_id <> supplied_account_id
     OR approval.workspace_id <> supplied_workspace_id
     OR approval.project_id <> supplied_project_id
     OR approval.project_revision_id <> supplied_project_revision_id
     OR approval.generation_request_id <> supplied_generation_request_id
     OR approval.generation_plan_sha256 <> supplied_generation_plan_sha256
     OR approval.lease_id <> supplied_lease_id
     OR approval.lane_bindings IS DISTINCT FROM supplied_lane_bindings
     OR approval.maximum_cumulative_finite_cap_usd <> supplied_total_cap_usd
     OR approval.expires_at IS DISTINCT FROM supplied_expires_at
     OR approval.approved_at > db_now
     OR approval.expires_at <= db_now THEN
    RAISE EXCEPTION 'hosted paid dispatch approval scope, lineage, cap, or expiry mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.hosted_paid_dispatch_claims claim
              WHERE claim.approval_id = supplied_approval_id
                 OR claim.generation_request_id = supplied_generation_request_id) THEN
    RAISE EXCEPTION 'hosted paid dispatch approval already claimed' USING ERRCODE = '23505';
  END IF;

  -- Lock mutable authority truth in one deterministic order. Terminal/release/retire transactions
  -- must wait until this claim commits; after they win first, these exact predicates reject.
  SELECT request.* INTO current_request FROM public.generation_requests request
   WHERE request.account_id = supplied_account_id AND request.workspace_id = supplied_workspace_id
     AND request.id = supplied_generation_request_id FOR UPDATE;
  SELECT revision.* INTO current_revision FROM public.project_revisions revision
   WHERE revision.account_id = supplied_account_id AND revision.workspace_id = supplied_workspace_id
     AND revision.id = supplied_project_revision_id FOR UPDATE;
  SELECT lease.* INTO current_lease FROM public.provider_workload_leases lease
   WHERE lease.account_id = supplied_account_id AND lease.workspace_id = supplied_workspace_id
     AND lease.id = supplied_lease_id FOR UPDATE;
  SELECT bridge.* INTO current_bridge FROM public.hosted_canonical_timing_bridges bridge
   WHERE bridge.account_id = supplied_account_id AND bridge.workspace_id = supplied_workspace_id
     AND bridge.project_id = supplied_project_id AND bridge.project_revision_id = supplied_project_revision_id
   FOR UPDATE;

  IF current_request.id IS NULL
     OR current_request.project_id <> supplied_project_id
     OR current_request.project_revision_id <> supplied_project_revision_id
     OR current_request.state <> 'ACTIVE' OR current_request.terminal_at IS NOT NULL
     OR current_revision.id IS NULL OR current_revision.project_id <> supplied_project_id
     OR current_revision.status <> 'LOCKED'
     OR current_lease.id IS NULL OR current_lease.generation_request_id <> supplied_generation_request_id
     OR current_lease.request_kind <> 'VIDEO' OR current_lease.state <> 'ACTIVE'
     OR current_lease.released_at IS NOT NULL OR current_lease.expires_at <= db_now
     OR current_bridge.hosted_asr_attempt_id IS NULL
     OR current_bridge.generation_plan_sha256 <> supplied_generation_plan_sha256 THEN
    RAISE EXCEPTION 'hosted paid dispatch requires the exact current active lease'
      USING ERRCODE = '23514';
  END IF;

  IF (SELECT array_agg(value->>'lane' ORDER BY value->>'lane')
        FROM jsonb_array_elements(supplied_lane_bindings))
       IS DISTINCT FROM ARRAY['mage_image','soulx_avatar']::text[] THEN
    RAISE EXCEPTION 'hosted paid dispatch requires both exact lanes' USING ERRCODE = '23514';
  END IF;

  FOR binding IN SELECT value FROM jsonb_array_elements(supplied_lane_bindings)
                  ORDER BY value->>'lane' LOOP
    SELECT * INTO deployment FROM public.serverless_endpoint_deployments candidate
     WHERE candidate.id::text = binding->>'deployment_id'
     FOR UPDATE;
    IF (binding->>'checkpoint_id') <> (CASE binding->>'lane'
         WHEN 'mage_image' THEN 'V2-07' WHEN 'soulx_avatar' THEN 'V2-08' ELSE '' END)
       OR binding->'operations' IS DISTINCT FROM
          '["serverless_run","serverless_status","serverless_cancel"]'::jsonb
       OR jsonb_typeof(binding->'resources') <> 'array'
       OR jsonb_array_length(binding->'resources') <> 4
       OR binding->>'deployment_snapshot_sha256' !~ '^sha256:[0-9a-f]{64}$'
       OR deployment.id IS NULL
       OR deployment.lane <> binding->>'lane'
       OR NOT deployment.is_active
       OR deployment.endpoint_id_sha256 <> binding->>'endpoint_id_sha256'
       OR deployment.endpoint_config_sha256 <> binding->>'endpoint_config_sha256'
       OR deployment.worker_image_digest <> binding->>'worker_image_digest'
       OR deployment.model_manifest_sha256 <> binding->>'model_manifest_sha256'
       OR deployment.volume_id_sha256 <> binding->>'volume_id_sha256'
       OR deployment.volume_manifest_sha256 <> binding->>'volume_manifest_sha256'
       OR deployment.region <> 'EU-RO-1'
       OR deployment.gpu_allowlist <> ARRAY['NVIDIA GeForce RTX 4090']::text[]
       OR deployment.worker_count_min <> 0
       OR deployment.volume_mount <> '/runpod-volume'
       OR binding->'resources' <> jsonb_build_array(
              'endpoint:' || deployment.id::text,
              'gpu:nvidia-geforce-rtx-4090-eu-ro-1',
              'image:' || substring(deployment.worker_image_digest FROM 8),
              'volume:' || substring(deployment.volume_id_sha256 FROM 8)
            )
       OR binding->>'deployment_snapshot_sha256' <>
          public.videoforge_hosted_deployment_snapshot_sha256(deployment.id) THEN
      RAISE EXCEPTION 'hosted paid dispatch lane binding is not the exact active sealed deployment'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  INSERT INTO public.hosted_paid_dispatch_claims (
    id, approval_id, approval_sha256, account_id, workspace_id, project_id,
    project_revision_id, generation_request_id, generation_plan_sha256, lease_id,
    lane_bindings, total_cap_usd, cumulative_reservation_usd, expires_at, claimed_at
  ) VALUES (
    supplied_claim_id, supplied_approval_id, supplied_approval_sha256, supplied_account_id,
    supplied_workspace_id, supplied_project_id, supplied_project_revision_id,
    supplied_generation_request_id, supplied_generation_plan_sha256, supplied_lease_id,
    supplied_lane_bindings, supplied_total_cap_usd, supplied_cumulative_reservation_usd,
    supplied_expires_at, db_now
  );

  RETURN QUERY SELECT supplied_approval_id, supplied_approval_sha256, supplied_claim_id,
    supplied_account_id, supplied_workspace_id, supplied_generation_request_id,
    supplied_total_cap_usd, supplied_cumulative_reservation_usd, supplied_expires_at, db_now;
END;
$$;

REVOKE ALL ON TABLE public.hosted_paid_dispatch_approvals FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_paid_dispatch_claims FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_canonical_jsonb(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_hosted_deployment_snapshot_sha256(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_claim_hosted_paid_dispatch(
  uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, numeric, numeric, timestamptz
) FROM PUBLIC;

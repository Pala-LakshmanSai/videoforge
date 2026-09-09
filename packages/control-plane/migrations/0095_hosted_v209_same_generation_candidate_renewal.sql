-- Migration 0095: recover one exact same-generation V2-09 candidate after an expired
-- admission lease without rewriting the append-only candidate or approval evidence.
--
-- A lease heartbeat alone is insufficient: 0074's candidate and 0040's approval both carry
-- the lease horizon and are append-only.  This migration adds one immutable renewal overlay,
-- keeps the original rows addressable for audit, and makes existing candidate readers resolve
-- the overlay only after the exact guarded renewal has committed.

CREATE TABLE public.hosted_v209_ordinary_dispatch_candidate_renewals (
  generation_request_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  original_candidate_sha256 text NOT NULL CHECK(original_candidate_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  original_approval_id uuid NOT NULL,
  candidate_sha256 text NOT NULL UNIQUE CHECK(candidate_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  approval_id uuid NOT NULL UNIQUE,
  candidate_document jsonb NOT NULL CHECK(
    jsonb_typeof(candidate_document)='object'
    AND candidate_document->>'schemaVersion'='videoforge.hosted-v209-ordinary-dispatch/v1'
  ),
  expires_at timestamptz NOT NULL,
  audit_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(account_id,workspace_id,generation_request_id),
  FOREIGN KEY(account_id,workspace_id,generation_request_id)
    REFERENCES public.hosted_v209_ordinary_dispatch_candidates(account_id,workspace_id,generation_request_id),
  FOREIGN KEY(account_id,workspace_id,project_id)
    REFERENCES public.projects(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,project_revision_id)
    REFERENCES public.project_revisions(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,lease_id)
    REFERENCES public.provider_workload_leases(account_id,workspace_id,id),
  FOREIGN KEY(original_approval_id) REFERENCES public.hosted_paid_dispatch_approvals(id),
  FOREIGN KEY(approval_id) REFERENCES public.hosted_paid_dispatch_approvals(id),
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours')
);

CREATE TRIGGER hosted_v209_ordinary_dispatch_candidate_renewals_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_v209_ordinary_dispatch_candidate_renewals
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_v209_candidate_renewals_tenant_write_guard
  BEFORE INSERT ON public.hosted_v209_ordinary_dispatch_candidate_renewals
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE public.hosted_v209_ordinary_dispatch_candidate_renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_v209_ordinary_dispatch_candidate_renewals FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_v209_ordinary_dispatch_candidate_renewals_tenant_rls
  ON public.hosted_v209_ordinary_dispatch_candidate_renewals
  USING(account_id=public.videoforge_current_account_id())
  WITH CHECK(account_id=public.videoforge_current_account_id());
REVOKE ALL ON TABLE public.hosted_v209_ordinary_dispatch_candidate_renewals FROM PUBLIC;

-- The view preserves the original candidate row while exposing the one committed renewal as
-- the effective candidate.  It is intentionally read-only and is used only by SECURITY DEFINER
-- functions; writes continue to target the original append-only table.
CREATE VIEW public.hosted_v209_ordinary_dispatch_candidates_effective AS
SELECT candidate.generation_request_id,
       candidate.account_id,
       candidate.workspace_id,
       candidate.project_id,
       candidate.project_revision_id,
       candidate.lease_id,
       candidate.generation_plan_sha256,
       candidate.work_manifest_sha256,
       coalesce(renewal.candidate_sha256,candidate.candidate_sha256) AS candidate_sha256,
       coalesce(renewal.approval_id,candidate.approval_id) AS approval_id,
       coalesce(renewal.candidate_document,candidate.candidate_document) AS candidate_document,
       coalesce(renewal.expires_at,candidate.expires_at) AS expires_at,
       candidate.created_at,
       candidate.id
  FROM public.hosted_v209_ordinary_dispatch_candidates candidate
  LEFT JOIN public.hosted_v209_ordinary_dispatch_candidate_renewals renewal
    ON renewal.account_id=candidate.account_id
   AND renewal.workspace_id=candidate.workspace_id
   AND renewal.generation_request_id=candidate.generation_request_id;
REVOKE ALL ON public.hosted_v209_ordinary_dispatch_candidates_effective FROM PUBLIC;

CREATE FUNCTION public.videoforge_effective_hosted_v209_candidate(
  supplied_account_id uuid,
  supplied_workspace_id uuid,
  supplied_generation_request_id uuid
) RETURNS public.hosted_v209_ordinary_dispatch_candidates
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  original public.hosted_v209_ordinary_dispatch_candidates%ROWTYPE;
  renewal public.hosted_v209_ordinary_dispatch_candidate_renewals%ROWTYPE;
  approval public.hosted_paid_dispatch_approvals%ROWTYPE;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN
    RETURN NULL;
  END IF;
  SELECT candidate.* INTO original
    FROM public.hosted_v209_ordinary_dispatch_candidates candidate
   WHERE candidate.account_id=supplied_account_id
     AND candidate.workspace_id=supplied_workspace_id
     AND candidate.generation_request_id=supplied_generation_request_id;
  IF original.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF original.candidate_sha256<>'sha256:'||encode(sha256(convert_to(
       public.videoforge_canonical_jsonb(original.candidate_document),'UTF8')),'hex') THEN
    RAISE EXCEPTION 'hosted V2-09 original candidate hash drifted' USING ERRCODE='23514';
  END IF;
  SELECT row.* INTO renewal
    FROM public.hosted_v209_ordinary_dispatch_candidate_renewals row
   WHERE row.account_id=supplied_account_id
     AND row.workspace_id=supplied_workspace_id
     AND row.generation_request_id=supplied_generation_request_id;
  IF renewal.generation_request_id IS NULL THEN
    RETURN original;
  END IF;
  SELECT row.* INTO approval
    FROM public.hosted_paid_dispatch_approvals row
   WHERE row.id=renewal.approval_id;
  IF renewal.original_candidate_sha256<>original.candidate_sha256
     OR renewal.original_approval_id<>original.approval_id
     OR renewal.account_id<>original.account_id
     OR renewal.workspace_id<>original.workspace_id
     OR renewal.project_id<>original.project_id
     OR renewal.project_revision_id<>original.project_revision_id
     OR renewal.lease_id<>original.lease_id
     OR renewal.candidate_sha256<>'sha256:'||encode(sha256(convert_to(
        public.videoforge_canonical_jsonb(renewal.candidate_document),'UTF8')),'hex')
     OR renewal.candidate_document->>'generationRequestId'<>original.generation_request_id::text
     OR renewal.candidate_document->>'projectRevisionId'<>original.project_revision_id::text
     OR renewal.candidate_document->>'leaseId'<>original.lease_id::text
     OR renewal.candidate_document->>'candidateSha256' IS NOT NULL
     OR renewal.candidate_document->>'approvalId'<>renewal.approval_id::text
     OR renewal.candidate_document->>'approvalSha256'<>approval.approval_sha256
     OR renewal.candidate_document->>'expiresAt'<>to_char(renewal.expires_at AT TIME ZONE 'UTC',
       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
     OR approval.id IS NULL
     OR approval.account_id<>renewal.account_id
     OR approval.workspace_id<>renewal.workspace_id
     OR approval.project_id<>renewal.project_id
     OR approval.project_revision_id<>renewal.project_revision_id
     OR approval.generation_request_id<>renewal.generation_request_id
     OR approval.lease_id<>renewal.lease_id
     OR approval.approval_sha256<>'sha256:'||encode(sha256(convert_to(
        public.videoforge_canonical_jsonb(jsonb_build_object(
          'schemaVersion','videoforge.hosted-v209-paid-approval/v1',
          'accountId',approval.account_id,'workspaceId',approval.workspace_id,
          'projectId',approval.project_id,'projectRevisionId',approval.project_revision_id,
          'generationRequestId',approval.generation_request_id,
          'generationPlanSha256',approval.generation_plan_sha256,'leaseId',approval.lease_id,
          'laneBindings',approval.lane_bindings,'totalCapUsd',approval.maximum_cumulative_finite_cap_usd,
          'expiresAt',to_char(approval.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )),'UTF8')),'hex') THEN
    RAISE EXCEPTION 'hosted V2-09 candidate renewal lineage drifted' USING ERRCODE='23514';
  END IF;
  original.candidate_sha256:=renewal.candidate_sha256;
  original.approval_id:=renewal.approval_id;
  original.candidate_document:=renewal.candidate_document;
  original.expires_at:=renewal.expires_at;
  RETURN original;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_effective_hosted_v209_candidate(uuid,uuid,uuid) FROM PUBLIC;

CREATE FUNCTION public.videoforge_renew_hosted_v209_ordinary_candidate(
  supplied_account_id uuid,
  supplied_workspace_id uuid,
  supplied_user_id uuid,
  supplied_project_id uuid,
  supplied_generation_request_id uuid,
  supplied_lease_id uuid,
  supplied_expected_request_version integer,
  supplied_expected_lease_version integer,
  supplied_original_candidate_sha256 text,
  supplied_original_approval_id uuid,
  supplied_audit_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  capacity_before public.global_generation_capacity%ROWTYPE;
  capacity_after public.global_generation_capacity%ROWTYPE;
  request public.generation_requests%ROWTYPE;
  lease public.provider_workload_leases%ROWTYPE;
  runtime public.video_runtime_states%ROWTYPE;
  candidate public.hosted_v209_ordinary_dispatch_candidates%ROWTYPE;
  approval public.hosted_paid_dispatch_approvals%ROWTYPE;
  binding jsonb; binding_lane text; binding_count integer:=0;
  mage_lane_state_count integer; soulx_lane_state_count integer;
  mage_ready_task_count integer; soulx_ready_task_count integer;
  mage_binding_count integer:=0; soulx_binding_count integer:=0;
  qualification_expiry timestamptz:='infinity'::timestamptz;
  deployment public.serverless_endpoint_deployments%ROWTYPE;
  qualification public.hosted_serverless_qualification_attestations%ROWTYPE;
  renewed_expires_at timestamptz; renewed_approval_id uuid;
  approval_base jsonb; renewed_approval_sha text; renewed_candidate_document jsonb;
  renewed_candidate_sha text; changed_count integer;
  ready_lane_count integer; lane_state_count integer;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR supplied_original_candidate_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_audit_id IS NULL THEN
    RAISE EXCEPTION 'hosted V2-09 candidate renewal scope invalid' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.memberships membership
    WHERE membership.account_id=supplied_account_id AND membership.workspace_id=supplied_workspace_id
      AND membership.user_id=supplied_user_id AND membership.status='ACTIVE') THEN
    RAISE EXCEPTION 'hosted V2-09 candidate renewal principal invalid' USING ERRCODE='42501';
  END IF;
  SELECT row.* INTO request FROM public.generation_requests row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.id=supplied_generation_request_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_generation_request_id::text,41));
  SELECT row.* INTO capacity_before FROM public.global_generation_capacity row
   WHERE row.singleton FOR UPDATE;
  SELECT row.* INTO lease FROM public.provider_workload_leases row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.id=supplied_lease_id FOR UPDATE;
  SELECT row.* INTO runtime FROM public.video_runtime_states row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.id=md5('hosted-v209-runtime:'||supplied_generation_request_id::text)::uuid FOR UPDATE;
  SELECT row.* INTO candidate FROM public.hosted_v209_ordinary_dispatch_candidates row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.generation_request_id=supplied_generation_request_id FOR UPDATE;
  PERFORM 1 FROM public.video_runtime_lane_states row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.runtime_id=runtime.id ORDER BY row.lane FOR UPDATE;
  SELECT row.* INTO approval FROM public.hosted_paid_dispatch_approvals row
   WHERE row.id=candidate.approval_id FOR SHARE;
  IF (SELECT count(*) FROM public.videoforge_schema_migrations)<>95
     OR (SELECT max(version) FROM public.videoforge_schema_migrations)<>95
     OR NOT EXISTS(
       SELECT 1 FROM public.videoforge_schema_migrations migration
        WHERE migration.version=95
          AND migration.name='hosted_v209_same_generation_candidate_renewal'
          AND migration.filename='0095_hosted_v209_same_generation_candidate_renewal.sql')
     OR capacity_before.singleton IS DISTINCT FROM true
     OR capacity_before.active_lease_count<>1
     OR request.id IS NULL OR request.account_id<>supplied_account_id
     OR request.workspace_id<>supplied_workspace_id OR request.project_id<>supplied_project_id
     OR request.project_revision_id IS NULL OR request.created_by_user_id<>supplied_user_id
     OR NOT EXISTS(SELECT 1 FROM public.project_revisions revision
       WHERE revision.account_id=supplied_account_id
         AND revision.workspace_id=supplied_workspace_id
         AND revision.project_id=supplied_project_id
         AND revision.id=request.project_revision_id AND revision.status='LOCKED')
     OR request.state<>'ACTIVE' OR request.terminal_at IS NOT NULL
     OR request.version<>supplied_expected_request_version
     OR lease.id IS NULL OR lease.generation_request_id<>request.id
     OR lease.account_id<>supplied_account_id OR lease.workspace_id<>supplied_workspace_id
     OR lease.request_kind<>'VIDEO' OR lease.slot<>1 OR lease.state<>'ACTIVE'
     OR lease.version<>supplied_expected_lease_version OR lease.released_at IS NOT NULL
     OR lease.release_reason IS NOT NULL OR lease.expires_at>db_now
     OR (SELECT count(*) FROM public.provider_workload_leases row
         WHERE row.account_id=supplied_account_id AND row.state='ACTIVE')<>1
     OR (SELECT count(*) FROM public.provider_workload_leases row
         WHERE row.slot=lease.slot AND row.state='ACTIVE')<>1
     OR runtime.id IS NULL OR runtime.generation_request_id<>request.id
     OR runtime.project_id<>supplied_project_id OR runtime.project_revision_id<>request.project_revision_id
     OR runtime.stage<>'WAITING_FOR_WORKER' OR runtime.terminal_at IS NOT NULL
     OR candidate.id IS NULL OR candidate.lease_id<>lease.id
     OR candidate.project_id<>supplied_project_id OR candidate.project_revision_id<>request.project_revision_id
     OR candidate.candidate_sha256<>supplied_original_candidate_sha256
     OR candidate.approval_id<>supplied_original_approval_id
     OR candidate.expires_at>db_now
     OR candidate.candidate_sha256<>'sha256:'||encode(sha256(convert_to(
        public.videoforge_canonical_jsonb(candidate.candidate_document),'UTF8')),'hex')
     OR approval.id IS NULL OR approval.account_id<>supplied_account_id
     OR approval.workspace_id<>supplied_workspace_id OR approval.project_id<>supplied_project_id
     OR approval.project_revision_id<>request.project_revision_id
     OR approval.generation_request_id<>request.id OR approval.lease_id<>lease.id
     OR approval.expires_at>db_now
     OR EXISTS(SELECT 1 FROM public.hosted_paid_dispatch_claims claim
       WHERE claim.generation_request_id=request.id)
     OR EXISTS(SELECT 1 FROM public.hosted_v209_ordinary_dispatch_candidate_renewals row
       WHERE row.generation_request_id=request.id)
     OR EXISTS(SELECT 1 FROM public.serverless_attempts row WHERE row.generation_request_id=request.id)
     OR EXISTS(SELECT 1 FROM public.hosted_v209_ordinary_lane_materializations row
       WHERE row.generation_request_id=request.id)
     OR EXISTS(SELECT 1 FROM public.render_jobs row
       WHERE row.workspace_id=supplied_workspace_id AND row.project_revision_id=request.project_revision_id)
     OR EXISTS(SELECT 1 FROM public.serverless_dispatch_outbox outbox
       JOIN public.serverless_attempts attempt ON attempt.id=outbox.attempt_id
       WHERE attempt.generation_request_id=request.id)
     OR EXISTS(SELECT 1 FROM public.serverless_provider_assignments assignment
       JOIN public.serverless_attempts attempt ON attempt.id=assignment.attempt_id
       WHERE attempt.generation_request_id=request.id) THEN
    RAISE EXCEPTION 'hosted V2-09 candidate renewal precondition drifted' USING ERRCODE='55000';
  END IF;
  SELECT count(*) INTO lane_state_count FROM public.video_runtime_lane_states row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.runtime_id=runtime.id AND row.project_revision_id=request.project_revision_id
     AND row.lane IN ('mage_image','soulx_avatar') AND row.state='MANIFEST_DURABLE'
     AND row.current_attempt_id IS NULL AND row.accepted_item_count=0 AND row.attempt_ordinal=0;
  SELECT count(*) FILTER (WHERE row.lane='mage_image') INTO mage_lane_state_count
    FROM public.video_runtime_lane_states row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.runtime_id=runtime.id AND row.project_revision_id=request.project_revision_id
     AND row.lane IN ('mage_image','soulx_avatar') AND row.state='MANIFEST_DURABLE'
     AND row.current_attempt_id IS NULL AND row.accepted_item_count=0 AND row.attempt_ordinal=0;
  SELECT count(*) FILTER (WHERE row.lane='soulx_avatar') INTO soulx_lane_state_count
    FROM public.video_runtime_lane_states row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.runtime_id=runtime.id AND row.project_revision_id=request.project_revision_id
     AND row.lane IN ('mage_image','soulx_avatar') AND row.state='MANIFEST_DURABLE'
     AND row.current_attempt_id IS NULL AND row.accepted_item_count=0 AND row.attempt_ordinal=0;
  SELECT count(*) INTO ready_lane_count FROM public.generation_tasks row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.project_revision_id=request.project_revision_id AND row.owner_type='PROJECT_REVISION'
     AND row.lane IN ('IMAGE','AVATAR') AND row.task_key LIKE 'hosted-lane-batch:%'
     AND row.state='READY' AND row.required;
  SELECT count(*) FILTER (WHERE row.lane='IMAGE') INTO mage_ready_task_count
    FROM public.generation_tasks row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.project_revision_id=request.project_revision_id AND row.owner_type='PROJECT_REVISION'
     AND row.lane IN ('IMAGE','AVATAR') AND row.task_key LIKE 'hosted-lane-batch:%'
     AND row.state='READY' AND row.required;
  SELECT count(*) FILTER (WHERE row.lane='AVATAR') INTO soulx_ready_task_count
    FROM public.generation_tasks row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.project_revision_id=request.project_revision_id AND row.owner_type='PROJECT_REVISION'
     AND row.lane IN ('IMAGE','AVATAR') AND row.task_key LIKE 'hosted-lane-batch:%'
     AND row.state='READY' AND row.required;
  IF lane_state_count<>2 OR mage_lane_state_count<>1 OR soulx_lane_state_count<>1
     OR ready_lane_count<>2 OR mage_ready_task_count<>1 OR soulx_ready_task_count<>1
     OR EXISTS(SELECT 1 FROM public.video_runtime_lane_states row
       WHERE row.runtime_id=runtime.id AND row.lane NOT IN ('mage_image','soulx_avatar')) THEN
    RAISE EXCEPTION 'hosted V2-09 candidate renewal lanes are not ready' USING ERRCODE='55000';
  END IF;
  IF jsonb_typeof(candidate.candidate_document->'laneBindings') IS DISTINCT FROM 'array'
     OR jsonb_array_length(candidate.candidate_document->'laneBindings')<>2 THEN
    RAISE EXCEPTION 'hosted V2-09 candidate renewal lane bindings invalid' USING ERRCODE='23514';
  END IF;
  FOR binding IN SELECT value FROM jsonb_array_elements(candidate.candidate_document->'laneBindings') value LOOP
    binding_lane:=binding->>'lane';
    IF binding_lane NOT IN ('mage_image','soulx_avatar')
       OR binding->>'deployment_id' IS NULL OR binding->>'qualification_attestation_id' IS NULL THEN
      RAISE EXCEPTION 'hosted V2-09 candidate renewal lane binding drifted' USING ERRCODE='23514';
    END IF;
    IF binding_lane='mage_image' THEN
      mage_binding_count:=mage_binding_count+1;
    ELSE
      soulx_binding_count:=soulx_binding_count+1;
    END IF;
    SELECT row.* INTO deployment FROM public.serverless_endpoint_deployments row
     WHERE row.id=(binding->>'deployment_id')::uuid AND row.lane=binding_lane AND row.is_active FOR SHARE;
    SELECT row.* INTO qualification FROM public.hosted_serverless_qualification_attestations row
     WHERE row.id=(binding->>'qualification_attestation_id')::uuid
       AND row.deployment_id=deployment.id AND row.lane=binding_lane
       AND row.independent_audit_accepted AND row.verified_at<=db_now AND row.expires_at>db_now FOR SHARE;
    IF deployment.id IS NULL OR qualification.id IS NULL
       OR deployment.worker_count_min<>0 OR deployment.worker_count_max<>1
       OR deployment.handler_concurrency<>1 OR deployment.region<>'EU-RO-1'
       OR deployment.gpu_allowlist<>ARRAY['NVIDIA GeForce RTX 4090']::text[]
       OR deployment.gpu_count_per_worker<>1 OR deployment.retained_active_workers<>0
       OR deployment.volume_mount<>'/runpod-volume' OR deployment.blind_resubmit_permitted
       OR qualification.expires_at<db_now+make_interval(secs=>deployment.request_ttl_seconds)
       OR qualification.deployment_snapshot_sha256<>public.videoforge_hosted_deployment_snapshot_sha256(deployment.id)
       OR binding->>'deployment_snapshot_sha256'<>qualification.deployment_snapshot_sha256
       OR binding->>'qualification_record_sha256'<>qualification.qualification_record_sha256 THEN
      RAISE EXCEPTION 'hosted V2-09 candidate renewal qualification drifted' USING ERRCODE='42501';
    END IF;
    binding_count:=binding_count+1;
    qualification_expiry:=least(qualification_expiry,qualification.expires_at);
  END LOOP;
  IF binding_count<>2 OR mage_binding_count<>1 OR soulx_binding_count<>1
     OR qualification_expiry<=db_now+interval '30 minutes' THEN
    RAISE EXCEPTION 'hosted V2-09 candidate renewal authority horizon is too short' USING ERRCODE='55000';
  END IF;
  renewed_expires_at:=least(db_now+interval '1 hour',qualification_expiry);
  renewed_approval_id:=public.videoforge_hosted_v209_uuid(
    'approval',request.id,'renewal:'||supplied_audit_id::text);
  approval_base:=jsonb_build_object(
    'schemaVersion','videoforge.hosted-v209-paid-approval/v1',
    'accountId',approval.account_id,'workspaceId',approval.workspace_id,
    'projectId',approval.project_id,'projectRevisionId',approval.project_revision_id,
    'generationRequestId',approval.generation_request_id,
    'generationPlanSha256',approval.generation_plan_sha256,'leaseId',approval.lease_id,
    'laneBindings',approval.lane_bindings,'totalCapUsd',approval.maximum_cumulative_finite_cap_usd,
    'expiresAt',to_char(renewed_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  renewed_approval_sha:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(approval_base),'UTF8')),'hex');
  renewed_candidate_document:=jsonb_set(jsonb_set(jsonb_set(candidate.candidate_document,
    '{approvalId}',to_jsonb(renewed_approval_id::text),true),
    '{approvalSha256}',to_jsonb(renewed_approval_sha),true),
    '{expiresAt}',to_jsonb(to_char(renewed_expires_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),true);
  renewed_candidate_sha:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(renewed_candidate_document),'UTF8')),'hex');
  INSERT INTO public.hosted_paid_dispatch_approvals(
    id,approval_sha256,account_id,workspace_id,project_id,project_revision_id,
    generation_request_id,generation_plan_sha256,lease_id,lane_bindings,
    maximum_cumulative_finite_cap_usd,expires_at,approved_by_operator,approved_at,created_at)
  VALUES(renewed_approval_id,renewed_approval_sha,approval.account_id,approval.workspace_id,
    approval.project_id,approval.project_revision_id,approval.generation_request_id,
    approval.generation_plan_sha256,approval.lease_id,approval.lane_bindings,
    approval.maximum_cumulative_finite_cap_usd,renewed_expires_at,
    'DB_OWNED_V2_09_CANDIDATE_RENEWAL',db_now,db_now);
  INSERT INTO public.hosted_v209_ordinary_dispatch_candidate_renewals(
    generation_request_id,account_id,workspace_id,project_id,project_revision_id,lease_id,
    original_candidate_sha256,original_approval_id,candidate_sha256,approval_id,candidate_document,
    expires_at,audit_id,created_at)
  VALUES(request.id,request.account_id,request.workspace_id,request.project_id,request.project_revision_id,
    lease.id,candidate.candidate_sha256,candidate.approval_id,renewed_candidate_sha,renewed_approval_id,
    renewed_candidate_document,renewed_expires_at,supplied_audit_id,db_now);
  UPDATE public.provider_workload_leases
     SET heartbeat_at=db_now,expires_at=renewed_expires_at,version=version+1
   WHERE id=lease.id AND account_id=supplied_account_id AND workspace_id=supplied_workspace_id
     AND generation_request_id=request.id AND state='ACTIVE'
     AND version=supplied_expected_lease_version AND slot=1
     AND expires_at<=db_now AND released_at IS NULL AND release_reason IS NULL;
  GET DIAGNOSTICS changed_count=ROW_COUNT;
  IF changed_count<>1 THEN
    RAISE EXCEPTION 'hosted V2-09 candidate renewal lease CAS failed' USING ERRCODE='40001';
  END IF;
  SELECT row.* INTO capacity_after FROM public.global_generation_capacity row
   WHERE row.singleton FOR UPDATE;
  IF to_jsonb(capacity_before)<>to_jsonb(capacity_after) THEN
    RAISE EXCEPTION 'hosted V2-09 candidate renewal changed capacity' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.generation_queue_audits(
    id,account_id,workspace_id,actor_user_id,operation,request_kind,request_id,lease_id,
    request_version_before,request_version_after,video_cursor_before,video_cursor_after,
    preview_cursor_before,preview_cursor_after,detail,occurred_at)
  VALUES(supplied_audit_id,request.account_id,request.workspace_id,supplied_user_id,'HEARTBEAT','VIDEO',
    request.id,lease.id,request.version,request.version,capacity_before.video_fair_cursor,
    capacity_after.video_fair_cursor,capacity_before.preview_fair_cursor,capacity_after.preview_fair_cursor,
    jsonb_build_object('sameGenerationCandidateRenewal',true,
      'leaseVersionBefore',supplied_expected_lease_version,
      'leaseVersionAfter',supplied_expected_lease_version+1,
      'originalCandidateSha256',candidate.candidate_sha256,
      'renewedCandidateSha256',renewed_candidate_sha,
      'originalApprovalId',candidate.approval_id,'renewedApprovalId',renewed_approval_id,
      'providerActionsCreated',false),db_now);
  IF (SELECT count(*) FROM public.hosted_v209_ordinary_dispatch_candidate_renewals row
      WHERE row.generation_request_id=request.id AND row.audit_id=supplied_audit_id)<>1
     OR (SELECT version FROM public.provider_workload_leases WHERE id=lease.id)<>supplied_expected_lease_version+1
     OR (SELECT expires_at>db_now FROM public.provider_workload_leases WHERE id=lease.id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'hosted V2-09 candidate renewal postcondition failed' USING ERRCODE='55000';
  END IF;
  RETURN jsonb_build_object('schemaVersion','videoforge.v2-09-candidate-renewal/v1',
    'generationRequestId',request.id,'leaseId',lease.id,
    'leaseVersionBefore',supplied_expected_lease_version,
    'leaseVersionAfter',supplied_expected_lease_version+1,
    'leaseExpiresAt',to_char(renewed_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'originalCandidateSha256',candidate.candidate_sha256,
    'renewedCandidateSha256',renewed_candidate_sha,
    'originalApprovalId',candidate.approval_id,'renewedApprovalId',renewed_approval_id,
    'providerActionsCreated',false,'serverlessAttempts',0,'renderJobs',0);
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_renew_hosted_v209_ordinary_candidate(
  uuid,uuid,uuid,uuid,uuid,uuid,integer,integer,text,uuid,uuid) FROM PUBLIC;

-- Existing 0074/0075/0081/0090/0092 bodies keep their locking and write paths. Patch only the
-- exact eleven readers that existed at migration 94. Any additional candidate consumer is a
-- migration-time failure; this prevents an unrelated public function from being rewritten.
DO $patch_candidate_readers$
DECLARE
  expected text[]:=ARRAY[
    'videoforge_accept_hosted_v209_terminal_output(uuid,uuid,uuid,text,text,text,jsonb,jsonb,timestamp with time zone)',
    'videoforge_assert_hosted_v209_ordinary_avatar_source(uuid,uuid,uuid)',
    'videoforge_has_hosted_v209_ordinary_candidate(uuid,uuid,uuid)',
    'videoforge_materialize_hosted_v209_ordinary_dispatch(uuid,uuid,uuid,uuid)',
    'videoforge_read_hosted_v209_ready_render_inputs_v1(uuid,uuid,uuid)',
    'videoforge_read_hosted_v209_terminal_lineage(uuid,uuid,uuid,text,text)',
    'videoforge_resume_hosted_v209_ordinary_lane_materialization(uuid,uuid,uuid,text)',
    'videoforge_v209_ordinary_commit_lane_legacy_0081(uuid,uuid,uuid,text,uuid,text,jsonb,text)',
    'videoforge_v209_ordinary_load_lane_legacy_0081(uuid,uuid,uuid,text)',
    'videoforge_v209_ordinary_materialize_legacy_0081(uuid,uuid,uuid,uuid)',
    'videoforge_v209_ordinary_pair_legacy_0081(uuid,uuid,uuid,uuid,jsonb)'
  ]::text[];
  direct text[]:=ARRAY[
    'videoforge_accept_hosted_v209_terminal_output(uuid,uuid,uuid,text,text,text,jsonb,jsonb,timestamp with time zone)',
    'videoforge_assert_hosted_v209_ordinary_avatar_source(uuid,uuid,uuid)',
    'videoforge_materialize_hosted_v209_ordinary_dispatch(uuid,uuid,uuid,uuid)',
    'videoforge_read_hosted_v209_ready_render_inputs_v1(uuid,uuid,uuid)',
    'videoforge_resume_hosted_v209_ordinary_lane_materialization(uuid,uuid,uuid,text)',
    'videoforge_v209_ordinary_commit_lane_legacy_0081(uuid,uuid,uuid,text,uuid,text,jsonb,text)',
    'videoforge_v209_ordinary_load_lane_legacy_0081(uuid,uuid,uuid,text)',
    'videoforge_v209_ordinary_materialize_legacy_0081(uuid,uuid,uuid,uuid)',
    'videoforge_v209_ordinary_pair_legacy_0081(uuid,uuid,uuid,uuid,jsonb)'
  ]::text[];
  joins text[]:=ARRAY[
    'videoforge_read_hosted_v209_ready_render_inputs_v1(uuid,uuid,uuid)',
    'videoforge_read_hosted_v209_terminal_lineage(uuid,uuid,uuid,text,text)'
  ]::text[];
  target_signature text; target_oid oid; target_count integer;
  definition text; patched text; unexpected text;
  direct_matches integer; join_matches integer; from_matches integer;
BEGIN
  SELECT count(*) INTO target_count
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f'
     AND p.oid::regprocedure::text=ANY(expected);
  IF target_count<>array_length(expected,1) THEN
    RAISE EXCEPTION 'hosted V2-09 candidate reader allowlist incomplete: expected %, found %',
      array_length(expected,1),target_count USING ERRCODE='55000';
  END IF;
  SELECT string_agg(p.oid::regprocedure::text,',' ORDER BY p.oid::regprocedure::text) INTO unexpected
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f'
     AND pg_get_functiondef(p.oid) LIKE '%public.hosted_v209_ordinary_dispatch_candidates%'
     AND NOT (p.oid::regprocedure::text=ANY(expected))
     AND p.oid::regprocedure::text NOT IN (
       'videoforge_effective_hosted_v209_candidate(uuid,uuid,uuid)',
       'videoforge_renew_hosted_v209_ordinary_candidate(uuid,uuid,uuid,uuid,uuid,uuid,integer,integer,text,uuid,uuid)');
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'unexpected hosted V2-09 candidate consumer: %',unexpected USING ERRCODE='55000';
  END IF;
  FOREACH target_signature IN ARRAY expected LOOP
    SELECT p.oid INTO target_oid
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prokind='f'
       AND p.oid::regprocedure::text=target_signature;
    definition:=pg_get_functiondef(target_oid);
    patched:=definition;
    IF target_signature=ANY(joins) THEN
      SELECT count(*) INTO join_matches FROM regexp_matches(definition,
        'JOIN[[:space:]]+public\.hosted_v209_ordinary_dispatch_candidates[[:space:]]+(AS[[:space:]]+)?','g');
      IF join_matches<>1 THEN
        RAISE EXCEPTION 'candidate reader join preimage drifted: %',target_signature USING ERRCODE='55000';
      END IF;
      patched:=replace(patched,'JOIN public.hosted_v209_ordinary_dispatch_candidates ',
        'JOIN public.hosted_v209_ordinary_dispatch_candidates_effective ');
      patched:=replace(patched,'JOIN public.hosted_v209_ordinary_dispatch_candidates AS ',
        'JOIN public.hosted_v209_ordinary_dispatch_candidates_effective AS ');
    END IF;
    IF target_signature=ANY(direct) THEN
      SELECT count(*) INTO direct_matches FROM regexp_matches(definition,
        '(SELECT[[:space:]]+([[:alnum:]_]+\.)?\*[[:space:]]+INTO[[:space:]]+(candidate|stored)[[:space:]]+FROM[[:space:]]+public\.hosted_v209_ordinary_dispatch_candidates[^;]*;)','g');
      IF direct_matches<>1 THEN
        RAISE EXCEPTION 'candidate reader direct preimage drifted: %',target_signature USING ERRCODE='55000';
      END IF;
      patched:=regexp_replace(patched,
        '(SELECT[[:space:]]+([[:alnum:]_]+\.)?\*[[:space:]]+INTO[[:space:]]+(candidate|stored)[[:space:]]+FROM[[:space:]]+public\.hosted_v209_ordinary_dispatch_candidates[^;]*;)',
        E'\\1\n  \\3:=public.videoforge_effective_hosted_v209_candidate(\n    supplied_account_id,supplied_workspace_id,\\3.generation_request_id);',1,1);
    END IF;
    IF target_signature='videoforge_has_hosted_v209_ordinary_candidate(uuid,uuid,uuid)' THEN
      SELECT count(*) INTO from_matches FROM regexp_matches(definition,
        'FROM[[:space:]]+public\.hosted_v209_ordinary_dispatch_candidates[[:space:]]+','g');
      IF from_matches<>1 THEN
        RAISE EXCEPTION 'candidate existence preimage drifted: %',target_signature USING ERRCODE='55000';
      END IF;
      patched:=replace(patched,'FROM public.hosted_v209_ordinary_dispatch_candidates ',
        'FROM public.hosted_v209_ordinary_dispatch_candidates_effective ');
    END IF;
    IF patched=definition OR (patched NOT LIKE '%videoforge_effective_hosted_v209_candidate%'
      AND patched NOT LIKE '%hosted_v209_ordinary_dispatch_candidates_effective%') THEN
      RAISE EXCEPTION 'candidate reader was not overlaid: %',target_signature USING ERRCODE='55000';
    END IF;
    EXECUTE patched;
  END LOOP;
  SELECT count(*) INTO target_count
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f'
     AND p.oid::regprocedure::text=ANY(expected)
     AND (pg_get_functiondef(p.oid) LIKE '%videoforge_effective_hosted_v209_candidate%'
       OR pg_get_functiondef(p.oid) LIKE '%hosted_v209_ordinary_dispatch_candidates_effective%');
  IF target_count<>array_length(expected,1) THEN
    RAISE EXCEPTION 'hosted V2-09 candidate reader overlay incomplete: % of %',target_count,
      array_length(expected,1) USING ERRCODE='55000';
  END IF;
END
$patch_candidate_readers$;

REVOKE ALL ON public.hosted_v209_ordinary_dispatch_candidates_effective FROM PUBLIC;

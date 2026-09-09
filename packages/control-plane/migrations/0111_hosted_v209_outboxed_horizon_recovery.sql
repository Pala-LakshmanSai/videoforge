-- One-use recovery for an exact hosted V2-09 pair which was fully materialized and OUTBOXED,
-- but whose admission lease expired before the first provider transport call.  The immutable
-- predispatch authority and materialized envelope remain the upper bound: this function cannot
-- extend them, replace a token, create a provider call, or make a sent row sendable again.

CREATE TABLE public.hosted_v209_outboxed_horizon_recoveries (
  operation_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  generation_request_id uuid NOT NULL UNIQUE,
  lease_id uuid NOT NULL,
  candidate_sha256 text NOT NULL CHECK(candidate_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  approval_id uuid NOT NULL,
  authority_deadline_at timestamptz NOT NULL,
  refreshed_reconciliation_deadline_at timestamptz NOT NULL,
  mage_attempt_id uuid NOT NULL,
  soulx_attempt_id uuid NOT NULL,
  mage_outbox_id uuid NOT NULL,
  soulx_outbox_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(account_id,workspace_id,generation_request_id),
  FOREIGN KEY(account_id,workspace_id,generation_request_id)
    REFERENCES public.generation_requests(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,lease_id)
    REFERENCES public.provider_workload_leases(account_id,workspace_id,id),
  FOREIGN KEY(approval_id) REFERENCES public.hosted_paid_dispatch_approvals(id)
);
CREATE TRIGGER hosted_v209_outboxed_horizon_recoveries_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_v209_outboxed_horizon_recoveries
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
REVOKE ALL ON TABLE public.hosted_v209_outboxed_horizon_recoveries FROM PUBLIC;

CREATE FUNCTION public.videoforge_recover_hosted_v209_outboxed_horizon(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
#variable_conflict use_variable
DECLARE
  db_now timestamptz:=transaction_timestamp();
  operation_id uuid:=(supplied->>'operationId')::uuid;
  account_id uuid:=(supplied->>'accountId')::uuid;
  workspace_id uuid:=(supplied->>'workspaceId')::uuid;
  request_id uuid:=(supplied->>'generationRequestId')::uuid;
  lease_id uuid:=(supplied->>'leaseId')::uuid;
  expected_lease_version integer:=(supplied->>'expectedLeaseVersion')::integer;
  expected_candidate_sha text:=supplied->>'expectedCandidateSha256';
  expected_approval_id uuid:=(supplied->>'expectedApprovalId')::uuid;
  expected_authority_deadline timestamptz:=(supplied->>'expectedAuthorityDeadlineAt')::timestamptz;
  requested_reconciliation_deadline timestamptz:=(supplied->>'refreshedReconciliationDeadlineAt')::timestamptz;
  request public.generation_requests%ROWTYPE;
  lease public.provider_workload_leases%ROWTYPE;
  candidate public.hosted_v209_ordinary_dispatch_candidates%ROWTYPE;
  approval public.hosted_paid_dispatch_approvals%ROWTYPE;
  claim public.hosted_paid_dispatch_claims%ROWTYPE;
  mage public.serverless_attempts%ROWTYPE;
  soulx public.serverless_attempts%ROWTYPE;
  mage_outbox public.serverless_dispatch_outbox%ROWTYPE;
  soulx_outbox public.serverless_dispatch_outbox%ROWTYPE;
  authority_count integer; materialization_count integer; changed_count integer;
  min_authority_deadline timestamptz; max_authority_deadline timestamptz;
  min_qualification_expiry timestamptz;
  renewed_approval_id uuid; approval_base jsonb; renewed_approval_sha text;
  renewed_candidate_document jsonb; renewed_candidate_sha text;
BEGIN
  IF jsonb_typeof(supplied) IS DISTINCT FROM 'object'
     OR supplied - ARRAY['schemaVersion','operationId','accountId','workspaceId',
       'generationRequestId','leaseId','expectedLeaseVersion','expectedCandidateSha256',
       'expectedApprovalId','expectedAuthorityDeadlineAt','refreshedReconciliationDeadlineAt']::text[] <> '{}'::jsonb
     OR supplied->>'schemaVersion'<>'videoforge.hosted-v209-outboxed-horizon-recovery/v1'
     OR expected_candidate_sha !~ '^sha256:[0-9a-f]{64}$'
     OR public.videoforge_current_account_id() IS DISTINCT FROM account_id THEN
    RAISE EXCEPTION 'hosted V2-09 outboxed recovery scope invalid' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM public.hosted_v209_outboxed_horizon_recoveries r
    WHERE r.operation_id=operation_id AND r.account_id=account_id AND r.workspace_id=workspace_id
      AND r.generation_request_id=request_id AND r.lease_id=lease_id) THEN
    RETURN (SELECT jsonb_build_object('operationId',r.operation_id,'generationRequestId',r.generation_request_id,
      'candidateSha256',r.candidate_sha256,'approvalId',r.approval_id,
      'authorityDeadlineAt',to_char(r.authority_deadline_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'refreshedReconciliationDeadlineAt',to_char(r.refreshed_reconciliation_deadline_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'providerActionsCreated',false) FROM public.hosted_v209_outboxed_horizon_recoveries r
      WHERE r.operation_id=operation_id AND r.account_id=account_id AND r.workspace_id=workspace_id
        AND r.generation_request_id=request_id AND r.lease_id=lease_id);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(request_id::text,111));
  SELECT r.* INTO request FROM public.generation_requests r
   WHERE r.account_id=account_id AND r.workspace_id=workspace_id AND r.id=request_id FOR UPDATE;
  SELECT l.* INTO lease FROM public.provider_workload_leases l
   WHERE l.account_id=account_id AND l.workspace_id=workspace_id AND l.id=lease_id FOR UPDATE;
  SELECT c.* INTO candidate FROM public.hosted_v209_ordinary_dispatch_candidates c
   WHERE c.account_id=account_id AND c.workspace_id=workspace_id AND c.generation_request_id=request_id FOR SHARE;
  SELECT a.* INTO approval FROM public.hosted_paid_dispatch_approvals a WHERE a.id=candidate.approval_id FOR SHARE;
  SELECT c.* INTO claim FROM public.hosted_paid_dispatch_claims c
   WHERE c.account_id=account_id AND c.workspace_id=workspace_id AND c.generation_request_id=request_id FOR SHARE;
  SELECT a.* INTO mage FROM public.serverless_attempts a
   WHERE a.account_id=account_id AND a.workspace_id=workspace_id AND a.generation_request_id=request_id
     AND a.lane='mage_image' FOR UPDATE;
  SELECT a.* INTO soulx FROM public.serverless_attempts a
   WHERE a.account_id=account_id AND a.workspace_id=workspace_id AND a.generation_request_id=request_id
     AND a.lane='soulx_avatar' FOR UPDATE;
  SELECT o.* INTO mage_outbox FROM public.serverless_dispatch_outbox o WHERE o.attempt_id=mage.id FOR UPDATE;
  SELECT o.* INTO soulx_outbox FROM public.serverless_dispatch_outbox o WHERE o.attempt_id=soulx.id FOR UPDATE;

  SELECT count(*),min(p.deadline_at),max(p.deadline_at)
    INTO authority_count,min_authority_deadline,max_authority_deadline
    FROM public.serverless_predispatch_authorities p
   WHERE p.attempt_id IN (mage.id,soulx.id) AND p.authority_mode='paid'
     AND p.non_transferable AND p.allowed_operations @> ARRAY['serverless_run']::text[];
  SELECT count(*) INTO materialization_count FROM public.hosted_v209_ordinary_lane_materializations m
   JOIN public.serverless_predispatch_authorities p ON p.attempt_id=m.attempt_id
   JOIN public.serverless_dispatch_outbox o ON o.attempt_id=m.attempt_id
   WHERE m.account_id=account_id AND m.workspace_id=workspace_id AND m.generation_request_id=request_id
     AND m.envelope_sha256=p.envelope_sha256 AND p.request_body_sha256=o.request_body_sha256
     AND date_trunc('milliseconds',(m.request_body#>>'{envelope,limits,expires_at}')::timestamptz)
         =date_trunc('milliseconds',p.deadline_at);
  SELECT min(q.expires_at) INTO min_qualification_expiry
    FROM public.serverless_predispatch_authorities p
    JOIN public.serverless_endpoint_deployments d ON d.id=p.deployment_id AND d.is_active
    JOIN public.hosted_serverless_qualification_attestations q ON q.deployment_id=d.id AND q.lane=d.lane
      AND q.independent_audit_accepted AND q.deployment_snapshot_sha256=public.videoforge_hosted_deployment_snapshot_sha256(d.id)
   WHERE p.attempt_id IN (mage.id,soulx.id) AND q.expires_at>db_now;

  IF request.id IS NULL OR request.state<>'ACTIVE' OR request.terminal_at IS NOT NULL
     OR lease.id IS NULL OR lease.generation_request_id<>request.id OR lease.state<>'ACTIVE'
     OR lease.released_at IS NOT NULL OR lease.release_reason IS NOT NULL OR lease.slot<>1
     OR lease.version<>expected_lease_version OR lease.expires_at>db_now
     OR candidate.id IS NULL OR candidate.lease_id<>lease.id
     OR candidate.candidate_sha256<>expected_candidate_sha OR candidate.approval_id<>expected_approval_id
     OR candidate.expires_at>db_now OR approval.id IS NULL OR approval.expires_at>db_now
     OR claim.id IS NULL OR claim.approval_id<>approval.id OR claim.approval_sha256<>approval.approval_sha256
     OR claim.lease_id<>lease.id OR claim.generation_request_id<>request.id
     OR EXISTS(SELECT 1 FROM public.hosted_v209_ordinary_dispatch_candidate_renewals r
       WHERE r.account_id=account_id AND r.workspace_id=workspace_id AND r.generation_request_id=request_id)
     OR mage.id IS NULL OR soulx.id IS NULL OR mage.state<>'OUTBOXED' OR soulx.state<>'OUTBOXED'
     OR mage.submitted_at IS NOT NULL OR soulx.submitted_at IS NOT NULL
     OR mage_outbox.id IS NULL OR soulx_outbox.id IS NULL
     OR mage_outbox.state<>'READY_TO_DISPATCH' OR soulx_outbox.state<>'READY_TO_DISPATCH'
     OR mage_outbox.send_attempt_count<>0 OR soulx_outbox.send_attempt_count<>0
     OR mage_outbox.version<>1 OR soulx_outbox.version<>1
     OR EXISTS(SELECT 1 FROM public.serverless_provider_assignments x WHERE x.attempt_id IN(mage.id,soulx.id))
     OR authority_count<>2 OR materialization_count<>2
     OR min_authority_deadline<>max_authority_deadline
     OR min_authority_deadline<>expected_authority_deadline
     OR mage.deadline_at<>expected_authority_deadline OR soulx.deadline_at<>expected_authority_deadline
     OR min_qualification_expiry IS NULL OR min_qualification_expiry<=expected_authority_deadline
     OR db_now>=expected_authority_deadline-interval '2 minutes'
     OR requested_reconciliation_deadline<=db_now+interval '1 minute'
     OR requested_reconciliation_deadline>expected_authority_deadline THEN
    RAISE EXCEPTION 'hosted V2-09 outboxed recovery precondition drifted' USING ERRCODE='55000';
  END IF;

  renewed_approval_id:=public.videoforge_hosted_v209_uuid('approval',request.id,'renewal:'||operation_id::text);
  approval_base:=jsonb_build_object('schemaVersion','videoforge.hosted-v209-paid-approval/v1',
    'accountId',approval.account_id,'workspaceId',approval.workspace_id,'projectId',approval.project_id,
    'projectRevisionId',approval.project_revision_id,'generationRequestId',approval.generation_request_id,
    'generationPlanSha256',approval.generation_plan_sha256,'leaseId',approval.lease_id,
    'laneBindings',approval.lane_bindings,'totalCapUsd',approval.maximum_cumulative_finite_cap_usd,
    'expiresAt',to_char(expected_authority_deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  renewed_approval_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(approval_base),'UTF8')),'hex');
  renewed_candidate_document:=jsonb_set(jsonb_set(jsonb_set(candidate.candidate_document,
    '{approvalId}',to_jsonb(renewed_approval_id::text),true),'{approvalSha256}',to_jsonb(renewed_approval_sha),true),
    '{expiresAt}',to_jsonb(to_char(expected_authority_deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),true);
  renewed_candidate_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(renewed_candidate_document),'UTF8')),'hex');

  INSERT INTO public.hosted_paid_dispatch_approvals(id,approval_sha256,account_id,workspace_id,project_id,
    project_revision_id,generation_request_id,generation_plan_sha256,lease_id,lane_bindings,
    maximum_cumulative_finite_cap_usd,expires_at,approved_by_operator,approved_at,created_at)
  VALUES(renewed_approval_id,renewed_approval_sha,approval.account_id,approval.workspace_id,approval.project_id,
    approval.project_revision_id,approval.generation_request_id,approval.generation_plan_sha256,approval.lease_id,
    approval.lane_bindings,approval.maximum_cumulative_finite_cap_usd,expected_authority_deadline,
    'DB_OWNED_V2_09_OUTBOXED_HORIZON_RECOVERY',db_now,db_now);
  INSERT INTO public.hosted_v209_ordinary_dispatch_candidate_renewals(generation_request_id,account_id,
    workspace_id,project_id,project_revision_id,lease_id,original_candidate_sha256,original_approval_id,
    candidate_sha256,approval_id,candidate_document,expires_at,audit_id,created_at,renewal_ordinal,
    previous_candidate_sha256,previous_approval_id)
  VALUES(request.id,candidate.account_id,candidate.workspace_id,candidate.project_id,candidate.project_revision_id,
    lease.id,candidate.candidate_sha256,candidate.approval_id,renewed_candidate_sha,renewed_approval_id,
    renewed_candidate_document,expected_authority_deadline,operation_id,db_now,1,NULL,NULL);
  UPDATE public.provider_workload_leases l SET heartbeat_at=db_now,expires_at=expected_authority_deadline,
    version=l.version+1 WHERE l.id=lease.id AND l.version=expected_lease_version AND l.state='ACTIVE'
    AND l.expires_at<=db_now AND l.released_at IS NULL;
  GET DIAGNOSTICS changed_count=ROW_COUNT;
  IF changed_count<>1 THEN RAISE EXCEPTION 'hosted V2-09 outboxed recovery lease CAS failed' USING ERRCODE='40001'; END IF;
  UPDATE public.serverless_attempts a SET reconciliation_deadline_at=requested_reconciliation_deadline,
    updated_at=db_now,version=a.version+1 WHERE a.id IN(mage.id,soulx.id) AND a.state='OUTBOXED'
    AND a.submitted_at IS NULL AND a.reconciliation_deadline_at<db_now;
  GET DIAGNOSTICS changed_count=ROW_COUNT;
  IF changed_count<>2 THEN RAISE EXCEPTION 'hosted V2-09 outboxed recovery attempt CAS failed' USING ERRCODE='40001'; END IF;
  INSERT INTO public.hosted_v209_outboxed_horizon_recoveries(operation_id,account_id,workspace_id,
    generation_request_id,lease_id,candidate_sha256,approval_id,authority_deadline_at,
    refreshed_reconciliation_deadline_at,mage_attempt_id,soulx_attempt_id,mage_outbox_id,soulx_outbox_id)
  VALUES(operation_id,account_id,workspace_id,request.id,lease.id,renewed_candidate_sha,renewed_approval_id,
    expected_authority_deadline,requested_reconciliation_deadline,mage.id,soulx.id,mage_outbox.id,soulx_outbox.id);
  RETURN jsonb_build_object('operationId',operation_id,'generationRequestId',request.id,
    'candidateSha256',renewed_candidate_sha,'approvalId',renewed_approval_id,
    'authorityDeadlineAt',to_char(expected_authority_deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'refreshedReconciliationDeadlineAt',to_char(requested_reconciliation_deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'providerActionsCreated',false);
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_recover_hosted_v209_outboxed_horizon(jsonb) FROM PUBLIC;

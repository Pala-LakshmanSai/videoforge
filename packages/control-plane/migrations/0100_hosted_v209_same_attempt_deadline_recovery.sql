-- Migration 0100: recover one already-admitted V2-09 pair whose Workflow schedule expired
-- before the first provider-sendable materialization.  The recovery is append-only evidence and
-- is available only for the exact two PLANNED attempts; it never creates a new generation or
-- provider action.

ALTER TABLE public.hosted_v209_ordinary_dispatch_candidate_renewals
  DROP CONSTRAINT hosted_v209_renewal_ordinal_check,
  DROP CONSTRAINT hosted_v209_renewal_predecessor_check,
  ADD CONSTRAINT hosted_v209_renewal_ordinal_check CHECK(renewal_ordinal IN (1,2,3,4,5)),
  ADD CONSTRAINT hosted_v209_renewal_predecessor_check
    CHECK((renewal_ordinal=1 AND previous_candidate_sha256 IS NULL AND previous_approval_id IS NULL)
    OR (renewal_ordinal IN (2,3,4,5) AND previous_candidate_sha256 IS NOT NULL
      AND previous_candidate_sha256 ~ '^sha256:[0-9a-f]{64}$'
      AND previous_approval_id IS NOT NULL));

-- The effective reader must accept exactly the base candidate plus five possible renewal
-- ordinals.  The body is patched from the 0099 definition so all lineage checks remain identical.
DO $patch_effective_candidate_ordinal5$
DECLARE
  signature constant text:='videoforge_effective_hosted_v209_candidate(uuid,uuid,uuid)';
  definition text; patched text; target_count integer;
BEGIN
  SELECT count(*),min(pg_get_functiondef(p.oid)) INTO target_count,definition
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.oid::regprocedure::text=signature;
  IF target_count<>1
     OR position('IF expected_ordinal>5 THEN' IN definition)=0
     OR (length(definition)-length(replace(definition,'IF expected_ordinal>5 THEN','')))
          /length('IF expected_ordinal>5 THEN')<>1 THEN
    RAISE EXCEPTION 'hosted V2-09 effective candidate preimage drifted' USING ERRCODE='55000';
  END IF;
  patched:=replace(definition,'IF expected_ordinal>5 THEN','IF expected_ordinal>6 THEN');
  IF patched=definition
     OR position('IF expected_ordinal>5 THEN' IN patched)>0
     OR position('IF expected_ordinal>6 THEN' IN patched)=0 THEN
    RAISE EXCEPTION 'hosted V2-09 effective candidate ordinal patch failed' USING ERRCODE='55000';
  END IF;
  EXECUTE patched;
END
$patch_effective_candidate_ordinal5$;

-- The token recovery reader must retain the immutable claim as lineage, while resolving freshness
-- from the effective same-generation candidate/approval.  The original claim and approval are
-- append-only evidence and may have expired before this one-use recovery is consumed.
DO $patch_effective_token_recovery$
DECLARE
  signature constant text:='videoforge_recover_hosted_atomic_pair_tokens(uuid,uuid,uuid)';
  definition text; patched text; target_count integer;
  stale_predicate constant text:='AND c.expires_at>transaction_timestamp() AND p.expires_at>transaction_timestamp()';
  effective_join constant text:='JOIN public.hosted_paid_dispatch_approvals p ON p.id=c.approval_id';
BEGIN
  SELECT count(*),min(pg_get_functiondef(p.oid)) INTO target_count,definition
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.oid::regprocedure::text=signature;
  IF target_count<>1 OR position(stale_predicate IN definition)=0
     OR position(effective_join IN definition)=0
     OR position('AND c.approval_sha256=p.approval_sha256' IN definition)>0 THEN
    RAISE EXCEPTION 'hosted V2-09 token recovery preimage drifted' USING ERRCODE='55000';
  END IF;
  patched:=replace(definition,effective_join,effective_join||chr(10)||
    '    CROSS JOIN LATERAL public.videoforge_effective_hosted_v209_candidate('||
      'v.account_id,v.workspace_id,v.generation_request_id) effective_candidate'||chr(10)||
    '    JOIN public.hosted_paid_dispatch_approvals effective_approval'||
      ' ON effective_approval.id=effective_candidate.approval_id');
  patched:=replace(patched,stale_predicate,
    'AND c.approval_sha256=p.approval_sha256'||chr(10)||
    '     AND effective_candidate.id IS NOT NULL'||chr(10)||
    '     AND effective_candidate.generation_request_id=c.generation_request_id'||chr(10)||
    '     AND effective_candidate.project_id=c.project_id'||chr(10)||
    '     AND effective_candidate.project_revision_id=c.project_revision_id'||chr(10)||
    '     AND effective_candidate.lease_id=c.lease_id'||chr(10)||
    '     AND effective_candidate.generation_plan_sha256=c.generation_plan_sha256'||chr(10)||
    '     AND effective_candidate.candidate_document->''laneBindings'' IS NOT DISTINCT FROM c.lane_bindings'||chr(10)||
    '     AND effective_candidate.expires_at>transaction_timestamp()'||chr(10)||
    '     AND effective_approval.account_id=c.account_id'||chr(10)||
    '     AND effective_approval.workspace_id=c.workspace_id'||chr(10)||
    '     AND effective_approval.project_id=c.project_id'||chr(10)||
    '     AND effective_approval.project_revision_id=c.project_revision_id'||chr(10)||
    '     AND effective_approval.generation_request_id=c.generation_request_id'||chr(10)||
    '     AND effective_approval.lease_id=c.lease_id'||chr(10)||
    '     AND effective_approval.generation_plan_sha256=c.generation_plan_sha256'||chr(10)||
    '     AND effective_approval.lane_bindings IS NOT DISTINCT FROM c.lane_bindings'||chr(10)||
    '     AND effective_approval.maximum_cumulative_finite_cap_usd=c.total_cap_usd'||chr(10)||
    '     AND effective_approval.expires_at>transaction_timestamp()');
  IF patched=definition OR position(stale_predicate IN patched)>0
     OR position('effective_candidate.expires_at>transaction_timestamp()' IN patched)=0
     OR position('effective_approval.expires_at>transaction_timestamp()' IN patched)=0
     OR position('effective_candidate.candidate_document->''laneBindings''' IN patched)=0 THEN
    RAISE EXCEPTION 'hosted V2-09 token recovery patch failed' USING ERRCODE='55000';
  END IF;
  EXECUTE patched;
END
$patch_effective_token_recovery$;

CREATE TABLE public.hosted_v209_same_attempt_deadline_recoveries (
  operation_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  generation_request_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  source_lease_version integer NOT NULL CHECK(source_lease_version>0),
  lease_version integer NOT NULL CHECK(lease_version>0),
  source_candidate_sha256 text NOT NULL CHECK(source_candidate_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  source_approval_id uuid NOT NULL,
  source_candidate_expires_at timestamptz NOT NULL,
  source_approval_sha256 text NOT NULL CHECK(source_approval_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  source_approval_expires_at timestamptz NOT NULL,
  source_lease_expires_at timestamptz NOT NULL,
  previous_candidate_sha256 text NOT NULL CHECK(previous_candidate_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  previous_approval_id uuid NOT NULL,
  candidate_sha256 text NOT NULL CHECK(candidate_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  approval_id uuid NOT NULL,
  approval_sha256 text NOT NULL CHECK(approval_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  renewal_ordinal smallint NOT NULL CHECK(renewal_ordinal=5),
  mage_attempt_id uuid NOT NULL,
  soulx_attempt_id uuid NOT NULL,
  mage_source_version integer NOT NULL CHECK(mage_source_version>0),
  soulx_source_version integer NOT NULL CHECK(soulx_source_version>0),
  source_database_observed_at timestamptz NOT NULL,
  source_cancel_at timestamptz NOT NULL,
  source_stop_at timestamptz NOT NULL,
  mage_source_created_at timestamptz NOT NULL,
  mage_source_deadline_at timestamptz NOT NULL,
  mage_source_reconciliation_deadline_at timestamptz NOT NULL,
  soulx_source_created_at timestamptz NOT NULL,
  soulx_source_deadline_at timestamptz NOT NULL,
  soulx_source_reconciliation_deadline_at timestamptz NOT NULL,
  refreshed_database_observed_at timestamptz NOT NULL,
  refreshed_cancel_at timestamptz NOT NULL,
  refreshed_stop_at timestamptz NOT NULL,
  mage_refreshed_created_at timestamptz NOT NULL,
  mage_refreshed_deadline_at timestamptz NOT NULL,
  mage_refreshed_reconciliation_deadline_at timestamptz NOT NULL,
  mage_refreshed_version integer NOT NULL CHECK(mage_refreshed_version>0),
  soulx_refreshed_created_at timestamptz NOT NULL,
  soulx_refreshed_deadline_at timestamptz NOT NULL,
  soulx_refreshed_reconciliation_deadline_at timestamptz NOT NULL,
  soulx_refreshed_version integer NOT NULL CHECK(soulx_refreshed_version>0),
  refreshed_lease_expires_at timestamptz NOT NULL,
  refreshed_candidate_expires_at timestamptz NOT NULL,
  refreshed_approval_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(account_id,workspace_id,generation_request_id),
  UNIQUE(account_id,workspace_id,operation_id),
  FOREIGN KEY(account_id,workspace_id,project_id)
    REFERENCES public.projects(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,project_revision_id)
    REFERENCES public.project_revisions(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,generation_request_id)
    REFERENCES public.generation_requests(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,lease_id)
    REFERENCES public.provider_workload_leases(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,claim_id)
    REFERENCES public.hosted_paid_dispatch_claims(account_id,workspace_id,id),
  FOREIGN KEY(source_approval_id) REFERENCES public.hosted_paid_dispatch_approvals(id),
  FOREIGN KEY(previous_approval_id) REFERENCES public.hosted_paid_dispatch_approvals(id),
  FOREIGN KEY(approval_id) REFERENCES public.hosted_paid_dispatch_approvals(id),
  FOREIGN KEY(account_id,workspace_id,mage_attempt_id)
    REFERENCES public.serverless_attempts(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,soulx_attempt_id)
    REFERENCES public.serverless_attempts(account_id,workspace_id,id),
  CHECK(mage_attempt_id<>soulx_attempt_id),
  CHECK(lease_version=source_lease_version+1),
  CHECK(mage_refreshed_version=mage_source_version+1),
  CHECK(soulx_refreshed_version=soulx_source_version+1),
  CHECK(previous_candidate_sha256=source_candidate_sha256),
  CHECK(previous_approval_id=source_approval_id),
  CHECK(source_cancel_at=source_database_observed_at+interval '20 minutes'),
  CHECK(source_stop_at=source_database_observed_at+interval '30 minutes'),
  CHECK(source_stop_at>source_cancel_at),
  CHECK(refreshed_cancel_at=refreshed_database_observed_at+interval '20 minutes'),
  CHECK(refreshed_stop_at=refreshed_database_observed_at+interval '30 minutes'),
  CHECK(refreshed_stop_at>refreshed_cancel_at),
  CHECK(mage_refreshed_reconciliation_deadline_at<=mage_refreshed_deadline_at),
  CHECK(soulx_refreshed_reconciliation_deadline_at<=soulx_refreshed_deadline_at),
  CHECK(refreshed_lease_expires_at>refreshed_stop_at),
  CHECK(refreshed_candidate_expires_at>refreshed_stop_at),
  CHECK(refreshed_approval_expires_at>refreshed_stop_at)
);

CREATE TRIGGER hosted_v209_same_attempt_deadline_recoveries_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_v209_same_attempt_deadline_recoveries
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_v209_same_attempt_deadline_recoveries_tenant_write_guard
  BEFORE INSERT ON public.hosted_v209_same_attempt_deadline_recoveries
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE public.hosted_v209_same_attempt_deadline_recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_v209_same_attempt_deadline_recoveries FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_v209_same_attempt_deadline_recoveries_tenant_rls
  ON public.hosted_v209_same_attempt_deadline_recoveries
  USING(account_id=public.videoforge_current_account_id())
  WITH CHECK(account_id=public.videoforge_current_account_id());
REVOKE ALL ON TABLE public.hosted_v209_same_attempt_deadline_recoveries FROM PUBLIC;

-- Normal scheduling reads the immutable admission schedule unless this exact recovery row exists.
-- The overlay is deliberately narrow: it cannot affect a generation with zero or a partial pair.
CREATE OR REPLACE FUNCTION public.videoforge_load_hosted_pair_workflow_schedule(uuid,uuid,uuid)
RETURNS TABLE(existing_pair boolean,cancel_at timestamptz,stop_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  claim public.hosted_paid_dispatch_claims%ROWTYPE;
  admission public.hosted_v209_short_admissions%ROWTYPE;
  request public.generation_requests%ROWTYPE;
  effective_candidate public.hosted_v209_ordinary_dispatch_candidates%ROWTYPE;
  effective_approval public.hosted_paid_dispatch_approvals%ROWTYPE;
  fifth_renewal public.hosted_v209_ordinary_dispatch_candidate_renewals%ROWTYPE;
  lease public.provider_workload_leases%ROWTYPE;
  mage public.serverless_attempts%ROWTYPE;
  soulx public.serverless_attempts%ROWTYPE;
  recovery public.hosted_v209_same_attempt_deadline_recoveries%ROWTYPE;
  pair_count integer; mage_pair_count integer; soulx_pair_count integer; schedule_anchor timestamptz;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM $1 THEN
    RAISE EXCEPTION 'tenant mismatch' USING ERRCODE='42501';
  END IF;
  SELECT * INTO claim FROM public.hosted_paid_dispatch_claims c
   WHERE c.account_id=$1 AND c.workspace_id=$2 AND c.generation_request_id=$3;
  SELECT * INTO admission FROM public.hosted_v209_short_admissions a
   WHERE a.account_id=$1 AND a.workspace_id=$2 AND a.generation_request_id=$3;
  SELECT * INTO request FROM public.generation_requests r
   WHERE r.account_id=$1 AND r.workspace_id=$2 AND r.id=$3;
  SELECT * INTO recovery FROM public.hosted_v209_same_attempt_deadline_recoveries r
   WHERE r.account_id=$1 AND r.workspace_id=$2 AND r.generation_request_id=$3;
  SELECT count(*) INTO pair_count FROM public.serverless_attempts a
   WHERE a.account_id=$1 AND a.workspace_id=$2 AND a.generation_request_id=$3
     AND a.lane IN ('mage_image','soulx_avatar');
  SELECT count(*) FILTER (WHERE a.lane='mage_image'),count(*) FILTER (WHERE a.lane='soulx_avatar')
    INTO mage_pair_count,soulx_pair_count
    FROM public.serverless_attempts a
   WHERE a.account_id=$1 AND a.workspace_id=$2 AND a.generation_request_id=$3
     AND a.lane IN ('mage_image','soulx_avatar');
  IF pair_count NOT IN (0,2)
     OR mage_pair_count NOT IN (0,1) OR soulx_pair_count NOT IN (0,1)
     OR (pair_count=2 AND (mage_pair_count<>1 OR soulx_pair_count<>1))
     OR (pair_count=0 AND (mage_pair_count<>0 OR soulx_pair_count<>0)) THEN
    RAISE EXCEPTION 'partial hosted pair invalid' USING ERRCODE='23514';
  END IF;
  existing_pair:=pair_count=2;
  IF recovery.operation_id IS NOT NULL AND NOT existing_pair THEN
    RAISE EXCEPTION 'V2-09 deadline recovery pair missing' USING ERRCODE='23514';
  END IF;
  IF existing_pair AND admission.generation_request_id IS NULL THEN
    RAISE EXCEPTION 'V2-09 admission missing' USING ERRCODE='23514';
  END IF;
  IF recovery.operation_id IS NOT NULL THEN
    effective_candidate:=public.videoforge_effective_hosted_v209_candidate($1,$2,$3);
    SELECT * INTO effective_approval FROM public.hosted_paid_dispatch_approvals a
     WHERE a.id=effective_candidate.approval_id;
    SELECT * INTO fifth_renewal FROM public.hosted_v209_ordinary_dispatch_candidate_renewals row
     WHERE row.account_id=$1 AND row.workspace_id=$2 AND row.generation_request_id=$3
       AND row.renewal_ordinal=5;
    SELECT * INTO lease FROM public.provider_workload_leases row
     WHERE row.account_id=$1 AND row.workspace_id=$2 AND row.id=recovery.lease_id;
    SELECT * INTO mage FROM public.serverless_attempts row
     WHERE row.account_id=$1 AND row.workspace_id=$2 AND row.id=recovery.mage_attempt_id;
    SELECT * INTO soulx FROM public.serverless_attempts row
     WHERE row.account_id=$1 AND row.workspace_id=$2 AND row.id=recovery.soulx_attempt_id;
    IF claim.id IS NULL OR request.id IS NULL
       OR recovery.project_id<>request.project_id
       OR recovery.project_revision_id<>request.project_revision_id
       OR recovery.claim_id<>claim.id
       OR recovery.lease_id<>claim.lease_id
       OR claim.project_id<>request.project_id
       OR claim.project_revision_id<>request.project_revision_id
       OR claim.generation_plan_sha256<>effective_candidate.generation_plan_sha256
       OR claim.lane_bindings IS DISTINCT FROM effective_candidate.candidate_document->'laneBindings'
       OR fifth_renewal.renewal_ordinal<>5
       OR fifth_renewal.previous_candidate_sha256<>recovery.source_candidate_sha256
       OR fifth_renewal.previous_approval_id<>recovery.source_approval_id
       OR recovery.previous_candidate_sha256<>recovery.source_candidate_sha256
       OR recovery.previous_approval_id<>recovery.source_approval_id
       OR fifth_renewal.candidate_sha256<>recovery.candidate_sha256
       OR fifth_renewal.approval_id<>recovery.approval_id
       OR recovery.candidate_sha256<>effective_candidate.candidate_sha256
       OR recovery.approval_id<>effective_candidate.approval_id
       OR recovery.refreshed_candidate_expires_at<>effective_candidate.expires_at
       OR effective_approval.id IS NULL
       OR effective_approval.lane_bindings IS DISTINCT FROM claim.lane_bindings
       OR effective_approval.expires_at<>recovery.refreshed_approval_expires_at
       OR lease.generation_request_id<>request.id
       OR lease.state<>'ACTIVE' OR lease.released_at IS NOT NULL OR lease.release_reason IS NOT NULL
       OR lease.expires_at<=transaction_timestamp()
       OR lease.version<>recovery.lease_version
       OR lease.expires_at<>recovery.refreshed_lease_expires_at
       OR mage.id IS NULL OR mage.lane<>'mage_image'
       OR mage.generation_request_id<>request.id
       OR mage.version<>recovery.mage_refreshed_version
       OR mage.created_at<>recovery.mage_refreshed_created_at
       OR mage.deadline_at<>recovery.mage_refreshed_deadline_at
       OR mage.reconciliation_deadline_at<>recovery.mage_refreshed_reconciliation_deadline_at
       OR soulx.id IS NULL OR soulx.lane<>'soulx_avatar'
       OR soulx.generation_request_id<>request.id
       OR soulx.version<>recovery.soulx_refreshed_version
       OR soulx.created_at<>recovery.soulx_refreshed_created_at
       OR soulx.deadline_at<>recovery.soulx_refreshed_deadline_at
       OR soulx.reconciliation_deadline_at<>recovery.soulx_refreshed_reconciliation_deadline_at
       OR effective_approval.expires_at<=transaction_timestamp()
       OR effective_candidate.expires_at<=transaction_timestamp() THEN
      RAISE EXCEPTION 'V2-09 deadline recovery lineage drifted' USING ERRCODE='23514';
    END IF;
  END IF;
  schedule_anchor:=coalesce(recovery.refreshed_database_observed_at,
    admission.database_observed_at,claim.claimed_at,transaction_timestamp());
  cancel_at:=coalesce(recovery.refreshed_cancel_at,admission.cancel_at,
    schedule_anchor+interval '20 minutes');
  stop_at:=coalesce(recovery.refreshed_stop_at,admission.stop_at,
    schedule_anchor+interval '30 minutes');
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_load_hosted_pair_workflow_schedule(uuid,uuid,uuid) FROM PUBLIC;

-- One exact operator call refreshes only the existing pair's schedule and attempt timing.  It
-- requires the fifth effective candidate renewal and a >=30-minute candidate/approval/lease
-- horizon, then updates the two PLANNED rows and records their before/after values append-only.
CREATE FUNCTION public.videoforge_recover_hosted_v209_same_attempt_deadline(
  supplied_account_id uuid,
  supplied_workspace_id uuid,
  supplied_project_id uuid,
  supplied_project_revision_id uuid,
  supplied_generation_request_id uuid,
  supplied_lease_id uuid,
  supplied_expected_lease_version integer,
  supplied_expected_candidate_sha256 text,
  supplied_expected_approval_id uuid,
  supplied_mage_attempt_id uuid,
  supplied_soulx_attempt_id uuid,
  supplied_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  request public.generation_requests%ROWTYPE;
  project_row public.projects%ROWTYPE;
  revision_row public.project_revisions%ROWTYPE;
  claim public.hosted_paid_dispatch_claims%ROWTYPE;
  claim_approval public.hosted_paid_dispatch_approvals%ROWTYPE;
  admission public.hosted_v209_short_admissions%ROWTYPE;
  base_candidate public.hosted_v209_ordinary_dispatch_candidates%ROWTYPE;
  effective_candidate public.hosted_v209_ordinary_dispatch_candidates%ROWTYPE;
  previous_renewal public.hosted_v209_ordinary_dispatch_candidate_renewals%ROWTYPE;
  effective_approval public.hosted_paid_dispatch_approvals%ROWTYPE;
  lease public.provider_workload_leases%ROWTYPE;
  runtime public.video_runtime_states%ROWTYPE;
  mage_lane public.video_runtime_lane_states%ROWTYPE;
  soulx_lane public.video_runtime_lane_states%ROWTYPE;
  mage public.serverless_attempts%ROWTYPE;
  soulx public.serverless_attempts%ROWTYPE;
  mage_after public.serverless_attempts%ROWTYPE;
  soulx_after public.serverless_attempts%ROWTYPE;
  lease_after public.provider_workload_leases%ROWTYPE;
  recovery public.hosted_v209_same_attempt_deadline_recoveries%ROWTYPE;
  capacity_before public.global_generation_capacity%ROWTYPE;
  capacity_after public.global_generation_capacity%ROWTYPE;
  mage_deployment public.serverless_endpoint_deployments%ROWTYPE;
  soulx_deployment public.serverless_endpoint_deployments%ROWTYPE;
  deployment public.serverless_endpoint_deployments%ROWTYPE;
  qualification public.hosted_serverless_qualification_attestations%ROWTYPE;
  binding jsonb;
  binding_lane text;
  approval_base jsonb;
  renewed_candidate_document jsonb;
  renewed_approval_id uuid;
  renewed_candidate_sha text;
  renewed_approval_sha text;
  renewed_expires_at timestamptz;
  mage_deadline timestamptz;
  mage_reconciliation_deadline timestamptz;
  soulx_deadline timestamptz;
  soulx_reconciliation_deadline timestamptz;
  qualification_expiry timestamptz:='infinity'::timestamptz;
  renewal_count integer;
  attempt_count integer;
  runtime_lane_count integer;
  ready_task_count integer;
  batch_count integer;
  binding_count integer:=0;
  mage_binding_count integer:=0;
  soulx_binding_count integer:=0;
  ledger_count integer;
  ledger_attempt_count integer;
  event_count integer;
  event_attempt_count integer;
  changed_count integer;
  downstream_count integer;
  schedule_existing boolean;
  schedule_cancel_at timestamptz;
  schedule_stop_at timestamptz;
  reserved_total numeric;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR supplied_expected_lease_version IS NULL OR supplied_expected_lease_version<1
     OR supplied_expected_candidate_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_expected_approval_id IS NULL OR supplied_mage_attempt_id IS NULL
     OR supplied_soulx_attempt_id IS NULL OR supplied_operation_id IS NULL
     OR supplied_mage_attempt_id=supplied_soulx_attempt_id THEN
    RAISE EXCEPTION 'hosted V2-09 deadline recovery scope invalid' USING ERRCODE='42501';
  END IF;

  -- The request row is the common serialization point with ordinary materialization.  The same
  -- advisory namespace as 0074/0095 is retained for callers that already hold the pair lock.
  SELECT row.* INTO request FROM public.generation_requests row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.id=supplied_generation_request_id FOR UPDATE;
  IF request.id IS NULL THEN
    RAISE EXCEPTION 'hosted V2-09 deadline recovery request missing' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_generation_request_id::text,41));

  SELECT row.* INTO capacity_before FROM public.global_generation_capacity row
   WHERE row.singleton FOR UPDATE;
  SELECT row.* INTO lease FROM public.provider_workload_leases row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.id=supplied_lease_id FOR UPDATE;
  SELECT row.* INTO claim FROM public.hosted_paid_dispatch_claims row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.generation_request_id=supplied_generation_request_id FOR SHARE;
  SELECT row.* INTO admission FROM public.hosted_v209_short_admissions row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.generation_request_id=supplied_generation_request_id FOR SHARE;
  SELECT row.* INTO project_row FROM public.projects row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.id=supplied_project_id FOR SHARE;
  SELECT row.* INTO revision_row FROM public.project_revisions row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.id=supplied_project_revision_id FOR SHARE;
  SELECT row.* INTO runtime FROM public.video_runtime_states row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.generation_request_id=supplied_generation_request_id FOR UPDATE;
  SELECT row.* INTO mage_lane FROM public.video_runtime_lane_states row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.runtime_id=runtime.id AND row.lane='mage_image' FOR UPDATE;
  SELECT row.* INTO soulx_lane FROM public.video_runtime_lane_states row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.runtime_id=runtime.id AND row.lane='soulx_avatar' FOR UPDATE;
  SELECT row.* INTO base_candidate FROM public.hosted_v209_ordinary_dispatch_candidates row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.generation_request_id=supplied_generation_request_id FOR SHARE;
  SELECT count(*) INTO renewal_count
    FROM public.hosted_v209_ordinary_dispatch_candidate_renewals row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.generation_request_id=supplied_generation_request_id;
  SELECT row.* INTO previous_renewal
    FROM public.hosted_v209_ordinary_dispatch_candidate_renewals row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.generation_request_id=supplied_generation_request_id
     AND row.renewal_ordinal=4 FOR SHARE;
  effective_candidate:=public.videoforge_effective_hosted_v209_candidate(
    supplied_account_id,supplied_workspace_id,supplied_generation_request_id);
  SELECT row.* INTO claim_approval FROM public.hosted_paid_dispatch_approvals row
   WHERE row.id=claim.approval_id FOR SHARE;
  SELECT row.* INTO effective_approval FROM public.hosted_paid_dispatch_approvals row
   WHERE row.id=effective_candidate.approval_id FOR SHARE;
  SELECT row.* INTO mage FROM public.serverless_attempts row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.id=supplied_mage_attempt_id FOR UPDATE;
  SELECT row.* INTO soulx FROM public.serverless_attempts row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.id=supplied_soulx_attempt_id FOR UPDATE;
  SELECT count(*) INTO attempt_count FROM public.serverless_attempts row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.generation_request_id=supplied_generation_request_id
     AND row.lane IN ('mage_image','soulx_avatar');
  SELECT row.* INTO mage_deployment FROM public.serverless_endpoint_deployments row
   WHERE row.id=mage.deployment_id AND row.lane='mage_image' AND row.is_active FOR SHARE;
  SELECT row.* INTO soulx_deployment FROM public.serverless_endpoint_deployments row
   WHERE row.id=soulx.deployment_id AND row.lane='soulx_avatar' AND row.is_active FOR SHARE;

  -- Lock and count the immutable runtime shape before any append-only renewal or attempt update.
  SELECT count(*) INTO runtime_lane_count
    FROM public.video_runtime_lane_states row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.runtime_id=runtime.id;
  SELECT count(*) INTO ready_task_count
    FROM public.generation_tasks row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.project_revision_id=supplied_project_revision_id
     AND row.id IN (mage.task_id,soulx.task_id) AND row.state='READY' AND row.required
     AND ((row.id=mage.task_id AND row.lane='IMAGE') OR
          (row.id=soulx.task_id AND row.lane='AVATAR'));
  SELECT count(*) INTO batch_count
    FROM public.hosted_lane_batches row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.project_revision_id=supplied_project_revision_id
     AND row.generation_request_id=supplied_generation_request_id
     AND row.generation_plan_sha256=effective_candidate.generation_plan_sha256
     AND ((row.lane='mage_image' AND row.dispatch_task_id=mage.task_id AND row.deployment_id=mage.deployment_id)
       OR (row.lane='soulx_avatar' AND row.dispatch_task_id=soulx.task_id AND row.deployment_id=soulx.deployment_id));

  -- Cost rows are the original reservations, not provider spend.  They must remain byte-equivalent;
  -- no new cost row/event is written by this operation.
  PERFORM 1 FROM public.serverless_cost_ledgers row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.attempt_id IN (supplied_mage_attempt_id,supplied_soulx_attempt_id) FOR UPDATE;
  PERFORM 1 FROM public.serverless_cost_events row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.attempt_id IN (supplied_mage_attempt_id,supplied_soulx_attempt_id) FOR SHARE;
  SELECT count(*),count(DISTINCT row.attempt_id),coalesce(sum(row.reserved_usd),0)
    INTO ledger_count,ledger_attempt_count,reserved_total
    FROM public.serverless_cost_ledgers row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.attempt_id IN (supplied_mage_attempt_id,supplied_soulx_attempt_id);
  SELECT count(*),count(DISTINCT row.attempt_id)
    INTO event_count,event_attempt_count
    FROM public.serverless_cost_events row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.attempt_id IN (supplied_mage_attempt_id,supplied_soulx_attempt_id);

  IF (SELECT count(*) FROM public.videoforge_schema_migrations)<>100
     OR (SELECT max(version) FROM public.videoforge_schema_migrations)<>100
     OR NOT EXISTS(SELECT 1 FROM public.videoforge_schema_migrations migration
       WHERE migration.version=100
         AND migration.name='hosted_v209_same_attempt_deadline_recovery'
         AND migration.filename='0100_hosted_v209_same_attempt_deadline_recovery.sql')
     OR capacity_before.singleton IS DISTINCT FROM true
     OR capacity_before.active_lease_count<>1
     OR request.account_id<>supplied_account_id OR request.workspace_id<>supplied_workspace_id
     OR request.project_id<>supplied_project_id OR request.project_revision_id<>supplied_project_revision_id
     OR request.state<>'ACTIVE' OR request.terminal_at IS NOT NULL
     OR NOT EXISTS(SELECT 1 FROM public.memberships membership
       WHERE membership.account_id=supplied_account_id AND membership.workspace_id=supplied_workspace_id
         AND membership.user_id=request.created_by_user_id AND membership.status='ACTIVE')
     OR project_row.id IS NULL OR project_row.status<>'ACTIVE'
     OR revision_row.id IS NULL OR revision_row.project_id<>supplied_project_id
     OR revision_row.status<>'LOCKED'
     OR lease.id IS NULL OR lease.generation_request_id<>request.id
     OR lease.account_id<>supplied_account_id OR lease.workspace_id<>supplied_workspace_id
     OR lease.request_kind<>'VIDEO' OR lease.slot<>1 OR lease.state<>'ACTIVE'
     OR lease.released_at IS NOT NULL OR lease.release_reason IS NOT NULL
     OR lease.version<>supplied_expected_lease_version
     OR lease.expires_at>=db_now+interval '30 minutes'
     OR (SELECT count(*) FROM public.provider_workload_leases row
         WHERE row.account_id=supplied_account_id AND row.state='ACTIVE')<>1
     OR (SELECT count(*) FROM public.provider_workload_leases row
         WHERE row.slot=lease.slot AND row.state='ACTIVE')<>1
     OR claim.id IS NULL OR claim.account_id<>supplied_account_id
     OR claim.workspace_id<>supplied_workspace_id OR claim.project_id<>supplied_project_id
     OR claim.project_revision_id<>supplied_project_revision_id
     OR claim.generation_request_id<>request.id OR claim.lease_id<>lease.id
     OR claim.total_cap_usd<>2
     OR claim.approval_id<>effective_candidate.approval_id
     OR claim_approval.id IS NULL OR claim_approval.approval_sha256<>claim.approval_sha256
     OR claim_approval.account_id<>claim.account_id OR claim_approval.workspace_id<>claim.workspace_id
     OR claim_approval.project_id<>claim.project_id OR claim_approval.project_revision_id<>claim.project_revision_id
     OR claim_approval.generation_request_id<>claim.generation_request_id OR claim_approval.lease_id<>claim.lease_id
     OR claim_approval.generation_plan_sha256<>claim.generation_plan_sha256
     OR claim_approval.lane_bindings IS DISTINCT FROM claim.lane_bindings
     OR claim_approval.maximum_cumulative_finite_cap_usd<>claim.total_cap_usd
     OR base_candidate.id IS NULL OR base_candidate.account_id<>supplied_account_id
     OR base_candidate.workspace_id<>supplied_workspace_id OR base_candidate.project_id<>supplied_project_id
     OR base_candidate.project_revision_id<>supplied_project_revision_id
     OR base_candidate.generation_request_id<>request.id OR base_candidate.lease_id<>lease.id
     OR effective_candidate.id IS NULL OR effective_candidate.account_id<>supplied_account_id
     OR effective_candidate.workspace_id<>supplied_workspace_id OR effective_candidate.project_id<>supplied_project_id
     OR effective_candidate.project_revision_id<>supplied_project_revision_id
     OR effective_candidate.generation_request_id<>request.id OR effective_candidate.lease_id<>lease.id
     OR effective_candidate.candidate_sha256<>supplied_expected_candidate_sha256
     OR effective_candidate.approval_id<>supplied_expected_approval_id
     OR effective_candidate.expires_at>=db_now+interval '30 minutes'
     OR effective_candidate.generation_plan_sha256<>claim.generation_plan_sha256
     OR effective_candidate.candidate_document->'laneBindings' IS DISTINCT FROM claim.lane_bindings
     OR claim.generation_plan_sha256<>admission.plan_sha256
     OR effective_candidate.work_manifest_sha256<>admission.work_manifest_sha256
     OR effective_approval.id IS NULL OR effective_approval.account_id<>supplied_account_id
     OR effective_approval.workspace_id<>supplied_workspace_id OR effective_approval.project_id<>supplied_project_id
     OR effective_approval.project_revision_id<>supplied_project_revision_id
     OR effective_approval.generation_request_id<>request.id OR effective_approval.lease_id<>lease.id
     OR effective_approval.maximum_cumulative_finite_cap_usd<>2
     OR effective_approval.lane_bindings IS DISTINCT FROM claim.lane_bindings
     OR effective_approval.expires_at>=db_now+interval '30 minutes'
     OR admission.generation_request_id IS NULL OR NOT admission.no_redispatch
     OR admission.phase_cap_micro_usd<>2000000 OR admission.combined_cap_micro_usd<>17500000
     OR admission.stop_at>=db_now
     OR renewal_count<>4 OR previous_renewal.renewal_ordinal<>4
     OR previous_renewal.original_candidate_sha256<>base_candidate.candidate_sha256
     OR previous_renewal.original_approval_id<>base_candidate.approval_id
     OR previous_renewal.candidate_sha256<>effective_candidate.candidate_sha256
     OR previous_renewal.approval_id<>effective_candidate.approval_id
     OR attempt_count<>2
     OR mage.id IS NULL OR mage.account_id<>supplied_account_id OR mage.workspace_id<>supplied_workspace_id
     OR mage.project_id<>supplied_project_id OR mage.project_revision_id<>supplied_project_revision_id
     OR mage.generation_request_id<>request.id OR mage.lane<>'mage_image' OR mage.state<>'PLANNED'
     OR mage.attempt_ordinal<>1 OR mage.version<>1
     OR mage.submitted_at IS NOT NULL OR mage.ttl_expires_at IS NOT NULL
     OR mage.terminal_at IS NOT NULL OR mage.possible_duplicate_executions<>0
     OR mage.possible_duplicate_cost_usd<>0
     OR soulx.id IS NULL OR soulx.account_id<>supplied_account_id OR soulx.workspace_id<>supplied_workspace_id
     OR soulx.project_id<>supplied_project_id OR soulx.project_revision_id<>supplied_project_revision_id
     OR soulx.generation_request_id<>request.id OR soulx.lane<>'soulx_avatar' OR soulx.state<>'PLANNED'
     OR soulx.attempt_ordinal<>1 OR soulx.version<>1
     OR soulx.submitted_at IS NOT NULL OR soulx.ttl_expires_at IS NOT NULL
     OR soulx.terminal_at IS NOT NULL OR soulx.possible_duplicate_executions<>0
     OR soulx.possible_duplicate_cost_usd<>0
     OR mage_deployment.id IS NULL OR soulx_deployment.id IS NULL
     OR mage_deployment.id<>mage.deployment_id OR soulx_deployment.id<>soulx.deployment_id
     OR mage_deployment.worker_count_min<>0 OR mage_deployment.worker_count_max<>1
     OR soulx_deployment.worker_count_min<>0 OR soulx_deployment.worker_count_max<>1
     OR mage_deployment.handler_concurrency<>1 OR soulx_deployment.handler_concurrency<>1
     OR mage_deployment.request_ttl_seconds<=1800 OR soulx_deployment.request_ttl_seconds<=1800
     OR runtime.id IS NULL OR runtime.generation_request_id<>request.id
     OR runtime.project_id<>supplied_project_id OR runtime.project_revision_id<>supplied_project_revision_id
     OR runtime.stage<>'WAITING_FOR_WORKER' OR runtime.terminal_at IS NOT NULL
     OR runtime_lane_count<>2 OR mage_lane.id IS NULL OR soulx_lane.id IS NULL
     OR mage_lane.state<>'MANIFEST_DURABLE' OR soulx_lane.state<>'MANIFEST_DURABLE'
     OR mage_lane.current_attempt_id IS NOT NULL OR soulx_lane.current_attempt_id IS NOT NULL
     OR mage_lane.attempt_ordinal<>0 OR soulx_lane.attempt_ordinal<>0
     OR mage_lane.accepted_item_count<>0 OR soulx_lane.accepted_item_count<>0
     OR ready_task_count<>2 OR batch_count<>2
     OR ledger_count<>2 OR ledger_attempt_count<>2 OR event_count<>2 OR event_attempt_count<>2
     OR claim.cumulative_reservation_usd<>1.488 OR reserved_total<>1.488
     OR EXISTS(SELECT 1 FROM public.serverless_cost_ledgers row
       WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
         AND row.attempt_id IN (mage.id,soulx.id)
         AND (row.project_revision_id<>supplied_project_revision_id
           OR row.owner_type<>'PROJECT_REVISION' OR row.owner_id<>supplied_project_revision_id
           OR row.estimated_usd<>row.reserved_usd
           OR row.reported_usd<>0 OR row.possible_duplicate_usd<>0 OR row.settled_usd<>0
           OR row.refunded_usd<>0 OR row.reserved_usd<=0
           OR NOT row.fixed_retained_volume_usd_excluded))
     OR EXISTS(SELECT 1 FROM public.serverless_cost_events event
       JOIN public.serverless_cost_ledgers ledger ON ledger.account_id=event.account_id
         AND ledger.workspace_id=event.workspace_id AND ledger.id=event.ledger_id
       WHERE event.account_id=supplied_account_id AND event.workspace_id=supplied_workspace_id
         AND event.attempt_id IN (mage.id,soulx.id)
         AND (event.project_revision_id<>supplied_project_revision_id
           OR ledger.attempt_id<>event.attempt_id
           OR event.kind<>'RESERVATION' OR event.sequence<>1 OR event.confidence<>'ESTIMATED'
           OR event.amount_usd<>ledger.reserved_usd))
     OR EXISTS(SELECT 1 FROM public.serverless_predispatch_authorities row
       JOIN public.serverless_attempts attempt ON attempt.id=row.attempt_id
       WHERE attempt.account_id=supplied_account_id AND attempt.workspace_id=supplied_workspace_id
         AND attempt.generation_request_id=request.id)
     OR EXISTS(SELECT 1 FROM public.serverless_dispatch_outbox row
       JOIN public.serverless_attempts attempt ON attempt.id=row.attempt_id
       WHERE attempt.account_id=supplied_account_id AND attempt.workspace_id=supplied_workspace_id
         AND attempt.generation_request_id=request.id)
     OR EXISTS(SELECT 1 FROM public.serverless_provider_assignments row
       JOIN public.serverless_attempts attempt ON attempt.id=row.attempt_id
       WHERE attempt.account_id=supplied_account_id AND attempt.workspace_id=supplied_workspace_id
         AND attempt.generation_request_id=request.id)
     OR EXISTS(SELECT 1 FROM public.serverless_progress_events row
       WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
         AND row.attempt_id IN (mage.id,soulx.id))
     OR EXISTS(SELECT 1 FROM public.serverless_provenance_receipts row
       WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
         AND row.attempt_id IN (mage.id,soulx.id))
     OR EXISTS(SELECT 1 FROM public.serverless_output_receipts row
       WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
         AND row.attempt_id IN (mage.id,soulx.id))
     OR EXISTS(SELECT 1 FROM public.serverless_cancellations row
       WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
         AND row.attempt_id IN (mage.id,soulx.id))
     OR EXISTS(SELECT 1 FROM public.serverless_reconciliations row
       WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
         AND row.attempt_id IN (mage.id,soulx.id))
     OR EXISTS(SELECT 1 FROM public.hosted_v209_ordinary_lane_materializations row
       WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
         AND row.generation_request_id=request.id)
     OR EXISTS(SELECT 1 FROM public.hosted_pair_runtime_states row
       WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
         AND row.generation_request_id=request.id)
     OR EXISTS(SELECT 1 FROM public.hosted_pair_zero_worker_observations row
       WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
         AND row.generation_request_id=request.id)
     OR EXISTS(SELECT 1 FROM public.hosted_v209_same_attempt_deadline_recoveries row
       WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
         AND row.generation_request_id=request.id)
     OR EXISTS(SELECT 1 FROM public.generation_queue_audits row
       WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
         AND row.id=supplied_operation_id) THEN
    RAISE EXCEPTION 'hosted V2-09 deadline recovery precondition drifted' USING ERRCODE='55000';
  END IF;

  -- Validate the exact two retained qualified lanes and derive the new common authority horizon.
  IF jsonb_typeof(effective_candidate.candidate_document->'laneBindings') IS DISTINCT FROM 'array'
     OR jsonb_array_length(effective_candidate.candidate_document->'laneBindings')<>2 THEN
    RAISE EXCEPTION 'hosted V2-09 deadline recovery lane bindings invalid' USING ERRCODE='23514';
  END IF;
  FOR binding IN SELECT value FROM jsonb_array_elements(effective_candidate.candidate_document->'laneBindings') value LOOP
    binding_lane:=binding->>'lane';
    IF binding_lane NOT IN ('mage_image','soulx_avatar')
       OR binding->>'deployment_id' IS NULL OR binding->>'qualification_attestation_id' IS NULL THEN
      RAISE EXCEPTION 'hosted V2-09 deadline recovery lane binding invalid' USING ERRCODE='23514';
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
       OR binding->>'qualification_record_sha256'<>qualification.qualification_record_sha256
       OR (binding_lane='mage_image' AND deployment.id<>mage_deployment.id)
       OR (binding_lane='soulx_avatar' AND deployment.id<>soulx_deployment.id) THEN
      RAISE EXCEPTION 'hosted V2-09 deadline recovery qualification drifted' USING ERRCODE='42501';
    END IF;
    binding_count:=binding_count+1;
    qualification_expiry:=least(qualification_expiry,qualification.expires_at);
  END LOOP;
  IF binding_count<>2 OR mage_binding_count<>1 OR soulx_binding_count<>1 THEN
    RAISE EXCEPTION 'hosted V2-09 deadline recovery lanes incomplete' USING ERRCODE='55000';
  END IF;
  renewed_expires_at:=least(db_now+interval '1 hour',qualification_expiry);
  IF renewed_expires_at<=db_now+interval '30 minutes' THEN
    RAISE EXCEPTION 'hosted V2-09 deadline recovery authority horizon is too short' USING ERRCODE='55000';
  END IF;

  -- Append the fifth approval/candidate renewal with immutable base/original and ordinal4 previous
  -- lineage.  The claim itself is never rewritten and its stale expiry is intentionally ignored.
  renewed_approval_id:=public.videoforge_hosted_v209_uuid(
    'approval',request.id,'renewal:'||supplied_operation_id::text);
  approval_base:=jsonb_build_object(
    'schemaVersion','videoforge.hosted-v209-paid-approval/v1',
    'accountId',effective_approval.account_id,'workspaceId',effective_approval.workspace_id,
    'projectId',effective_approval.project_id,'projectRevisionId',effective_approval.project_revision_id,
    'generationRequestId',effective_approval.generation_request_id,
    'generationPlanSha256',effective_approval.generation_plan_sha256,'leaseId',effective_approval.lease_id,
    'laneBindings',effective_approval.lane_bindings,'totalCapUsd',effective_approval.maximum_cumulative_finite_cap_usd,
    'expiresAt',to_char(renewed_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  renewed_approval_sha:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(approval_base),'UTF8')),'hex');
  renewed_candidate_document:=jsonb_set(jsonb_set(jsonb_set(effective_candidate.candidate_document,
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
  VALUES(renewed_approval_id,renewed_approval_sha,effective_approval.account_id,effective_approval.workspace_id,
    effective_approval.project_id,effective_approval.project_revision_id,effective_approval.generation_request_id,
    effective_approval.generation_plan_sha256,effective_approval.lease_id,effective_approval.lane_bindings,
    effective_approval.maximum_cumulative_finite_cap_usd,renewed_expires_at,
    'DB_OWNED_V2_09_PLANNED_PAIR_DEADLINE_RECOVERY',db_now,db_now);
  INSERT INTO public.hosted_v209_ordinary_dispatch_candidate_renewals(
    generation_request_id,account_id,workspace_id,project_id,project_revision_id,lease_id,
    original_candidate_sha256,original_approval_id,candidate_sha256,approval_id,candidate_document,
    expires_at,audit_id,created_at,renewal_ordinal,previous_candidate_sha256,previous_approval_id)
  VALUES(request.id,request.account_id,request.workspace_id,request.project_id,request.project_revision_id,
    lease.id,base_candidate.candidate_sha256,base_candidate.approval_id,renewed_candidate_sha,
    renewed_approval_id,renewed_candidate_document,renewed_expires_at,supplied_operation_id,db_now,
    5,effective_candidate.candidate_sha256,effective_candidate.approval_id);

  -- The lease and both still-unsubmitted attempts are changed by CAS in this same transaction.
  UPDATE public.provider_workload_leases
     SET heartbeat_at=db_now,expires_at=renewed_expires_at,version=version+1
   WHERE id=lease.id AND account_id=supplied_account_id AND workspace_id=supplied_workspace_id
     AND generation_request_id=request.id AND state='ACTIVE' AND slot=1
     AND version=supplied_expected_lease_version
     AND expires_at<db_now+interval '30 minutes'
     AND released_at IS NULL AND release_reason IS NULL;
  GET DIAGNOSTICS changed_count=ROW_COUNT;
  IF changed_count<>1 THEN
    RAISE EXCEPTION 'hosted V2-09 deadline recovery lease CAS failed' USING ERRCODE='40001';
  END IF;

  mage_deadline:=db_now+make_interval(secs=>mage_deployment.request_ttl_seconds);
  mage_reconciliation_deadline:=db_now+make_interval(secs=>least(
    mage_deployment.reconciliation_deadline_seconds,mage_deployment.request_ttl_seconds));
  soulx_deadline:=db_now+make_interval(secs=>soulx_deployment.request_ttl_seconds);
  soulx_reconciliation_deadline:=db_now+make_interval(secs=>least(
    soulx_deployment.reconciliation_deadline_seconds,soulx_deployment.request_ttl_seconds));
  IF renewed_expires_at<=db_now+interval '30 minutes'
     OR mage_deadline<=db_now+interval '30 minutes'
     OR soulx_deadline<=db_now+interval '30 minutes' THEN
    RAISE EXCEPTION 'hosted V2-09 deadline recovery refreshed TTL does not cover schedule horizon'
      USING ERRCODE='55000';
  END IF;
  UPDATE public.serverless_attempts SET created_at=db_now,deadline_at=mage_deadline,
    reconciliation_deadline_at=mage_reconciliation_deadline,updated_at=db_now,version=version+1
   WHERE id=mage.id AND account_id=supplied_account_id AND workspace_id=supplied_workspace_id
     AND state='PLANNED' AND version=mage.version
     AND created_at=mage.created_at AND deadline_at=mage.deadline_at
     AND reconciliation_deadline_at=mage.reconciliation_deadline_at;
  GET DIAGNOSTICS changed_count=ROW_COUNT;
  IF changed_count<>1 THEN
    RAISE EXCEPTION 'hosted V2-09 mage attempt deadline CAS failed' USING ERRCODE='40001';
  END IF;
  UPDATE public.serverless_attempts SET created_at=db_now,deadline_at=soulx_deadline,
    reconciliation_deadline_at=soulx_reconciliation_deadline,updated_at=db_now,version=version+1
   WHERE id=soulx.id AND account_id=supplied_account_id AND workspace_id=supplied_workspace_id
     AND state='PLANNED' AND version=soulx.version
     AND created_at=soulx.created_at AND deadline_at=soulx.deadline_at
     AND reconciliation_deadline_at=soulx.reconciliation_deadline_at;
  GET DIAGNOSTICS changed_count=ROW_COUNT;
  IF changed_count<>1 THEN
    RAISE EXCEPTION 'hosted V2-09 soulx attempt deadline CAS failed' USING ERRCODE='40001';
  END IF;

  INSERT INTO public.hosted_v209_same_attempt_deadline_recoveries(
    operation_id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,
    lease_id,claim_id,source_lease_version,lease_version,source_candidate_sha256,source_approval_id,
    source_candidate_expires_at,source_approval_sha256,source_approval_expires_at,source_lease_expires_at,
    previous_candidate_sha256,previous_approval_id,candidate_sha256,approval_id,approval_sha256,renewal_ordinal,
    mage_attempt_id,soulx_attempt_id,mage_source_version,soulx_source_version,
    source_database_observed_at,source_cancel_at,source_stop_at,
    mage_source_created_at,mage_source_deadline_at,mage_source_reconciliation_deadline_at,
    soulx_source_created_at,soulx_source_deadline_at,soulx_source_reconciliation_deadline_at,
    refreshed_database_observed_at,refreshed_cancel_at,refreshed_stop_at,
    mage_refreshed_created_at,mage_refreshed_deadline_at,mage_refreshed_reconciliation_deadline_at,
    mage_refreshed_version,soulx_refreshed_created_at,soulx_refreshed_deadline_at,
    soulx_refreshed_reconciliation_deadline_at,soulx_refreshed_version,
    refreshed_lease_expires_at,refreshed_candidate_expires_at,refreshed_approval_expires_at)
  VALUES(supplied_operation_id,supplied_account_id,supplied_workspace_id,supplied_project_id,
    supplied_project_revision_id,supplied_generation_request_id,lease.id,claim.id,
    lease.version,lease.version+1,effective_candidate.candidate_sha256,effective_candidate.approval_id,
    effective_candidate.expires_at,effective_approval.approval_sha256,effective_approval.expires_at,lease.expires_at,
    effective_candidate.candidate_sha256,effective_candidate.approval_id,renewed_candidate_sha,renewed_approval_id,
    renewed_approval_sha,5,mage.id,soulx.id,mage.version,soulx.version,
    admission.database_observed_at,admission.cancel_at,admission.stop_at,
    mage.created_at,mage.deadline_at,mage.reconciliation_deadline_at,
    soulx.created_at,soulx.deadline_at,soulx.reconciliation_deadline_at,
    db_now,db_now+interval '20 minutes',db_now+interval '30 minutes',
    db_now,mage_deadline,mage_reconciliation_deadline,mage.version+1,
    db_now,soulx_deadline,soulx_reconciliation_deadline,soulx.version+1,
    renewed_expires_at,renewed_expires_at,renewed_expires_at);

  SELECT * INTO lease_after FROM public.provider_workload_leases row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.id=lease.id;
  SELECT * INTO mage_after FROM public.serverless_attempts row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.id=mage.id;
  SELECT * INTO soulx_after FROM public.serverless_attempts row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.id=soulx.id;
  SELECT * INTO capacity_after FROM public.global_generation_capacity row
   WHERE row.singleton FOR UPDATE;
  SELECT schedule.existing_pair,schedule.cancel_at,schedule.stop_at
    INTO schedule_existing,schedule_cancel_at,schedule_stop_at
    FROM public.videoforge_load_hosted_pair_workflow_schedule(
      supplied_account_id,supplied_workspace_id,supplied_generation_request_id) schedule;
  SELECT * INTO recovery FROM public.hosted_v209_same_attempt_deadline_recoveries row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.operation_id=supplied_operation_id;
  IF lease_after.version<>supplied_expected_lease_version+1
     OR lease_after.expires_at<>renewed_expires_at
     OR mage_after.version<>mage.version+1 OR mage_after.state<>'PLANNED'
     OR mage_after.created_at<>db_now OR mage_after.deadline_at<>mage_deadline
     OR mage_after.reconciliation_deadline_at<>mage_reconciliation_deadline
     OR soulx_after.version<>soulx.version+1 OR soulx_after.state<>'PLANNED'
     OR soulx_after.created_at<>db_now OR soulx_after.deadline_at<>soulx_deadline
     OR soulx_after.reconciliation_deadline_at<>soulx_reconciliation_deadline
     OR to_jsonb(capacity_before)<>to_jsonb(capacity_after)
     OR schedule_existing IS DISTINCT FROM true
     OR schedule_cancel_at<>db_now+interval '20 minutes'
     OR schedule_stop_at<>db_now+interval '30 minutes'
     OR recovery.operation_id IS NULL
     OR (SELECT count(*) FROM public.hosted_v209_ordinary_dispatch_candidate_renewals row
         WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
           AND row.generation_request_id=request.id)=5
       IS NOT TRUE
     OR (SELECT count(*) FROM public.serverless_predispatch_authorities row
         JOIN public.serverless_attempts attempt ON attempt.id=row.attempt_id
         WHERE attempt.account_id=supplied_account_id AND attempt.workspace_id=supplied_workspace_id
           AND attempt.generation_request_id=request.id)<>0
     OR (SELECT count(*) FROM public.serverless_dispatch_outbox row
         JOIN public.serverless_attempts attempt ON attempt.id=row.attempt_id
         WHERE attempt.account_id=supplied_account_id AND attempt.workspace_id=supplied_workspace_id
           AND attempt.generation_request_id=request.id)<>0
     OR (SELECT count(*) FROM public.hosted_v209_ordinary_lane_materializations row
         WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
           AND row.generation_request_id=request.id)<>0 THEN
    RAISE EXCEPTION 'hosted V2-09 deadline recovery postcondition failed' USING ERRCODE='55000';
  END IF;

  INSERT INTO public.generation_queue_audits(
    id,account_id,workspace_id,actor_user_id,operation,request_kind,request_id,lease_id,
    request_version_before,request_version_after,video_cursor_before,video_cursor_after,
    preview_cursor_before,preview_cursor_after,detail,occurred_at)
  VALUES(supplied_operation_id,request.account_id,request.workspace_id,request.created_by_user_id,
    'HEARTBEAT','VIDEO',request.id,lease.id,request.version,request.version,
    capacity_before.video_fair_cursor,capacity_after.video_fair_cursor,
    capacity_before.preview_fair_cursor,capacity_after.preview_fair_cursor,
    jsonb_build_object('sameAttemptDeadlineRecovery',true,'renewalOrdinal',5,
      'claimId',claim.id,'sourceCandidateSha256',effective_candidate.candidate_sha256,
      'renewedCandidateSha256',renewed_candidate_sha,'sourceApprovalId',effective_candidate.approval_id,
      'renewedApprovalId',renewed_approval_id,'sourceLeaseVersion',lease.version,
      'renewedLeaseVersion',lease.version+1,'mageAttemptId',mage.id,'soulxAttemptId',soulx.id,
      'providerActionsCreated',false,'redispatch',false),db_now);
  IF (SELECT count(*) FROM public.generation_queue_audits row
       WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
         AND row.id=supplied_operation_id AND row.request_id=request.id
         AND row.operation='HEARTBEAT'
         AND row.detail->>'sameAttemptDeadlineRecovery'='true'
         AND row.detail->>'providerActionsCreated'='false')<>1 THEN
    RAISE EXCEPTION 'hosted V2-09 deadline recovery audit postcondition failed' USING ERRCODE='55000';
  END IF;

  RETURN jsonb_build_object(
    'schemaVersion','videoforge.v2-09-same-attempt-deadline-recovery/v2',
    'operationId',supplied_operation_id,'accountId',supplied_account_id,
    'workspaceId',supplied_workspace_id,'projectId',supplied_project_id,
    'projectRevisionId',supplied_project_revision_id,'generationRequestId',request.id,
    'claimId',claim.id,'leaseId',lease.id,'leaseVersionBefore',lease.version,
    'leaseVersionAfter',lease.version+1,'leaseExpiresAt',to_char(renewed_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceCandidateSha256',effective_candidate.candidate_sha256,
    'candidateSha256',renewed_candidate_sha,'sourceApprovalId',effective_candidate.approval_id,
    'approvalId',renewed_approval_id,'approvalSha256',renewed_approval_sha,'renewalOrdinal',5,
    'previousCandidateSha256',effective_candidate.candidate_sha256,
    'previousApprovalId',effective_candidate.approval_id,
    'mageAttemptId',mage.id,'soulxAttemptId',soulx.id,
    'cancelAt',db_now+interval '20 minutes','stopAt',db_now+interval '30 minutes',
    'mageDeadlineAt',mage_deadline,'mageReconciliationDeadlineAt',mage_reconciliation_deadline,
    'soulxDeadlineAt',soulx_deadline,'soulxReconciliationDeadlineAt',soulx_reconciliation_deadline,
    'providerActionsCreated',false,'redispatch',false,'replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_recover_hosted_v209_same_attempt_deadline(
  uuid,uuid,uuid,uuid,uuid,uuid,integer,text,uuid,uuid,uuid,uuid) FROM PUBLIC;

-- Migration 0099: permit exactly one fourth append-only renewal for the same V2-09
-- generation while preserving the base candidate and the three prior renewals as immutable evidence.

ALTER TABLE public.hosted_v209_ordinary_dispatch_candidate_renewals
  DROP CONSTRAINT hosted_v209_renewal_ordinal_check,
  DROP CONSTRAINT hosted_v209_renewal_predecessor_check,
  ADD CONSTRAINT hosted_v209_renewal_ordinal_check CHECK(renewal_ordinal IN (1,2,3,4)),
  ADD CONSTRAINT hosted_v209_renewal_predecessor_check
    CHECK((renewal_ordinal=1 AND previous_candidate_sha256 IS NULL AND previous_approval_id IS NULL)
    OR (renewal_ordinal IN (2,3,4) AND previous_candidate_sha256 IS NOT NULL
      AND previous_candidate_sha256 ~ '^sha256:[0-9a-f]{64}$'
      AND previous_approval_id IS NOT NULL));

CREATE OR REPLACE VIEW public.hosted_v209_ordinary_dispatch_candidates_effective AS
SELECT candidate.generation_request_id,candidate.account_id,candidate.workspace_id,
       candidate.project_id,candidate.project_revision_id,candidate.lease_id,
       candidate.generation_plan_sha256,candidate.work_manifest_sha256,
       coalesce(renewal.candidate_sha256,candidate.candidate_sha256) AS candidate_sha256,
       coalesce(renewal.approval_id,candidate.approval_id) AS approval_id,
       coalesce(renewal.candidate_document,candidate.candidate_document) AS candidate_document,
       coalesce(renewal.expires_at,candidate.expires_at) AS expires_at,
       candidate.created_at,candidate.id
  FROM public.hosted_v209_ordinary_dispatch_candidates candidate
  LEFT JOIN LATERAL (
    SELECT row.candidate_sha256,row.approval_id,row.candidate_document,row.expires_at
      FROM public.hosted_v209_ordinary_dispatch_candidate_renewals row
     WHERE row.account_id=candidate.account_id AND row.workspace_id=candidate.workspace_id
       AND row.generation_request_id=candidate.generation_request_id
     ORDER BY row.renewal_ordinal DESC,row.audit_id DESC LIMIT 1
  ) renewal ON true;
REVOKE ALL ON public.hosted_v209_ordinary_dispatch_candidates_effective FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.videoforge_effective_hosted_v209_candidate(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_generation_request_id uuid
) RETURNS public.hosted_v209_ordinary_dispatch_candidates
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  original public.hosted_v209_ordinary_dispatch_candidates%ROWTYPE;
  renewal public.hosted_v209_ordinary_dispatch_candidate_renewals%ROWTYPE;
  approval public.hosted_paid_dispatch_approvals%ROWTYPE;
  base_candidate_sha text; base_approval_id uuid;
  previous_candidate_sha text; previous_approval_id uuid;
  expected_ordinal integer:=1;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN RETURN NULL; END IF;
  SELECT candidate.* INTO original FROM public.hosted_v209_ordinary_dispatch_candidates candidate
   WHERE candidate.account_id=supplied_account_id AND candidate.workspace_id=supplied_workspace_id
     AND candidate.generation_request_id=supplied_generation_request_id;
  IF original.id IS NULL THEN RETURN NULL; END IF;
  IF original.candidate_sha256<>'sha256:'||encode(sha256(convert_to(
       public.videoforge_canonical_jsonb(original.candidate_document),'UTF8')),'hex') THEN
    RAISE EXCEPTION 'hosted V2-09 original candidate hash drifted' USING ERRCODE='23514';
  END IF;
  base_candidate_sha:=original.candidate_sha256; base_approval_id:=original.approval_id;
  previous_candidate_sha:=base_candidate_sha; previous_approval_id:=base_approval_id;
  FOR renewal IN SELECT row.* FROM public.hosted_v209_ordinary_dispatch_candidate_renewals row
    WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
      AND row.generation_request_id=supplied_generation_request_id
    ORDER BY row.renewal_ordinal,row.audit_id
  LOOP
    SELECT row.* INTO approval FROM public.hosted_paid_dispatch_approvals row
     WHERE row.id=renewal.approval_id;
    IF renewal.renewal_ordinal<>expected_ordinal
       OR renewal.original_candidate_sha256<>base_candidate_sha
       OR renewal.original_approval_id<>base_approval_id
       OR (renewal.renewal_ordinal=1 AND (renewal.previous_candidate_sha256 IS NOT NULL
         OR renewal.previous_approval_id IS NOT NULL))
       OR (renewal.renewal_ordinal>1 AND
         (renewal.previous_candidate_sha256 IS DISTINCT FROM previous_candidate_sha
         OR renewal.previous_approval_id IS DISTINCT FROM previous_approval_id))
       OR renewal.account_id<>original.account_id OR renewal.workspace_id<>original.workspace_id
       OR renewal.project_id<>original.project_id OR renewal.project_revision_id<>original.project_revision_id
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
       OR approval.id IS NULL OR approval.account_id<>renewal.account_id
       OR approval.workspace_id<>renewal.workspace_id OR approval.project_id<>renewal.project_id
       OR approval.project_revision_id<>renewal.project_revision_id
       OR approval.generation_request_id<>renewal.generation_request_id OR approval.lease_id<>renewal.lease_id
       OR approval.approval_sha256<>'sha256:'||encode(sha256(convert_to(
          public.videoforge_canonical_jsonb(jsonb_build_object(
            'schemaVersion','videoforge.hosted-v209-paid-approval/v1','accountId',approval.account_id,
            'workspaceId',approval.workspace_id,'projectId',approval.project_id,
            'projectRevisionId',approval.project_revision_id,'generationRequestId',approval.generation_request_id,
            'generationPlanSha256',approval.generation_plan_sha256,'leaseId',approval.lease_id,
            'laneBindings',approval.lane_bindings,'totalCapUsd',approval.maximum_cumulative_finite_cap_usd,
            'expiresAt',to_char(approval.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          )),'UTF8')),'hex') THEN
      RAISE EXCEPTION 'hosted V2-09 candidate renewal lineage drifted' USING ERRCODE='23514';
    END IF;
    original.candidate_sha256:=renewal.candidate_sha256; original.approval_id:=renewal.approval_id;
    original.candidate_document:=renewal.candidate_document; original.expires_at:=renewal.expires_at;
    previous_candidate_sha:=renewal.candidate_sha256; previous_approval_id:=renewal.approval_id;
    expected_ordinal:=expected_ordinal+1;
  END LOOP;
  IF expected_ordinal>5 THEN
    RAISE EXCEPTION 'hosted V2-09 candidate renewal count invalid' USING ERRCODE='23514';
  END IF;
  RETURN original;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_effective_hosted_v209_candidate(uuid,uuid,uuid) FROM PUBLIC;

DO $patch_fourth_candidate_renewal$
DECLARE
  signature constant text:=
    'videoforge_renew_hosted_v209_ordinary_candidate(uuid,uuid,uuid,uuid,uuid,uuid,integer,integer,text,uuid,uuid)';
  definition text; patched text; target_count integer;
BEGIN
  SELECT count(*),min(pg_get_functiondef(p.oid)) INTO target_count,definition
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.oid::regprocedure::text=signature;
  IF target_count<>1
     OR position('(SELECT count(*) FROM public.videoforge_schema_migrations)<>98' IN definition)=0
     OR position('(SELECT max(version) FROM public.videoforge_schema_migrations)<>98' IN definition)=0
     OR position('WHERE migration.version=98' IN definition)=0
     OR position('lease.expires_at>db_now' IN definition)=0
     OR position('candidate.expires_at>db_now' IN definition)=0
     OR position('approval.expires_at>db_now' IN definition)=0
     OR position('AND expires_at<=db_now' IN definition)=0
     OR (length(definition)-length(replace(definition,'lease.expires_at>db_now','')))
          /length('lease.expires_at>db_now')<>1
     OR (length(definition)-length(replace(definition,'candidate.expires_at>db_now','')))
          /length('candidate.expires_at>db_now')<>1
     OR (length(definition)-length(replace(definition,'approval.expires_at>db_now','')))
          /length('approval.expires_at>db_now')<>1
     OR (length(definition)-length(replace(definition,'AND expires_at<=db_now','')))
          /length('AND expires_at<=db_now')<>1
     OR position('candidate:=public.videoforge_effective_hosted_v209_candidate' IN definition)=0
     OR position('(SELECT count(*) FROM public.hosted_v209_ordinary_dispatch_candidate_renewals row' IN definition)=0
     OR position('expires_at,audit_id,created_at,renewal_ordinal,previous_candidate_sha256,previous_approval_id)' IN definition)=0
     OR position('renewed_candidate_document,renewed_expires_at,supplied_audit_id,db_now,3,candidate.candidate_sha256,candidate.approval_id)' IN definition)=0
     OR position('lease.id,(SELECT row.candidate_sha256 FROM public.hosted_v209_ordinary_dispatch_candidates row WHERE row.generation_request_id=request.id),(SELECT row.approval_id FROM public.hosted_v209_ordinary_dispatch_candidates row WHERE row.generation_request_id=request.id),renewed_candidate_sha' IN definition)=0 THEN
    RAISE EXCEPTION 'hosted V2-09 fourth renewal preimage drifted' USING ERRCODE='55000';
  END IF;
  patched:=replace(definition,'(SELECT count(*) FROM public.videoforge_schema_migrations)<>98',
    '(SELECT count(*) FROM public.videoforge_schema_migrations)<>99');
  patched:=replace(patched,'(SELECT max(version) FROM public.videoforge_schema_migrations)<>98',
    '(SELECT max(version) FROM public.videoforge_schema_migrations)<>99');
  patched:=replace(patched,
    'WHERE migration.version=98' || chr(10) ||
    '          AND migration.name=''hosted_v209_third_candidate_renewal''' || chr(10) ||
    '          AND migration.filename=''0098_hosted_v209_third_candidate_renewal.sql''',
    'WHERE migration.version=99' || chr(10) ||
    '          AND migration.name=''hosted_v209_fourth_candidate_renewal''' || chr(10) ||
    '          AND migration.filename=''0099_hosted_v209_fourth_candidate_renewal.sql''');
  patched:=replace(patched,
    'OR (SELECT count(*) FROM public.hosted_v209_ordinary_dispatch_candidate_renewals row' || chr(10) ||
    '       WHERE row.generation_request_id=request.id)<>2',
    'OR (SELECT count(*) FROM public.hosted_v209_ordinary_dispatch_candidate_renewals row' || chr(10) ||
    '       WHERE row.generation_request_id=request.id)<>3');
  patched:=replace(patched,
    'renewed_candidate_document,renewed_expires_at,supplied_audit_id,db_now,3,candidate.candidate_sha256,candidate.approval_id);',
    'renewed_candidate_document,renewed_expires_at,supplied_audit_id,db_now,4,candidate.candidate_sha256,candidate.approval_id);');
  patched:=replace(patched,'lease.expires_at>db_now',
    'lease.expires_at>=db_now+interval ''30 minutes''');
  patched:=replace(patched,'candidate.expires_at>db_now',
    'candidate.expires_at>=db_now+interval ''30 minutes''');
  patched:=replace(patched,'approval.expires_at>db_now',
    'approval.expires_at>=db_now+interval ''30 minutes''');
  patched:=replace(patched,'AND expires_at<=db_now',
    'AND expires_at<db_now+interval ''30 minutes''');
  IF patched=definition OR position('migration.version=98' IN patched)>0
     OR position('generation_request_id=request.id)<>2' IN patched)>0
     OR position('candidate:=public.videoforge_effective_hosted_v209_candidate' IN patched)=0
     OR position('db_now,4,candidate.candidate_sha256,candidate.approval_id' IN patched)=0
     OR position('lease.expires_at>db_now' IN patched)>0
     OR position('candidate.expires_at>db_now' IN patched)>0
     OR position('approval.expires_at>db_now' IN patched)>0
     OR position('AND expires_at<=db_now' IN patched)>0
     OR position('lease.expires_at>=db_now+interval ''30 minutes''' IN patched)=0
     OR position('candidate.expires_at>=db_now+interval ''30 minutes''' IN patched)=0
     OR position('approval.expires_at>=db_now+interval ''30 minutes''' IN patched)=0
     OR position('AND expires_at<db_now+interval ''30 minutes''' IN patched)=0
     OR (length(patched)-length(replace(patched,
          'lease.expires_at>=db_now+interval ''30 minutes''','')))
          /length('lease.expires_at>=db_now+interval ''30 minutes''')<>1
     OR (length(patched)-length(replace(patched,
          'candidate.expires_at>=db_now+interval ''30 minutes''','')))
          /length('candidate.expires_at>=db_now+interval ''30 minutes''')<>1
     OR (length(patched)-length(replace(patched,
          'approval.expires_at>=db_now+interval ''30 minutes''','')))
          /length('approval.expires_at>=db_now+interval ''30 minutes''')<>1
     OR (length(patched)-length(replace(patched,
          'AND expires_at<db_now+interval ''30 minutes''','')))
          /length('AND expires_at<db_now+interval ''30 minutes''')<>1 THEN
    RAISE EXCEPTION 'hosted V2-09 fourth renewal patch failed' USING ERRCODE='55000';
  END IF;
  EXECUTE patched;
END
$patch_fourth_candidate_renewal$;

REVOKE ALL ON FUNCTION public.videoforge_renew_hosted_v209_ordinary_candidate(
  uuid,uuid,uuid,uuid,uuid,uuid,integer,integer,text,uuid,uuid) FROM PUBLIC;

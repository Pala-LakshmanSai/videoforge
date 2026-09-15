-- Reuse the strict no-provider-action renewal boundary for fresh funded candidates.
-- Historical recovery entrypoint and append-only evidence remain unchanged.
DO $migration$
DECLARE definition text; needle text;
BEGIN
  definition:=pg_get_functiondef('public.videoforge_renew_hosted_v209_ordinary_candidate(uuid,uuid,uuid,uuid,uuid,uuid,integer,integer,text,uuid,uuid)'::regprocedure);
  IF position('db_now,4,candidate.candidate_sha256,candidate.approval_id' IN definition)=0
    OR position('lease.expires_at>=db_now+interval ''30 minutes''' IN definition)=0 THEN
    RAISE EXCEPTION 'funded candidate renewal predecessor drift';
  END IF;
  definition:=replace(definition,'FUNCTION public.videoforge_renew_hosted_v209_ordinary_candidate(',
    'FUNCTION public.videoforge_renew_hosted_v209_funded_candidate(');
  definition:=replace(definition,'ready_lane_count integer; lane_state_count integer;',
    'ready_lane_count integer; lane_state_count integer; funded_seconds integer; renewal_number integer;');
  needle:='  IF (SELECT count(*) FROM public.videoforge_schema_migrations)<>99';
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'funded candidate schema guard drift'; END IF;
  definition:=replace(definition,needle,$new$
  IF candidate.candidate_document->>'budgetVersion' IS DISTINCT FROM 'ordinary-video-budget/v1' THEN
    RAISE EXCEPTION 'funded candidate required' USING ERRCODE='23514';
  END IF;
  funded_seconds:=(public.videoforge_ordinary_video_budget((candidate.candidate_document#>>'{renderPlan,totalFrames}')::bigint)->>'soulxAvatarTimeoutSeconds')::integer+600;
  SELECT count(*)+1 INTO renewal_number FROM public.hosted_v209_ordinary_dispatch_candidate_renewals WHERE generation_request_id=request.id;
  IF renewal_number NOT BETWEEN 1 AND 4$new$);
  definition:=replace(definition,'    OR (SELECT max(version) FROM public.videoforge_schema_migrations)<>99','');
  -- The original migration remains a required ancestor; do not pin current schema count.
  definition:=replace(definition,')<>3',')<>renewal_number-1');
  definition:=replace(definition,'db_now+interval ''30 minutes''','db_now+make_interval(secs=>funded_seconds+60)');
  definition:=replace(definition,'db_now+interval ''1 hour''','db_now+make_interval(secs=>greatest(3600,funded_seconds+600))');
  definition:=replace(definition,'db_now,4,candidate.candidate_sha256,candidate.approval_id',
    'db_now,renewal_number,CASE WHEN renewal_number=1 THEN NULL ELSE candidate.candidate_sha256 END,CASE WHEN renewal_number=1 THEN NULL ELSE candidate.approval_id END');
  EXECUTE definition;
END;
$migration$;
REVOKE ALL ON FUNCTION public.videoforge_renew_hosted_v209_funded_candidate(uuid,uuid,uuid,uuid,uuid,uuid,integer,integer,text,uuid,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.videoforge_materialize_hosted_v209_ordinary_dispatch_canonical(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_user_id uuid, supplied_project_id uuid
) RETURNS TABLE(candidate jsonb, candidate_canonical_json text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE request_version integer; lease_version integer; funded_seconds integer;
BEGIN
  candidate:=public.videoforge_materialize_hosted_v209_ordinary_dispatch(
    supplied_account_id,supplied_workspace_id,supplied_user_id,supplied_project_id);
  IF candidate->>'budgetVersion'='ordinary-video-budget/v1'
    AND (candidate->>'pairExists')::boolean IS FALSE THEN
    funded_seconds:=(public.videoforge_ordinary_video_budget((candidate#>>'{renderPlan,totalFrames}')::bigint)->>'soulxAvatarTimeoutSeconds')::integer+600;
    IF (candidate->>'expiresAt')::timestamptz<transaction_timestamp()+make_interval(secs=>funded_seconds+60) THEN
      SELECT version INTO request_version FROM public.generation_requests WHERE id=(candidate->>'generationRequestId')::uuid;
      SELECT version INTO lease_version FROM public.provider_workload_leases WHERE id=(candidate->>'leaseId')::uuid;
      PERFORM public.videoforge_renew_hosted_v209_funded_candidate(
        supplied_account_id,supplied_workspace_id,supplied_user_id,supplied_project_id,
        (candidate->>'generationRequestId')::uuid,(candidate->>'leaseId')::uuid,
        request_version,lease_version,candidate->>'candidateSha256',(candidate->>'approvalId')::uuid,gen_random_uuid());
      candidate:=public.videoforge_materialize_hosted_v209_ordinary_dispatch(
        supplied_account_id,supplied_workspace_id,supplied_user_id,supplied_project_id);
    END IF;
  END IF;
  candidate_canonical_json:=public.videoforge_canonical_jsonb(
    candidate-'candidateSha256'-'replayed'-'pairExists'-'existingWorkflowId');
  RETURN NEXT;
END;
$$;

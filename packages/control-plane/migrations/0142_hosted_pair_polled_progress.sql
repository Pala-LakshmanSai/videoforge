-- Persist exact polled provider states for the UI without mutating attempt authority.
CREATE FUNCTION public.videoforge_record_hosted_pair_progress(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_generation_request_id uuid,
  supplied_attempt_id uuid, supplied_lane text, supplied_provider_job_id text, supplied_status text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  target public.serverless_attempts%ROWTYPE;
  assignment public.serverless_provider_assignments%ROWTYPE;
  previous public.serverless_progress_events%ROWTYPE;
  next_sequence bigint;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
    OR supplied_account_id IS NULL OR supplied_workspace_id IS NULL OR supplied_generation_request_id IS NULL
    OR supplied_attempt_id IS NULL OR supplied_lane IS NULL OR supplied_lane NOT IN ('mage_image','soulx_avatar')
    OR supplied_status IS NULL OR supplied_status NOT IN ('IN_QUEUE','IN_PROGRESS')
    OR supplied_provider_job_id IS NULL OR length(supplied_provider_job_id)=0 THEN
    RAISE EXCEPTION 'HOSTED_PAIR_PROGRESS_SCOPE_INVALID' USING ERRCODE='42501';
  END IF;
  SELECT a.* INTO target FROM public.serverless_attempts a
    WHERE a.id=supplied_attempt_id AND a.account_id=supplied_account_id
      AND a.workspace_id=supplied_workspace_id AND a.generation_request_id=supplied_generation_request_id
      AND a.lane=supplied_lane FOR UPDATE;
  IF target.id IS NULL THEN RAISE EXCEPTION 'HOSTED_PAIR_PROGRESS_ATTEMPT_INVALID' USING ERRCODE='42501'; END IF;
  SELECT p.* INTO assignment FROM public.serverless_provider_assignments p
    WHERE p.account_id=supplied_account_id AND p.workspace_id=supplied_workspace_id
      AND p.attempt_id=target.id AND p.provider_job_id=supplied_provider_job_id AND p.is_current FOR SHARE;
  IF assignment.id IS NULL THEN RAISE EXCEPTION 'HOSTED_PAIR_PROGRESS_ASSIGNMENT_INVALID' USING ERRCODE='42501'; END IF;
  IF target.state NOT IN ('ASSIGNED','IN_QUEUE','IN_PROGRESS','UPLOADING','RECONCILING','CANCELLING') THEN RETURN false; END IF;
  SELECT e.* INTO previous FROM public.serverless_progress_events e
    WHERE e.attempt_id=target.id ORDER BY e.sequence DESC LIMIT 1;
  IF previous.assignment_id=assignment.id AND previous.provider_status=supplied_status THEN RETURN false; END IF;
  next_sequence:=coalesce(previous.sequence,0)+1;
  INSERT INTO public.serverless_progress_events(id,account_id,workspace_id,project_revision_id,
    attempt_id,assignment_id,sequence,advisory_source,authoritative,provider_status,attempt_state,
    items_completed,items_total,observed_at,created_at)
  VALUES(gen_random_uuid(),target.account_id,target.workspace_id,target.project_revision_id,
    target.id,assignment.id,next_sequence,'POLL_STATUS',true,supplied_status,target.state,
    coalesce(previous.items_completed,0),target.item_count,transaction_timestamp(),transaction_timestamp());
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_record_hosted_pair_progress(uuid,uuid,uuid,uuid,text,text,text) FROM PUBLIC;
DO $migration$
DECLARE principal record;
BEGIN
  FOR principal IN SELECT DISTINCT role.rolname FROM pg_proc procedure
    CROSS JOIN LATERAL aclexplode(procedure.proacl) privilege JOIN pg_roles role ON role.oid=privilege.grantee
    WHERE procedure.oid='public.videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid)'::regprocedure
      AND privilege.privilege_type='EXECUTE'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.videoforge_record_hosted_pair_progress(uuid,uuid,uuid,uuid,text,text,text) TO %I',principal.rolname);
  END LOOP;
END;
$migration$;

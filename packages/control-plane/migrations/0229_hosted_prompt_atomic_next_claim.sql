-- Lock once before checking stale continuation snapshots. Exact existing claims never submit again.
CREATE FUNCTION public.videoforge_claim_next_hosted_prompt_batch(
  supplied_run_id uuid, supplied_batch_ordinal integer, supplied_provider_task_uuid text,
  supplied_request_bytes text, supplied_request_hash text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE run public.hosted_prompt_runs%ROWTYPE; existing public.hosted_prompt_batch_claims%ROWTYPE;
BEGIN
  SELECT * INTO run FROM public.hosted_prompt_runs WHERE id=supplied_run_id FOR UPDATE;
  IF run.id IS NULL OR public.videoforge_current_account_id() IS DISTINCT FROM run.account_id THEN
    RAISE EXCEPTION 'hosted next prompt claim tenant is invalid' USING ERRCODE='42501';
  END IF;
  SELECT * INTO existing FROM public.hosted_prompt_batch_claims
    WHERE account_id=run.account_id AND workspace_id=run.workspace_id AND run_id=run.id
      AND batch_ordinal=supplied_batch_ordinal;
  IF existing.id IS NOT NULL THEN
    IF existing.task_id=run.task_id AND existing.attempt_id=run.attempt_id AND existing.outbox_id=run.outbox_id
       AND existing.provider_task_uuid=supplied_provider_task_uuid
       AND existing.request_bytes=supplied_request_bytes AND existing.request_hash=supplied_request_hash THEN
      RETURN false;
    END IF;
    RAISE EXCEPTION 'hosted next prompt claim identity drifted' USING ERRCODE='23514';
  END IF;
  PERFORM public.videoforge_reopen_saved_hosted_prompt_prefix(run.id);
  RETURN public.videoforge_claim_hosted_prompt_batch(run.id,supplied_batch_ordinal,
    supplied_provider_task_uuid,supplied_request_bytes,supplied_request_hash);
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_claim_next_hosted_prompt_batch(uuid,integer,text,text,text) FROM PUBLIC;
DO $$
DECLARE principal record;
BEGIN
  FOR principal IN SELECT DISTINCT pg_get_userbyid(acl.grantee) AS role_name
    FROM pg_proc proc CROSS JOIN LATERAL aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl
    WHERE proc.oid='public.videoforge_claim_hosted_prompt_batch(uuid,integer,text,text,text)'::regprocedure
      AND acl.privilege_type='EXECUTE' AND acl.grantee<>0 AND acl.grantee<>proc.proowner
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.videoforge_claim_next_hosted_prompt_batch(uuid,integer,text,text,text) TO %I',principal.role_name);
  END LOOP;
END;
$$;

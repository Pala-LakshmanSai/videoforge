-- Preserve immutable SQL hashes across JSON numeric serialization in the runtime.
CREATE FUNCTION public.videoforge_materialize_hosted_v209_ordinary_dispatch_canonical(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_user_id uuid, supplied_project_id uuid
) RETURNS TABLE(candidate jsonb, candidate_canonical_json text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  candidate:=public.videoforge_materialize_hosted_v209_ordinary_dispatch(
    supplied_account_id,supplied_workspace_id,supplied_user_id,supplied_project_id);
  candidate_canonical_json:=public.videoforge_canonical_jsonb(
    candidate-'candidateSha256'-'replayed'-'pairExists'-'existingWorkflowId');
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_materialize_hosted_v209_ordinary_dispatch_canonical(uuid,uuid,uuid,uuid) FROM PUBLIC;
DO $migration$
DECLARE principal record;
BEGIN
  FOR principal IN SELECT DISTINCT role.rolname FROM pg_proc procedure
    CROSS JOIN LATERAL aclexplode(procedure.proacl) privilege
    JOIN pg_roles role ON role.oid=privilege.grantee
    WHERE procedure.oid='public.videoforge_materialize_hosted_v209_ordinary_dispatch(uuid,uuid,uuid,uuid)'::regprocedure
      AND privilege.privilege_type='EXECUTE'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.videoforge_materialize_hosted_v209_ordinary_dispatch_canonical(uuid,uuid,uuid,uuid) TO %I',principal.rolname);
  END LOOP;
END;
$migration$;

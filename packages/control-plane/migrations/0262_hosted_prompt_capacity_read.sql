-- Progress may inspect this tenant's durable hold without reading private receipts.
CREATE FUNCTION public.videoforge_hosted_prompt_capacity_held(requested_run_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.hosted_prompt_runs run
  JOIN public.repository_mutation_receipts receipt ON receipt.workspace_id=run.workspace_id
   AND receipt.operation='hosted_prompt_capacity_rejected'
   AND receipt.result_payload->>'run_id'=run.id::text
  WHERE run.id=requested_run_id
   AND run.account_id=public.videoforge_current_account_id()
 );
$$;
REVOKE ALL ON FUNCTION public.videoforge_hosted_prompt_capacity_held(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_hosted_prompt_capacity_held(uuid)
 TO videoforge_v209_runtime_dc9612d6;

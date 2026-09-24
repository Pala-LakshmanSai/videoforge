-- Match immutable Kie prompt binding to the provider's 800-character input contract.
CREATE OR REPLACE FUNCTION public.videoforge_bind_hosted_api_image_prompt(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_generation_request_id uuid,
  supplied_generation_task_id uuid,supplied_prompt text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.hosted_api_generation_jobs%ROWTYPE; bound_manifest jsonb; bound_hash text;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR supplied_prompt IS NULL OR length(supplied_prompt) NOT BETWEEN 1 AND 800
     OR supplied_prompt<>btrim(supplied_prompt) THEN
    RAISE EXCEPTION 'API image prompt invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO job FROM public.hosted_api_generation_jobs j
    WHERE j.account_id=supplied_account_id AND j.workspace_id=supplied_workspace_id
      AND j.generation_request_id=supplied_generation_request_id
      AND j.generation_task_id=supplied_generation_task_id FOR UPDATE;
  IF job.id IS NULL OR job.lane<>'IMAGE' THEN
    RAISE EXCEPTION 'API image job unavailable' USING ERRCODE='23514';
  END IF;
  IF job.input_manifest ? 'prompt' THEN
    IF job.input_manifest->>'prompt' IS DISTINCT FROM supplied_prompt THEN
      RAISE EXCEPTION 'API image prompt replay drift' USING ERRCODE='23505';
    END IF;
    RETURN public.videoforge_hosted_api_job_json(job);
  END IF;
  IF job.state<>'PREPARED' THEN
    RAISE EXCEPTION 'API image prompt already dispatched' USING ERRCODE='23505';
  END IF;
  bound_manifest:=job.input_manifest||jsonb_build_object('prompt',supplied_prompt);
  bound_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(bound_manifest),'UTF8')),'hex');
  UPDATE public.hosted_api_generation_jobs SET input_manifest=bound_manifest,input_sha256=bound_hash,
    updated_at=transaction_timestamp() WHERE id=job.id RETURNING * INTO job;
  RETURN public.videoforge_hosted_api_job_json(job);
END;
$$;

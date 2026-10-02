-- A confirmed provider invoice is retained before price policy rejects its output.
-- Never discard actual spend because it exceeded the pinned estimate.
ALTER TABLE public.hosted_video_jobs DROP CONSTRAINT hosted_video_jobs_output_cost_usd_check;
ALTER TABLE public.hosted_video_jobs ADD CONSTRAINT hosted_video_jobs_output_cost_usd_check
 CHECK(output_cost_usd IS NULL OR (output_cost_usd>=0 AND output_cost_usd::text NOT IN('NaN','Infinity','-Infinity')));

CREATE OR REPLACE FUNCTION public.videoforge_record_hosted_video_cost(a uuid,w uuid,g uuid,jid uuid,cost numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE j hosted_video_jobs%ROWTYPE;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() OR cost IS NULL OR cost<0
  OR cost::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'video cost invalid' USING ERRCODE='23514'; END IF;
 -- Match paid claim lock order. The next claimant sees the saved invoice policy fence.
 PERFORM 1 FROM generation_requests WHERE account_id=a AND workspace_id=w AND id=g FOR UPDATE;
 SELECT * INTO j FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND id=jid FOR UPDATE;
 IF j.id IS NULL OR j.state='PREPARED' THEN RAISE EXCEPTION 'video cost state or price invalid' USING ERRCODE='23514'; END IF;
 IF j.output_cost_usd IS NOT NULL THEN
  IF j.output_cost_usd IS DISTINCT FROM cost THEN RAISE EXCEPTION 'video cost replay drift' USING ERRCODE='23505'; END IF;
 ELSE
  IF j.state IN('FAILED','SUCCEEDED') THEN RAISE EXCEPTION 'video cost must precede terminal output' USING ERRCODE='23514'; END IF;
  UPDATE hosted_video_jobs SET output_cost_usd=cost,updated_at=transaction_timestamp() WHERE id=j.id RETURNING * INTO j;
 END IF;
 RETURN public.videoforge_hosted_video_job_json(j);
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_record_hosted_video_cost(uuid,uuid,uuid,uuid,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_record_hosted_video_cost(uuid,uuid,uuid,uuid,numeric) TO videoforge_v209_runtime_dc9612d6;

-- Stop only new paid claims after a confirmed unexpected invoice. Submitted work still
-- polls, records its actual cost and drains through the established terminal gates.
DO $claims$
DECLARE definition text; marker text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_claim_hosted_video_job(uuid,uuid,uuid,uuid,uuid)'::regprocedure) INTO definition;
 marker:=$old$ IF (SELECT count(*) FROM hosted_video_jobs WHERE generation_request_id=g AND state IN('SUBMITTING','SUBMITTED'))>=4$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'video invoice claim preimage drift'; END IF;
 EXECUTE replace(definition,marker,$new$ IF EXISTS(SELECT 1 FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND output_cost_usd>duration_seconds*0.01336*1.10)
   OR (SELECT count(*) FROM hosted_video_jobs WHERE generation_request_id=g AND state IN('SUBMITTING','SUBMITTED'))>=4$new$);
 SELECT pg_get_functiondef('public.videoforge_claim_hosted_api_job(uuid,uuid,uuid,uuid,uuid)'::regprocedure) INTO definition;
 marker:=$old$  SELECT * INTO job FROM public.hosted_api_generation_jobs j$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'API invoice claim lock preimage drift'; END IF;
 definition:=replace(definition,marker,$new$  PERFORM 1 FROM public.generation_requests WHERE account_id=supplied_account_id AND workspace_id=supplied_workspace_id AND id=supplied_generation_request_id FOR UPDATE;
  SELECT * INTO job FROM public.hosted_api_generation_jobs j$new$);
 marker:=$old$  IF job.state<>'PREPARED' THEN$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'API invoice claim preimage drift'; END IF;
 EXECUTE replace(definition,marker,$new$  IF job.state='PREPARED' AND EXISTS(SELECT 1 FROM public.hosted_video_jobs WHERE account_id=supplied_account_id AND workspace_id=supplied_workspace_id AND generation_request_id=supplied_generation_request_id AND output_cost_usd>duration_seconds*0.01336*1.10) THEN
    RETURN public.videoforge_hosted_api_job_json(job);
  END IF;
  IF job.state<>'PREPARED' THEN$new$);
END; $claims$;

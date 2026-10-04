-- Serialize same-account pending narration intake by durable creation order.
-- Replace only the versioned queue seam; legacy start and exact identity recovery remain compatible.
CREATE OR REPLACE FUNCTION public.videoforge_queue_voiceover_job(a uuid,w uuid,j uuid,h text,s text,v text,f text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.hosted_voiceover_jobs;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'voiceover tenant scope invalid' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.global_generation_capacity WHERE singleton FOR UPDATE;
 SELECT * INTO job FROM public.hosted_voiceover_jobs WHERE id=j;
 IF FOUND THEN
  IF job.account_id<>a OR job.workspace_id<>w OR job.request_hash<>h THEN RAISE EXCEPTION 'VOICEOVER_REQUEST_CONFLICT'; END IF;
  RETURN jsonb_build_object('claimed',false,'job',public.videoforge_read_voiceover_job(a,w,j));
 END IF;
 -- Existing identity wins above, including a response lost before intake state persisted.
 -- The capacity lock serializes concurrent workflow admissions for this account.
 IF EXISTS (
  SELECT 1 FROM public.hosted_script_projects current
  JOIN public.hosted_script_projects earlier ON earlier.account_id=current.account_id
  JOIN public.projects p ON p.id=earlier.project_id AND p.account_id=earlier.account_id
  WHERE current.voiceover_job_id=j AND current.account_id=a AND current.workspace_id=w
    AND earlier.state='WAITING' AND p.status='ACTIVE'
    AND (earlier.created_at,earlier.project_id)<(current.created_at,current.project_id)
 ) THEN RAISE EXCEPTION 'VOICEOVER_CAPACITY_BUSY'; END IF;
 INSERT INTO public.hosted_voiceover_jobs(id,account_id,workspace_id,request_hash,script,voice_id,filename,state)
 VALUES(j,a,w,h,s,v,f,'WAITING');
 RETURN jsonb_build_object('claimed',true,'job',public.videoforge_read_voiceover_job(a,w,j));
END $$;

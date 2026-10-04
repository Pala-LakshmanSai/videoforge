-- Queue narration durably before the shared provider claim. Only an explicit 429
-- rejection can make a submitted identity eligible again; uncertainty retains capacity.
ALTER TABLE public.hosted_voiceover_jobs DROP CONSTRAINT hosted_voiceover_jobs_state_check;
ALTER TABLE public.hosted_voiceover_jobs ADD CONSTRAINT hosted_voiceover_jobs_state_check
 CHECK(state IN('WAITING','SUBMITTING','PROCESSING','COMPLETED','FAILED','UNKNOWN_NO_RETRY','CANCELLED'));
ALTER TABLE public.hosted_voiceover_jobs ADD COLUMN submit_claim_id uuid,
 ADD COLUMN submission_started_at timestamptz, ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX hosted_voiceover_jobs_due ON public.hosted_voiceover_jobs(next_attempt_at,updated_at,id) WHERE state='WAITING';
CREATE OR REPLACE FUNCTION public.videoforge_voiceover_capacity_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['state','provider_job_id','failure_code','updated_at','submit_claim_id','submission_started_at','next_attempt_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['state','provider_job_id','failure_code','updated_at','submit_claim_id','submission_started_at','next_attempt_at'])
     OR (OLD.provider_job_id IS NOT NULL AND NEW.provider_job_id IS DISTINCT FROM OLD.provider_job_id)
     OR (OLD.state IN('COMPLETED','FAILED','CANCELLED') AND NEW.state<>OLD.state)
     OR (OLD.state='WAITING' AND NEW.state NOT IN('WAITING','SUBMITTING','CANCELLED'))
     OR (NEW.state='SUBMITTING' AND (OLD.state<>'WAITING' OR NEW.submit_claim_id IS NULL OR NEW.submit_claim_id IS NOT DISTINCT FROM OLD.submit_claim_id))
     OR (NEW.state='WAITING' AND OLD.state<>'WAITING' AND NOT (OLD.state='SUBMITTING' AND OLD.provider_job_id IS NULL AND NEW.failure_code='J1TTS_RATE_LIMITED' AND EXISTS(
       SELECT 1 FROM public.provider_api_rejections r WHERE r.provider='J1_TTS' AND r.kind='VOICEOVER' AND r.job_id=OLD.id AND r.claim_id=OLD.submit_claim_id AND r.account_id=OLD.account_id)))
  THEN RAISE EXCEPTION 'TTS identity cannot replay'; END IF;
  RETURN NEW;
 END IF;
 PERFORM 1 FROM public.accounts WHERE id=NEW.account_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.hosted_voiceover_jobs WHERE account_id=NEW.account_id
   AND state IN('WAITING','SUBMITTING','PROCESSING','UNKNOWN_NO_RETRY')) THEN
  RAISE EXCEPTION 'VOICEOVER_CAPACITY_BUSY' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.videoforge_claim_voiceover_submission(a uuid,w uuid,j uuid,c uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.hosted_voiceover_jobs; admitted jsonb;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'voiceover tenant scope invalid' USING ERRCODE='42501'; END IF;
 -- Serialize queue selection before locking an individual job, across both entrypoints.
 PERFORM 1 FROM public.provider_api_policies WHERE provider='J1_TTS' FOR UPDATE;
 PERFORM 1 FROM public.projects p JOIN public.hosted_script_projects s ON s.project_id=p.id WHERE s.voiceover_job_id=j FOR UPDATE OF p;
 SELECT * INTO job FROM public.hosted_voiceover_jobs WHERE account_id=a AND workspace_id=w AND id=j FOR UPDATE;
 IF NOT FOUND OR job.state<>'WAITING' OR job.next_attempt_at>now() THEN RETURN NULL; END IF;
 -- A script project archived while queued cannot dispatch provider work.
 IF EXISTS(SELECT 1 FROM public.hosted_script_projects s JOIN public.projects p ON p.id=s.project_id
   WHERE s.voiceover_job_id=j AND (s.state='CANCELLED' OR p.status<>'ACTIVE')) THEN
  UPDATE public.hosted_voiceover_jobs SET state='CANCELLED',updated_at=now() WHERE id=j;
  RETURN NULL;
 END IF;
 INSERT INTO public.provider_api_waiters(provider,kind,job_id,account_id,created_at)
 SELECT 'J1_TTS','VOICEOVER',q.id,q.account_id,q.created_at FROM public.hosted_voiceover_jobs q WHERE q.state='WAITING' AND q.next_attempt_at<=now() ON CONFLICT DO NOTHING;
 admitted:=public.videoforge_try_acquire_provider_api('J1_TTS',a,'VOICEOVER',j);
 IF NOT coalesce((admitted->>'acquired')::boolean,false) THEN RETURN NULL; END IF;
 UPDATE public.hosted_voiceover_jobs SET state='SUBMITTING',submit_claim_id=c,submission_started_at=now(),failure_code=NULL,updated_at=now() WHERE id=j;
 RETURN public.videoforge_read_voiceover_job(a,w,j);
END $$;
CREATE FUNCTION public.videoforge_finish_voiceover_submission(a uuid,w uuid,j uuid,c uuid,s text,p text,e text,retry_ms integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.hosted_voiceover_jobs;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'voiceover tenant scope invalid' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.provider_api_policies WHERE provider='J1_TTS' FOR UPDATE;
 SELECT * INTO job FROM public.hosted_voiceover_jobs WHERE id=j AND account_id=a AND workspace_id=w FOR UPDATE;
 IF NOT FOUND OR job.state<>'SUBMITTING' OR job.submit_claim_id IS DISTINCT FROM c THEN RETURN public.videoforge_read_voiceover_job(a,w,j); END IF;
 IF s='WAITING' THEN
  IF e IS DISTINCT FROM 'J1TTS_RATE_LIMITED' OR p IS NOT NULL OR retry_ms IS NULL OR retry_ms<1000 OR retry_ms>86400000 THEN RAISE EXCEPTION 'TTS retry rejection invalid'; END IF;
  PERFORM public.videoforge_defer_provider_api('J1_TTS',a,'VOICEOVER',j,c,retry_ms);
  UPDATE public.hosted_voiceover_jobs SET state='WAITING',failure_code=e,next_attempt_at=now()+retry_ms*interval '1 millisecond',updated_at=now() WHERE id=j;
 ELSE
  IF s NOT IN('PROCESSING','FAILED','UNKNOWN_NO_RETRY') OR (s='PROCESSING' AND p IS NULL) THEN RAISE EXCEPTION 'TTS submission result invalid'; END IF;
  UPDATE public.hosted_voiceover_jobs SET state=s,provider_job_id=p,failure_code=e,updated_at=now() WHERE id=j;
 END IF;
 RETURN public.videoforge_read_voiceover_job(a,w,j);
END $$;
CREATE OR REPLACE FUNCTION public.videoforge_pending_voiceover_jobs() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('accountId',account_id,'workspaceId',workspace_id,'jobId',id) ORDER BY updated_at,id),'[]'::jsonb)
 FROM public.hosted_voiceover_jobs WHERE (state='WAITING' AND next_attempt_at<=now()) OR state IN('SUBMITTING','PROCESSING') OR (state='UNKNOWN_NO_RETRY' AND provider_job_id IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION public.videoforge_claim_voiceover_submission(uuid,uuid,uuid,uuid),public.videoforge_finish_voiceover_submission(uuid,uuid,uuid,uuid,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_claim_voiceover_submission(uuid,uuid,uuid,uuid),public.videoforge_finish_voiceover_submission(uuid,uuid,uuid,uuid,text,text,text,integer) TO videoforge_v209_runtime_dc9612d6;

-- Archive takes the same project lock as submission; queued narration can be cancelled,
-- while accepted or uncertain provider work keeps the original reconciliation fence.
CREATE OR REPLACE FUNCTION public.videoforge_script_project_archive_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status<>'ACTIVE' THEN
  IF EXISTS(SELECT 1 FROM public.hosted_script_projects s WHERE s.project_id=NEW.id AND
    (s.state IN('PREPARING','UNKNOWN_NO_RETRY') OR (s.state='GENERATING' AND NOT EXISTS(
      SELECT 1 FROM public.hosted_voiceover_jobs j WHERE j.id=s.voiceover_job_id AND j.state='WAITING'))))
    THEN RAISE EXCEPTION 'hosted project has active work' USING ERRCODE='55000'; END IF;
  UPDATE public.hosted_voiceover_jobs j SET state='CANCELLED',updated_at=now()
   FROM public.hosted_script_projects s WHERE s.project_id=NEW.id AND s.voiceover_job_id=j.id AND j.state='WAITING';
  UPDATE public.hosted_script_projects SET state='CANCELLED',updated_at=now()
   WHERE project_id=NEW.id AND state IN('WAITING','GENERATING');
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.videoforge_voiceover_active_count() RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT count(*)::integer FROM public.hosted_voiceover_jobs WHERE state IN('WAITING','SUBMITTING','PROCESSING','UNKNOWN_NO_RETRY')
$$;
CREATE OR REPLACE FUNCTION public.videoforge_voiceover_busy(a uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.hosted_voiceover_jobs WHERE account_id=a AND state IN('WAITING','SUBMITTING','PROCESSING','UNKNOWN_NO_RETRY'))
$$;

-- Version the intake seam so the currently deployed binary retains SUBMITTING
-- before its POST throughout the additive migration/application rollout.
CREATE FUNCTION public.videoforge_queue_voiceover_job(a uuid,w uuid,j uuid,h text,s text,v text,f text) RETURNS jsonb
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
 INSERT INTO public.hosted_voiceover_jobs(id,account_id,workspace_id,request_hash,script,voice_id,filename,state)
 VALUES(j,a,w,h,s,v,f,'WAITING');
 RETURN jsonb_build_object('claimed',true,'job',public.videoforge_read_voiceover_job(a,w,j));
END $$;
REVOKE ALL ON FUNCTION public.videoforge_queue_voiceover_job(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_queue_voiceover_job(uuid,uuid,uuid,text,text,text,text) TO videoforge_v209_runtime_dc9612d6;
-- Rolling back to the pre-queue application requires draining WAITING jobs or a
-- compatibility build that retains their driver. Do not replay them through old start.

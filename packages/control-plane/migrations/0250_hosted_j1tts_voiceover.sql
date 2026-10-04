-- Durable private TTS requests precede provider submission; ambiguous calls never replay.
CREATE TABLE public.hosted_voiceover_jobs (
 id uuid PRIMARY KEY, account_id uuid NOT NULL, workspace_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^sha256:[0-9a-f]{64}$'),
 script text NOT NULL CHECK(length(script) BETWEEN 1 AND 100000),
 voice_id text NOT NULL CHECK(length(voice_id) BETWEEN 1 AND 160),
 filename text NOT NULL CHECK(filename ~ '^[A-Za-z0-9._-]{1,150}\.mp3$'),
 state text NOT NULL DEFAULT 'SUBMITTING' CHECK(state IN('SUBMITTING','PROCESSING','COMPLETED','FAILED','UNKNOWN_NO_RETRY')),
 provider_job_id text CHECK(provider_job_id ~ '^[A-Za-z0-9_-]{1,160}$'),
 failure_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(account_id,workspace_id) REFERENCES public.workspaces(account_id,id) ON DELETE RESTRICT
);
CREATE INDEX hosted_voiceover_jobs_owner ON public.hosted_voiceover_jobs(account_id,workspace_id,created_at DESC);
ALTER TABLE public.hosted_voiceover_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_voiceover_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_voiceover_jobs_tenant ON public.hosted_voiceover_jobs
 USING(account_id=public.videoforge_current_account_id()) WITH CHECK(account_id=public.videoforge_current_account_id());
REVOKE ALL ON public.hosted_voiceover_jobs FROM PUBLIC;

CREATE FUNCTION public.videoforge_voiceover_capacity_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE occupied integer;
BEGIN
 -- Share the existing singleton lock without changing its lease-only counter.
 PERFORM 1 FROM public.global_generation_capacity WHERE singleton FOR UPDATE;
 IF TG_TABLE_NAME='provider_workload_leases' THEN
  IF NEW.state<>'ACTIVE' OR (TG_OP='UPDATE' AND OLD.state='ACTIVE') THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.hosted_voiceover_jobs WHERE state IN('SUBMITTING','PROCESSING','UNKNOWN_NO_RETRY')) THEN RETURN NEW; END IF;
 ELSE
  IF TG_OP='UPDATE' THEN
   IF (to_jsonb(NEW)-ARRAY['state','provider_job_id','failure_code','updated_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['state','provider_job_id','failure_code','updated_at'])
      OR (OLD.provider_job_id IS NOT NULL AND NEW.provider_job_id IS DISTINCT FROM OLD.provider_job_id)
      OR (OLD.state IN('COMPLETED','FAILED') AND NEW.state<>OLD.state)
      OR NEW.state='SUBMITTING' THEN RAISE EXCEPTION 'TTS identity cannot replay'; END IF;
   RETURN NEW;
  END IF;
 END IF;
 SELECT count(*) INTO occupied FROM public.provider_workload_leases WHERE state='ACTIVE';
 IF occupied+(SELECT count(*) FROM public.hosted_voiceover_jobs WHERE state IN('SUBMITTING','PROCESSING','UNKNOWN_NO_RETRY'))>=2
 OR EXISTS(SELECT 1 FROM public.hosted_voiceover_jobs WHERE account_id=NEW.account_id AND state IN('SUBMITTING','PROCESSING','UNKNOWN_NO_RETRY'))
 OR (TG_TABLE_NAME='hosted_voiceover_jobs' AND EXISTS(SELECT 1 FROM public.provider_workload_leases WHERE account_id=NEW.account_id AND state='ACTIVE'))
 THEN RAISE EXCEPTION 'VOICEOVER_CAPACITY_BUSY' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hosted_voiceover_jobs_guard BEFORE INSERT OR UPDATE ON public.hosted_voiceover_jobs
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_voiceover_capacity_guard();
-- Alphabetical ordering places this check before the existing lease counter mutation.
CREATE TRIGGER provider_workload_leases_aaa_voiceover BEFORE INSERT OR UPDATE ON public.provider_workload_leases
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_voiceover_capacity_guard();

CREATE FUNCTION public.videoforge_read_voiceover_job(a uuid,w uuid,j uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT to_jsonb(job)-'script'-'request_hash'-'account_id'-'workspace_id' FROM public.hosted_voiceover_jobs job
 WHERE a=public.videoforge_current_account_id() AND account_id=a AND workspace_id=w AND (j IS NULL OR id=j) ORDER BY created_at DESC LIMIT 1
$$;
CREATE FUNCTION public.videoforge_start_voiceover_job(a uuid,w uuid,j uuid,h text,s text,v text,f text) RETURNS jsonb
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
 INSERT INTO public.hosted_voiceover_jobs(id,account_id,workspace_id,request_hash,script,voice_id,filename) VALUES(j,a,w,h,s,v,f);
 RETURN jsonb_build_object('claimed',true,'job',public.videoforge_read_voiceover_job(a,w,j));
END $$;
CREATE FUNCTION public.videoforge_record_voiceover_job(a uuid,w uuid,j uuid,s text,p text,e text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'voiceover tenant scope invalid' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.hosted_voiceover_jobs WHERE account_id=a AND workspace_id=w AND id=j AND provider_job_id IS NOT NULL AND p IS NOT NULL AND provider_job_id<>p) THEN RAISE EXCEPTION 'TTS identity cannot replay'; END IF;
 UPDATE public.hosted_voiceover_jobs SET state=s,provider_job_id=coalesce(provider_job_id,p),failure_code=e,updated_at=now()
 WHERE account_id=a AND workspace_id=w AND id=j AND state NOT IN('COMPLETED','FAILED');
 RETURN public.videoforge_read_voiceover_job(a,w,j);
END $$;
REVOKE ALL ON FUNCTION public.videoforge_read_voiceover_job(uuid,uuid,uuid),public.videoforge_start_voiceover_job(uuid,uuid,uuid,text,text,text,text),public.videoforge_record_voiceover_job(uuid,uuid,uuid,text,text,text),public.videoforge_voiceover_capacity_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_read_voiceover_job(uuid,uuid,uuid),public.videoforge_start_voiceover_job(uuid,uuid,uuid,text,text,text,text),public.videoforge_record_voiceover_job(uuid,uuid,uuid,text,text,text) TO videoforge_v209_runtime_dc9612d6;

CREATE TABLE public.saved_voiceover_voices (
 account_id uuid NOT NULL, workspace_id uuid NOT NULL, voice_id text NOT NULL CHECK(length(voice_id) BETWEEN 1 AND 160),
 saved boolean NOT NULL DEFAULT true, imported boolean NOT NULL DEFAULT false, starred boolean NOT NULL DEFAULT false CHECK(NOT starred OR saved), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,workspace_id,voice_id), FOREIGN KEY(account_id,workspace_id) REFERENCES public.workspaces(account_id,id) ON DELETE RESTRICT
);
ALTER TABLE public.saved_voiceover_voices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_voiceover_voices FORCE ROW LEVEL SECURITY;
CREATE POLICY saved_voiceover_voices_tenant ON public.saved_voiceover_voices USING(account_id=public.videoforge_current_account_id()) WITH CHECK(account_id=public.videoforge_current_account_id());
REVOKE ALL ON public.saved_voiceover_voices FROM PUBLIC;
CREATE FUNCTION public.videoforge_saved_voices(a uuid,w uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('voice_id',voice_id,'starred',starred,'saved',saved,'imported',imported) ORDER BY created_at),'[]'::jsonb) FROM public.saved_voiceover_voices WHERE a=public.videoforge_current_account_id() AND account_id=a AND workspace_id=w
$$;
CREATE FUNCTION public.videoforge_save_voice(a uuid,w uuid,v text,s boolean,t boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'voiceover tenant scope invalid' USING ERRCODE='42501'; END IF;
 IF NOT s THEN DELETE FROM public.saved_voiceover_voices WHERE a=public.videoforge_current_account_id() AND account_id=a AND workspace_id=w AND voice_id=v AND NOT imported;
 UPDATE public.saved_voiceover_voices SET saved=false,starred=false WHERE account_id=a AND workspace_id=w AND voice_id=v AND imported;
 ELSE INSERT INTO public.saved_voiceover_voices(account_id,workspace_id,voice_id,starred) VALUES(a,w,v,t) ON CONFLICT(account_id,workspace_id,voice_id) DO UPDATE SET saved=true,starred=excluded.starred; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.videoforge_saved_voices(uuid,uuid),public.videoforge_save_voice(uuid,uuid,text,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_saved_voices(uuid,uuid),public.videoforge_save_voice(uuid,uuid,text,boolean,boolean) TO videoforge_v209_runtime_dc9612d6;

CREATE FUNCTION public.videoforge_voiceover_active_count() RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT count(*)::integer FROM public.hosted_voiceover_jobs WHERE state IN('SUBMITTING','PROCESSING','UNKNOWN_NO_RETRY')
$$;
CREATE FUNCTION public.videoforge_voiceover_busy(a uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.hosted_voiceover_jobs WHERE account_id=a AND state IN('SUBMITTING','PROCESSING','UNKNOWN_NO_RETRY'))
$$;
REVOKE ALL ON FUNCTION public.videoforge_voiceover_active_count(),public.videoforge_voiceover_busy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_voiceover_active_count(),public.videoforge_voiceover_busy(uuid) TO videoforge_v209_runtime_dc9612d6;
-- Existing hosted queue readers keep waiting rather than attempting a conflicting lease.
DO $migration$
DECLARE target regprocedure; definition text; patched integer:=0;
BEGIN
 FOR target IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'videoforge_admit_hosted_v209_generation%'
 LOOP
  definition:=pg_get_functiondef(target);
  IF strpos(definition,'IF capacity_before.active_lease_count>=2 THEN')>0 THEN
   IF strpos(definition,'WHERE active_lease.account_id=queued.account_id')=0 THEN RAISE EXCEPTION 'voiceover admission preimage mismatch'; END IF;
   definition:=replace(definition,'IF capacity_before.active_lease_count>=2 THEN','IF capacity_before.active_lease_count+public.videoforge_voiceover_active_count()>=2 THEN');
   -- The lease subquery is empty for a TTS-only account, so apply an independent predicate too.
   definition:=replace(definition,$needle$WHERE queued.state IN ('WAITING','RETRY_WAIT')$needle$,$replacement$WHERE queued.state IN ('WAITING','RETRY_WAIT') AND NOT public.videoforge_voiceover_busy(queued.account_id)$replacement$);
   EXECUTE definition; patched:=patched+1;
  END IF;
 END LOOP;
 IF patched<>1 THEN RAISE EXCEPTION 'expected exactly one hosted admission reader, got %',patched; END IF;
END $migration$;

CREATE FUNCTION public.videoforge_import_voice(a uuid,w uuid,v text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'voiceover tenant scope invalid' USING ERRCODE='42501'; END IF;
 INSERT INTO public.saved_voiceover_voices(account_id,workspace_id,voice_id,imported,saved) VALUES(a,w,v,true,true) ON CONFLICT(account_id,workspace_id,voice_id) DO UPDATE SET imported=true,saved=true;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.videoforge_import_voice(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_import_voice(uuid,uuid,text) TO videoforge_v209_runtime_dc9612d6;

CREATE FUNCTION public.videoforge_pending_voiceover_jobs() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('accountId',account_id,'workspaceId',workspace_id,'jobId',id)),'[]'::jsonb) FROM public.hosted_voiceover_jobs WHERE state IN('SUBMITTING','PROCESSING')
$$;
REVOKE ALL ON FUNCTION public.videoforge_pending_voiceover_jobs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_pending_voiceover_jobs() TO videoforge_v209_runtime_dc9612d6;

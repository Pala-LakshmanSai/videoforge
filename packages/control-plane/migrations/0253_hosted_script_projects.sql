-- Additive intake: a project exists before generated narration and its immutable revision.
-- Rollback application code only after these intakes drain; do not delete accepted requests.
CREATE TABLE public.hosted_script_projects (
 project_id uuid PRIMARY KEY, account_id uuid NOT NULL, workspace_id uuid NOT NULL,
 idempotency_key text NOT NULL, request_sha256 text NOT NULL CHECK(request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
 options jsonb NOT NULL CHECK(jsonb_typeof(options)='object'),
 script text NOT NULL CHECK(length(script) BETWEEN 1 AND 100000),
 voice_id text NOT NULL CHECK(voice_id ~ '^[A-Za-z0-9_-]{1,160}$'),
 voice_name text NOT NULL, voiceover_job_id uuid NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'WAITING' CHECK(state IN('WAITING','GENERATING','PREPARING','COMPLETE','FAILED','UNKNOWN_NO_RETRY','CANCELLED')),
 audio jsonb, failure_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,workspace_id,idempotency_key),
 FOREIGN KEY(account_id,workspace_id,project_id) REFERENCES public.projects(account_id,workspace_id,id) ON DELETE RESTRICT
);
ALTER TABLE public.hosted_script_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_script_projects FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_script_projects_tenant ON public.hosted_script_projects
 USING(account_id=public.videoforge_current_account_id()) WITH CHECK(account_id=public.videoforge_current_account_id());
CREATE TRIGGER hosted_script_projects_tenant_write BEFORE INSERT OR UPDATE ON public.hosted_script_projects FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
REVOKE ALL ON public.hosted_script_projects FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON public.hosted_script_projects TO videoforge_v209_runtime_dc9612d6;
CREATE FUNCTION public.videoforge_script_project_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['state','audio','failure_code','updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['state','audio','failure_code','updated_at'])
    OR (OLD.audio IS NOT NULL AND NEW.audio IS DISTINCT FROM OLD.audio)
    OR (OLD.state IN('COMPLETE','FAILED','CANCELLED') AND NEW.state<>OLD.state)
    OR (OLD.state<>'WAITING' AND NEW.state='WAITING')
 THEN RAISE EXCEPTION 'script project identity cannot replay'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hosted_script_project_guard BEFORE UPDATE ON public.hosted_script_projects
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_script_project_guard();
CREATE FUNCTION public.videoforge_script_project_archive_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status<>'ACTIVE' THEN
  IF EXISTS(SELECT 1 FROM public.hosted_script_projects WHERE project_id=NEW.id AND state IN('GENERATING','PREPARING','UNKNOWN_NO_RETRY'))
    THEN RAISE EXCEPTION 'hosted project has active work' USING ERRCODE='55000'; END IF;
  UPDATE public.hosted_script_projects SET state='CANCELLED',updated_at=now()
   WHERE project_id=NEW.id AND state='WAITING';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hosted_script_project_archive_guard BEFORE UPDATE ON public.projects
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_script_project_archive_guard();
CREATE FUNCTION public.videoforge_pending_script_projects() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('accountId',account_id,'workspaceId',workspace_id,'projectId',project_id)),'[]'::jsonb)
 FROM (SELECT DISTINCT ON(s.account_id) s.account_id,s.workspace_id,s.project_id,s.created_at
 FROM public.hosted_script_projects s JOIN public.projects p ON p.id=s.project_id AND p.account_id=s.account_id AND p.workspace_id=s.workspace_id
 WHERE p.status='ACTIVE' AND (s.state IN('WAITING','GENERATING','PREPARING') OR (s.state='UNKNOWN_NO_RETRY' AND EXISTS(SELECT 1 FROM public.hosted_voiceover_jobs j WHERE j.id=s.voiceover_job_id AND j.account_id=s.account_id AND j.workspace_id=s.workspace_id AND j.provider_job_id IS NOT NULL)))
 ORDER BY s.account_id,s.created_at,s.project_id LIMIT 16) due
$$;
REVOKE ALL ON FUNCTION public.videoforge_script_project_guard(),public.videoforge_script_project_archive_guard(),public.videoforge_pending_script_projects() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_pending_script_projects() TO videoforge_v209_runtime_dc9612d6;

-- An uncertain acknowledgement with a saved provider ID remains retrieval-only and observable.
CREATE OR REPLACE FUNCTION public.videoforge_pending_voiceover_jobs() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('accountId',account_id,'workspaceId',workspace_id,'jobId',id)),'[]'::jsonb)
 FROM public.hosted_voiceover_jobs WHERE state IN('SUBMITTING','PROCESSING') OR (state='UNKNOWN_NO_RETRY' AND provider_job_id IS NOT NULL)
$$;

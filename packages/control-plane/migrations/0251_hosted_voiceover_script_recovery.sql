-- Return original narration only to the authenticated owning account/workspace.
CREATE OR REPLACE FUNCTION public.videoforge_read_voiceover_job(a uuid,w uuid,j uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT to_jsonb(job)-'request_hash'-'account_id'-'workspace_id' FROM public.hosted_voiceover_jobs job
 WHERE a=public.videoforge_current_account_id() AND account_id=a AND workspace_id=w AND (j IS NULL OR id=j) ORDER BY created_at DESC LIMIT 1
$$;

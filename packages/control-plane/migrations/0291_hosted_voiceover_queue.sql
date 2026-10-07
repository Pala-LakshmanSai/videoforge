-- Add a durable waiting backlog without increasing paid concurrency.
-- Existing jobs, provider identities, terminal fences and all non-voiceover lanes remain unchanged.
-- Old application versions can read these rows; rollback the app without removing queued work.
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
 -- Waiting rows reserve no provider capacity. Legacy immediate submissions remain guarded.
 IF NEW.state<>'WAITING' AND EXISTS(SELECT 1 FROM public.hosted_voiceover_jobs WHERE account_id=NEW.account_id
   AND state IN('WAITING','SUBMITTING','PROCESSING','UNKNOWN_NO_RETRY')) THEN
  RAISE EXCEPTION 'VOICEOVER_CAPACITY_BUSY' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.videoforge_provider_api_waiter_eligible(k text,a uuid,j uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT CASE k
 WHEN 'VOICEOVER' THEN EXISTS(
   SELECT 1 FROM hosted_voiceover_jobs candidate WHERE candidate.id=j AND candidate.account_id=a
     AND candidate.state='WAITING' AND candidate.next_attempt_at<=now()
     AND NOT EXISTS(SELECT 1 FROM hosted_voiceover_jobs active WHERE active.account_id=a
       AND active.state IN('SUBMITTING','PROCESSING','UNKNOWN_NO_RETRY'))
     AND NOT EXISTS(SELECT 1 FROM hosted_voiceover_jobs earlier WHERE earlier.account_id=a
       AND earlier.state='WAITING' AND (earlier.created_at,earlier.id)<(candidate.created_at,candidate.id))
 )
 WHEN 'PROMPT' THEN EXISTS(SELECT 1 FROM hosted_prompt_runs WHERE id=j AND account_id=a
   AND state IN('DISPATCHING','UNKNOWN') AND acceptance_fingerprint_hash IS NULL
   AND NOT EXISTS(SELECT 1 FROM repository_mutation_receipts m WHERE m.workspace_id=hosted_prompt_runs.workspace_id
     AND m.operation='hosted_prompt_capacity_rejected' AND m.result_payload->>'run_id'=j::text))
 WHEN 'CONTEXT' THEN EXISTS(SELECT 1 FROM projects WHERE id=j AND account_id=a AND status='ACTIVE'
   AND NOT EXISTS(SELECT 1 FROM hosted_voiceover_contexts c WHERE c.project_id=j AND c.account_id=a
     AND c.project_revision_id=(SELECT id FROM project_revisions WHERE project_id=j AND account_id=a
       ORDER BY revision_number DESC,id DESC LIMIT 1) AND c.state IN('DISPATCHING','SUCCEEDED')))
 WHEN 'STYLE' THEN EXISTS(SELECT 1 FROM image_style_versions v JOIN image_styles s ON s.id=v.style_id
   WHERE v.id=j AND v.account_id=a AND v.state='DRAFT' AND s.status='ACTIVE')
 ELSE public.videoforge_provider_api_waiter_eligible_media(k,a,j) END;
$$;

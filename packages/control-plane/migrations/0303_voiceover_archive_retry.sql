-- A confirmed failed download must not hold the archive for the full crash lease.
-- Keep the claim identity so the next claimant still sweeps any abandoned bytes.
CREATE FUNCTION public.videoforge_defer_voiceover_library_archive(a uuid,w uuid,j uuid,c uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN
    RAISE EXCEPTION 'voiceover library tenant scope invalid' USING ERRCODE='42501';
  END IF;
  UPDATE public.hosted_voiceover_library_assets asset
     SET archive_claimed_at=LEAST(archive_claimed_at,now()-interval '14 minutes'),updated_at=now()
   WHERE account_id=a AND workspace_id=w AND voiceover_job_id=j
     AND archive_claim_id=c AND object_key IS NULL AND deleted_at IS NULL
     AND archive_failure_code IS NULL
     AND EXISTS(SELECT 1 FROM public.hosted_voiceover_jobs job
                 WHERE job.id=j AND job.account_id=a AND job.workspace_id=w
                   AND job.state='COMPLETED' AND job.provider_job_id IS NOT NULL);
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.videoforge_defer_voiceover_library_archive(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_defer_voiceover_library_archive(uuid,uuid,uuid,uuid)
  TO videoforge_v209_runtime_dc9612d6;

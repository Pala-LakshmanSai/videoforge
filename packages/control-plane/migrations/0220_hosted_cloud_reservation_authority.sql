-- Read only the authority status needed for one exact, fenced, tenant-owned reservation.
-- Keep budget rows/debits and provider leases private. Expired/disabled authorities remain
-- observable so independently owned cleanup and accepted artifacts do not get stranded.
CREATE FUNCTION public.videoforge_cloud_media_reservation_authority(
 target_reservation uuid, exact_leased_attempt uuid, exact_fence uuid
) RETURNS TABLE(id uuid, expires_at timestamptz, enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT b.id,b.expires_at,b.enabled
 FROM public.cloud_media_reservations r
 JOIN public.hosted_cpu_job_attempts a ON a.id=r.leased_attempt_id
   AND a.account_id=r.account_id AND a.workspace_id=r.workspace_id
   AND a.project_id=r.project_id AND a.project_revision_id=r.project_revision_id
   AND a.execution_backend='RUNPOD_POD'
 JOIN public.cloud_media_jobs j ON j.reservation_id=r.id AND j.attempt_id=r.leased_attempt_id
   AND j.account_id=r.account_id AND j.workspace_id=r.workspace_id
 JOIN public.cloud_media_budget_authorities b ON b.id=r.budget_authority_id
 WHERE r.id=target_reservation AND r.leased_attempt_id=exact_leased_attempt AND r.fence_id=exact_fence
   AND r.account_id=public.videoforge_current_account_id()
   AND r.account_id=ANY(b.allowed_account_ids) AND r.project_id=ANY(b.allowed_project_ids);
$$;
REVOKE ALL ON FUNCTION public.videoforge_cloud_media_reservation_authority(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_cloud_media_reservation_authority(uuid,uuid,uuid)
 TO videoforge_v209_runtime_dc9612d6;

-- Restore the exact runtime EXECUTE permission already required by migration 0147.
-- Its unchanged definer body fences the tenant and settles only terminal renders with
-- no live provider lease or unfinished render; do not grant direct request/lease writes.
DO $grant_guard$
DECLARE definition text; definer boolean; settings text[];
BEGIN
 SELECT p.prosrc,p.prosecdef,p.proconfig INTO definition,definer,settings
 FROM pg_proc p WHERE p.oid='public.videoforge_settle_stranded_hosted_v209_requests(uuid,uuid,uuid)'::regprocedure;
 IF definer IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=public, pg_catalog']
   OR strpos(definition,'IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN')=0
   OR strpos(definition,'hosted V2-09 stranded request reclaim tenant scope invalid')=0 THEN
  RAISE EXCEPTION 'cloud terminal settlement reviewed tenant guard mismatch' USING ERRCODE='55000';
 END IF;
END;
$grant_guard$;
REVOKE ALL ON FUNCTION public.videoforge_settle_stranded_hosted_v209_requests(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_settle_stranded_hosted_v209_requests(uuid,uuid,uuid)
 TO videoforge_v209_runtime_dc9612d6;

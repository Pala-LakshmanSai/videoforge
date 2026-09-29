-- The hosted qualification guard needs a yes/no admission fact, not runtime table access.
-- Preserve its exact owner, authority, current revision, VIDEO lease, accepted ASR,
-- provider-inert and optional independently CLEAN capacity conditions behind one tenant-bound
-- definer function. This grants neither admission nor dispatch and exposes no lease records.
CREATE FUNCTION public.videoforge_cloud_span_qualification_allowed(
 supplied_authority_id uuid, supplied_project_id uuid, supplied_account_id uuid,
 supplied_workspace_id uuid, supplied_user_id uuid, require_clean_capacity boolean
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT coalesce((
 SELECT public.videoforge_current_account_id() IS NOT DISTINCT FROM supplied_account_id
         AND require_clean_capacity IS NOT NULL
         AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.account_id=supplied_account_id
           AND m.workspace_id=supplied_workspace_id AND m.user_id=supplied_user_id AND m.status='ACTIVE')
         AND public.videoforge_cloud_media_qualification_scope(supplied_authority_id,supplied_project_id)
         AND EXISTS(SELECT 1 FROM public.projects p JOIN public.project_revisions revision
           ON revision.account_id=p.account_id AND revision.workspace_id=p.workspace_id
             AND revision.project_id=p.id
           JOIN public.generation_requests g ON g.account_id=p.account_id AND g.workspace_id=p.workspace_id
             AND g.project_id=p.id AND g.project_revision_id=revision.id
           JOIN public.provider_workload_leases lease ON lease.account_id=g.account_id AND lease.workspace_id=g.workspace_id
             AND lease.generation_request_id=g.id AND lease.request_kind='VIDEO'
             AND lease.state='ACTIVE' AND lease.expires_at>now()
           WHERE p.id=supplied_project_id AND p.account_id=supplied_account_id AND p.workspace_id=supplied_workspace_id
             AND p.owner_user_id=supplied_user_id AND p.status='ACTIVE' AND revision.status='LOCKED'
             AND revision.media_execution_backend='RUNPOD_POD' AND g.state='ACTIVE'
             AND revision.revision_number=(SELECT max(current_revision.revision_number) FROM public.project_revisions current_revision
               WHERE current_revision.account_id=p.account_id AND current_revision.workspace_id=p.workspace_id
                 AND current_revision.project_id=p.id)
             AND NOT EXISTS(SELECT 1 FROM public.hosted_api_generation_jobs api WHERE api.account_id=p.account_id
               AND api.workspace_id=p.workspace_id AND api.project_id=p.id
               AND api.state IN ('SUBMITTING','UNKNOWN_NO_RETRY','SUBMITTED'))
             AND (NOT require_clean_capacity OR NOT EXISTS(SELECT 1 FROM public.cloud_media_reservations owned WHERE owned.account_id=p.account_id
               AND (owned.state<>'CLEAN' OR owned.cleanup_verified_at IS NULL)))
             AND EXISTS(SELECT 1 FROM public.hosted_cpu_job_attempts a JOIN public.cloud_media_jobs j ON j.attempt_id=a.id
               JOIN public.cloud_media_reservations r ON r.id=j.reservation_id
               WHERE a.account_id=p.account_id AND a.workspace_id=p.workspace_id
                 AND a.project_id=p.id AND a.project_revision_id=revision.id AND a.kind='ASR'
                 AND a.execution_backend='RUNPOD_POD' AND a.state='SUCCEEDED'
                 AND a.result_receipt_sha256 IS NOT NULL AND r.state='CLEAN' AND r.cleanup_verified_at IS NOT NULL))

 ),false);
$$;
REVOKE ALL ON FUNCTION public.videoforge_cloud_span_qualification_allowed(uuid,uuid,uuid,uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_cloud_span_qualification_allowed(uuid,uuid,uuid,uuid,uuid,boolean)
 TO videoforge_v209_runtime_dc9612d6;

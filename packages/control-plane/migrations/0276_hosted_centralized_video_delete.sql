-- Exact-owner explicit deletion of one completed render; ordinary tenant policies stay private.
CREATE FUNCTION public.videoforge_delete_centralized_video(
  supplied_token text, selected_attempt uuid, supplied_facts_sha256 text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog SET row_security = off AS $$
DECLARE
  target public.hosted_cpu_job_attempts%ROWTYPE;
  next_sequence integer;
  visible jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.videoforge_hosted_session_scope(supplied_token) s
    WHERE lower(btrim(s.normalized_email))='demo9gss@gmail.com') THEN
    RETURN jsonb_build_object('error','CENTRALIZED_LIBRARY_FORBIDDEN');
  END IF;
  SELECT attempt.* INTO target FROM public.hosted_cpu_job_attempts attempt
    JOIN public.projects project ON project.id=attempt.project_id
      AND project.account_id=attempt.account_id AND project.workspace_id=attempt.workspace_id
    JOIN public.project_revisions revision ON revision.id=attempt.project_revision_id
      AND revision.project_id=project.id AND revision.account_id=attempt.account_id
      AND revision.workspace_id=attempt.workspace_id
    WHERE attempt.id=selected_attempt AND attempt.kind='RENDER' AND attempt.state='SUCCEEDED'
      AND project.project_kind='USER' AND project.status='ACTIVE' AND revision.status='LOCKED'
    FOR UPDATE OF attempt;
  IF target.id IS NULL THEN RETURN jsonb_build_object('error','VIDEO_NOT_FOUND'); END IF;
  IF target.retention_deleted_at IS NOT NULL THEN RETURN jsonb_build_object('deleted',true); END IF;
  visible := public.videoforge_read_centralized_library(supplied_token,selected_attempt,'',NULL,0);
  IF jsonb_array_length(COALESCE(visible->'outputs','[]'::jsonb))<>1 THEN
    RETURN jsonb_build_object('error','VIDEO_NOT_FOUND');
  END IF;
  IF supplied_facts_sha256 IS NULL THEN
    RETURN jsonb_build_object('job_spec_object_key',target.job_spec_object_key,
      'artifact_prefix','tenant/'||target.account_id||'/workspace/'||target.workspace_id||'/project/'||target.project_id||'/revision/'||target.project_revision_id||'/lane/render/job/'||target.id||'/artifact/',
      'object_keys',(SELECT jsonb_agg(authority.object_key ORDER BY authority.source)
        FROM public.hosted_cpu_upload_authorities authority
        WHERE authority.attempt_id=target.id AND authority.account_id=target.account_id
          AND authority.workspace_id=target.workspace_id AND authority.issued_at IS NOT NULL));
  END IF;
  IF supplied_facts_sha256 !~ '^sha256:[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('error','DELETION_FACTS_INVALID');
  END IF;
  SELECT COALESCE(max(sequence),0)+1 INTO next_sequence FROM public.hosted_cpu_job_events
    WHERE attempt_id=target.id AND account_id=target.account_id AND workspace_id=target.workspace_id;
  INSERT INTO public.hosted_cpu_job_events(id,account_id,workspace_id,attempt_id,sequence,kind,facts_sha256,occurred_at)
    VALUES(md5(target.id::text||':centralized-delete:'||next_sequence::text)::uuid,
      target.account_id,target.workspace_id,target.id,next_sequence,'RETENTION_DELETED',supplied_facts_sha256,now());
  UPDATE public.hosted_cpu_job_attempts SET retention_deleted_at=now(),version=version+1,updated_at=now()
    WHERE id=target.id AND account_id=target.account_id AND workspace_id=target.workspace_id;
  RETURN jsonb_build_object('deleted',true);
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_delete_centralized_video(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_delete_centralized_video(text,uuid,text)
  TO videoforge_v209_runtime_dc9612d6;

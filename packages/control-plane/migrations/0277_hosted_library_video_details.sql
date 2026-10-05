-- Additive completed-revision metadata; preserve the exact owner/session gate and RLS.
CREATE OR REPLACE FUNCTION public.videoforge_read_centralized_library(
  supplied_token text, selected_attempt uuid DEFAULT NULL, search_text text DEFAULT '',
  selected_creator uuid DEFAULT NULL, page_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog SET row_security = off AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.videoforge_hosted_session_scope(supplied_token) s
     WHERE lower(btrim(s.normalized_email)) = 'demo9gss@gmail.com'
  ) THEN
    RETURN jsonb_build_object('error','CENTRALIZED_LIBRARY_FORBIDDEN');
  END IF;
  IF page_offset IS NULL OR page_offset < 0 OR search_text IS NULL OR length(search_text) > 200 THEN
    RETURN jsonb_build_object('error','CENTRALIZED_LIBRARY_QUERY_INVALID');
  END IF;
  RETURN (
    WITH eligible AS MATERIALIZED (
      SELECT attempt.id AS attempt_id, attempt.project_id, project.name AS title,
             attempt.created_at, authority.object_key,
             authority.issued_content_length AS content_length,
             authority.issued_checksum_sha256 AS checksum_sha256,
             voiceover.metadata->>'filename' AS voiceover_filename,
             jsonb_build_object(
                  'avatar_enabled', revision.revision_config_payload->>'avatar_enabled' IS DISTINCT FROM 'false',
                  'avatar_name', COALESCE(NULLIF(revision.revision_config_payload#>>'{avatar_binding,avatar_display_name_snapshot}',''), avatar.name),
                  'avatar_version', avatar_version.version_number,
                  'voiceover_name', narration.voice_name,
                  'voiceover_filename', voiceover.metadata->>'filename',
                  'image_style_name', style.name,
                  'image_style_version', style_version.version_number
                ) AS video_details,
             link.admitted_account_id AS creator_id, auth_user.name AS creator_name,
             auth_user.email AS creator_email
        FROM public.hosted_cpu_job_attempts attempt
        JOIN public.projects project ON project.id=attempt.project_id
         AND project.account_id=attempt.account_id AND project.workspace_id=attempt.workspace_id
        JOIN public.project_revisions revision ON revision.id=attempt.project_revision_id
         AND revision.account_id=attempt.account_id AND revision.workspace_id=attempt.workspace_id
         AND revision.project_id=attempt.project_id
        JOIN public.hosted_auth_links link ON link.admitted_account_id=attempt.account_id
         AND link.workspace_id=attempt.workspace_id
        JOIN public.hosted_auth_users auth_user ON auth_user.id=link.hosted_auth_user_id
        LEFT JOIN public.assets voiceover ON voiceover.id=revision.voiceover_asset_id
         AND voiceover.account_id=revision.account_id AND voiceover.workspace_id=revision.workspace_id
         AND voiceover.project_id=revision.project_id AND voiceover.kind='VOICEOVER'
        LEFT JOIN avatar_profile_versions AS avatar_version
             ON avatar_version.id=revision.avatar_profile_version_id
            AND avatar_version.account_id=revision.account_id AND avatar_version.workspace_id=revision.workspace_id
            AND avatar_version.profile_id=revision.avatar_profile_id
           LEFT JOIN avatar_profiles AS avatar
             ON avatar.id=avatar_version.profile_id AND avatar.account_id=avatar_version.account_id
            AND avatar.workspace_id=avatar_version.workspace_id
           LEFT JOIN image_style_versions AS style_version
             ON style_version.id=revision.image_style_version_id
            AND style_version.account_id=revision.account_id AND style_version.workspace_id=revision.workspace_id
            AND style_version.style_id=revision.image_style_id
           LEFT JOIN image_styles AS style
             ON style.id=style_version.style_id AND style.account_id=style_version.account_id
            AND style.workspace_id=style_version.workspace_id
           LEFT JOIN hosted_script_projects AS narration
             ON narration.project_id=revision.project_id AND narration.account_id=revision.account_id
            AND narration.workspace_id=revision.workspace_id
            AND narration.audio->'metadata'->>'checksum_sha256'=voiceover.binary_sha256
        JOIN public.hosted_cpu_upload_authorities authority ON authority.attempt_id=attempt.id
         AND authority.account_id=attempt.account_id AND authority.workspace_id=attempt.workspace_id
         AND authority.source='PRIMARY_RESULT_OUTPUT'
        LEFT JOIN public.hosted_cpu_upload_authorities result_document ON result_document.attempt_id=attempt.id
         AND result_document.account_id=attempt.account_id AND result_document.workspace_id=attempt.workspace_id
         AND result_document.source='RESULT_DOCUMENT' AND result_document.issued_at IS NOT NULL
       WHERE project.project_kind='USER' AND project.status='ACTIVE' AND revision.status='LOCKED'
         AND (
  attempt.kind = 'RENDER' AND attempt.state = 'SUCCEEDED'
  AND attempt.retention_deleted_at IS NULL
  AND authority.issued_at IS NOT NULL AND authority.content_type = 'video/mp4'
  AND authority.issued_content_length BETWEEN 1 AND 10737418240
  AND authority.issued_checksum_sha256 ~ '^sha256:[0-9a-f]{64}$'
  AND ((attempt.result_object_key = authority.object_key
    AND attempt.result_content_length = authority.issued_content_length
    AND attempt.result_checksum_sha256 = authority.issued_checksum_sha256)
    OR (attempt.result_object_key = result_document.object_key
    AND attempt.result_content_length = result_document.issued_content_length
    AND attempt.result_checksum_sha256 = result_document.issued_checksum_sha256))
  AND (NOT EXISTS(SELECT 1 FROM hosted_render_only_runs run WHERE run.id=attempt.id)
    OR EXISTS(SELECT 1 FROM hosted_render_only_runs run WHERE run.id=attempt.id
      AND run.account_id=attempt.account_id AND run.workspace_id=attempt.workspace_id
      AND run.state='SUCCEEDED' AND run.output_receipt_id IS NOT NULL
      AND run.final_output->>'checksumSha256'=authority.issued_checksum_sha256)))
    ), filtered AS (
      SELECT * FROM eligible
       WHERE (selected_attempt IS NULL OR attempt_id=selected_attempt)
         AND (selected_creator IS NULL OR creator_id=selected_creator)
         AND (search_text='' OR position(lower(search_text) IN lower(title || ' ' || creator_name || ' ' || creator_email)) > 0)
    ), paged AS (
      SELECT * FROM filtered ORDER BY created_at DESC, attempt_id DESC LIMIT 48 OFFSET page_offset
    )
    SELECT jsonb_build_object(
      'outputs', COALESCE((SELECT jsonb_agg(to_jsonb(paged) ORDER BY created_at DESC, attempt_id DESC) FROM paged),'[]'::jsonb),
      'total', (SELECT count(*) FROM filtered),
      'total_videos', (SELECT count(*) FROM eligible),
      'total_bytes', (SELECT COALESCE(sum(content_length),0) FROM eligible),
      'creators', COALESCE((SELECT jsonb_agg(to_jsonb(creator) ORDER BY creator_name, creator_id)
        FROM (SELECT DISTINCT creator_id, creator_name, creator_email FROM eligible) creator),'[]'::jsonb)
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_read_centralized_library(text,uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_read_centralized_library(text,uuid,text,uuid,integer)
  TO videoforge_v209_runtime_dc9612d6;

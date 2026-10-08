-- Saved voice selections are shared with all admitted users; preference writes remain private.
-- User-authorized account emails identify saved collections for admitted users.
CREATE OR REPLACE FUNCTION public.videoforge_shared_saved_voice_collections(a uuid,w uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_catalog SET row_security=off AS $$
BEGIN
  IF a IS DISTINCT FROM public.videoforge_current_account_id() OR NOT EXISTS (
    SELECT 1 FROM public.hosted_auth_links link
    JOIN public.hosted_auth_users auth_user ON auth_user.id=link.hosted_auth_user_id
    WHERE link.admitted_account_id=a AND link.workspace_id=w AND auth_user.email_verified
      AND NOT EXISTS (SELECT 1 FROM public.hosted_access_revocations r
                      WHERE r.hosted_auth_user_id=auth_user.id)
  ) THEN
    RAISE EXCEPTION 'voiceover tenant scope invalid' USING ERRCODE='42501';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',link.admitted_account_id,
      'name',coalesce(nullif(btrim(auth_user.name),''),'User '||left(link.admitted_account_id::text,8)),
      'email',auth_user.email,
      'is_current_user',link.admitted_account_id=a,
      'voice_ids',coalesce((SELECT jsonb_agg(saved.voice_id ORDER BY saved.voice_id)
        FROM public.saved_voiceover_voices saved
        WHERE saved.account_id=link.admitted_account_id AND saved.workspace_id=link.workspace_id
          AND saved.saved),'[]'::jsonb)
    ) ORDER BY auth_user.name,link.admitted_account_id),'[]'::jsonb)
    FROM public.hosted_auth_links link
    JOIN public.hosted_auth_users auth_user ON auth_user.id=link.hosted_auth_user_id
    WHERE auth_user.email_verified AND NOT EXISTS (
      SELECT 1 FROM public.hosted_access_revocations r WHERE r.hosted_auth_user_id=auth_user.id
    )
  );
END $$;
REVOKE ALL ON FUNCTION public.videoforge_shared_saved_voice_collections(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_shared_saved_voice_collections(uuid,uuid)
TO videoforge_v209_runtime_dc9612d6;

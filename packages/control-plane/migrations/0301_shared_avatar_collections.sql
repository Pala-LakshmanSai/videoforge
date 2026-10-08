-- User-authorized read-only Avatar Hub collections. Raw tables and writes remain tenant-private.
CREATE FUNCTION public.videoforge_shared_avatar_collections(a uuid,w uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_catalog SET row_security=off AS $$
DECLARE identities jsonb;
BEGIN
  -- The existing reader checks the bound actor, workspace, verified admission and revocation.
  identities := public.videoforge_shared_saved_voice_collections(a,w);
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',identity->>'id','name',identity->>'name','email',identity->>'email',
      'is_current_user',(identity->>'is_current_user')::boolean,
      'avatars',coalesce((SELECT jsonb_agg(jsonb_build_object(
        'profile_id',profile.id,'version_id',version.id,'name',profile.name,
        'version_number',version.version_number,'state',version.state,
        'status',profile.status,'scope_kind',profile.scope_kind,
        'profile_hash',version.profile_hash,'rights_status','ATTESTED'
      ) ORDER BY profile.name,version.version_number DESC)
      FROM public.hosted_auth_links link
      JOIN public.avatar_profiles profile ON profile.account_id=link.admitted_account_id
        AND profile.workspace_id=link.workspace_id AND profile.scope_kind='WORKSPACE'
      JOIN public.avatar_profile_versions version ON version.account_id=profile.account_id
        AND version.workspace_id=profile.workspace_id AND version.profile_id=profile.id
        AND version.scope_kind='WORKSPACE'
      JOIN public.assets source ON source.account_id=version.account_id
        AND source.workspace_id=version.workspace_id
        AND source.id=coalesce(profile.thumbnail_asset_id,version.original_asset_id)
      WHERE link.admitted_account_id=(identity->>'id')::uuid
        AND profile.status='ACTIVE' AND version.state='READY'
        AND source.state='VERIFIED' AND source.content_type IN ('image/png','image/jpeg','image/webp')
        AND source.object_key IS NOT NULL),'[]'::jsonb)
    ) ORDER BY identity->>'name',identity->>'id'),'[]'::jsonb)
    FROM jsonb_array_elements(identities) identity
  );
END $$;

CREATE FUNCTION public.videoforge_shared_avatar_preview(a uuid,w uuid,v uuid)
RETURNS TABLE(object_key text,content_type text) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_catalog SET row_security=off AS $$
DECLARE identities jsonb;
BEGIN
  identities := public.videoforge_shared_saved_voice_collections(a,w);
  RETURN QUERY SELECT source.object_key,source.content_type
    FROM public.avatar_profile_versions version
    JOIN public.avatar_profiles profile ON profile.account_id=version.account_id
      AND profile.workspace_id=version.workspace_id AND profile.id=version.profile_id
    JOIN public.hosted_auth_links link ON link.admitted_account_id=profile.account_id
      AND link.workspace_id=profile.workspace_id
    JOIN public.assets source ON source.account_id=version.account_id
      AND source.workspace_id=version.workspace_id
      AND source.id=coalesce(profile.thumbnail_asset_id,version.original_asset_id)
    WHERE version.id=v AND version.state='READY' AND version.scope_kind='WORKSPACE'
      AND profile.status='ACTIVE' AND profile.scope_kind='WORKSPACE'
      AND source.state='VERIFIED' AND source.content_type IN ('image/png','image/jpeg','image/webp')
      AND source.object_key IS NOT NULL
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(identities) identity
                  WHERE (identity->>'id')::uuid=link.admitted_account_id)
    LIMIT 1;
END $$;

REVOKE ALL ON FUNCTION public.videoforge_shared_avatar_collections(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_shared_avatar_preview(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_shared_avatar_collections(uuid,uuid),
  public.videoforge_shared_avatar_preview(uuid,uuid,uuid)
TO videoforge_v209_runtime_dc9612d6;

-- Server-only immutable source snapshot for an explicit shared-avatar selection.
CREATE FUNCTION public.videoforge_shared_avatar_source(a uuid,w uuid,v uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_catalog SET row_security=off AS $$
DECLARE identities jsonb;
BEGIN
  identities := public.videoforge_shared_saved_voice_collections(a,w);
  RETURN (
    SELECT jsonb_build_object(
      'account_id',profile.account_id,'profile_id',profile.id,'version_id',version.id,
      'name',profile.name,'owner_name',identity->>'name',
      'profile_contract_name',version.profile_contract_name,
      'profile_contract_version',version.profile_contract_version,
      'profile_payload',version.profile_payload,'profile_hash',version.profile_hash,
      'source_preparation_profile',version.source_preparation_profile,
      'source_validation_profile',version.source_validation_profile,
      'rights_attested_by_user_id',version.rights_attested_by_user_id,
      'likeness_attested_by_user_id',version.likeness_attested_by_user_id,
      'original',jsonb_build_object('id',original.id,'object_key',original.object_key,
        'binary_sha256',original.binary_sha256,'content_type',original.content_type,
        'byte_size',original.byte_size,'width_px',original.width_px,'height_px',original.height_px),
      'runtime',jsonb_build_object('id',runtime.id,'object_key',runtime.object_key,
        'binary_sha256',runtime.binary_sha256,'content_type',runtime.content_type,
        'byte_size',runtime.byte_size,'width_px',runtime.width_px,'height_px',runtime.height_px)
    ) FROM public.avatar_profiles profile
    JOIN public.avatar_profile_versions version ON version.account_id=profile.account_id
      AND version.workspace_id=profile.workspace_id AND version.profile_id=profile.id
    JOIN public.hosted_auth_links link ON link.admitted_account_id=profile.account_id
      AND link.workspace_id=profile.workspace_id
    JOIN LATERAL jsonb_array_elements(identities) identity
      ON (identity->>'id')::uuid=link.admitted_account_id
    JOIN public.assets original ON original.account_id=version.account_id
      AND original.workspace_id=version.workspace_id AND original.id=version.original_asset_id
    JOIN public.assets runtime ON runtime.account_id=version.account_id
      AND runtime.workspace_id=version.workspace_id AND runtime.id=version.runtime_source_asset_id
    JOIN public.avatar_profile_assets original_link ON original_link.account_id=version.account_id
      AND original_link.workspace_id=version.workspace_id AND original_link.profile_id=profile.id
      AND original_link.version_id=version.id AND original_link.asset_id=original.id
      AND original_link.role='ORIGINAL' AND original_link.retention_state='RETAIN'
      AND original_link.binary_sha256=original.binary_sha256
    WHERE version.id=v AND profile.status='ACTIVE' AND profile.scope_kind='WORKSPACE'
      AND version.state='READY' AND version.scope_kind='WORKSPACE'
      AND version.rights_attested_by_user_id IS NOT NULL AND version.likeness_attested_by_user_id IS NOT NULL
      AND original.kind='AVATAR_ORIGINAL' AND runtime.kind IN ('AVATAR_ORIGINAL','AVATAR_RUNTIME')
      AND original.state='VERIFIED' AND runtime.state='VERIFIED'
      AND original.content_type IN ('image/png','image/jpeg','image/webp')
      AND runtime.content_type IN ('image/png','image/jpeg','image/webp')
      AND original.object_key IS NOT NULL AND runtime.object_key IS NOT NULL
      AND original.byte_size BETWEEN 1 AND 20971520 AND runtime.byte_size BETWEEN 1 AND 20971520
      AND runtime.binary_sha256=version.runtime_source_binary_sha256
      AND (runtime.id=original.id OR EXISTS (
        SELECT 1 FROM public.avatar_profile_assets runtime_link
        WHERE runtime_link.account_id=version.account_id AND runtime_link.workspace_id=version.workspace_id
          AND runtime_link.profile_id=profile.id AND runtime_link.version_id=version.id
          AND runtime_link.asset_id=runtime.id AND runtime_link.role='RUNTIME'
          AND runtime_link.retention_state='RETAIN' AND runtime_link.binary_sha256=runtime.binary_sha256
      ))
      AND NOT EXISTS (
        SELECT 1 FROM (VALUES
          (original.object_key,original.binary_sha256,original.content_type,original.byte_size,original.metadata,'ORIGINAL'),
          (runtime.object_key,runtime.binary_sha256,runtime.content_type,runtime.byte_size,runtime.metadata,'RUNTIME')
        ) source(object_key,binary_sha256,content_type,byte_size,metadata,role)
        WHERE (
          source.object_key ~ ('^tenant/'||version.account_id||'/workspace/'||version.workspace_id||
            '/avatar-profile/'||profile.id||'/version/'||version.id||'/(original|canonical)/[^/]+$')
          OR (source.metadata->>'system_source_scope'='SYSTEM'
            AND source.metadata->>'materialization'='hosted-system-preset-snapshot-v1'
            AND EXISTS (
              SELECT 1 FROM public.assets system_asset
              JOIN public.avatar_profile_assets system_link ON system_link.account_id=system_asset.account_id
                AND system_link.workspace_id=system_asset.workspace_id AND system_link.asset_id=system_asset.id
                AND system_link.role=source.role AND system_link.retention_state='RETAIN'
                AND system_link.binary_sha256=system_asset.binary_sha256
              JOIN public.avatar_profile_versions system_version ON system_version.account_id=system_link.account_id
                AND system_version.workspace_id=system_link.workspace_id AND system_version.id=system_link.version_id
                AND system_version.profile_id=system_link.profile_id AND system_version.scope_kind='SYSTEM'
                AND system_version.state='READY'
                AND CASE source.role WHEN 'ORIGINAL' THEN system_version.original_asset_id
                  ELSE system_version.runtime_source_asset_id END=system_asset.id
                AND (source.role='ORIGINAL' OR system_version.runtime_source_binary_sha256=system_asset.binary_sha256)
              JOIN public.avatar_profiles system_profile ON system_profile.account_id=system_version.account_id
                AND system_profile.workspace_id=system_version.workspace_id AND system_profile.id=system_version.profile_id
                AND system_profile.scope_kind='SYSTEM' AND system_profile.status='ACTIVE'
                AND system_profile.active_version_id=system_version.id
              WHERE system_asset.account_id='ffffffff-ffff-4fff-8fff-000000000001'::uuid
                AND system_asset.workspace_id='ffffffff-ffff-4fff-8fff-000000000011'::uuid
                AND system_asset.id::text=source.metadata->>'system_source_asset_id'
                AND system_asset.state IN ('VERIFIED','ACCEPTED')
                AND system_asset.object_key=source.object_key AND system_asset.binary_sha256=source.binary_sha256
                AND system_asset.content_type=source.content_type AND system_asset.byte_size=source.byte_size
            ))
        ) IS NOT TRUE
      )
    LIMIT 1
  );
END $$;
REVOKE ALL ON FUNCTION public.videoforge_shared_avatar_source(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_shared_avatar_source(uuid,uuid,uuid)
TO videoforge_v209_runtime_dc9612d6;

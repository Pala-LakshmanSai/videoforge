// Both libraries use the exact completed attempt's revision and tenant-owned presets.
export const LIBRARY_VIDEO_DETAILS_SQL = `jsonb_build_object(
                  'avatar_enabled', revision.revision_config_payload->>'avatar_enabled' IS DISTINCT FROM 'false',
                  'avatar_name', COALESCE(NULLIF(revision.revision_config_payload#>>'{avatar_binding,avatar_display_name_snapshot}',''), avatar.name),
                  'avatar_version', avatar_version.version_number,
                  'voiceover_name', narration.voice_name,
                  'voiceover_filename', voiceover.metadata->>'filename',
                  'image_style_name', style.name,
                  'image_style_version', style_version.version_number
                ) AS video_details`;
export const LIBRARY_VIDEO_DETAILS_JOINS_SQL = `LEFT JOIN avatar_profile_versions AS avatar_version
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
            AND narration.audio->'metadata'->>'checksum_sha256'=voiceover.binary_sha256`;

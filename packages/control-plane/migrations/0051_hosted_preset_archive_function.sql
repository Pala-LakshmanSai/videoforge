-- Tenant-scoped archive-only capability for hosted user presets.
--
-- The hosted runtime has SELECT-only access to preset tables.  This narrow SECURITY DEFINER
-- function is the sole runtime write path: it verifies the trusted account setting and supplied
-- workspace, refuses SYSTEM presets, locks the parent row, and archives the parent while retaining
-- every immutable version and its media for historical project revisions.

CREATE FUNCTION public.videoforge_archive_hosted_preset(
  supplied_account_id uuid,
  supplied_workspace_id uuid,
  supplied_kind text,
  supplied_preset_id uuid
) RETURNS TABLE (
  preset_kind text,
  preset_id uuid,
  version_id uuid,
  state text,
  referenced_revision_count bigint
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_account_id uuid := public.videoforge_current_account_id();
  kind_value text := upper(btrim(COALESCE(supplied_kind, '')));
  target_id uuid;
  target_version_id uuid;
  target_status text;
  reference_count bigint;
BEGIN
  IF current_account_id IS NULL OR current_account_id IS DISTINCT FROM supplied_account_id THEN
    RAISE EXCEPTION 'hosted preset tenant mismatch' USING ERRCODE = '42501';
  END IF;

  IF kind_value NOT IN ('AVATAR', 'IMAGE_STYLE') THEN
    RAISE EXCEPTION 'hosted preset kind is unsupported' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.workspaces AS workspace
     WHERE workspace.account_id = supplied_account_id
       AND workspace.id = supplied_workspace_id
       AND workspace.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'hosted preset workspace mismatch' USING ERRCODE = '42501';
  END IF;

  -- SYSTEM presets are globally readable but immutable.  Check both parent and version ids so a
  -- caller cannot bypass the built-in boundary by supplying a version id instead.
  IF kind_value = 'AVATAR' AND EXISTS (
    SELECT 1
      FROM public.avatar_profiles AS profile
      LEFT JOIN public.avatar_profile_versions AS version
        ON version.account_id = profile.account_id
       AND version.workspace_id = profile.workspace_id
       AND version.profile_id = profile.id
       AND version.scope_kind = profile.scope_kind
     WHERE profile.scope_kind = 'SYSTEM'
       AND (profile.id = supplied_preset_id OR version.id = supplied_preset_id)
  ) THEN
    RAISE EXCEPTION 'built-in avatar profiles are immutable' USING ERRCODE = '55000';
  END IF;

  IF kind_value = 'IMAGE_STYLE' AND EXISTS (
    SELECT 1
      FROM public.image_styles AS style
      LEFT JOIN public.image_style_versions AS version
        ON version.account_id = style.account_id
       AND version.workspace_id = style.workspace_id
       AND version.style_id = style.id
       AND version.scope_kind = style.scope_kind
     WHERE style.scope_kind = 'SYSTEM'
       AND (style.id = supplied_preset_id OR version.id = supplied_preset_id)
  ) THEN
    RAISE EXCEPTION 'built-in image styles are immutable' USING ERRCODE = '55000';
  END IF;

  IF kind_value = 'AVATAR' THEN
    SELECT profile.id, profile.active_version_id, profile.status
      INTO target_id, target_version_id, target_status
      FROM public.avatar_profiles AS profile
     WHERE profile.account_id = supplied_account_id
       AND profile.workspace_id = supplied_workspace_id
       AND profile.scope_kind = 'WORKSPACE'
       AND (
         profile.id = supplied_preset_id
         OR EXISTS (
           SELECT 1
             FROM public.avatar_profile_versions AS version
            WHERE version.account_id = profile.account_id
              AND version.workspace_id = profile.workspace_id
              AND version.profile_id = profile.id
              AND version.scope_kind = 'WORKSPACE'
              AND version.id = supplied_preset_id
         )
       )
     ORDER BY CASE WHEN profile.id = supplied_preset_id THEN 0 ELSE 1 END
     LIMIT 1
     FOR UPDATE;

    IF NOT FOUND THEN
      RETURN;
    END IF;

    SELECT count(*)
      INTO reference_count
      FROM public.project_revisions AS revision
     WHERE revision.account_id = supplied_account_id
       AND revision.workspace_id = supplied_workspace_id
       AND revision.avatar_profile_id = target_id;

    IF target_status = 'ACTIVE' THEN
      UPDATE public.avatar_profiles AS profile
         SET status = 'ARCHIVED', archived_at = COALESCE(profile.archived_at, now()), updated_at = now()
       WHERE profile.account_id = supplied_account_id
         AND profile.workspace_id = supplied_workspace_id
         AND profile.id = target_id
         AND profile.scope_kind = 'WORKSPACE'
         AND profile.status = 'ACTIVE';
      target_status := 'ARCHIVED';
    END IF;
  ELSE
    SELECT style.id, style.active_version_id, style.status
      INTO target_id, target_version_id, target_status
      FROM public.image_styles AS style
     WHERE style.account_id = supplied_account_id
       AND style.workspace_id = supplied_workspace_id
       AND style.scope_kind = 'WORKSPACE'
       AND (
         style.id = supplied_preset_id
         OR EXISTS (
           SELECT 1
             FROM public.image_style_versions AS version
            WHERE version.account_id = style.account_id
              AND version.workspace_id = style.workspace_id
              AND version.style_id = style.id
              AND version.scope_kind = 'WORKSPACE'
              AND version.id = supplied_preset_id
         )
       )
     ORDER BY CASE WHEN style.id = supplied_preset_id THEN 0 ELSE 1 END
     LIMIT 1
     FOR UPDATE;

    IF NOT FOUND THEN
      RETURN;
    END IF;

    SELECT count(*)
      INTO reference_count
      FROM public.project_revisions AS revision
     WHERE revision.account_id = supplied_account_id
       AND revision.workspace_id = supplied_workspace_id
       AND revision.image_style_id = target_id;

    IF target_status = 'ACTIVE' THEN
      UPDATE public.image_styles AS style
         SET status = 'ARCHIVED', archived_at = COALESCE(style.archived_at, now()), updated_at = now()
       WHERE style.account_id = supplied_account_id
         AND style.workspace_id = supplied_workspace_id
         AND style.id = target_id
         AND style.scope_kind = 'WORKSPACE'
         AND style.status = 'ACTIVE';
      target_status := 'ARCHIVED';
    END IF;
  END IF;

  preset_kind := kind_value;
  preset_id := target_id;
  version_id := target_version_id;
  state := target_status;
  referenced_revision_count := reference_count;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.videoforge_archive_hosted_preset(uuid, uuid, text, uuid) IS
  'Archive one tenant-owned WORKSPACE avatar or image style parent by parent or version id. SYSTEM presets are immutable; versions and media are retained for existing project revisions.';

REVOKE ALL ON FUNCTION public.videoforge_archive_hosted_preset(uuid, uuid, text, uuid) FROM PUBLIC;

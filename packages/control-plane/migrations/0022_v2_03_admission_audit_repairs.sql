-- V2-03 independent-audit repairs.
--
-- The original preview identifier was polymorphic and therefore could not be protected by one
-- PostgreSQL foreign key. Resolve it to one exact immutable Mage Image Style version or SoulX
-- Avatar Profile version, including its source tenant lineage. A request may bind its own
-- workspace preset or an explicit immutable SYSTEM preset, never another user's preset.

ALTER TABLE preset_preview_requests
  ADD COLUMN preset_account_id uuid,
  ADD COLUMN preset_workspace_id uuid,
  ADD COLUMN preset_scope_kind text,
  ADD COLUMN mage_image_style_version_id uuid,
  ADD COLUMN soulx_avatar_profile_version_id uuid;

UPDATE preset_preview_requests request
   SET preset_account_id = resolved.account_id,
       preset_workspace_id = resolved.workspace_id,
       preset_scope_kind = resolved.scope_kind,
       mage_image_style_version_id = request.preset_version_id
  FROM image_style_versions resolved
 WHERE request.lane = 'MAGE'
   AND resolved.id = request.preset_version_id
   AND (
     (resolved.account_id = request.account_id AND resolved.workspace_id = request.workspace_id
      AND resolved.scope_kind = 'WORKSPACE')
     OR
     (resolved.account_id = 'ffffffff-ffff-4fff-8fff-000000000001'::uuid
      AND resolved.scope_kind = 'SYSTEM')
   );

UPDATE preset_preview_requests request
   SET preset_account_id = resolved.account_id,
       preset_workspace_id = resolved.workspace_id,
       preset_scope_kind = resolved.scope_kind,
       soulx_avatar_profile_version_id = request.preset_version_id
  FROM avatar_profile_versions resolved
 WHERE request.lane = 'SOULX'
   AND resolved.id = request.preset_version_id
   AND (
     (resolved.account_id = request.account_id AND resolved.workspace_id = request.workspace_id
      AND resolved.scope_kind = 'WORKSPACE')
     OR
     (resolved.account_id = 'ffffffff-ffff-4fff-8fff-000000000001'::uuid
      AND resolved.scope_kind = 'SYSTEM')
   );

ALTER TABLE preset_preview_requests
  ALTER COLUMN preset_account_id SET NOT NULL,
  ALTER COLUMN preset_workspace_id SET NOT NULL,
  ALTER COLUMN preset_scope_kind SET NOT NULL,
  ADD CONSTRAINT preset_preview_requests_scope_kind_ck
    CHECK (preset_scope_kind IN ('WORKSPACE', 'SYSTEM')),
  ADD CONSTRAINT preset_preview_requests_owned_or_system_ck
    CHECK (
      (preset_account_id = account_id AND preset_workspace_id = workspace_id
       AND preset_scope_kind = 'WORKSPACE')
      OR
      (preset_account_id = 'ffffffff-ffff-4fff-8fff-000000000001'::uuid
       AND preset_scope_kind = 'SYSTEM')
    ),
  ADD CONSTRAINT preset_preview_requests_lane_binding_ck
    CHECK (
      (lane = 'MAGE' AND mage_image_style_version_id = preset_version_id
       AND soulx_avatar_profile_version_id IS NULL)
      OR
      (lane = 'SOULX' AND soulx_avatar_profile_version_id = preset_version_id
       AND mage_image_style_version_id IS NULL)
    ),
  ADD CONSTRAINT preset_preview_requests_mage_version_fk
    FOREIGN KEY (preset_account_id, preset_workspace_id, mage_image_style_version_id)
    REFERENCES image_style_versions (account_id, workspace_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT preset_preview_requests_soulx_version_fk
    FOREIGN KEY (preset_account_id, preset_workspace_id, soulx_avatar_profile_version_id)
    REFERENCES avatar_profile_versions (account_id, workspace_id, id) ON DELETE RESTRICT;

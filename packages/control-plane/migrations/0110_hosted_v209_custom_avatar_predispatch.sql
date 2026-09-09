-- Migration 0110: admit an exact verified workspace-owned PNG avatar at the
-- ordinary V2-09 predispatch guard. The immutable SYSTEM snapshot path and its
-- receipt proof remain unchanged.

DO $patch_custom_avatar_predispatch$
DECLARE
  signature constant text:=
    'videoforge_assert_hosted_v209_ordinary_avatar_source(uuid,uuid,uuid)';
  definition text;
  patched text;
  target_count integer;
BEGIN
  SELECT count(*),min(pg_get_functiondef(p.oid)) INTO target_count,definition
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.oid::regprocedure::text=signature;
  IF target_count<>1
     OR position('asset.binary_sha256 avatar_asset_sha256' IN definition)=0
     OR position('AND asset.kind=''AVATAR_RUNTIME''' IN definition)=0
     OR position('projection:=public.videoforge_read_hosted_v209_system_avatar_projection' IN definition)=0 THEN
    RAISE EXCEPTION 'hosted V2-09 custom avatar predispatch preimage drifted' USING ERRCODE='55000';
  END IF;

  patched:=replace(definition,
    'asset.binary_sha256 avatar_asset_sha256',
    'asset.binary_sha256 avatar_asset_sha256,asset.kind avatar_asset_kind');
  patched:=replace(patched,
    'AND asset.kind=''AVATAR_RUNTIME'' AND asset.state IN (''VERIFIED'',''ACCEPTED'')',
    'AND asset.kind IN (''AVATAR_RUNTIME'',''AVATAR_ORIGINAL'') AND asset.state IN (''VERIFIED'',''ACCEPTED'')');
  patched:=replace(patched,
$old$IF target.generation_request_id IS NULL OR target.status<>'LOCKED'
     OR target.avatar_runtime_source_binary_sha256<>exact_source_sha
     OR target.avatar_asset_sha256<>exact_source_sha
     OR target.avatar_content_type<>'image/png' OR target.avatar_byte_size<>1912005
     OR target.avatar_width_px<>1672 OR target.avatar_height_px<>941 THEN$old$,
$new$IF target.generation_request_id IS NULL OR target.status<>'LOCKED'
     OR target.avatar_runtime_source_binary_sha256<>target.avatar_asset_sha256
     OR target.avatar_content_type<>'image/png' OR target.avatar_byte_size<=0
     OR target.avatar_width_px<=0 OR target.avatar_height_px<=0
     OR (target.avatar_asset_kind='AVATAR_RUNTIME' AND
       (target.avatar_asset_sha256<>exact_source_sha OR target.avatar_byte_size<>1912005
        OR target.avatar_width_px<>1672 OR target.avatar_height_px<>941))
     OR target.avatar_asset_kind NOT IN ('AVATAR_RUNTIME','AVATAR_ORIGINAL') THEN$new$);

  patched:=replace(patched,
$old$  projection:=public.videoforge_read_hosted_v209_system_avatar_projection($old$,
$new$  IF target.avatar_asset_kind='AVATAR_ORIGINAL' THEN
    IF target.avatar_object_key !~ ('^tenant/'||supplied_account_id::text||
         '/workspace/'||supplied_workspace_id::text||'/avatar-profile/[0-9a-f-]{36}/version/[0-9a-f-]{36}/original/source$') THEN
      RAISE EXCEPTION 'hosted V2-09 custom PNG avatar object identity invalid'
        USING ERRCODE='23514';
    END IF;
    SELECT candidate_row.* INTO candidate
      FROM public.hosted_v209_ordinary_dispatch_candidates candidate_row
     WHERE candidate_row.account_id=supplied_account_id
       AND candidate_row.workspace_id=supplied_workspace_id
       AND candidate_row.generation_request_id=target.generation_request_id;
    IF candidate.generation_request_id IS NOT NULL THEN
      SELECT count(*)::integer INTO invalid_work_count
        FROM jsonb_array_elements(candidate.candidate_document#>'{work,soulx_avatar}') work_item
       WHERE work_item->>'avatarSourceAssetId' IS DISTINCT FROM target.avatar_runtime_source_asset_id::text
          OR work_item->>'avatarSourceSha256' IS DISTINCT FROM target.avatar_asset_sha256
          OR work_item->>'avatarSourceObjectKey' IS DISTINCT FROM target.avatar_object_key
          OR work_item->>'avatarSourceContentType' IS DISTINCT FROM target.avatar_content_type
          OR (work_item->>'avatarSourceContentLength')::bigint IS DISTINCT FROM target.avatar_byte_size
          OR work_item->>'avatarSourceInputReservationId' IS DISTINCT FROM
            public.videoforge_hosted_v209_uuid(
              'input-reservation',target.generation_request_id,'avatar-source')::text;
      IF candidate.project_revision_id<>target.id
         OR candidate.candidate_document->>'projectRevisionId' IS DISTINCT FROM target.id::text
         OR candidate.candidate_document->>'generationRequestId'
              IS DISTINCT FROM target.generation_request_id::text
         OR candidate.candidate_document->>'avatarSourceInputReservationId' IS DISTINCT FROM
            public.videoforge_hosted_v209_uuid(
              'input-reservation',target.generation_request_id,'avatar-source')::text
         OR candidate.candidate_sha256<>'sha256:'||encode(sha256(convert_to(
           public.videoforge_canonical_jsonb(candidate.candidate_document),'UTF8')),'hex')
         OR coalesce(jsonb_array_length(candidate.candidate_document#>'{work,soulx_avatar}'),0)<1
         OR invalid_work_count<>0 THEN
        RAISE EXCEPTION 'hosted V2-09 custom SoulX candidate avatar binding drifted'
          USING ERRCODE='23514';
      END IF;
    END IF;
    RETURN;
  END IF;

  projection:=public.videoforge_read_hosted_v209_system_avatar_projection($new$);

  IF patched=definition
     OR position('asset.kind IN (''AVATAR_RUNTIME'',''AVATAR_ORIGINAL'')' IN patched)=0
     OR position('hosted V2-09 custom PNG avatar object identity invalid' IN patched)=0
     OR position('hosted V2-09 exact SYSTEM avatar receipt unavailable' IN patched)=0 THEN
    RAISE EXCEPTION 'hosted V2-09 custom avatar predispatch patch failed' USING ERRCODE='55000';
  END IF;
  EXECUTE patched;
END
$patch_custom_avatar_predispatch$;

REVOKE ALL ON FUNCTION public.videoforge_assert_hosted_v209_ordinary_avatar_source(
  uuid,uuid,uuid) FROM PUBLIC;

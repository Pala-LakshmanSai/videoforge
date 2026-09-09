-- Migration 0109: ordinary workspace avatars may pin their verified original image
-- directly as the immutable runtime source. Keep SYSTEM clones restricted to AVATAR_RUNTIME.

DO $patch_custom_avatar_source_kind$
DECLARE
  signature constant text:=
    'videoforge_materialize_hosted_v209_system_avatar_reference_v2(uuid,uuid,uuid,uuid)';
  definition text;
  patched text;
  target_count integer;
BEGIN
  SELECT count(*),min(pg_get_functiondef(p.oid)) INTO target_count,definition
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.oid::regprocedure::text=signature;
  IF target_count<>1
     OR (length(definition)-length(replace(definition,
          'AND asset.kind=''AVATAR_RUNTIME''','')))
          /length('AND asset.kind=''AVATAR_RUNTIME''')<>1
     OR position('AND tenant_asset.kind=''AVATAR_RUNTIME''' IN definition)=0
     OR position('''referenceRequired'',false' IN definition)=0 THEN
    RAISE EXCEPTION 'hosted V2-09 custom avatar source preimage drifted' USING ERRCODE='55000';
  END IF;
  patched:=replace(definition,
    'AND asset.kind=''AVATAR_RUNTIME''',
    'AND asset.kind IN (''AVATAR_RUNTIME'',''AVATAR_ORIGINAL'')');
  IF patched=definition
     OR position('AND asset.kind IN (''AVATAR_RUNTIME'',''AVATAR_ORIGINAL'')' IN patched)=0
     OR position('AND tenant_asset.kind=''AVATAR_RUNTIME''' IN patched)=0 THEN
    RAISE EXCEPTION 'hosted V2-09 custom avatar source patch failed' USING ERRCODE='55000';
  END IF;
  EXECUTE patched;
END
$patch_custom_avatar_source_kind$;

REVOKE ALL ON FUNCTION public.videoforge_materialize_hosted_v209_system_avatar_reference_v2(
  uuid,uuid,uuid,uuid) FROM PUBLIC;

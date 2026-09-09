-- Migration 0101: align the two legacy ordinary-lane materializers with the
-- qualified production deployment contract.  Both retained lanes use a
-- one-hour (3600 second) authority lifetime; the previous Mage-only 7200
-- assertion rejected an otherwise valid renewed candidate.
--
-- Only the stale Mage literal is replaced.  The function signatures, body
-- guards, SECURITY DEFINER/search_path configuration, and existing ACLs are
-- preserved by CREATE OR REPLACE and checked before and after the patch.

DO $patch_mage_ttl_alignment$
DECLARE
  target_signature text;
  target_oid oid;
  target_count integer;
  definition text;
  patched text;
  stale_predicate text;
  replacement_predicate text;
  acl_before aclitem[];
  acl_after aclitem[];
BEGIN
  FOREACH target_signature IN ARRAY ARRAY[
    'videoforge_v209_ordinary_load_lane_legacy_0081(uuid,uuid,uuid,text)',
    'videoforge_v209_ordinary_commit_lane_legacy_0081(uuid,uuid,uuid,text,uuid,text,jsonb,text)'
  ] LOOP
    SELECT count(*) INTO target_count
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prokind='f'
       AND p.oid::regprocedure::text=target_signature;
    IF target_count<>1 THEN
      RAISE EXCEPTION 'hosted V2-09 Mage TTL patch target drifted: %',target_signature
        USING ERRCODE='55000';
    END IF;

    SELECT p.oid,pg_get_functiondef(p.oid),p.proacl
      INTO target_oid,definition,acl_before
      FROM pg_catalog.pg_proc p
     WHERE p.oid::regprocedure::text=target_signature;

    IF target_signature LIKE '%load_lane_legacy_0081%' THEN
      stale_predicate:='OR (supplied_lane=''mage_image'' AND target.request_ttl_seconds<>7200)';
      replacement_predicate:='OR (supplied_lane=''mage_image'' AND target.request_ttl_seconds<>3600)';
      IF position('OR (supplied_lane=''soulx_avatar'' AND target.request_ttl_seconds<>3600)' IN definition)=0 THEN
        RAISE EXCEPTION 'hosted V2-09 SoulX loader TTL contract drifted' USING ERRCODE='55000';
      END IF;
    ELSE
      stale_predicate:='OR (supplied_lane=''mage_image'' AND deployment.request_ttl_seconds<>7200)';
      replacement_predicate:='OR (supplied_lane=''mage_image'' AND deployment.request_ttl_seconds<>3600)';
      IF position('OR (supplied_lane=''soulx_avatar'' AND deployment.request_ttl_seconds<>3600)' IN definition)=0 THEN
        RAISE EXCEPTION 'hosted V2-09 SoulX commit TTL contract drifted' USING ERRCODE='55000';
      END IF;
    END IF;

    IF (length(definition)-length(replace(definition,stale_predicate,'')))
         /length(stale_predicate)<>1
       OR position(replacement_predicate IN definition)>0 THEN
      RAISE EXCEPTION 'hosted V2-09 Mage TTL patch preimage drifted: %',target_signature
        USING ERRCODE='55000';
    END IF;
    patched:=replace(definition,stale_predicate,replacement_predicate);
    IF patched=definition
       OR position(stale_predicate IN patched)>0
       OR (length(patched)-length(replace(patched,replacement_predicate,'')))
            /length(replacement_predicate)<>1 THEN
      RAISE EXCEPTION 'hosted V2-09 Mage TTL patch failed: %',target_signature
        USING ERRCODE='55000';
    END IF;
    EXECUTE patched;

    SELECT pg_get_functiondef(p.oid),p.proacl
      INTO definition,acl_after
      FROM pg_catalog.pg_proc p
     WHERE p.oid=target_oid;
    IF position(stale_predicate IN definition)>0
       OR position(replacement_predicate IN definition)=0
       OR acl_after IS DISTINCT FROM acl_before THEN
      RAISE EXCEPTION 'hosted V2-09 Mage TTL patch postcondition failed: %',target_signature
        USING ERRCODE='55000';
    END IF;
  END LOOP;
END
$patch_mage_ttl_alignment$;

-- Migration 0096: disambiguate the legacy V2-09 pair envelope JSONB subtraction.
-- PostgreSQL otherwise resolves `unknown - unknown` before the left JSONB operand is bound.

DO $patch_ordinary_pair_jsonb_subtraction$
DECLARE
  target_signature constant text:=
    'videoforge_v209_ordinary_pair_legacy_0081(uuid,uuid,uuid,uuid,jsonb)';
  target_oid oid;
  target_count integer;
  definition text;
  patched text;
  metadata_before jsonb;
  metadata_after jsonb;
  wrapper_before text;
  wrapper_after text;
  preimage_pattern constant text:=
    'item[[:space:]]*->[[:space:]]*''unsigned_envelope''(::text)?[[:space:]]*-[[:space:]]*''dispatch_token''(::text)?';
  replacement constant text:='(item -> ''unsigned_envelope''::text) - ''dispatch_token''::text';
  replacement_pattern constant text:=
    '\(item[[:space:]]*->[[:space:]]*''unsigned_envelope''::text\)[[:space:]]*-[[:space:]]*''dispatch_token''::text';
  match_count integer;
BEGIN
  SELECT count(*) INTO target_count
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.prokind='f'
     AND p.oid::regprocedure::text=target_signature;
  IF target_count<>1 THEN
    RAISE EXCEPTION 'hosted V2-09 legacy pair function is unavailable'
      USING ERRCODE='55000';
  END IF;
  SELECT p.oid,
         jsonb_build_object(
           'prorettype',p.prorettype::text,'proargtypes',p.proargtypes::text,
           'proallargtypes',p.proallargtypes::text,'proargmodes',p.proargmodes::text,
           'proargnames',p.proargnames::text,'provolatile',p.provolatile,
           'proparallel',p.proparallel,'prosecdef',p.prosecdef,
           'proconfig',p.proconfig::text,'proacl',p.proacl::text)
    INTO target_oid,metadata_before
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.oid::regprocedure::text=target_signature;
  IF metadata_before->>'prosecdef'<>'true'
     OR metadata_before->>'proconfig'<>'{"search_path=public, pg_catalog"}'
     OR has_function_privilege('public',target_oid,'EXECUTE') THEN
    RAISE EXCEPTION 'hosted V2-09 legacy pair metadata preimage drifted'
      USING ERRCODE='55000';
  END IF;
  definition:=pg_get_functiondef(target_oid);
  SELECT pg_get_functiondef(
    'public.videoforge_commit_hosted_v209_ordinary_pair(uuid,uuid,uuid,uuid,jsonb)'::regprocedure)
    INTO wrapper_before;
  SELECT count(*) INTO match_count
    FROM regexp_matches(definition,preimage_pattern,'g');
  IF match_count<>1 THEN
    RAISE EXCEPTION 'hosted V2-09 legacy pair JSONB subtraction preimage drifted'
      USING ERRCODE='55000';
  END IF;
  patched:=regexp_replace(definition,preimage_pattern,replacement,'g');
  IF patched=definition THEN
    RAISE EXCEPTION 'hosted V2-09 legacy pair JSONB subtraction was not patched'
      USING ERRCODE='55000';
  END IF;
  EXECUTE patched;
  SELECT pg_get_functiondef(p.oid),
         jsonb_build_object(
           'prorettype',p.prorettype::text,'proargtypes',p.proargtypes::text,
           'proallargtypes',p.proallargtypes::text,'proargmodes',p.proargmodes::text,
           'proargnames',p.proargnames::text,'provolatile',p.provolatile,
           'proparallel',p.proparallel,'prosecdef',p.prosecdef,
           'proconfig',p.proconfig::text,'proacl',p.proacl::text)
    INTO definition,metadata_after
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.prokind='f'
     AND p.oid::regprocedure::text=target_signature;
  SELECT count(*) INTO match_count
    FROM regexp_matches(definition,replacement_pattern,'g');
  SELECT pg_get_functiondef(
    'public.videoforge_commit_hosted_v209_ordinary_pair(uuid,uuid,uuid,uuid,jsonb)'::regprocedure)
    INTO wrapper_after;
  IF match_count<>1
     OR metadata_after IS DISTINCT FROM metadata_before
     OR wrapper_after IS DISTINCT FROM wrapper_before
     OR has_function_privilege('public',target_oid,'EXECUTE') THEN
    RAISE EXCEPTION 'hosted V2-09 legacy pair JSONB subtraction patch readback failed'
      USING ERRCODE='55000';
  END IF;
END
$patch_ordinary_pair_jsonb_subtraction$;

REVOKE ALL ON FUNCTION public.videoforge_v209_ordinary_pair_legacy_0081(uuid,uuid,uuid,uuid,jsonb)
  FROM PUBLIC;

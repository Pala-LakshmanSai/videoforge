-- Artifact INSERT/receipt triggers call private SYSTEM-reference predicates. Execute only the
-- trigger bodies as their existing owner; do not expose those predicates to runtime callers.
-- The row's explicit tenant must match the original request GUC before any privileged read.
DO $repair$
DECLARE signature text; definition text; expected_source_sha256 text; actual_source_sha256 text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.videoforge_artifact_reservation_guard()',
    'public.videoforge_artifact_receipt_guard()',
    'public.videoforge_hosted_v209_system_avatar_candidate_reservation_guard()'
  ] LOOP
    expected_source_sha256:=CASE signature
      WHEN 'public.videoforge_artifact_reservation_guard()' THEN 'dab1479dfdbd71edb20d099847319107b55d1a67611f23fb240d365bb064112c'
      WHEN 'public.videoforge_artifact_receipt_guard()' THEN '25aee8f5edfa69f6c5251f3eb01ff5e64000e9fbdf990c6cfc4ea9b34a6f7f2e'
      WHEN 'public.videoforge_hosted_v209_system_avatar_candidate_reservation_guard()' THEN '2f26b795e55537dd4e7d9de5d85927b41ad29df45c0c4a21dccdf250a9ffe1e5'
    END;
    SELECT pg_get_functiondef(oid),encode(sha256(convert_to(prosrc,'UTF8')),'hex')
      INTO definition,actual_source_sha256 FROM pg_proc WHERE oid=signature::regprocedure;
    IF actual_source_sha256 IS DISTINCT FROM expected_source_sha256 THEN
      RAISE EXCEPTION 'hosted artifact trigger source drift' USING ERRCODE='23514';
    END IF;
    IF definition IS NULL OR position('SECURITY DEFINER' IN definition)>0
       OR position('BEGIN' IN definition)=0
       OR position('videoforge_is_hosted_v209_system_avatar_reference' IN definition)=0 THEN
      RAISE EXCEPTION 'hosted artifact trigger definition drift' USING ERRCODE='23514';
    END IF;
    -- Replace only the first BEGIN, leaving all ownership, exact-candidate, immutable receipt,
    -- and retention checks unchanged. Trigger functions cannot be called as ordinary SQL.
    definition:=overlay(definition placing
      'BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM NEW.account_id THEN
    RAISE EXCEPTION ''hosted artifact trigger tenant scope denied'' USING ERRCODE=''42501'';
  END IF;'
      from position('BEGIN' IN definition) for length('BEGIN'));
    EXECUTE definition;
    EXECUTE 'ALTER FUNCTION '||signature||' SECURITY DEFINER';
    EXECUTE 'ALTER FUNCTION '||signature||' SET search_path=pg_catalog,public';
    EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC';
  END LOOP;
END;
$repair$;

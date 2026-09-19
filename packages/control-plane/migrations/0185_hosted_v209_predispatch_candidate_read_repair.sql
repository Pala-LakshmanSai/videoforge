-- Repairs the V2-09 predispatch avatar guard so a missing candidate row skips the candidate
-- cross-check instead of raising 55000.
--
-- videoforge_assert_hosted_v209_ordinary_avatar_source (0081, re-patched by 0110) cross-checks the
-- dispatch candidate document whenever one exists:
--
--   SELECT candidate_row.* INTO candidate
--     FROM public.hosted_v209_ordinary_dispatch_candidates candidate_row
--    WHERE candidate_row.account_id=... AND candidate_row.generation_request_id=...;
--   IF candidate.generation_request_id IS NOT NULL THEN
--
-- In PL/pgSQL a row/record target stays *unassigned* when SELECT INTO matches no row, and reading any
-- field of an unassigned record raises 55000 'record "candidate" is not assigned yet'. So the guard
-- explodes with an internal error - not a typed refusal - for every avatar source whose candidate row
-- does not exist yet, which is exactly the state the 0081 predispatch path is called in (the SYSTEM
-- snapshot path and any dispatch that has not loaded a candidate).
--
-- The intent is the conditional the author wrote: cross-check the candidate *when present*. FOUND is
-- set by that SELECT INTO before the IF runs, so the repair swaps the unassigned-record read for
-- FOUND and leaves the cross-check itself untouched.
--
-- Live production carries the same marker inside the installed definition, so this is a live defect
-- and not only a fixture one.
--
-- Idempotent: an already-repaired function is left alone, and a definition that contains neither the
-- unassigned read nor the repaired form is refused instead of patched blindly.

DO $repair_predispatch_candidate_read$
DECLARE
  signature constant text:=
    'videoforge_assert_hosted_v209_ordinary_avatar_source(uuid,uuid,uuid)';
  unassigned_read constant text:='IF candidate.generation_request_id IS NOT NULL THEN';
  definition text;
  patched text;
  target_count integer;
BEGIN
  SELECT count(*),min(pg_get_functiondef(p.oid)) INTO target_count,definition
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.oid::regprocedure::text=signature;
  IF target_count<>1 THEN
    RAISE EXCEPTION 'hosted V2-09 predispatch avatar guard is unavailable'
      USING ERRCODE='55000';
  END IF;

  IF position(unassigned_read IN definition)=0 THEN
    IF position('candidate_row.* INTO candidate' IN definition)>0
       AND position('IF FOUND THEN' IN definition)>0
       AND position('hosted V2-09 custom PNG avatar object identity invalid' IN definition)>0 THEN
      RAISE NOTICE 'hosted V2-09 predispatch avatar guard candidate read already repaired';
    ELSE
      RAISE EXCEPTION 'hosted V2-09 predispatch avatar guard preimage drifted'
        USING ERRCODE='55000';
    END IF;
  ELSE
    patched:=replace(definition,unassigned_read,'IF FOUND THEN');
    IF patched=definition
       OR position('hosted V2-09 custom SoulX candidate avatar binding drifted' IN patched)=0
       OR position('hosted V2-09 exact SYSTEM avatar receipt unavailable' IN patched)=0
       OR position('hosted V2-09 custom PNG avatar object identity invalid' IN patched)=0 THEN
      RAISE EXCEPTION 'hosted V2-09 predispatch avatar guard repair failed'
        USING ERRCODE='55000';
    END IF;
    EXECUTE patched;
    RAISE NOTICE 'hosted V2-09 predispatch avatar guard candidate read repaired';
  END IF;
END
$repair_predispatch_candidate_read$;

REVOKE ALL ON FUNCTION public.videoforge_assert_hosted_v209_ordinary_avatar_source(
  uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_assert_hosted_v209_ordinary_avatar_source(
  uuid,uuid,uuid) TO videoforge_v209_runtime_dc9612d6;

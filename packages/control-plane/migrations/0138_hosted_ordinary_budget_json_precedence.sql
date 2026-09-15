-- JSON extraction must finish before subtracting the transport-only cost key.
DO $migration$
DECLARE
  definition text;
  prior text := $old$(supplied_admission->'cost' - 'combinedCompletionCapMicroUsd')$old$;
  corrected text := $new$((supplied_admission->'cost') - 'combinedCompletionCapMicroUsd')$new$;
BEGIN
  definition:=pg_get_functiondef('public.videoforge_v209_ordinary_pair_legacy_0081(uuid,uuid,uuid,uuid,jsonb)'::regprocedure);
  IF position(prior IN definition)=0 OR position(corrected IN definition)>0 THEN
    RAISE EXCEPTION 'ordinary budget JSON precedence predecessor drift';
  END IF;
  EXECUTE replace(definition,prior,corrected);
END;
$migration$;

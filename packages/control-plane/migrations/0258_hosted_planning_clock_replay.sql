-- Planning start/end are display observations, not canonical plan identity.
-- Preserve the first accepted clock evidence and every other exact replay field.
DO $migration$
DECLARE definition text; preimage text:='existing.append_payload IS DISTINCT FROM supplied_payload'; replacement text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_append_hosted_canonical_timing(uuid,uuid,uuid,uuid,uuid,uuid,jsonb)'::regprocedure) INTO definition;
 replacement:=$clock$(existing.append_payload #- '{timeline,asset,metadata,planning_started_at}'
         #- '{timeline,asset,metadata,planning_completed_at}') IS DISTINCT FROM
         (supplied_payload #- '{timeline,asset,metadata,planning_started_at}'
         #- '{timeline,asset,metadata,planning_completed_at}')$clock$;
 IF (length(definition)-length(replace(definition,preimage,'')))/length(preimage)<>1 THEN
  RAISE EXCEPTION 'hosted planning clock replay preimage changed'; END IF;
 EXECUTE replace(definition,preimage,replacement);
END; $migration$;

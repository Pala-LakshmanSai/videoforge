-- Long ordinary videos could never dispatch. The duration-derived budget introduced by 0135 raises
-- a pair's lane spend ceiling above USD 2 for any video longer than 20 minutes, but the lane batch
-- validator in 0041 kept the pre-budget flat bound of USD 2, so the batch materialization rejected
-- every such plan with 'hosted lane batch manifest is invalid' (23514) and the project stayed at
-- WAITING_FOR_WORKER no matter how many times dispatch was retried.
--
-- Bind the validator to the budget's own legal maximum instead of a second hardcoded number, so the
-- two bounds cannot drift apart again. The replacement fails closed on predecessor drift.
CREATE FUNCTION pg_temp.vf_ceiling_replace(source text, needle text, replacement text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF position(needle IN source)=0 THEN
    RAISE EXCEPTION 'ordinary ceiling bound predecessor drift: %',left(needle,120);
  END IF;
  IF (length(source)-length(replace(source,needle,'')))/length(needle)<>1 THEN
    RAISE EXCEPTION 'ordinary ceiling bound is ambiguous in predecessor';
  END IF;
  RETURN replace(source,needle,replacement);
END;
$$;

DO $migration$
DECLARE definition text;
BEGIN
  definition:=pg_get_functiondef(
    'public.videoforge_materialize_hosted_lane_batches(uuid,uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure);
  definition:=pg_temp.vf_ceiling_replace(definition,
    $old$OR (batch->>'spend_ceiling_usd')::numeric<=0 OR (batch->>'spend_ceiling_usd')::numeric>2$old$,
    $new$OR (batch->>'spend_ceiling_usd')::numeric<=0
       OR (batch->>'spend_ceiling_usd')::numeric>
         (public.videoforge_ordinary_video_budget(108000)->>'hardVariableCostCeilingMicroUsd')::numeric/1000000$new$);
  EXECUTE definition;
END;
$migration$;

DROP FUNCTION pg_temp.vf_ceiling_replace(text,text,text);

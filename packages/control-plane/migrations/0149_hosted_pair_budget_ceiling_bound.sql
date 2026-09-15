-- Same stale flat bound as 0148, one layer deeper. The duration budget from 0135 quotes more than
-- USD 2 per lane for any video longer than twenty minutes, but the cost ledger, the predispatch
-- authority table, and the atomic pair predispatch commit still enforced the pre-budget USD 2
-- ceiling. A long ordinary video therefore failed at HOSTED_PAIR_PREDISPATCH_COMMIT_FAILED with
-- serverless_cost_ledgers_ceiling_usd_check (23514) even after the lane batch bound was aligned.
--
-- The legal maximum is the budget's own ceiling for its largest admissible input:
-- videoforge_ordinary_video_budget(108000) -> hardVariableCostCeilingMicroUsd = 5000000 (USD 5).
-- The table checks take that literal because a CHECK expression must be immutable; the function
-- clause reads it from the budget so the two cannot drift apart again.
--
-- Reservation conservation is untouched: reservation_usd <= spend_ceiling_usd and
-- reserved_usd <= ceiling_usd remain enforced.
ALTER TABLE public.serverless_cost_ledgers
  DROP CONSTRAINT serverless_cost_ledgers_ceiling_usd_check;
ALTER TABLE public.serverless_cost_ledgers
  ADD CONSTRAINT serverless_cost_ledgers_ceiling_usd_check
  CHECK (ceiling_usd > 0 AND ceiling_usd <= 5);

ALTER TABLE public.serverless_predispatch_authorities
  DROP CONSTRAINT serverless_predispatch_authorities_spend_ceiling_usd_check;
ALTER TABLE public.serverless_predispatch_authorities
  ADD CONSTRAINT serverless_predispatch_authorities_spend_ceiling_usd_check
  CHECK (spend_ceiling_usd > 0 AND spend_ceiling_usd <= 5);

CREATE FUNCTION pg_temp.vf_pair_ceiling_replace(source text, needle text, replacement text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF position(needle IN source)=0 THEN
    RAISE EXCEPTION 'atomic pair ceiling bound predecessor drift: %',left(needle,120);
  END IF;
  IF (length(source)-length(replace(source,needle,'')))/length(needle)<>1 THEN
    RAISE EXCEPTION 'atomic pair ceiling bound is ambiguous in predecessor';
  END IF;
  RETURN replace(source,needle,replacement);
END;
$$;

DO $migration$
DECLARE definition text;
BEGIN
  definition:=pg_get_functiondef(
    'public.videoforge_commit_hosted_atomic_pair_predispatch(uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,numeric,timestamp with time zone,jsonb,jsonb)'::regprocedure);
  definition:=pg_temp.vf_pair_ceiling_replace(definition,
    $old$OR (item->>'spend_ceiling_usd')::numeric<=0 OR (item->>'spend_ceiling_usd')::numeric>2$old$,
    $new$OR (item->>'spend_ceiling_usd')::numeric<=0
       OR (item->>'spend_ceiling_usd')::numeric>
         (public.videoforge_ordinary_video_budget(108000)->>'hardVariableCostCeilingMicroUsd')::numeric/1000000$new$);
  EXECUTE definition;
END;
$migration$;

DROP FUNCTION pg_temp.vf_pair_ceiling_replace(text,text,text);

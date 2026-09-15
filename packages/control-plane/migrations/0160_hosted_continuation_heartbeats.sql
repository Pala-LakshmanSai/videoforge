-- Heartbeats for the hosted stage-continuation sweep.
--
-- `wrangler tail` streams fetch invocations; scheduled (cron) invocations are not visible there, so a
-- sweep that never runs and one that runs and dispatches nothing look identical from the outside.
-- Each sweep attempt records one row, which makes the trigger observable in production and separates
-- "the cron is not delivering" from "the sweep found nothing due".
CREATE TABLE IF NOT EXISTS public.hosted_continuation_heartbeats (
  id bigserial PRIMARY KEY,
  cron text,
  due_count integer NOT NULL DEFAULT 0,
  dispatched text[] NOT NULL DEFAULT '{}',
  failure text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hosted_continuation_heartbeats_recorded_at_idx
  ON public.hosted_continuation_heartbeats (recorded_at DESC);

-- Retention: the sweep runs every minute, so keep a bounded window of history.
CREATE OR REPLACE FUNCTION public.videoforge_trim_hosted_continuation_heartbeats()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  removed integer;
BEGIN
  WITH doomed AS (
    SELECT id FROM public.hosted_continuation_heartbeats
     ORDER BY recorded_at DESC
     OFFSET 500
  )
  DELETE FROM public.hosted_continuation_heartbeats heartbeat
   USING doomed
   WHERE heartbeat.id = doomed.id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

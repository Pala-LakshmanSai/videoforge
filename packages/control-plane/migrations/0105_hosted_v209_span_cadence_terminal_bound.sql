-- SoulX consumes 25 fps audio, so outward cadence snapping may extend the
-- terminal source boundary by any value from 0 through 39 milliseconds.
-- Migration 0092 allowed only 20 ms, rejecting valid terminal spans such as
-- 159216 ms -> 159240 ms. Preserve the function byte-for-byte otherwise.

DO $migration$
DECLARE
  definition text;
  old_guard constant text :=
    'effective_padded_end>span_row.source_duration_ms+20';
  new_guard constant text :=
    'effective_padded_end>span_row.source_duration_ms+39';
BEGIN
  definition:=pg_get_functiondef(
    'public.videoforge_materialize_hosted_v209_span_audio_jobs(uuid,uuid,uuid,uuid)'::regprocedure
  );
  IF position(old_guard IN definition)=0 OR position(new_guard IN definition)>0 THEN
    RAISE EXCEPTION 'hosted V2-09 span cadence terminal guard drifted'
      USING ERRCODE='23514';
  END IF;
  EXECUTE replace(definition,old_guard,new_guard);
END;
$migration$;

-- A fresh one-batch run needs room for its paid original plus one USD 0.25 correction.
-- Preserve every existing run's exact reservation and all current preparation/recovery guards.
DO $$
DECLARE definition text; old_text text; new_text text;
BEGIN
  definition:=pg_get_functiondef('public.videoforge_prepare_hosted_prompt_run(jsonb)'::regprocedure);
  old_text:='least(8000000::numeric,planned_batch_count::numeric*250000::numeric)';
  new_text:='greatest(500000::numeric,least(8000000::numeric,planned_batch_count::numeric*250000::numeric))';
  IF position(old_text IN definition)=0 THEN
    RAISE EXCEPTION 'single-batch prompt reservation boundary drifted';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END;
$$;

-- Ordinary hosted projects are unlimited. Historical finite revision values remain inert audit
-- data; cost events remain exact and fully accounted.

ALTER TABLE public.project_revisions
  DROP CONSTRAINT project_revisions_maximum_cost_micro_usd_check,
  ALTER COLUMN maximum_cost_micro_usd DROP NOT NULL,
  ADD CONSTRAINT project_revisions_maximum_cost_micro_usd_check
    CHECK (
      maximum_cost_micro_usd IS NULL
      OR maximum_cost_micro_usd BETWEEN 50000 AND 2000000
    );

DO $$
DECLARE
  voice_definition text;
  prompt_definition text;
BEGIN
  voice_definition:=pg_get_functiondef(
    'public.videoforge_prepare_hosted_voiceover_context(jsonb)'::regprocedure
  );
  IF position('revision.maximum_cost_micro_usd>=10000' IN voice_definition)=0 THEN
    RAISE EXCEPTION 'hosted voiceover context cost guard drifted';
  END IF;
  voice_definition:=replace(
    voice_definition,
    'revision.maximum_cost_micro_usd>=10000',
    'TRUE'
  );
  EXECUTE voice_definition;

  prompt_definition:=pg_get_functiondef(
    'public.videoforge_prepare_hosted_prompt_run(jsonb)'::regprocedure
  );
  IF position('revision.maximum_cost_micro_usd>=50000' IN prompt_definition)=0 THEN
    RAISE EXCEPTION 'hosted prompt cost guard drifted';
  END IF;
  prompt_definition:=replace(
    prompt_definition,
    'revision.maximum_cost_micro_usd>=50000',
    'TRUE'
  );
  EXECUTE prompt_definition;
END;
$$;

COMMENT ON COLUMN public.project_revisions.maximum_cost_micro_usd IS
  'Inert historical project ceiling in integer micro-USD; new revisions use NULL. Exact cost accounting remains mandatory.';

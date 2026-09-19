-- Restores the unlimited-revision-budget repair for the stage-3 context capability.
--
-- Migration 0086 made project_revisions.maximum_cost_micro_usd nullable (NULL means "no project cost
-- limit") and replaced `revision.maximum_cost_micro_usd>=10000` with TRUE inside
-- videoforge_prepare_hosted_voiceover_context, because every real revision carries NULL.
--
-- Migration 0173 later re-created that same function from a stale copy and silently put the predicate
-- back. From 2026-09-18 11:52Z (0173's apply time) every stage-3 start therefore raised
-- 'hosted voiceover context authority is invalid' (42501): the context row was never created, the
-- continuation sweep re-offered the step on every tick (heartbeats: due_count 1, dispatched {},
-- failure "<project>:context:hosted voiceover context authority is invalid"), and the stage read
-- RUNNING with 0/100 forever - live on helen1, project e9f3d94c, revision bda7ccef.
--
-- The repair is the same in-place edit 0086 applied: assert the predicate is present, replace it with
-- TRUE, re-execute the definition. Safe because any non-null limit is >= 50000
-- (project_revisions_maximum_cost_micro_usd_check), which always covers the 10000 reservation. The
-- redispatch capability is checked too so a future copy cannot reintroduce the clause silently.
-- Idempotent: an already-repaired function is left alone.

DO $$
DECLARE
  voice_definition text;
BEGIN
  voice_definition:=pg_get_functiondef(
    'public.videoforge_prepare_hosted_voiceover_context(jsonb)'::regprocedure
  );
  IF position('revision.maximum_cost_micro_usd>=10000' IN voice_definition)=0 THEN
    RAISE NOTICE 'hosted voiceover context cost guard already repaired';
  ELSE
    voice_definition:=replace(
      voice_definition,
      'revision.maximum_cost_micro_usd>=10000',
      'TRUE'
    );
    EXECUTE voice_definition;
    RAISE NOTICE 'hosted voiceover context cost guard repaired';
  END IF;

  voice_definition:=pg_get_functiondef(
    'public.videoforge_redispatch_hosted_voiceover_context(jsonb)'::regprocedure
  );
  IF position('revision.maximum_cost_micro_usd>=10000' IN voice_definition)=0 THEN
    RAISE NOTICE 'hosted voiceover context redispatch guard carries no cost clause';
  ELSE
    voice_definition:=replace(
      voice_definition,
      'revision.maximum_cost_micro_usd>=10000',
      'TRUE'
    );
    EXECUTE voice_definition;
    RAISE NOTICE 'hosted voiceover context redispatch cost guard repaired';
  END IF;
END
$$;

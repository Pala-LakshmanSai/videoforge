-- Preserve the exact deadline that terminal acceptance compares to the stored attempt.
DO $migration$
DECLARE
  definition text;
  old_value text := $old$'deadlineAt',to_char(attempt.deadline_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')$old$;
  new_value text := $new$'deadlineAt',to_char(attempt.deadline_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.videoforge_read_hosted_v209_terminal_lineage(uuid,uuid,uuid,text,text)'::regprocedure
  ) INTO definition;
  IF strpos(definition,old_value)=0 THEN
    RAISE EXCEPTION 'hosted V2-09 terminal lineage preimage drifted' USING ERRCODE='23514';
  END IF;
  EXECUTE replace(definition,old_value,new_value);
END;
$migration$;

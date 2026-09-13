-- Extract JSON text before concatenation; otherwise PostgreSQL applies ->> to text.
DO $migration$
DECLARE
  definition text;
  old_path text := $old$attempt.output_prefix||'/artifact/'||artifact->>'item_id'$old$;
  new_path text := $new$attempt.output_prefix||'/artifact/'||(artifact->>'item_id')$new$;
  old_receipt text := $old$md5('hosted-v209-provenance:'||supplied_receipt->>'receipt_sha256')$old$;
  new_receipt text := $new$md5('hosted-v209-provenance:'||(supplied_receipt->>'receipt_sha256'))$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.videoforge_accept_hosted_v209_terminal_output(uuid,uuid,uuid,text,text,text,jsonb,jsonb,timestamptz)'::regprocedure
  ) INTO definition;
  IF strpos(definition,old_path)=0 OR strpos(definition,old_receipt)=0 THEN
    RAISE EXCEPTION 'hosted V2-09 terminal acceptance preimage drifted' USING ERRCODE='23514';
  END IF;
  EXECUTE replace(replace(definition,old_path,new_path),old_receipt,new_receipt);
END;
$migration$;

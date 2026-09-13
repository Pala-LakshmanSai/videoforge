-- Keep the aggregate item alias distinct from the PL/pgSQL artifact variable.
DO $migration$
DECLARE
  definition text;
  old_value text := $old$  SELECT jsonb_agg(jsonb_build_object('item_id',artifact->>'item_id','object_key',artifact->>'object_key',
      'content_type',artifact->>'content_type','content_length',(artifact->>'content_length')::bigint,
      'checksum_sha256',artifact->>'checksum_sha256')
      ORDER BY artifact->>'item_id' COLLATE "C") INTO canonical_objects
    FROM jsonb_array_elements(supplied_artifacts) artifact;$old$;
  new_value text := $new$  SELECT jsonb_agg(jsonb_build_object('item_id',accepted_item->>'item_id','object_key',accepted_item->>'object_key',
      'content_type',accepted_item->>'content_type','content_length',(accepted_item->>'content_length')::bigint,
      'checksum_sha256',accepted_item->>'checksum_sha256')
      ORDER BY accepted_item->>'item_id' COLLATE "C") INTO canonical_objects
    FROM jsonb_array_elements(supplied_artifacts) accepted_item;$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.videoforge_accept_hosted_v209_terminal_output(uuid,uuid,uuid,text,text,text,jsonb,jsonb,timestamptz)'::regprocedure
  ) INTO definition;
  IF strpos(definition,old_value)=0 THEN
    RAISE EXCEPTION 'hosted V2-09 terminal aggregate preimage drifted' USING ERRCODE='23514';
  END IF;
  EXECUTE replace(definition,old_value,new_value);
END;
$migration$;

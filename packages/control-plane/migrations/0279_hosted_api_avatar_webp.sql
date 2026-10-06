-- Match Avatar Hub uploads and Fal FlashHead's accepted reference-image formats.
-- Keep legacy SoulX PNG qualification and every scope/hash/audio/spend guard unchanged.
DO $$
DECLARE definition text; old_text text; new_text text;
BEGIN
  definition:=pg_get_functiondef('public.videoforge_materialize_hosted_api_jobs(uuid,uuid,uuid,uuid)'::regprocedure);
  old_text:=$old$span_row.avatar_content_type NOT IN ('image/png','image/jpeg')$old$;
  new_text:=$new$span_row.avatar_content_type NOT IN ('image/png','image/jpeg','image/webp')$new$;
  IF position(old_text IN definition)=0 OR
     (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 THEN
    RAISE EXCEPTION 'API avatar source type guard drifted';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END;
$$;

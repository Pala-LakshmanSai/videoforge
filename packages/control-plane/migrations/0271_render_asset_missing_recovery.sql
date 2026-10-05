-- A renderer that omitted a pinned input can recover only after its execution bundle changes.
-- Preserve accepted inputs, definite failure, ownership, cleanup, attempt caps and retry identity.
DO $migration$
DECLARE signature text; definition text; marker text;
BEGIN
 marker:=$old$'RENDER_INPUT_INVALID','RENDER_OUTPUT_INVALID'$old$;
 FOREACH signature IN ARRAY ARRAY[
  'public.videoforge_prepare_hosted_api_local_render_recovery(uuid,uuid,uuid,uuid,uuid,uuid,text)',
  'public.videoforge_prepare_cloud_media_render_recovery(uuid,uuid,uuid,uuid,uuid,uuid,text)',
  'public.videoforge_read_hosted_api_render_recovery_status(uuid,uuid,uuid,uuid,text)'
 ] LOOP
  SELECT pg_get_functiondef(signature::regprocedure) INTO definition;
  IF (length(definition)-length(replace(definition,marker,'')))/length(marker)<>2
   OR strpos(definition,'RENDER_ASSET_MISSING')>0
   OR strpos(definition,'failure_code IN ('||marker||')')=0
   OR strpos(definition,marker||$guard$,'RENDER_PROCESS_FAILED'$guard$)=0 THEN
   RAISE EXCEPTION 'render asset recovery preimage mismatch: %',signature;
  END IF;
  EXECUTE replace(definition,marker,
   $new$'RENDER_INPUT_INVALID','RENDER_OUTPUT_INVALID','RENDER_ASSET_MISSING'$new$);
 END LOOP;
END; $migration$;

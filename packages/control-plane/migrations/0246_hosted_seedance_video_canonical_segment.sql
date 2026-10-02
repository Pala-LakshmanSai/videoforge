-- SQL persistence stores a relational segment key (segment:<UUID>), while the
-- canonical render manifest carries that exact UUID. Match only these two forms;
-- keep immutable jobs, selected frames and all accepted source/output proofs.
DO $mapping$
DECLARE definition text; marker text:=$old$s->>'segment_id'=video.segment_id$old$;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_hosted_video_manifest_valid(uuid,uuid,uuid,jsonb)'::regprocedure) INTO definition;
 IF (length(definition)-length(replace(definition,marker,'')))/length(marker)<>2 THEN
  RAISE EXCEPTION 'video canonical segment validator preimage drift';
 END IF;
 EXECUTE replace(definition,marker,$new$(s->>'segment_id'=video.segment_id OR(
   (s->>'segment_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND video.segment_id='segment:'||(s->>'segment_id')))$new$);
END; $mapping$;

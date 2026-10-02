-- Shared media-worker inputs may include accepted scene video clips. Preserve
-- the installed legacy/image/avatar predicates exactly; add only MP4 scene-video
-- keys scoped to the row's account/workspace and UUID project/revision/job/artifact.
DO $input_keys$
DECLARE old_predicate text;
BEGIN
 SELECT pg_get_expr(c.conbin,c.conrelid) INTO old_predicate FROM pg_constraint c
  WHERE c.conrelid='public.media_worker_input_objects'::regclass
   AND c.conname='media_worker_input_objects_object_key_check' AND c.contype='c' AND c.convalidated;
 IF old_predicate IS NULL THEN RAISE EXCEPTION 'worker input object key preimage missing'; END IF;
 ALTER TABLE public.media_worker_input_objects DROP CONSTRAINT media_worker_input_objects_object_key_check;
 EXECUTE format('ALTER TABLE public.media_worker_input_objects ADD CONSTRAINT media_worker_input_objects_object_key_check CHECK ((%s) OR (%s))',old_predicate,
  $new$content_type='video/mp4' AND object_key ~ ('^tenant/'||account_id||'/workspace/'||workspace_id||'/project/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/revision/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/lane/scene-video/job/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/artifact/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')$new$);
END; $input_keys$;

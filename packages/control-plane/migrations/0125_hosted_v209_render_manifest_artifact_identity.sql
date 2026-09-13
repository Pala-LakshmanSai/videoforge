-- The manifest key ends in its asset UUID; preserve that identity in the reservation.
DO $migration$
DECLARE
  definition text;
  old_value text := $old$'resolved-render-manifest',supplied_object_key,'PUT'$old$;
  new_value text := $new$asset_id::text,supplied_object_key,'PUT'$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.videoforge_commit_hosted_v209_resolved_render_manifest(uuid,uuid,uuid,jsonb,text,text,bigint)'::regprocedure
  ) INTO definition;
  IF strpos(definition,old_value)=0 THEN
    RAISE EXCEPTION 'hosted V2-09 manifest reservation preimage drifted' USING ERRCODE='23514';
  END IF;
  EXECUTE replace(definition,old_value,new_value);
END;
$migration$;

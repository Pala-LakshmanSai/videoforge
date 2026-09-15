-- Qualify the lease columns against the materializer's same-named local variable.
DO $migration$
DECLARE
  definition text;
  prior text := $old$UPDATE public.provider_workload_leases SET
    expires_at=greatest(expires_at,db_now+make_interval(secs=>greatest(3600,(budget->>'soulxAvatarTimeoutSeconds')::integer+600))),
    heartbeat_at=db_now,version=version+1
    WHERE id=lease.id AND state='ACTIVE' AND released_at IS NULL RETURNING * INTO lease;$old$;
  corrected text := $new$UPDATE public.provider_workload_leases AS funded_lease SET
    expires_at=greatest(funded_lease.expires_at,db_now+make_interval(secs=>greatest(3600,(budget->>'soulxAvatarTimeoutSeconds')::integer+600))),
    heartbeat_at=db_now,version=funded_lease.version+1
    WHERE funded_lease.id=lease.id AND funded_lease.state='ACTIVE' AND funded_lease.released_at IS NULL RETURNING funded_lease.* INTO lease;$new$;
BEGIN
  definition := pg_get_functiondef('public.videoforge_materialize_hosted_v209_ordinary_dispatch(uuid,uuid,uuid,uuid)'::regprocedure);
  IF position(prior IN definition)=0 OR position(corrected IN definition)>0 THEN
    RAISE EXCEPTION 'ordinary budget lease alias predecessor drift';
  END IF;
  EXECUTE replace(definition,prior,corrected);
END;
$migration$;

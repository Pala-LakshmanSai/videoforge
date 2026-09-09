-- Migration 0108: renew an expired hosted V2-09 lease only while the same active
-- generation is still strictly pre-dispatch. Long personal-worker preparation must
-- not strand Stage 6/7 behind the original one-hour admission horizon.

DO $patch_predispatch_lease_renewal$
DECLARE
  signature constant text:=
    'videoforge_admit_hosted_v209_generation(uuid,uuid,uuid,uuid)';
  definition text;
  patched text;
  target_count integer;
BEGIN
  SELECT count(*),min(pg_get_functiondef(p.oid)) INTO target_count,definition
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.oid::regprocedure::text=signature;
  IF target_count<>1
     OR (length(definition)-length(replace(definition,
          'IF lease.id IS NOT NULL AND lease.expires_at<=db_now THEN','')))
          /length('IF lease.id IS NOT NULL AND lease.expires_at<=db_now THEN')<>1
     OR position('RAISE EXCEPTION ''hosted V2-09 active lease expired''' IN definition)=0
     OR position('IF request.state=''ACTIVE'' AND lease.id IS NOT NULL THEN' IN definition)=0 THEN
    RAISE EXCEPTION 'hosted V2-09 predispatch lease renewal preimage drifted' USING ERRCODE='55000';
  END IF;

  patched:=replace(definition,
$old$RAISE EXCEPTION 'hosted V2-09 active lease expired' USING ERRCODE='55000';$old$,
$new$
    IF request.state<>'ACTIVE'
       OR request.terminal_at IS NOT NULL
       OR EXISTS(SELECT 1 FROM public.hosted_v209_ordinary_dispatch_candidates row
          WHERE row.generation_request_id=request.id)
       OR EXISTS(SELECT 1 FROM public.hosted_paid_dispatch_claims row
          WHERE row.generation_request_id=request.id)
       OR EXISTS(SELECT 1 FROM public.serverless_attempts row
          WHERE row.generation_request_id=request.id)
       OR EXISTS(SELECT 1 FROM public.hosted_v209_ordinary_lane_materializations row
          WHERE row.generation_request_id=request.id)
       OR EXISTS(SELECT 1 FROM public.serverless_dispatch_outbox outbox
          JOIN public.serverless_attempts attempt ON attempt.id=outbox.attempt_id
          WHERE attempt.generation_request_id=request.id)
       OR EXISTS(SELECT 1 FROM public.serverless_provider_assignments assignment
          JOIN public.serverless_attempts attempt ON attempt.id=assignment.attempt_id
          WHERE attempt.generation_request_id=request.id) THEN
      RAISE EXCEPTION 'hosted V2-09 active lease expired' USING ERRCODE='55000';
    END IF;
    UPDATE public.provider_workload_leases row
       SET heartbeat_at=db_now,expires_at=db_now+interval '1 hour',version=row.version+1
     WHERE row.id=lease.id
       AND row.account_id=supplied_account_id
       AND row.workspace_id=supplied_workspace_id
       AND row.generation_request_id=request.id
       AND row.request_kind='VIDEO'
       AND row.state='ACTIVE'
       AND row.version=lease.version
       AND row.expires_at<=db_now
       AND row.released_at IS NULL
       AND row.release_reason IS NULL
    RETURNING row.* INTO lease;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'hosted V2-09 predispatch lease renewal CAS failed' USING ERRCODE='40001';
    END IF;
    INSERT INTO public.generation_queue_audits(
      id,account_id,workspace_id,actor_user_id,operation,request_kind,request_id,lease_id,
      request_version_before,request_version_after,video_cursor_before,video_cursor_after,
      preview_cursor_before,preview_cursor_after,detail,occurred_at)
    VALUES(
      gen_random_uuid(),supplied_account_id,supplied_workspace_id,supplied_user_id,
      'HEARTBEAT','VIDEO',request.id,lease.id,request.version,request.version,
      capacity_before.video_fair_cursor,capacity_before.video_fair_cursor,
      capacity_before.preview_fair_cursor,capacity_before.preview_fair_cursor,
      jsonb_build_object('hostedPredispatchLeaseRenewal',true,
        'leaseVersionAfter',lease.version,
        'leaseExpiresAt',to_char(lease.expires_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'providerActionsCreated',false),db_now);
$new$);

  IF patched=definition
     OR position('hostedPredispatchLeaseRenewal' IN patched)=0
     OR position('hosted V2-09 predispatch lease renewal CAS failed' IN patched)=0 THEN
    RAISE EXCEPTION 'hosted V2-09 predispatch lease renewal patch failed' USING ERRCODE='55000';
  END IF;
  EXECUTE patched;
END
$patch_predispatch_lease_renewal$;

REVOKE ALL ON FUNCTION public.videoforge_admit_hosted_v209_generation(
  uuid,uuid,uuid,uuid) FROM PUBLIC;

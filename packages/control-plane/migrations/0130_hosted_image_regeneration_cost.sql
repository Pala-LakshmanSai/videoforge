-- One-scene cost admission is independent of immutable ordinary video ledgers.
ALTER TABLE public.hosted_image_regeneration_requests ADD COLUMN cost_admission jsonb;

CREATE FUNCTION public.videoforge_admit_hosted_image_regeneration_cost(req uuid,snapshot jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE r hosted_image_regeneration_requests%ROWTYPE; active_count integer; rate bigint; balance bigint; observed timestamptz;
BEGIN
 PERFORM 1 FROM global_generation_capacity WHERE singleton FOR UPDATE;
 SELECT * INTO r FROM hosted_image_regeneration_requests
  WHERE id=req AND account_id=public.videoforge_current_account_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'regeneration not found' USING ERRCODE='02000'; END IF;
 IF r.state<>'PREPARED' THEN RAISE EXCEPTION 'regeneration already dispatched' USING ERRCODE='23514'; END IF;
 rate:=(snapshot->>'flex_rate_micro_usd_per_gpu_hour')::bigint;
 balance:=(snapshot->>'balance_micro_usd')::bigint;
 observed:=(snapshot->>'observed_at')::timestamptz;
 SELECT count(*) INTO active_count FROM provider_workload_leases WHERE state='ACTIVE';
 IF snapshot->>'schema_version' IS DISTINCT FROM 'videoforge-image-regeneration-cost/v1'
 OR rate IS NULL OR rate<=0 OR rate>1116000
 OR balance IS NULL OR balance-active_count*2000000<3000000
 OR active_count<1
 OR observed IS NULL OR observed>clock_timestamp() OR observed<clock_timestamp()-interval '60 seconds'
 OR (snapshot->>'maximum_cost_micro_usd')::bigint IS DISTINCT FROM 2000000::bigint
 OR (snapshot->>'balance_floor_micro_usd')::bigint IS DISTINCT FROM 3000000::bigint
 OR (snapshot->>'estimated_cost_micro_usd')::bigint IS DISTINCT FROM ceil(rate::numeric*1020000/3600000)::bigint
 OR (snapshot->>'cumulative_endpoint_billing_micro_usd')::bigint IS NULL
 OR (snapshot->>'cumulative_endpoint_billing_micro_usd')::bigint<0
 OR NOT EXISTS(SELECT 1 FROM provider_workload_leases WHERE id=r.lease_id AND state='ACTIVE' AND image_regeneration_request_id=r.id)
 THEN RAISE EXCEPTION 'regeneration cost admission invalid' USING ERRCODE='23514'; END IF;
 IF r.cost_admission IS NULL THEN
   UPDATE hosted_image_regeneration_requests SET cost_admission=snapshot WHERE id=req RETURNING * INTO r;
 ELSIF (r.cost_admission->>'observed_at')::timestamptz < clock_timestamp()-interval '60 seconds' THEN
   RAISE EXCEPTION 'regeneration cost admission expired' USING ERRCODE='23514';
 END IF;
 RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.videoforge_admit_hosted_image_regeneration_cost(uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION public.videoforge_guard_image_regeneration_cost() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF OLD.cost_admission IS NOT NULL AND NEW.cost_admission IS DISTINCT FROM OLD.cost_admission
 OR OLD.cost_admission IS NULL AND NEW.cost_admission IS NOT NULL AND OLD.state<>'PREPARED'
 THEN RAISE EXCEPTION 'regeneration cost admission immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hosted_image_regeneration_cost_immutable BEFORE UPDATE OF cost_admission
 ON public.hosted_image_regeneration_requests FOR EACH ROW EXECUTE FUNCTION public.videoforge_guard_image_regeneration_cost();
REVOKE ALL ON FUNCTION public.videoforge_guard_image_regeneration_cost() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.videoforge_image_regeneration_transition(req uuid,next_state text,job text,expected_body text DEFAULT NULL,expected_envelope text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE r hosted_image_regeneration_requests%ROWTYPE; acquired boolean:=false;
BEGIN
 SELECT * INTO r FROM hosted_image_regeneration_requests WHERE id=req AND account_id=public.videoforge_current_account_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'regeneration not found' USING ERRCODE='02000'; END IF;
 IF next_state='CANCEL_UNSENT' THEN
   IF r.state NOT IN ('QUEUED','PREPARED') THEN RETURN to_jsonb(r)||jsonb_build_object('acquired',false); END IF;
   next_state:='CANCELLED';
 END IF;
 IF next_state='SENT' AND r.state='PREPARED' THEN
   IF r.cost_admission IS NULL OR (r.cost_admission->>'observed_at')::timestamptz < clock_timestamp()-interval '60 seconds' THEN
     RAISE EXCEPTION 'fresh regeneration cost admission required' USING ERRCODE='23514';
   END IF;
  IF r.request_hash IS DISTINCT FROM expected_body OR r.envelope_hash IS DISTINCT FROM expected_envelope OR r.deadline_at<=now() THEN RAISE EXCEPTION 'regeneration request changed or expired' USING ERRCODE='23514'; END IF;
  acquired:=true;
 ELSIF next_state IN ('ASSIGNED','REQUEST_REJECTED','DISPATCH_ACK_UNKNOWN') AND r.state='SENT' THEN
  IF (next_state='ASSIGNED') IS DISTINCT FROM (job IS NOT NULL AND length(job)>0) THEN RAISE EXCEPTION 'invalid provider assignment' USING ERRCODE='23514'; END IF;
 ELSIF next_state IN ('FAILED','CANCELLED') AND r.state IN ('QUEUED','PREPARED','ASSIGNED','REQUEST_REJECTED') THEN NULL;
 ELSE RETURN to_jsonb(r)||jsonb_build_object('acquired',false);
 END IF;
 UPDATE hosted_image_regeneration_requests SET state=next_state,provider_job_id=coalesce(job,provider_job_id),updated_at=now() WHERE id=req RETURNING * INTO r;
 -- Capacity is deliberately retained until provider absence has been proved separately.
 RETURN to_jsonb(r)||jsonb_build_object('acquired',acquired);
END $$;

CREATE OR REPLACE FUNCTION public.videoforge_image_regeneration_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'regeneration history is immutable' USING ERRCODE='55000'; END IF;
 IF (to_jsonb(NEW)-ARRAY['state','request_body','envelope','request_hash','envelope_hash','lineage','dispatch_token','endpoint_id_sha256','provider_job_id','accepted','lease_id','deadline_at','updated_at','render_stale','cost_admission']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['state','request_body','envelope','request_hash','envelope_hash','lineage','dispatch_token','endpoint_id_sha256','provider_job_id','accepted','lease_id','deadline_at','updated_at','render_stale','cost_admission'])
 OR (OLD.state<>'QUEUED' AND (to_jsonb(NEW)-ARRAY['state','provider_job_id','accepted','updated_at','render_stale','cost_admission']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','provider_job_id','accepted','updated_at','render_stale','cost_admission']))
 OR (OLD.accepted IS NOT NULL AND NEW.accepted IS DISTINCT FROM OLD.accepted)
 OR (OLD.provider_job_id IS NOT NULL AND NEW.provider_job_id IS DISTINCT FROM OLD.provider_job_id) THEN RAISE EXCEPTION 'regeneration identity is immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;

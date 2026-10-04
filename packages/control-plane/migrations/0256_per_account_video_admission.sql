-- User decision 2026-10-04: one active video per account, no cross-account ceiling.
-- Widen diagnostic slot/count fields; keep account uniqueness and every ownership,
-- lease identity, provider idempotency, cleanup and rental deadline fence.
ALTER TABLE public.global_generation_capacity DROP CONSTRAINT global_generation_capacity_active_lease_count_check;
ALTER TABLE public.global_generation_capacity ALTER COLUMN active_lease_count TYPE integer;
ALTER TABLE public.global_generation_capacity ADD CONSTRAINT global_generation_capacity_active_lease_count_check CHECK(active_lease_count>=0);
DROP VIEW public.videoforge_tenant_provider_workload_leases;
ALTER TABLE public.provider_workload_leases DROP CONSTRAINT provider_workload_leases_slot_check;
ALTER TABLE public.provider_workload_leases ALTER COLUMN slot TYPE integer;
ALTER TABLE public.provider_workload_leases ADD CONSTRAINT provider_workload_leases_slot_check CHECK(slot>0);
CREATE VIEW public.videoforge_tenant_provider_workload_leases WITH(security_barrier) AS
 SELECT id,slot,account_id,workspace_id,request_kind,generation_request_id,preset_preview_request_id,
        owner_token_sha256,state,version,acquired_at,heartbeat_at,expires_at,released_at,release_reason
 FROM public.provider_workload_leases WHERE account_id=public.videoforge_current_account_id();
REVOKE ALL ON public.videoforge_tenant_provider_workload_leases FROM PUBLIC;

CREATE FUNCTION pg_temp.vf_scalable_replace(definition text, old_text text, new_text text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 IF (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 THEN
  RAISE EXCEPTION 'scalable admission reviewed preimage mismatch: %',left(old_text,100);
 END IF;
 RETURN replace(definition,old_text,new_text);
END $$;
DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef(oid) INTO STRICT definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='videoforge_validate_provider_workload_lease';
 definition:=pg_temp.vf_scalable_replace(definition,$old$    IF capacity_count >= 2 THEN
      RAISE EXCEPTION 'both global provider workload slots are occupied' USING ERRCODE = '23514';
    END IF;$old$,$new$$new$);
 EXECUTE definition;
 SELECT pg_get_functiondef(oid) INTO STRICT definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='videoforge_guard_hosted_cpu_project_admission';
 definition:=pg_temp.vf_scalable_replace(definition,$old$  SELECT count(*) INTO active_project_count
    FROM (
      SELECT DISTINCT attempt.account_id, attempt.project_id
        FROM hosted_cpu_job_attempts AS attempt
       WHERE attempt.id <> NEW.id
       AND NOT (attempt.execution_backend = 'RUNPOD_POD' AND attempt.state IN ('PLANNED','OUTBOXED'))
         AND attempt.state IN (
           'PLANNED', 'OUTBOXED', 'SUBMITTED', 'RUNNING', 'RECONCILING', 'CANCEL_REQUESTED'
         )
    ) AS active_projects;
  IF active_project_count >= 2 THEN
    RAISE EXCEPTION 'both global personal CPU projects are occupied' USING ERRCODE = '23514';
  END IF;
$old$,$new$$new$);
 EXECUTE definition;
 SELECT pg_get_functiondef(oid) INTO STRICT definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='videoforge_guard_cloud_media_reservation';
 definition:=pg_temp.vf_scalable_replace(definition,$old$   OR (SELECT count(DISTINCT occupied.account_id) FROM (
     SELECT l.account_id FROM provider_workload_leases l WHERE l.state='ACTIVE' AND l.expires_at>now()
     UNION ALL SELECT r.account_id FROM cloud_media_reservations r WHERE r.id<>NEW.id AND r.state NOT IN ('WAITING_CAPACITY','CLEAN')
     UNION ALL SELECT NEW.account_id) occupied)>2$old$,$new$$new$);
 definition:=pg_temp.vf_scalable_replace(definition,$old$ IF (SELECT count(*) FROM cloud_media_reservations r WHERE r.id<>NEW.id AND r.state NOT IN ('WAITING_CAPACITY','CLEAN'))>=2
   OR EXISTS$old$,$new$ IF EXISTS$new$);
 EXECUTE definition;
 SELECT pg_get_functiondef(oid) INTO STRICT definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='videoforge_guard_admission_against_cloud_cleanup';
 definition:=pg_temp.vf_scalable_replace(definition,$old$  OR (SELECT count(DISTINCT occupied.account_id) FROM (
    SELECT l.account_id FROM provider_workload_leases l WHERE l.id<>NEW.id AND l.state='ACTIVE' AND l.expires_at>now()
    UNION ALL SELECT r.account_id FROM cloud_media_reservations r WHERE r.state NOT IN ('WAITING_CAPACITY','CLEAN')
    UNION ALL SELECT NEW.account_id) occupied)>2$old$,$new$$new$);
 EXECUTE definition;
 SELECT pg_get_functiondef(oid) INTO STRICT definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='videoforge_admit_hosted_v209_generation_after_reclaim';
 definition:=pg_temp.vf_scalable_replace(definition,$old$available_slot smallint;$old$,$new$available_slot integer;$new$);
 definition:=pg_temp.vf_scalable_replace(definition,$old$  IF capacity_before.active_lease_count+public.videoforge_voiceover_active_count()>=2 THEN
    RETURN jsonb_build_object('generationRequestId',request.id,'state','WAITING');
  END IF;$old$,$new$$new$);
 definition:=pg_temp.vf_scalable_replace(definition,$old$WHERE queued.state IN ('WAITING','RETRY_WAIT') AND NOT public.videoforge_voiceover_busy(queued.account_id)$old$,$new$WHERE queued.state IN ('WAITING','RETRY_WAIT') AND queued.account_id=supplied_account_id$new$);
 definition:=pg_temp.vf_scalable_replace(definition,$old$FROM (VALUES(1::smallint),(2::smallint)) available(slot)$old$,$new$FROM (SELECT 1 AS slot UNION SELECT slot+1 FROM public.provider_workload_leases WHERE state='ACTIVE') available(slot)$new$);
 EXECUTE definition;
 SELECT pg_get_functiondef(oid) INTO STRICT definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='videoforge_prepare_hosted_image_regeneration';
 definition:=pg_temp.vf_scalable_replace(definition,$old$FROM generate_series(1,2) s$old$,$new$FROM (SELECT 1 AS s UNION SELECT slot+1 FROM public.provider_workload_leases WHERE state='ACTIVE') candidates$new$);
 EXECUTE definition;
 SELECT pg_get_functiondef(oid) INTO STRICT definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='videoforge_claim_hosted_api_image_regeneration';
 definition:=pg_temp.vf_scalable_replace(definition,$old$FROM generate_series(1,2) s$old$,$new$FROM (SELECT 1 AS s UNION SELECT slot+1 FROM public.provider_workload_leases WHERE state='ACTIVE') candidates$new$);
 EXECUTE definition;
END $migration$;

-- Narration preparation is independent of video execution. Serialize only another
-- narration for the same account; one VA's voiceover never blocks another VA/video.
DROP TRIGGER provider_workload_leases_aaa_voiceover ON public.provider_workload_leases;
CREATE OR REPLACE FUNCTION public.videoforge_voiceover_capacity_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['state','provider_job_id','failure_code','updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['state','provider_job_id','failure_code','updated_at'])
     OR (OLD.provider_job_id IS NOT NULL AND NEW.provider_job_id IS DISTINCT FROM OLD.provider_job_id)
     OR (OLD.state IN('COMPLETED','FAILED') AND NEW.state<>OLD.state)
     OR NEW.state='SUBMITTING' THEN RAISE EXCEPTION 'TTS identity cannot replay'; END IF;
  RETURN NEW;
 END IF;
 PERFORM 1 FROM public.accounts WHERE id=NEW.account_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.hosted_voiceover_jobs WHERE account_id=NEW.account_id
   AND state IN('SUBMITTING','PROCESSING','UNKNOWN_NO_RETRY')) THEN
  RAISE EXCEPTION 'VOICEOVER_CAPACITY_BUSY' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;

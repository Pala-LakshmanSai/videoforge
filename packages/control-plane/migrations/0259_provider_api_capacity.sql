-- Shared SECURITY DEFINER counters must see all tenants under forced RLS.
DO $owner$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'provider gate requires a BYPASSRLS or superuser migration owner' USING ERRCODE='42501';
 END IF;
END $owner$;
-- Provider capacity is shared across workflows; unknown submissions remain occupied.
CREATE TABLE public.provider_api_policies (
 provider text PRIMARY KEY, max_inflight integer CHECK(max_inflight BETWEEN 1 AND 1000),
 min_start_interval_ms integer NOT NULL CHECK(min_start_interval_ms BETWEEN 0 AND 86400000),
 next_start_at timestamptz NOT NULL DEFAULT '-infinity', cooldown_until timestamptz NOT NULL DEFAULT '-infinity'
);
INSERT INTO public.provider_api_policies(provider,max_inflight,min_start_interval_ms) VALUES
 ('KIE',100,550),('FAL',4,250),('RUNWARE_VIDEO',4,250),('J1_TTS',1,60000);
CREATE TABLE public.provider_api_waiters (
 provider text NOT NULL REFERENCES public.provider_api_policies(provider),kind text NOT NULL,job_id uuid NOT NULL,
 account_id uuid NOT NULL REFERENCES public.accounts(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(provider,kind,job_id)
);
CREATE TABLE public.provider_api_account_turns (
 provider text NOT NULL REFERENCES public.provider_api_policies(provider),account_id uuid NOT NULL REFERENCES public.accounts(id),
 last_served_at timestamptz NOT NULL, PRIMARY KEY(provider,account_id)
);
CREATE TABLE public.provider_api_rejections (
 provider text NOT NULL REFERENCES public.provider_api_policies(provider),kind text NOT NULL,job_id uuid NOT NULL,
 claim_id uuid NOT NULL,account_id uuid NOT NULL REFERENCES public.accounts(id),
 retry_after_ms integer NOT NULL CHECK(retry_after_ms BETWEEN 0 AND 86400000),rejected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(provider,kind,job_id,claim_id)
);
-- All shared counters are internal only; tenant callers cannot inspect another tenant's queue.
ALTER TABLE public.provider_api_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_api_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_api_policies_owner_only ON public.provider_api_policies USING(false) WITH CHECK(false);
ALTER TABLE public.provider_api_waiters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_api_waiters FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_api_waiters_owner_only ON public.provider_api_waiters USING(false) WITH CHECK(false);
ALTER TABLE public.provider_api_account_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_api_account_turns FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_api_account_turns_owner_only ON public.provider_api_account_turns USING(false) WITH CHECK(false);
ALTER TABLE public.provider_api_rejections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_api_rejections FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_api_rejections_owner_only ON public.provider_api_rejections USING(false) WITH CHECK(false);
REVOKE ALL ON public.provider_api_policies,public.provider_api_waiters,public.provider_api_account_turns,public.provider_api_rejections FROM PUBLIC;
CREATE FUNCTION public.videoforge_provider_api_rejection_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$ BEGIN RAISE EXCEPTION 'provider rejection receipt is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER provider_api_rejection_immutable BEFORE UPDATE OR DELETE ON public.provider_api_rejections
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_provider_api_rejection_immutable();

CREATE FUNCTION public.videoforge_provider_api_active_count(p_provider text) RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT CASE p_provider
 WHEN 'KIE' THEN (SELECT count(*) FROM hosted_api_generation_jobs WHERE lane='IMAGE' AND state IN('SUBMITTING','SUBMITTED','UNKNOWN_NO_RETRY'))
   +(SELECT count(*) FROM hosted_api_image_regeneration_jobs WHERE coalesce(input_manifest->>'provider','KIE_Z_IMAGE')='KIE_Z_IMAGE' AND state IN('SUBMITTING','SUBMITTED','UNKNOWN_NO_RETRY'))
 WHEN 'FAL' THEN (SELECT count(*) FROM hosted_api_generation_jobs WHERE lane='AVATAR' AND state IN('SUBMITTING','SUBMITTED','UNKNOWN_NO_RETRY'))
   +(SELECT count(*) FROM hosted_api_image_regeneration_jobs WHERE input_manifest->>'provider'='FAL_Z_IMAGE' AND state IN('SUBMITTING','SUBMITTED','UNKNOWN_NO_RETRY'))
 WHEN 'RUNWARE_VIDEO' THEN (SELECT count(*) FROM hosted_video_jobs WHERE state IN('SUBMITTING','SUBMITTED','UNKNOWN_NO_RETRY'))
 WHEN 'J1_TTS' THEN (SELECT count(*) FROM hosted_voiceover_jobs WHERE state IN('SUBMITTING','PROCESSING','UNKNOWN_NO_RETRY'))
 ELSE NULL END;
$$;
CREATE FUNCTION public.videoforge_provider_api_waiter_eligible(p_kind text,p_account uuid,p_job uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT CASE p_kind
 WHEN 'API' THEN EXISTS(SELECT 1 FROM hosted_api_generation_jobs j JOIN generation_requests r ON r.id=j.generation_request_id
   WHERE j.id=p_job AND j.account_id=p_account AND j.state='PREPARED' AND r.state='ACTIVE'
   AND NOT EXISTS(SELECT 1 FROM hosted_cpu_job_attempts cpu WHERE cpu.account_id=r.account_id AND cpu.workspace_id=r.workspace_id AND cpu.project_id=r.project_id AND cpu.project_revision_id=r.project_revision_id AND cpu.execution_backend='RUNPOD_POD' AND cpu.kind IN('ASR','SPAN_AUDIO') AND cpu.state IN('FAILED','CANCELLED','EXPIRED'))
   AND NOT EXISTS(SELECT 1 FROM hosted_api_generation_jobs blocked WHERE blocked.generation_request_id=r.id AND blocked.state IN('UNKNOWN_NO_RETRY','FAILED'))
   AND NOT EXISTS(SELECT 1 FROM hosted_video_jobs blocked WHERE blocked.generation_request_id=r.id AND (blocked.state='UNKNOWN_NO_RETRY' OR (blocked.state='FAILED' AND NOT public.videoforge_hosted_video_static_fallback(blocked.state,blocked.failure_code,blocked.output_cost_usd,blocked.duration_seconds)) OR blocked.output_cost_usd>blocked.duration_seconds*0.01336*1.10)))
 WHEN 'REGEN' THEN EXISTS(SELECT 1 FROM hosted_api_image_regeneration_jobs j JOIN projects p ON p.id=j.project_id AND p.account_id=j.account_id WHERE j.id=p_job AND j.account_id=p_account AND j.state='PREPARED' AND p.status='ACTIVE')
 WHEN 'VIDEO' THEN EXISTS(SELECT 1 FROM hosted_video_jobs j JOIN generation_requests r ON r.id=j.generation_request_id
   WHERE j.id=p_job AND j.account_id=p_account AND j.state='PREPARED' AND r.state='ACTIVE'
   AND NOT EXISTS(SELECT 1 FROM hosted_cpu_job_attempts cpu WHERE cpu.account_id=r.account_id AND cpu.workspace_id=r.workspace_id AND cpu.project_id=r.project_id AND cpu.project_revision_id=r.project_revision_id AND cpu.execution_backend='RUNPOD_POD' AND cpu.kind IN('ASR','SPAN_AUDIO') AND cpu.state IN('FAILED','CANCELLED','EXPIRED'))
   AND NOT EXISTS(SELECT 1 FROM hosted_api_generation_jobs blocked WHERE blocked.generation_request_id=r.id AND blocked.state IN('UNKNOWN_NO_RETRY','FAILED'))
   AND NOT EXISTS(SELECT 1 FROM hosted_video_jobs blocked WHERE blocked.generation_request_id=r.id AND (blocked.state='UNKNOWN_NO_RETRY' OR (blocked.state='FAILED' AND NOT public.videoforge_hosted_video_static_fallback(blocked.state,blocked.failure_code,blocked.output_cost_usd,blocked.duration_seconds)) OR blocked.output_cost_usd>blocked.duration_seconds*0.01336*1.10)))
 WHEN 'VOICEOVER' THEN EXISTS(SELECT 1 FROM hosted_voiceover_jobs WHERE id=p_job AND account_id=p_account AND state IN('PREPARED','WAITING'))
 ELSE false END;
$$;
CREATE FUNCTION public.videoforge_try_acquire_provider_api(p_provider text,p_account uuid,p_kind text,p_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE policy provider_api_policies%ROWTYPE; selected provider_api_waiters%ROWTYPE; now_at timestamptz:=clock_timestamp(); occupied bigint;
BEGIN
 IF p_account IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'provider gate scope invalid' USING ERRCODE='42501'; END IF;
 SELECT * INTO policy FROM provider_api_policies WHERE provider=p_provider FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'provider gate policy missing' USING ERRCODE='23514'; END IF;
 now_at:=clock_timestamp();
 IF NOT public.videoforge_provider_api_waiter_eligible(p_kind,p_account,p_job) THEN
  RETURN jsonb_build_object('acquired',false,'retryAt',now_at+interval '1 second'); END IF;
 INSERT INTO provider_api_waiters(provider,kind,job_id,account_id) VALUES(p_provider,p_kind,p_job,p_account) ON CONFLICT(provider,kind,job_id) DO UPDATE SET last_seen_at=clock_timestamp();
 -- Freshness applies only to unsubmitted queue tickets, never to paid/unknown work.
 -- A stopped workflow or an earlier claim guard cannot hold the queue head indefinitely.
 DELETE FROM provider_api_waiters q WHERE q.provider=p_provider AND (q.last_seen_at<now_at-interval '2 minutes' OR NOT public.videoforge_provider_api_waiter_eligible(q.kind,q.account_id,q.job_id));
 occupied:=public.videoforge_provider_api_active_count(p_provider);
 IF occupied IS NULL AND policy.max_inflight IS NOT NULL THEN RAISE EXCEPTION 'provider gate occupancy missing' USING ERRCODE='23514'; END IF;
 SELECT q.* INTO selected FROM provider_api_waiters q LEFT JOIN provider_api_account_turns t ON t.provider=q.provider AND t.account_id=q.account_id
 WHERE q.provider=p_provider ORDER BY coalesce(t.last_served_at,'-infinity'::timestamptz),q.created_at,q.job_id LIMIT 1;
 IF (policy.max_inflight IS NOT NULL AND occupied>=policy.max_inflight) OR greatest(policy.next_start_at,policy.cooldown_until)>now_at
   OR selected.job_id IS DISTINCT FROM p_job OR selected.kind IS DISTINCT FROM p_kind THEN
  RETURN jsonb_build_object('acquired',false,'retryAt',greatest(policy.next_start_at,policy.cooldown_until,now_at+interval '1 second'));
 END IF;
 UPDATE provider_api_policies SET next_start_at=now_at+policy.min_start_interval_ms*interval '1 millisecond' WHERE provider=p_provider;
 INSERT INTO provider_api_account_turns(provider,account_id,last_served_at) VALUES(p_provider,p_account,now_at)
 ON CONFLICT(provider,account_id) DO UPDATE SET last_served_at=EXCLUDED.last_served_at;
 DELETE FROM provider_api_waiters WHERE provider=p_provider AND kind=p_kind AND job_id=p_job;
 RETURN jsonb_build_object('acquired',true);
END $$;
-- Internal helper: exact claim fencing is mandatory in the calling job-specific wrapper.
CREATE FUNCTION public.videoforge_defer_provider_api(p_provider text,p_account uuid,p_kind text,p_job uuid,p_claim uuid,p_retry_after_ms integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF p_account IS DISTINCT FROM public.videoforge_current_account_id() OR p_claim IS NULL OR p_retry_after_ms IS NULL
   OR p_retry_after_ms NOT BETWEEN 0 AND 86400000 THEN RAISE EXCEPTION 'provider defer scope invalid' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM provider_api_policies WHERE provider=p_provider FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'provider gate policy missing' USING ERRCODE='23514'; END IF;
 INSERT INTO provider_api_rejections(provider,kind,job_id,claim_id,account_id,retry_after_ms)
 VALUES(p_provider,p_kind,p_job,p_claim,p_account,p_retry_after_ms) ON CONFLICT DO NOTHING;
 UPDATE provider_api_policies SET cooldown_until=greatest(cooldown_until,clock_timestamp()+greatest(p_retry_after_ms,least(900000,1000*power(2,least(10,(SELECT count(*) FROM provider_api_rejections WHERE provider=p_provider AND kind=p_kind AND job_id=p_job)))::integer))*interval '1 millisecond') WHERE provider=p_provider;
END $$;
REVOKE ALL ON FUNCTION public.videoforge_provider_api_active_count(text),public.videoforge_provider_api_waiter_eligible(text,uuid,uuid),
 public.videoforge_try_acquire_provider_api(text,uuid,text,uuid),public.videoforge_defer_provider_api(text,uuid,text,uuid,uuid,integer),
 public.videoforge_provider_api_rejection_immutable() FROM PUBLIC;

-- Patch the final definitions in place: retain cloud failure, invoice, cancellation,
-- source acceptance, global/account lease, and static fallback guards from prior migrations.
DO $gate$
DECLARE definition text; marker text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_claim_hosted_api_job(uuid,uuid,uuid,uuid,uuid)'::regprocedure) INTO definition;
 marker:=$old$  UPDATE public.hosted_api_generation_jobs SET state='SUBMITTING',claim_id=supplied_claim_id,$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'provider API gate preimage drift'; END IF;
 EXECUTE replace(definition,marker,$new$  IF NOT (public.videoforge_try_acquire_provider_api(CASE job.lane WHEN 'IMAGE' THEN 'KIE' ELSE 'FAL' END,
    job.account_id,'API',job.id)->>'acquired')::boolean THEN RETURN public.videoforge_hosted_api_job_json(job); END IF;
$new$||marker);
 SELECT pg_get_functiondef('public.videoforge_claim_hosted_video_job(uuid,uuid,uuid,uuid,uuid)'::regprocedure) INTO definition;
 marker:=$old$ UPDATE hosted_video_jobs SET state='SUBMITTING',claim_id=claim,input_manifest=manifest,$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'provider video gate preimage drift'; END IF;
 EXECUTE replace(definition,marker,$new$ IF NOT (public.videoforge_try_acquire_provider_api('RUNWARE_VIDEO',a,'VIDEO',j.id)->>'acquired')::boolean THEN RETURN public.videoforge_hosted_video_job_json(j); END IF;
$new$||marker);
 SELECT pg_get_functiondef('public.videoforge_claim_hosted_api_image_regeneration(uuid,uuid)'::regprocedure) INTO definition;
 marker:=$old$  chosen_lease_id:=md5('hosted-api-image-regeneration-lease:'||job.id::text)::uuid;$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'provider regeneration gate preimage drift'; END IF;
 EXECUTE replace(definition,marker,$new$  IF NOT (public.videoforge_try_acquire_provider_api(CASE WHEN job.input_manifest->>'provider'='FAL_Z_IMAGE' THEN 'FAL' ELSE 'KIE' END,job.account_id,'REGEN',job.id)->>'acquired')::boolean THEN RETURN public.videoforge_hosted_api_image_regeneration_json(job); END IF;
  chosen_lease_id:=md5('hosted-api-image-regeneration-lease:'||job.id::text||':'||claim::text)::uuid;$new$);
END $gate$;

CREATE FUNCTION public.videoforge_defer_hosted_api_job(a uuid,w uuid,g uuid,jid uuid,claim uuid,retry_ms integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE j hosted_api_generation_jobs%ROWTYPE;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'API defer scope invalid' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM generation_requests WHERE id=g AND account_id=a AND workspace_id=w FOR UPDATE;
 SELECT * INTO j FROM hosted_api_generation_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND generation_task_id=jid FOR UPDATE;
 IF j.id IS NULL OR j.state<>'SUBMITTING' OR j.claim_id IS DISTINCT FROM claim OR j.provider_task_id IS NOT NULL THEN RAISE EXCEPTION 'API defer claim invalid' USING ERRCODE='23514'; END IF;
 PERFORM public.videoforge_defer_provider_api(CASE j.lane WHEN 'IMAGE' THEN 'KIE' ELSE 'FAL' END,a,'API',j.id,claim,retry_ms);
 UPDATE hosted_api_generation_jobs SET state='PREPARED',claim_id=NULL,updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
 RETURN public.videoforge_hosted_api_job_json(j);
END $$;
CREATE FUNCTION public.videoforge_defer_hosted_video_job(a uuid,w uuid,g uuid,jid uuid,claim uuid,retry_ms integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE j hosted_video_jobs%ROWTYPE;
BEGIN
 IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'video defer scope invalid' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM generation_requests WHERE id=g AND account_id=a AND workspace_id=w FOR UPDATE;
 SELECT * INTO j FROM hosted_video_jobs WHERE account_id=a AND workspace_id=w AND generation_request_id=g AND id=jid FOR UPDATE;
 IF j.id IS NULL OR j.state<>'SUBMITTING' OR j.claim_id IS DISTINCT FROM claim OR j.provider_task_id IS NOT NULL THEN RAISE EXCEPTION 'video defer claim invalid' USING ERRCODE='23514'; END IF;
 PERFORM public.videoforge_defer_provider_api('RUNWARE_VIDEO',a,'VIDEO',j.id,claim,retry_ms);
 -- Exact Seedance UUID retries lack a verified contract: retain identity for explicit review, never static fallback.
 UPDATE hosted_video_jobs SET state='FAILED',failure_code='SEEDANCE_RATE_LIMIT_REQUIRES_REVIEW',completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
 RETURN public.videoforge_hosted_video_job_json(j);
END $$;
CREATE FUNCTION public.videoforge_defer_hosted_api_image_regeneration(req uuid,claim uuid,retry_ms integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE j hosted_api_image_regeneration_jobs%ROWTYPE;
BEGIN
 PERFORM 1 FROM global_generation_capacity WHERE singleton FOR UPDATE;
 SELECT * INTO j FROM hosted_api_image_regeneration_jobs WHERE id=req AND account_id=public.videoforge_current_account_id() FOR UPDATE;
 IF j.id IS NULL OR j.state<>'SUBMITTING' OR j.claim_id IS DISTINCT FROM claim OR j.provider_task_id IS NOT NULL THEN RAISE EXCEPTION 'regeneration defer claim invalid' USING ERRCODE='23514'; END IF;
 PERFORM public.videoforge_defer_provider_api(CASE WHEN j.input_manifest->>'provider'='FAL_Z_IMAGE' THEN 'FAL' ELSE 'KIE' END,j.account_id,'REGEN',j.id,claim,retry_ms);
 UPDATE provider_workload_leases SET state='RELEASED',released_at=clock_timestamp(),release_reason='API_RATE_LIMITED',version=version+1,
 heartbeat_at=clock_timestamp(),expires_at=greatest(expires_at,clock_timestamp()+interval '1 second') WHERE id=j.lease_id AND state='ACTIVE';
 UPDATE hosted_api_image_regeneration_jobs SET state='PREPARED',claim_id=NULL,lease_id=NULL,updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
 RETURN public.videoforge_hosted_api_image_regeneration_json(j);
END $$;
REVOKE ALL ON FUNCTION public.videoforge_defer_hosted_api_job(uuid,uuid,uuid,uuid,uuid,integer),public.videoforge_defer_hosted_video_job(uuid,uuid,uuid,uuid,uuid,integer),public.videoforge_defer_hosted_api_image_regeneration(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_defer_hosted_api_job(uuid,uuid,uuid,uuid,uuid,integer),public.videoforge_defer_hosted_video_job(uuid,uuid,uuid,uuid,uuid,integer),public.videoforge_defer_hosted_api_image_regeneration(uuid,uuid,integer) TO videoforge_v209_runtime_dc9612d6;

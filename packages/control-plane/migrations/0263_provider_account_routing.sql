-- Account-aware media routing. Existing task inputs and provider request IDs are untouched.
DO $owner$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'provider routing requires a BYPASSRLS or superuser migration owner' USING ERRCODE='42501';
 END IF;
END $owner$;
CREATE TABLE public.provider_accounts (
 provider_account_id text PRIMARY KEY CHECK(provider_account_id ~ '^[a-z][a-z0-9-]{0,63}$'),
 provider text NOT NULL CHECK(provider IN('KIE','FAL')),
 credential_version text NOT NULL CHECK(credential_version ~ '^[a-zA-Z0-9_-]{1,64}$'),
 gate_provider text NOT NULL UNIQUE REFERENCES public.provider_api_policies(provider),
 enabled boolean NOT NULL DEFAULT false, is_legacy boolean NOT NULL DEFAULT false,
 pricing_verified boolean NOT NULL DEFAULT false,
 routing_available_from timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(NOT enabled OR pricing_verified),
 CHECK((is_legacy AND gate_provider=provider) OR (NOT is_legacy AND gate_provider=provider||':'||provider_account_id))
);
CREATE UNIQUE INDEX provider_accounts_legacy ON public.provider_accounts(provider) WHERE is_legacy;
INSERT INTO public.provider_accounts VALUES('kie-legacy','KIE','v1','KIE',true,true,true),('fal-legacy','FAL','v1','FAL',true,true,true);
CREATE TABLE public.provider_submission_attempt_accounts (
 kind text NOT NULL CHECK(kind IN('API','REGEN')), job_id uuid NOT NULL,
 claim_id uuid NOT NULL, account_id uuid NOT NULL REFERENCES public.accounts(id),
 provider_account_id text NOT NULL REFERENCES public.provider_accounts(provider_account_id),
 credential_version text NOT NULL, pinned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(kind,job_id,claim_id)
);
CREATE TABLE public.provider_task_routes (
 kind text NOT NULL CHECK(kind IN('API','REGEN')),job_id uuid NOT NULL,
 account_id uuid NOT NULL REFERENCES public.accounts(id),provider_account_id text NOT NULL REFERENCES public.provider_accounts(provider_account_id),
 credential_version text NOT NULL,claim_id uuid NOT NULL,pinned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(kind,job_id), FOREIGN KEY(kind,job_id,claim_id) REFERENCES public.provider_submission_attempt_accounts(kind,job_id,claim_id)
);
CREATE TABLE public.generation_provider_preferences (
 generation_request_id uuid NOT NULL REFERENCES public.generation_requests(id),
 provider text NOT NULL CHECK(provider IN('KIE','FAL')),
 provider_account_id text NOT NULL REFERENCES public.provider_accounts(provider_account_id),
 PRIMARY KEY(generation_request_id,provider)
);
DO $security$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['provider_accounts','provider_submission_attempt_accounts','provider_task_routes','generation_provider_preferences'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I ON public.%I USING(false) WITH CHECK(false)',t||'_owner_only',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, videoforge_v209_runtime_dc9612d6',t);
 END LOOP;
END $security$;
CREATE FUNCTION public.videoforge_provider_account_identity_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'provider account identity is immutable' USING ERRCODE='23514'; END IF;
 IF (NEW.provider_account_id,NEW.provider,NEW.credential_version,NEW.gate_provider,NEW.is_legacy,NEW.routing_available_from)
 IS DISTINCT FROM (OLD.provider_account_id,OLD.provider,OLD.credential_version,OLD.gate_provider,OLD.is_legacy,OLD.routing_available_from) THEN
  RAISE EXCEPTION 'provider account identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER provider_account_identity_immutable BEFORE UPDATE OR DELETE ON public.provider_accounts FOR EACH ROW EXECUTE FUNCTION public.videoforge_provider_account_identity_immutable();
CREATE TRIGGER provider_submission_account_immutable BEFORE UPDATE OR DELETE ON public.provider_submission_attempt_accounts FOR EACH ROW EXECUTE FUNCTION public.videoforge_provider_api_rejection_immutable();
CREATE FUNCTION public.videoforge_provider_route_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'provider route is immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM provider_api_rejections r WHERE r.kind=OLD.kind AND r.job_id=OLD.job_id AND r.claim_id=OLD.claim_id AND r.account_id=OLD.account_id) THEN
  RAISE EXCEPTION 'provider route requires exact unaccepted receipt' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER provider_route_guard BEFORE UPDATE OR DELETE ON public.provider_task_routes FOR EACH ROW EXECUTE FUNCTION public.videoforge_provider_route_guard();

CREATE FUNCTION public.videoforge_provider_account_json(p_kind text,p_job uuid,p_account uuid,p_provider text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT jsonb_build_object('id',a.provider_account_id,'provider',a.provider,'credentialVersion',a.credential_version)
 FROM provider_accounts a WHERE a.provider_account_id=coalesce(
  (SELECT r.provider_account_id FROM provider_task_routes r WHERE r.kind=p_kind AND r.job_id=p_job AND r.account_id=p_account),
  (SELECT provider_account_id FROM provider_accounts WHERE provider=p_provider AND is_legacy))
 AND p_account=public.videoforge_current_account_id()
$$;
-- Enrich all scoped output paths, including record/commit/defer, without altering input manifests.
DO $clone$ DECLARE d text; BEGIN SELECT pg_get_functiondef('public.videoforge_hosted_api_job_json(public.hosted_api_generation_jobs)'::regprocedure) INTO d; EXECUTE replace(d,'public.videoforge_hosted_api_job_json(', 'public.videoforge_hosted_api_job_json_0262('); END $clone$;
CREATE OR REPLACE FUNCTION public.videoforge_hosted_api_job_json(job public.hosted_api_generation_jobs) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT public.videoforge_hosted_api_job_json_0262(job)||jsonb_build_object('providerAccount',public.videoforge_provider_account_json('API',job.id,job.account_id,CASE job.lane WHEN 'IMAGE' THEN 'KIE' ELSE 'FAL' END))
$$;
DO $clone$ DECLARE d text; BEGIN SELECT pg_get_functiondef('public.videoforge_hosted_api_image_regeneration_json(public.hosted_api_image_regeneration_jobs)'::regprocedure) INTO d; EXECUTE replace(d,'public.videoforge_hosted_api_image_regeneration_json(', 'public.videoforge_hosted_api_image_regeneration_json_0262('); END $clone$;
CREATE OR REPLACE FUNCTION public.videoforge_hosted_api_image_regeneration_json(job public.hosted_api_image_regeneration_jobs) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT public.videoforge_hosted_api_image_regeneration_json_0262(job)||jsonb_build_object('providerAccount',public.videoforge_provider_account_json('REGEN',job.id,job.account_id,CASE WHEN job.input_manifest->>'provider'='FAL_Z_IMAGE' THEN 'FAL' ELSE 'KIE' END))
$$;
DO $clone$ DECLARE d text; BEGIN SELECT pg_get_functiondef('public.videoforge_provider_api_active_count(text)'::regprocedure) INTO d; EXECUTE replace(d,'public.videoforge_provider_api_active_count(', 'public.videoforge_provider_api_active_count_0262('); END $clone$;
CREATE OR REPLACE FUNCTION public.videoforge_provider_api_active_count(p_provider text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE a provider_accounts%ROWTYPE; BEGIN
 SELECT * INTO a FROM provider_accounts WHERE gate_provider=p_provider;
 IF a.provider_account_id IS NULL THEN RETURN public.videoforge_provider_api_active_count_0262(p_provider); END IF;
 RETURN (SELECT count(*) FROM hosted_api_generation_jobs j LEFT JOIN provider_task_routes r ON r.kind='API' AND r.job_id=j.id
  WHERE j.state IN('SUBMITTING','SUBMITTED','UNKNOWN_NO_RETRY') AND (CASE j.lane WHEN 'IMAGE' THEN 'KIE' ELSE 'FAL' END)=a.provider
  AND (r.provider_account_id=a.provider_account_id OR (r.job_id IS NULL AND a.is_legacy)))
 +(SELECT count(*) FROM hosted_api_image_regeneration_jobs j LEFT JOIN provider_task_routes r ON r.kind='REGEN' AND r.job_id=j.id
  WHERE j.state IN('SUBMITTING','SUBMITTED','UNKNOWN_NO_RETRY') AND (CASE WHEN j.input_manifest->>'provider'='FAL_Z_IMAGE' THEN 'FAL' ELSE 'KIE' END)=a.provider
  AND (r.provider_account_id=a.provider_account_id OR (r.job_id IS NULL AND a.is_legacy)));
END $$;

CREATE FUNCTION public.videoforge_acquire_media_provider_account(p_provider text,p_account uuid,p_kind text,p_job uuid,p_claim uuid,p_generation uuid,p_available_accounts text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE candidate record; preferred text; pinned provider_task_routes%ROWTYPE; result jsonb;
BEGIN
 IF p_account IS DISTINCT FROM public.videoforge_current_account_id() OR p_claim IS NULL THEN RAISE EXCEPTION 'provider routing scope invalid' USING ERRCODE='42501'; END IF;
 SELECT * INTO pinned FROM provider_task_routes WHERE kind=p_kind AND job_id=p_job;
 IF FOUND THEN RAISE EXCEPTION 'prepared task retains a provider account claim' USING ERRCODE='23514'; END IF;
 SELECT provider_account_id INTO preferred FROM generation_provider_preferences WHERE generation_request_id=p_generation AND provider=p_provider;
 -- Provider advisory lock is taken by outer claims BEFORE request/job locks. Lock policies consistently before choosing.
 PERFORM 1 FROM provider_api_policies q JOIN provider_accounts a ON a.gate_provider=q.provider WHERE a.provider=p_provider ORDER BY q.provider FOR UPDATE OF q;
 FOR candidate IN SELECT a.*,public.videoforge_provider_api_active_count(a.gate_provider) AS occupancy FROM provider_accounts a
  JOIN provider_api_policies q ON q.provider=a.gate_provider
  WHERE a.provider=p_provider AND a.enabled AND a.pricing_verified AND a.provider_account_id=ANY(p_available_accounts)
  AND (a.is_legacy OR (p_kind='API' AND EXISTS(SELECT 1 FROM generation_requests g WHERE g.id=p_generation AND g.account_id=p_account AND g.created_at>=a.routing_available_from))
    OR (p_kind='REGEN' AND EXISTS(SELECT 1 FROM hosted_api_image_regeneration_jobs j WHERE j.id=p_job AND j.account_id=p_account AND j.created_at>=a.routing_available_from)))
  ORDER BY CASE WHEN a.provider_account_id=preferred THEN 0 ELSE 1 END,
   CASE WHEN q.max_inflight IS NULL THEN 0 ELSE public.videoforge_provider_api_active_count(a.gate_provider)::numeric/q.max_inflight END,(SELECT count(*) FROM generation_provider_preferences prefs WHERE prefs.provider_account_id=a.provider_account_id),a.provider_account_id
 LOOP
  result:=public.videoforge_try_acquire_provider_api(candidate.gate_provider,p_account,p_kind,p_job);
  IF (result->>'acquired')::boolean THEN
   INSERT INTO provider_submission_attempt_accounts(kind,job_id,claim_id,account_id,provider_account_id,credential_version) VALUES(p_kind,p_job,p_claim,p_account,candidate.provider_account_id,candidate.credential_version);
   INSERT INTO provider_task_routes(kind,job_id,account_id,provider_account_id,credential_version,claim_id) VALUES(p_kind,p_job,p_account,candidate.provider_account_id,candidate.credential_version,p_claim);
   IF p_generation IS NOT NULL THEN INSERT INTO generation_provider_preferences VALUES(p_generation,p_provider,candidate.provider_account_id) ON CONFLICT DO NOTHING; END IF;
   -- A task can wait on several eligible pools, but has exactly one paid route.
   DELETE FROM provider_api_waiters w USING provider_accounts a WHERE w.provider=a.gate_provider AND a.provider=p_provider AND w.kind=p_kind AND w.job_id=p_job;
   RETURN jsonb_build_object('acquired',true);
  END IF;
 END LOOP;
 RETURN jsonb_build_object('acquired',false);
END $$;

-- Clone final guarded claims. Only the media gate is substituted; every prior guard remains.
DO $claims$ DECLARE d text; old text; BEGIN
 SELECT pg_get_functiondef('public.videoforge_claim_hosted_api_job(uuid,uuid,uuid,uuid,uuid)'::regprocedure) INTO d;
 d:=replace(d,'videoforge_claim_hosted_api_job(', 'videoforge_claim_hosted_api_job_v2(');
 d:=replace(d,'supplied_claim_id uuid)', 'supplied_claim_id uuid, p_available_accounts text[])');
 old:=$m$public.videoforge_try_acquire_provider_api(CASE job.lane WHEN 'IMAGE' THEN 'KIE' ELSE 'FAL' END,
    job.account_id,'API',job.id)$m$;
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'routing API gate preimage drift'; END IF;
 d:=replace(d,old,$m$public.videoforge_acquire_media_provider_account(CASE job.lane WHEN 'IMAGE' THEN 'KIE' ELSE 'FAL' END,job.account_id,'API',job.id,supplied_claim_id,job.generation_request_id,p_available_accounts)$m$);
 d:=replace(d,E'BEGIN\n',E'BEGIN\n  PERFORM pg_advisory_xact_lock(263,1);\n'); EXECUTE d;
 SELECT pg_get_functiondef('public.videoforge_claim_hosted_api_image_regeneration(uuid,uuid)'::regprocedure) INTO d;
 d:=replace(d,'videoforge_claim_hosted_api_image_regeneration(', 'videoforge_claim_hosted_api_image_regeneration_v2(');
 d:=replace(d,'claim uuid)', 'claim uuid, p_available_accounts text[])');
 old:=$m$public.videoforge_try_acquire_provider_api(CASE WHEN job.input_manifest->>'provider'='FAL_Z_IMAGE' THEN 'FAL' ELSE 'KIE' END,job.account_id,'REGEN',job.id)$m$;
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'routing regeneration gate preimage drift'; END IF;
 d:=replace(d,old,$m$public.videoforge_acquire_media_provider_account(CASE WHEN job.input_manifest->>'provider'='FAL_Z_IMAGE' THEN 'FAL' ELSE 'KIE' END,job.account_id,'REGEN',job.id,claim,NULL,p_available_accounts)$m$);
 d:=replace(d,E'BEGIN\n',E'BEGIN\n  PERFORM pg_advisory_xact_lock(263,1);\n'); EXECUTE d;
END $claims$;
-- One media routing lock also covers legacy callers, avoiding lock-order inversions during rollout.
DO $clone$ DECLARE d text; BEGIN SELECT pg_get_functiondef('public.videoforge_claim_hosted_api_job(uuid,uuid,uuid,uuid,uuid)'::regprocedure) INTO d; EXECUTE replace(d,'public.videoforge_claim_hosted_api_job(', 'public.videoforge_claim_hosted_api_job_0262('); END $clone$;
CREATE OR REPLACE FUNCTION public.videoforge_claim_hosted_api_job(supplied_account_id uuid,supplied_workspace_id uuid,supplied_generation_request_id uuid,supplied_generation_task_id uuid,supplied_claim_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$ DECLARE a ALIAS FOR $1; w ALIAS FOR $2; g ALIAS FOR $3; t ALIAS FOR $4; c ALIAS FOR $5; prepared_job public.hosted_api_generation_jobs%ROWTYPE; BEGIN
 PERFORM pg_advisory_xact_lock(263,1);
 IF EXISTS(SELECT 1 FROM hosted_api_generation_jobs j JOIN provider_task_routes r ON r.kind='API' AND r.job_id=j.id JOIN provider_accounts p ON p.provider_account_id=r.provider_account_id WHERE j.account_id=public.videoforge_current_account_id() AND j.account_id=a AND j.workspace_id=w AND j.generation_request_id=g AND j.generation_task_id=t AND NOT p.is_legacy) THEN RAISE EXCEPTION 'PROVIDER_ACCOUNT_ROUTING_VERSION_REQUIRED' USING ERRCODE='23514'; END IF;
 SELECT j.* INTO prepared_job FROM hosted_api_generation_jobs j JOIN provider_accounts p ON p.is_legacy AND p.provider=CASE j.lane WHEN 'IMAGE' THEN 'KIE' ELSE 'FAL' END
 WHERE j.account_id=public.videoforge_current_account_id() AND j.account_id=a AND j.workspace_id=w AND j.generation_request_id=g AND j.generation_task_id=t AND j.state='PREPARED' AND NOT p.enabled;
 IF FOUND THEN RETURN public.videoforge_hosted_api_job_json(prepared_job); END IF;
 RETURN public.videoforge_claim_hosted_api_job_0262(a,w,g,t,c);
END $$;
DO $clone$ DECLARE d text; BEGIN SELECT pg_get_functiondef('public.videoforge_claim_hosted_api_image_regeneration(uuid,uuid)'::regprocedure) INTO d; EXECUTE replace(d,'public.videoforge_claim_hosted_api_image_regeneration(', 'public.videoforge_claim_hosted_api_image_regeneration_0262('); END $clone$;
CREATE OR REPLACE FUNCTION public.videoforge_claim_hosted_api_image_regeneration(req uuid,claim uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$ DECLARE prepared_job public.hosted_api_image_regeneration_jobs%ROWTYPE; BEGIN
 PERFORM pg_advisory_xact_lock(263,1);
 IF EXISTS(SELECT 1 FROM provider_task_routes r JOIN provider_accounts p ON p.provider_account_id=r.provider_account_id WHERE r.kind='REGEN' AND r.job_id=req AND r.account_id=public.videoforge_current_account_id() AND NOT p.is_legacy) THEN RAISE EXCEPTION 'PROVIDER_ACCOUNT_ROUTING_VERSION_REQUIRED' USING ERRCODE='23514'; END IF;
 SELECT j.* INTO prepared_job FROM hosted_api_image_regeneration_jobs j JOIN provider_accounts p ON p.is_legacy AND p.provider=CASE WHEN j.input_manifest->>'provider'='FAL_Z_IMAGE' THEN 'FAL' ELSE 'KIE' END
 WHERE j.account_id=public.videoforge_current_account_id() AND j.id=req AND j.state='PREPARED' AND NOT p.enabled;
 IF FOUND THEN RETURN public.videoforge_hosted_api_image_regeneration_json(prepared_job); END IF;
 RETURN public.videoforge_claim_hosted_api_image_regeneration_0262(req,claim);
END $$;
-- New reads keep original tenant scope and enriched task JSON. Legacy reads fail closed on pooled work.
DO $clone$ DECLARE d text; BEGIN SELECT pg_get_functiondef('public.videoforge_read_hosted_api_jobs(uuid,uuid,uuid)'::regprocedure) INTO d; EXECUTE replace(d,'public.videoforge_read_hosted_api_jobs(', 'public.videoforge_read_hosted_api_jobs_v2('); END $clone$;
CREATE OR REPLACE FUNCTION public.videoforge_read_hosted_api_jobs(supplied_account_id uuid,supplied_workspace_id uuid,supplied_generation_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$ DECLARE a ALIAS FOR $1; w ALIAS FOR $2; g ALIAS FOR $3; BEGIN
 IF EXISTS(SELECT 1 FROM hosted_api_generation_jobs j JOIN provider_task_routes r ON r.kind='API' AND r.job_id=j.id JOIN provider_accounts p ON p.provider_account_id=r.provider_account_id WHERE j.account_id=public.videoforge_current_account_id() AND j.account_id=a AND j.workspace_id=w AND j.generation_request_id=g AND NOT p.is_legacy) THEN RAISE EXCEPTION 'PROVIDER_ACCOUNT_ROUTING_VERSION_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN public.videoforge_read_hosted_api_jobs_v2(a,w,g);
END $$;
DO $clone$ DECLARE d text; BEGIN SELECT pg_get_functiondef('public.videoforge_load_hosted_api_image_regeneration(uuid,uuid)'::regprocedure) INTO d; EXECUTE replace(d,'public.videoforge_load_hosted_api_image_regeneration(', 'public.videoforge_load_hosted_api_image_regeneration_v2('); END $clone$;
CREATE OR REPLACE FUNCTION public.videoforge_load_hosted_api_image_regeneration(req uuid,w uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM provider_task_routes r JOIN provider_accounts p ON p.provider_account_id=r.provider_account_id WHERE r.kind='REGEN' AND r.job_id=req AND r.account_id=public.videoforge_current_account_id() AND NOT p.is_legacy) THEN RAISE EXCEPTION 'PROVIDER_ACCOUNT_ROUTING_VERSION_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN public.videoforge_load_hosted_api_image_regeneration_v2(req,w);
END $$;
-- Keep existing immutable rejection schema and caller claim guards; scope media cooldown to its actual account.
DO $clone$ DECLARE d text; BEGIN SELECT pg_get_functiondef('public.videoforge_defer_provider_api(text,uuid,text,uuid,uuid,integer)'::regprocedure) INTO d; EXECUTE replace(d,'public.videoforge_defer_provider_api(', 'public.videoforge_defer_provider_api_0262('); END $clone$;
CREATE OR REPLACE FUNCTION public.videoforge_defer_provider_api(p_provider text,p_account uuid,p_kind text,p_job uuid,p_claim uuid,p_retry_after_ms integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE gate text; route provider_task_routes%ROWTYPE; BEGIN
 IF p_provider NOT IN('KIE','FAL') THEN PERFORM public.videoforge_defer_provider_api_0262(p_provider,p_account,p_kind,p_job,p_claim,p_retry_after_ms); RETURN; END IF;
 IF p_account IS DISTINCT FROM public.videoforge_current_account_id() OR p_claim IS NULL OR p_retry_after_ms IS NULL OR p_retry_after_ms NOT BETWEEN 0 AND 86400000 THEN RAISE EXCEPTION 'provider defer scope invalid' USING ERRCODE='42501'; END IF;
 SELECT * INTO route FROM provider_task_routes WHERE kind=p_kind AND job_id=p_job;
 IF route.job_id IS NOT NULL AND (route.account_id IS DISTINCT FROM p_account OR route.claim_id IS DISTINCT FROM p_claim) THEN RAISE EXCEPTION 'provider route claim invalid' USING ERRCODE='23514'; END IF;
 SELECT gate_provider INTO gate FROM provider_accounts WHERE provider=p_provider AND (provider_account_id=route.provider_account_id OR (route.job_id IS NULL AND is_legacy));
 PERFORM 1 FROM provider_api_policies WHERE provider=gate FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'provider account policy missing' USING ERRCODE='23514'; END IF;
 INSERT INTO provider_api_rejections(provider,kind,job_id,claim_id,account_id,retry_after_ms) VALUES(p_provider,p_kind,p_job,p_claim,p_account,p_retry_after_ms) ON CONFLICT DO NOTHING;
 UPDATE provider_api_policies SET cooldown_until=greatest(cooldown_until,clock_timestamp()+greatest(p_retry_after_ms,least(900000,1000*power(2,least(10,(SELECT count(*) FROM provider_api_rejections WHERE provider=p_provider AND kind=p_kind AND job_id=p_job)))::integer))*interval '1 millisecond') WHERE provider=gate;
 DELETE FROM provider_task_routes WHERE kind=p_kind AND job_id=p_job;
END $$;
DO $defers$ DECLARE sig text; d text; BEGIN
 FOREACH sig IN ARRAY ARRAY['public.videoforge_defer_hosted_api_job(uuid,uuid,uuid,uuid,uuid,integer)','public.videoforge_defer_hosted_api_image_regeneration(uuid,uuid,integer)'] LOOP
  SELECT pg_get_functiondef(sig::regprocedure) INTO d;
  d:=replace(d,E'BEGIN\n',E'BEGIN\n PERFORM pg_advisory_xact_lock(263,1);\n'); EXECUTE d;
 END LOOP;
END $defers$;
-- Durable output lineage carries the same immutable account pin as its provider task.
DO $provenance$ DECLARE d text; marker text:=$m$'providerTaskId',job.provider_task_id$m$; BEGIN
 SELECT pg_get_functiondef('public.videoforge_commit_hosted_api_output(uuid,uuid,uuid,uuid,text,bigint,text,jsonb)'::regprocedure) INTO d;
 IF strpos(d,marker)=0 THEN RAISE EXCEPTION 'routing output provenance preimage drift'; END IF;
 EXECUTE replace(d,marker,marker||$m$,'providerAccount',public.videoforge_provider_account_json('API',job.id,job.account_id,CASE job.lane WHEN 'IMAGE' THEN 'KIE' ELSE 'FAL' END)$m$);
 SELECT pg_get_functiondef('public.videoforge_commit_hosted_api_image_regeneration(uuid,text,bigint,text,jsonb)'::regprocedure) INTO d;
 IF strpos(d,marker)=0 THEN RAISE EXCEPTION 'routing regeneration provenance preimage drift'; END IF;
 EXECUTE replace(d,marker,marker||$m$,'providerAccount',public.videoforge_provider_account_json('REGEN',job.id,job.account_id,CASE WHEN job.input_manifest->>'provider'='FAL_Z_IMAGE' THEN 'FAL' ELSE 'KIE' END)$m$);
END $provenance$;
CREATE FUNCTION public.videoforge_read_pending_hosted_api_image_regenerations() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',j.id,'accountId',j.account_id,'workspaceId',j.workspace_id) ORDER BY j.created_at,j.id),'[]'::jsonb)
 FROM (SELECT job.* FROM hosted_api_image_regeneration_jobs job JOIN projects p ON p.id=job.project_id AND p.account_id=job.account_id AND p.workspace_id=job.workspace_id
 WHERE job.account_id=public.videoforge_current_account_id() AND p.status='ACTIVE'
 AND (job.state='SUBMITTED' OR (job.state='PREPARED' AND public.videoforge_provider_api_waiter_eligible('REGEN',job.account_id,job.id)))
 ORDER BY job.created_at,job.id LIMIT 5) j
$$;
REVOKE ALL ON FUNCTION public.videoforge_read_pending_hosted_api_image_regenerations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_read_pending_hosted_api_image_regenerations() TO videoforge_v209_runtime_dc9612d6;
DO $grants$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE '%_0262' OR proname IN('videoforge_acquire_media_provider_account','videoforge_provider_account_json','videoforge_provider_account_identity_immutable','videoforge_provider_route_guard')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,videoforge_v209_runtime_dc9612d6',f.sig);
 END LOOP;
END $grants$;
REVOKE ALL ON FUNCTION public.videoforge_hosted_api_job_json(public.hosted_api_generation_jobs),public.videoforge_hosted_api_image_regeneration_json(public.hosted_api_image_regeneration_jobs),public.videoforge_provider_api_active_count(text),public.videoforge_defer_provider_api(text,uuid,text,uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_claim_hosted_api_job_v2(uuid,uuid,uuid,uuid,uuid,text[]),public.videoforge_claim_hosted_api_image_regeneration_v2(uuid,uuid,text[]),public.videoforge_read_hosted_api_jobs_v2(uuid,uuid,uuid),public.videoforge_load_hosted_api_image_regeneration_v2(uuid,uuid),public.videoforge_claim_hosted_api_job(uuid,uuid,uuid,uuid,uuid),public.videoforge_claim_hosted_api_image_regeneration(uuid,uuid),public.videoforge_read_hosted_api_jobs(uuid,uuid,uuid),public.videoforge_load_hosted_api_image_regeneration(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_claim_hosted_api_job_v2(uuid,uuid,uuid,uuid,uuid,text[]),public.videoforge_claim_hosted_api_image_regeneration_v2(uuid,uuid,text[]),public.videoforge_read_hosted_api_jobs_v2(uuid,uuid,uuid),public.videoforge_load_hosted_api_image_regeneration_v2(uuid,uuid),public.videoforge_claim_hosted_api_job(uuid,uuid,uuid,uuid,uuid),public.videoforge_claim_hosted_api_image_regeneration(uuid,uuid),public.videoforge_read_hosted_api_jobs(uuid,uuid,uuid),public.videoforge_load_hosted_api_image_regeneration(uuid,uuid) TO videoforge_v209_runtime_dc9612d6;

-- Additive optional Linux media execution. Historical backend documents remain immutable.
ALTER TABLE project_revisions ADD COLUMN media_execution_backend text NOT NULL DEFAULT 'PERSONAL_WORKER'
  CHECK (media_execution_backend IN ('PERSONAL_WORKER','RUNPOD_POD'));
ALTER TABLE hosted_cpu_job_attempts ADD COLUMN IF NOT EXISTS failure_code text CHECK(failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{2,63}$');
ALTER TABLE hosted_cpu_job_attempts DROP CONSTRAINT hosted_cpu_job_attempts_execution_backend_check;
ALTER TABLE hosted_cpu_job_attempts ADD CONSTRAINT hosted_cpu_job_attempts_execution_backend_check
  CHECK (execution_backend IN ('CLOUD_RUN','PERSONAL_WORKER','RUNPOD_POD'));

-- An operator creates this row only after explicit finite spend/publication approval.
-- No approval, budget, or registry credential is seeded by this migration.
CREATE TABLE cloud_media_budget_authorities (
 id uuid PRIMARY KEY, allowed_account_ids uuid[] NOT NULL CHECK(cardinality(allowed_account_ids)>0 AND array_position(allowed_account_ids,NULL) IS NULL),
 allowed_project_ids uuid[] NOT NULL CHECK(cardinality(allowed_project_ids)>0 AND array_position(allowed_project_ids,NULL) IS NULL),
 total_cap_usd numeric(12,6) NOT NULL CHECK(total_cap_usd>0 AND total_cap_usd<=10000),
 debited_usd numeric(12,6) NOT NULL DEFAULT 0 CHECK(debited_usd>=0 AND debited_usd<=total_cap_usd),
 max_reservation_usd numeric(12,6) NOT NULL CHECK(max_reservation_usd>0 AND max_reservation_usd<=total_cap_usd),
 max_hourly_usd numeric(12,6) NOT NULL CHECK(max_hourly_usd>0 AND max_hourly_usd<=100),
 max_rental_seconds integer NOT NULL CHECK(max_rental_seconds BETWEEN 60 AND 14400),
 image text NOT NULL CHECK(image ~ '@sha256:[0-9a-f]{64}$'),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^sha256:[0-9a-f]{64}$'),
 runtime_sha256 text NOT NULL CHECK(runtime_sha256 ~ '^sha256:[0-9a-f]{64}$'),
 enabled boolean NOT NULL DEFAULT true, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON cloud_media_budget_authorities FROM PUBLIC;
-- Staging qualification may observe only the approved owner's exact projects.
-- The runtime receives a tenant-bound boolean, never the approval row or its scopes.
CREATE FUNCTION public.videoforge_cloud_media_qualification_scope(authority_id uuid, project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT EXISTS(
   SELECT 1 FROM public.cloud_media_budget_authorities a JOIN public.projects p
     ON p.id=$2 AND p.account_id=public.videoforge_current_account_id()
   WHERE a.id=$1 AND a.enabled AND a.expires_at>now()
     AND public.videoforge_current_account_id()=ANY(a.allowed_account_ids)
     AND p.id=ANY(a.allowed_project_ids)
 );
$$;
REVOKE ALL ON FUNCTION public.videoforge_cloud_media_qualification_scope(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_cloud_media_qualification_scope(uuid,uuid)
 TO videoforge_v209_runtime_dc9612d6;
CREATE TABLE cloud_media_reservations (
  id uuid PRIMARY KEY, account_id uuid NOT NULL, workspace_id uuid NOT NULL,
  budget_authority_id uuid NOT NULL REFERENCES cloud_media_budget_authorities(id),
  project_id uuid NOT NULL, project_revision_id uuid NOT NULL, attempt_id uuid NOT NULL UNIQUE,
  leased_attempt_id uuid NOT NULL UNIQUE, span_job_count integer NOT NULL DEFAULT 1 CHECK(span_job_count BETWEEN 1 AND 4),
  fence_id uuid NOT NULL UNIQUE, capability_sha256 text NOT NULL CHECK(capability_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  pod_name text NOT NULL UNIQUE CHECK(pod_name='videoforge-media-'||id::text), pod_id text,
  image text NOT NULL CHECK(image ~ '@sha256:[0-9a-f]{64}$'), registry_id text,
  source_sha256 text NOT NULL CHECK(source_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  runtime_sha256 text NOT NULL CHECK(runtime_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  tooling jsonb NOT NULL, disk_gb integer NOT NULL CHECK(disk_gb>=100), gpu text,
  max_hourly_usd numeric NOT NULL CHECK(max_hourly_usd>0), budget_usd numeric NOT NULL CHECK(budget_usd>0),
  expected_hourly_usd numeric CHECK(expected_hourly_usd>0), actual_hourly_usd numeric CHECK(actual_hourly_usd>0),
  rental_seconds integer NOT NULL CHECK(rental_seconds BETWEEN 60 AND 14400),
  state text NOT NULL CHECK(state IN ('WAITING_CAPACITY','CREATING','AMBIGUOUS','STARTING','DOWNLOADING','RENDERING','CHECKING','SAVING','STOPPING','CLEAN')),
  round integer NOT NULL DEFAULT 0 CHECK(round BETWEEN 0 AND 3), candidate_index integer NOT NULL DEFAULT 0,
  launch_outcome text CHECK(launch_outcome IN ('CONFIRMED','REFUSED','UNKNOWN')),
  failure_code text, placement_deadline_at timestamptz NOT NULL,
  deadline_at timestamptz, next_check_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz, last_heartbeat_at timestamptz, cleanup_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,attempt_id) REFERENCES hosted_cpu_job_attempts(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,leased_attempt_id) REFERENCES hosted_cpu_job_attempts(account_id,workspace_id,id),
  CHECK((state='CLEAN')=(cleanup_verified_at IS NOT NULL))
);
CREATE UNIQUE INDEX cloud_media_active_account ON cloud_media_reservations(account_id)
  WHERE state NOT IN ('WAITING_CAPACITY','CLEAN');
ALTER TABLE cloud_media_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_media_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY cloud_media_reservations_tenant ON cloud_media_reservations
 USING(account_id=public.videoforge_current_account_id()) WITH CHECK(account_id=public.videoforge_current_account_id());
CREATE TRIGGER cloud_media_tenant_write_guard BEFORE INSERT OR UPDATE ON cloud_media_reservations
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();

-- Conservative debits are permanent for this approval; no automatic refund or cap reuse.
CREATE TABLE cloud_media_budget_debits (
 reservation_id uuid PRIMARY KEY REFERENCES cloud_media_reservations(id),
 authority_id uuid NOT NULL REFERENCES cloud_media_budget_authorities(id),
 amount_usd numeric(12,6) NOT NULL CHECK(amount_usd>0), created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON cloud_media_budget_debits FROM PUBLIC;
CREATE FUNCTION public.videoforge_cloud_media_reserve_budget(reservation uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE r cloud_media_reservations%ROWTYPE; authority cloud_media_budget_authorities%ROWTYPE;
BEGIN
 SELECT * INTO r FROM cloud_media_reservations WHERE id=reservation FOR UPDATE;
 IF r.id IS NULL OR r.account_id IS DISTINCT FROM public.videoforge_current_account_id() THEN
  RAISE EXCEPTION 'cloud budget tenant rejected' USING ERRCODE='42501'; END IF;
 IF r.state<>'WAITING_CAPACITY' THEN RAISE EXCEPTION 'cloud budget not ready' USING ERRCODE='23514'; END IF;
 SELECT * INTO authority FROM cloud_media_budget_authorities WHERE id=r.budget_authority_id FOR UPDATE;
 IF authority.id IS NULL OR NOT authority.enabled OR authority.expires_at<=now()
  OR NOT r.account_id=ANY(authority.allowed_account_ids) OR NOT r.project_id=ANY(authority.allowed_project_ids)
  OR r.image<>authority.image OR r.source_sha256<>authority.source_sha256 OR r.runtime_sha256<>authority.runtime_sha256
  OR r.budget_usd>authority.max_reservation_usd OR r.max_hourly_usd>authority.max_hourly_usd
  OR r.rental_seconds>authority.max_rental_seconds THEN
  RAISE EXCEPTION 'cloud approved finite budget unavailable' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM cloud_media_budget_debits d WHERE d.reservation_id=r.id
   AND d.authority_id=r.budget_authority_id AND d.amount_usd=r.budget_usd) THEN RETURN true; END IF;
 IF authority.debited_usd+r.budget_usd>authority.total_cap_usd THEN
  RAISE EXCEPTION 'cloud finite budget exhausted' USING ERRCODE='55000'; END IF;
 INSERT INTO cloud_media_budget_debits(reservation_id,authority_id,amount_usd)
 VALUES(r.id,authority.id,r.budget_usd);
 UPDATE cloud_media_budget_authorities SET debited_usd=debited_usd+r.budget_usd WHERE id=authority.id;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_cloud_media_reserve_budget(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_cloud_media_reserve_budget(uuid) TO videoforge_v209_runtime_dc9612d6;

CREATE FUNCTION public.videoforge_guard_cloud_media_reservation() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.account_id,NEW.workspace_id,NEW.project_id,NEW.project_revision_id,NEW.attempt_id,
   NEW.fence_id,NEW.capability_sha256,NEW.image,NEW.source_sha256,NEW.runtime_sha256,NEW.tooling,NEW.disk_gb,
   NEW.budget_usd,NEW.max_hourly_usd,NEW.rental_seconds,NEW.pod_name,NEW.budget_authority_id,NEW.registry_id) IS DISTINCT FROM
   (OLD.account_id,OLD.workspace_id,OLD.project_id,OLD.project_revision_id,OLD.attempt_id,
   OLD.fence_id,OLD.capability_sha256,OLD.image,OLD.source_sha256,OLD.runtime_sha256,OLD.tooling,OLD.disk_gb,
   OLD.budget_usd,OLD.max_hourly_usd,OLD.rental_seconds,OLD.pod_name,OLD.budget_authority_id,OLD.registry_id) THEN
   RAISE EXCEPTION 'cloud media reservation identity is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND OLD.state='CLEAN' AND NEW.state<>'CLEAN' THEN
  RAISE EXCEPTION 'cleaned cloud reservation cannot relaunch' USING ERRCODE='23514'; END IF;
 IF NEW.state='CREATING' AND NOT EXISTS(SELECT 1 FROM cloud_media_budget_debits d
   WHERE d.reservation_id=NEW.id AND d.authority_id=NEW.budget_authority_id AND d.amount_usd=NEW.budget_usd) THEN
  RAISE EXCEPTION 'cloud launch requires durable approved budget debit' USING ERRCODE='23514'; END IF;
 IF NEW.state IN ('WAITING_CAPACITY','CLEAN') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.state NOT IN ('WAITING_CAPACITY','CLEAN') THEN RETURN NEW; END IF;
 PERFORM 1 FROM global_generation_capacity WHERE singleton FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM hosted_cpu_job_attempts a WHERE a.id=NEW.attempt_id
   AND a.account_id=NEW.account_id AND a.workspace_id=NEW.workspace_id
   AND a.project_id=NEW.project_id AND a.project_revision_id=NEW.project_revision_id
   AND a.execution_backend='RUNPOD_POD' AND a.state IN ('OUTBOXED','RUNNING') AND a.deadline_at>now())
   OR EXISTS(SELECT 1 FROM media_worker_leases l WHERE l.attempt_id=NEW.attempt_id
     AND l.state IN ('CLAIMED','RUNNING','COMPLETING'))
   OR EXISTS(SELECT 1 FROM hosted_cpu_job_attempts failed WHERE failed.account_id=NEW.account_id
     AND failed.workspace_id=NEW.workspace_id AND failed.project_id=NEW.project_id
     AND failed.project_revision_id=NEW.project_revision_id AND failed.execution_backend='RUNPOD_POD'
     AND failed.kind IN ('ASR','SPAN_AUDIO') AND failed.state IN ('FAILED','CANCELLED','EXPIRED')) THEN
   RAISE EXCEPTION 'cloud media execution is not ready or has a local lease' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM generation_requests g WHERE g.account_id=NEW.account_id
   AND g.workspace_id=NEW.workspace_id AND g.project_id=NEW.project_id AND g.project_revision_id=NEW.project_revision_id
   AND g.state='ACTIVE' AND (EXISTS(SELECT 1 FROM provider_workload_leases l WHERE l.generation_request_id=g.id
     AND l.state='ACTIVE' AND l.expires_at>now()) OR EXISTS(SELECT 1 FROM video_runtime_states v
     WHERE v.generation_request_id=g.id AND v.render_manifest_sha256 IS NOT NULL
       AND public.videoforge_v209_api_outputs_accepted(g.account_id,g.workspace_id,g.id,v.id))))
   OR EXISTS(SELECT 1 FROM provider_workload_leases l LEFT JOIN generation_requests g ON g.id=l.generation_request_id
     WHERE l.account_id=NEW.account_id AND l.state='ACTIVE' AND l.expires_at>now()
       AND (l.request_kind<>'VIDEO' OR g.project_id IS DISTINCT FROM NEW.project_id
         OR g.project_revision_id IS DISTINCT FROM NEW.project_revision_id))
   OR (SELECT count(DISTINCT occupied.account_id) FROM (
     SELECT l.account_id FROM provider_workload_leases l WHERE l.state='ACTIVE' AND l.expires_at>now()
     UNION ALL SELECT r.account_id FROM cloud_media_reservations r WHERE r.id<>NEW.id AND r.state NOT IN ('WAITING_CAPACITY','CLEAN')
     UNION ALL SELECT NEW.account_id) occupied)>2 THEN
  RAISE EXCEPTION 'cloud media requires admitted video with held account capacity' USING ERRCODE='55000'; END IF;
 IF (SELECT count(*) FROM cloud_media_reservations r WHERE r.id<>NEW.id AND r.state NOT IN ('WAITING_CAPACITY','CLEAN'))>=2
   OR EXISTS(SELECT 1 FROM cloud_media_reservations r WHERE r.id<>NEW.id AND r.account_id=NEW.account_id
     AND r.state NOT IN ('WAITING_CAPACITY','CLEAN')) THEN
   RAISE EXCEPTION 'cloud media capacity occupied' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER cloud_media_reservation_guard BEFORE INSERT OR UPDATE ON cloud_media_reservations
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_guard_cloud_media_reservation();
REVOKE ALL ON FUNCTION public.videoforge_guard_cloud_media_reservation() FROM PUBLIC;

CREATE TABLE cloud_media_multipart_uploads (
 id uuid PRIMARY KEY, account_id uuid NOT NULL, workspace_id uuid NOT NULL, reservation_id uuid NOT NULL,
 authority_id uuid NOT NULL, object_key text NOT NULL, upload_id text,
 content_length bigint NOT NULL CHECK(content_length BETWEEN 1 AND 10737418240),
 checksum_sha256 text NOT NULL CHECK(checksum_sha256 ~ '^sha256:[0-9a-f]{64}$'),
 part_size integer NOT NULL CHECK(part_size=67108864),
 state text NOT NULL CHECK(state IN ('INITIATING','OPEN','COMPLETING','VERIFIED','ABORTED','UNKNOWN')),
 verified_checksum_sha256 text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(reservation_id,authority_id),
 FOREIGN KEY(account_id,workspace_id,reservation_id) REFERENCES cloud_media_reservations(account_id,workspace_id,id),
 FOREIGN KEY(authority_id) REFERENCES hosted_cpu_upload_authorities(id)
);
ALTER TABLE cloud_media_multipart_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_media_multipart_uploads FORCE ROW LEVEL SECURITY;
CREATE POLICY cloud_media_multipart_tenant ON cloud_media_multipart_uploads
 USING(account_id=public.videoforge_current_account_id()) WITH CHECK(account_id=public.videoforge_current_account_id());
CREATE TRIGGER cloud_media_multipart_write_guard BEFORE INSERT OR UPDATE ON cloud_media_multipart_uploads
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();

-- Strict function preimages: a changed installed definition stops this migration.
DO $migration$
DECLARE definition text; runtime_call text; runtime_indent integer;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_finalize_hosted_v209_span_audio(uuid,uuid,uuid,jsonb)'::regprocedure) INTO definition;
 IF strpos(definition,$old$attempt.execution_backend<>'PERSONAL_WORKER'$old$)=0 THEN
   RAISE EXCEPTION 'cloud span finalization preimage drifted'; END IF;
 definition:=replace(definition,$old$attempt.execution_backend<>'PERSONAL_WORKER'$old$,$new$attempt.execution_backend NOT IN ('PERSONAL_WORKER','RUNPOD_POD')$new$);
 definition:=replace(definition,$old$'dispatch_target','PERSONAL_WORKER'$old$,$new$'dispatch_target',attempt.execution_backend$new$);
 EXECUTE definition;
 SELECT pg_get_functiondef('public.videoforge_admit_hosted_v209_generation_after_reclaim(uuid,uuid,uuid,uuid)'::regprocedure) INTO definition;
 IF strpos(definition,$old$  IF NOT EXISTS (
       SELECT 1 FROM public.generation_tasks task
        WHERE task.workspace_id=supplied_workspace_id
          AND task.project_revision_id=request.project_revision_id
          AND task.owner_type='PROJECT_REVISION'
          AND task.lane='PROMPT'
          AND task.task_key LIKE 'prompt:scene-batch:%'
          AND task.state='COMPLETE'
     )
     OR EXISTS (
       SELECT 1 FROM public.generation_tasks task
        WHERE task.workspace_id=supplied_workspace_id
          AND task.project_revision_id=request.project_revision_id
          AND task.owner_type='PROJECT_REVISION'
          AND task.lane='PROMPT'
          AND task.task_key LIKE 'prompt:scene-batch:%'
          AND task.required
          AND task.state<>'COMPLETE'
     ) THEN
$old$)=0 THEN RAISE EXCEPTION 'cloud early admission preimage drifted'; END IF;
 definition:=replace(definition,$old$  IF NOT EXISTS (
       SELECT 1 FROM public.generation_tasks task
        WHERE task.workspace_id=supplied_workspace_id
          AND task.project_revision_id=request.project_revision_id
          AND task.owner_type='PROJECT_REVISION'
          AND task.lane='PROMPT'
          AND task.task_key LIKE 'prompt:scene-batch:%'
          AND task.state='COMPLETE'
     )
     OR EXISTS (
       SELECT 1 FROM public.generation_tasks task
        WHERE task.workspace_id=supplied_workspace_id
          AND task.project_revision_id=request.project_revision_id
          AND task.owner_type='PROJECT_REVISION'
          AND task.lane='PROMPT'
          AND task.task_key LIKE 'prompt:scene-batch:%'
          AND task.required
          AND task.state<>'COMPLETE'
     ) THEN
$old$,$new$  IF NOT EXISTS (
       SELECT 1 FROM public.project_revisions r
       JOIN public.hosted_cpu_job_attempts a ON a.project_revision_id=r.id
         AND a.account_id=r.account_id AND a.workspace_id=r.workspace_id
       WHERE r.id=request.project_revision_id AND r.media_execution_backend='RUNPOD_POD'
         AND a.kind='ASR' AND a.execution_backend='RUNPOD_POD'
         AND a.state IN ('OUTBOXED','RUNNING','SUCCEEDED') AND a.deadline_at>db_now
     ) AND (NOT EXISTS (
       SELECT 1 FROM public.generation_tasks task
        WHERE task.workspace_id=supplied_workspace_id
          AND task.project_revision_id=request.project_revision_id
          AND task.owner_type='PROJECT_REVISION'
          AND task.lane='PROMPT'
          AND task.task_key LIKE 'prompt:scene-batch:%'
          AND task.state='COMPLETE'
     )
     OR EXISTS (
       SELECT 1 FROM public.generation_tasks task
        WHERE task.workspace_id=supplied_workspace_id
          AND task.project_revision_id=request.project_revision_id
          AND task.owner_type='PROJECT_REVISION'
          AND task.lane='PROMPT'
          AND task.task_key LIKE 'prompt:scene-batch:%'
          AND task.required
          AND task.state<>'COMPLETE'
     )) THEN
$new$);
 -- Admission owns the VIDEO lease before Cloud ASR. A new ASR has no canonical
 -- timing bridge yet; preparing image/avatar runtime at this point would fail
 -- and roll back admission. All ordinary and bridge-present calls stay exact.
 IF (length(definition)-length(replace(definition,'PERFORM public.videoforge_prepare_hosted_v209_runtime(','')))
   /length('PERFORM public.videoforge_prepare_hosted_v209_runtime(')<>3 THEN
  RAISE EXCEPTION 'cloud early runtime admission call count drifted'; END IF;
 FOR runtime_indent IN 4..8 BY 2 LOOP
  runtime_call:='PERFORM public.videoforge_prepare_hosted_v209_runtime('||E'\n'||
    repeat(' ',runtime_indent)||'supplied_account_id,supplied_workspace_id,supplied_user_id,supplied_project_id,request.id);';
  IF strpos(definition,runtime_call)=0 THEN
   RAISE EXCEPTION 'cloud early runtime admission preimage drifted'; END IF;
  definition:=replace(definition,runtime_call,$guard$IF NOT (
    EXISTS(SELECT 1 FROM public.project_revisions r
      JOIN public.hosted_cpu_job_attempts a ON a.project_revision_id=r.id
        AND a.account_id=r.account_id AND a.workspace_id=r.workspace_id
      WHERE r.account_id=supplied_account_id AND r.workspace_id=supplied_workspace_id
        AND r.project_id=supplied_project_id AND r.id=request.project_revision_id
        AND r.media_execution_backend='RUNPOD_POD' AND a.execution_backend='RUNPOD_POD'
        AND a.kind='ASR' AND a.state IN ('OUTBOXED','RUNNING','SUCCEEDED') AND a.deadline_at>db_now)
    AND NOT EXISTS(SELECT 1 FROM public.hosted_canonical_timing_bridges bridge
      WHERE bridge.account_id=supplied_account_id AND bridge.workspace_id=supplied_workspace_id
        AND bridge.project_id=supplied_project_id AND bridge.project_revision_id=request.project_revision_id)
   ) THEN
$guard$||runtime_call||E'\n END IF;');
 END LOOP;
 EXECUTE definition;
END;
$migration$;

GRANT SELECT,INSERT,UPDATE ON cloud_media_reservations,cloud_media_multipart_uploads TO videoforge_v209_runtime_dc9612d6;

-- Narrow capability lookup is the only unauthenticated tenant discovery.
CREATE FUNCTION public.videoforge_cloud_media_capability_scope(target_id uuid, token_sha text)
RETURNS TABLE(account_id uuid,workspace_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT r.account_id,r.workspace_id FROM cloud_media_reservations r WHERE r.id=target_id
 AND r.capability_sha256=token_sha AND token_sha ~ '^sha256:[0-9a-f]{64}$';
$$;
REVOKE ALL ON FUNCTION public.videoforge_cloud_media_capability_scope(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_cloud_media_capability_scope(uuid,text) TO videoforge_v209_runtime_dc9612d6;
CREATE FUNCTION public.videoforge_cloud_media_reconciliation_scope()
RETURNS TABLE(attempt_id uuid,account_id uuid,workspace_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT r.attempt_id,r.account_id,r.workspace_id FROM cloud_media_reservations r WHERE r.state<>'CLEAN'
 ORDER BY r.created_at,r.id LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.videoforge_cloud_media_reconciliation_scope() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_cloud_media_reconciliation_scope() TO videoforge_v209_runtime_dc9612d6;

CREATE FUNCTION public.videoforge_cloud_media_renew_admission(reservation uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 UPDATE provider_workload_leases l SET heartbeat_at=now(),expires_at=GREATEST(l.expires_at,now()+interval '10 minutes'),version=l.version+1
 FROM generation_requests g,cloud_media_reservations r WHERE r.id=reservation
 AND r.account_id=public.videoforge_current_account_id() AND r.state NOT IN ('CLEAN','WAITING_CAPACITY')
 AND g.account_id=r.account_id AND g.workspace_id=r.workspace_id AND g.project_id=r.project_id
 AND g.project_revision_id=r.project_revision_id AND g.state='ACTIVE'
 AND l.generation_request_id=g.id AND l.state='ACTIVE' AND l.expires_at>now();
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_cloud_media_renew_admission(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_cloud_media_renew_admission(uuid) TO videoforge_v209_runtime_dc9612d6;

CREATE TABLE cloud_media_jobs (
 account_id uuid NOT NULL,workspace_id uuid NOT NULL,reservation_id uuid NOT NULL,attempt_id uuid NOT NULL UNIQUE,
 claimed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(reservation_id,attempt_id),
 downloading_started_at timestamptz,rendering_started_at timestamptz,
 checking_started_at timestamptz,saving_started_at timestamptz,
 technical_verification_ms integer CHECK(technical_verification_ms BETWEEN 0 AND 14400000),
 artifact_verification_ms integer CHECK(artifact_verification_ms BETWEEN 0 AND 14400000),
 FOREIGN KEY(account_id,workspace_id,reservation_id) REFERENCES cloud_media_reservations(account_id,workspace_id,id),
 FOREIGN KEY(account_id,workspace_id,attempt_id) REFERENCES hosted_cpu_job_attempts(account_id,workspace_id,id)
);
ALTER TABLE cloud_media_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_media_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY cloud_media_jobs_tenant ON cloud_media_jobs USING(account_id=public.videoforge_current_account_id())
 WITH CHECK(account_id=public.videoforge_current_account_id());
CREATE TRIGGER cloud_media_jobs_write_guard BEFORE INSERT OR UPDATE ON cloud_media_jobs
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
GRANT SELECT,INSERT ON cloud_media_jobs TO videoforge_v209_runtime_dc9612d6;
GRANT UPDATE(downloading_started_at,rendering_started_at,checking_started_at,saving_started_at,
 technical_verification_ms,artifact_verification_ms) ON cloud_media_jobs TO videoforge_v209_runtime_dc9612d6;

-- Explicit Cloud recovery reuses accepted assets and the immutable render manifest.
-- No provider calls, paid-work replay, or accepted output replacement.
-- Keep the accepted Kie/Fal jobs, receipts, render plan, and generation identity intact.
CREATE TABLE public.cloud_media_render_recoveries (
  generation_request_id uuid NOT NULL,
  retry_ordinal integer NOT NULL CHECK (retry_ordinal BETWEEN 2 AND 5),
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  runtime_id uuid NOT NULL,
  failed_attempt_id uuid NOT NULL,
  retry_attempt_id uuid NOT NULL UNIQUE,
  replacement_bundle_sha256 text NOT NULL CHECK (replacement_bundle_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('PREPARING','CONSUMED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (generation_request_id,failed_attempt_id),
  UNIQUE (generation_request_id,retry_ordinal),
  FOREIGN KEY (account_id,workspace_id,generation_request_id)
    REFERENCES public.generation_requests(account_id,workspace_id,id),
  FOREIGN KEY (account_id,workspace_id,runtime_id)
    REFERENCES public.video_runtime_states(account_id,workspace_id,id),
  FOREIGN KEY (account_id,workspace_id,failed_attempt_id)
    REFERENCES public.hosted_cpu_job_attempts(account_id,workspace_id,id)
);
ALTER TABLE public.cloud_media_render_recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_media_render_recoveries FORCE ROW LEVEL SECURITY;
CREATE POLICY cloud_media_render_recoveries_tenant
  ON public.cloud_media_render_recoveries
  USING (account_id=public.videoforge_current_account_id())
  WITH CHECK (account_id=public.videoforge_current_account_id());
REVOKE ALL ON public.cloud_media_render_recoveries FROM PUBLIC;

-- Only an exact transaction-local Cloud recovery proof can reopen this failed runtime.
DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_validate_video_runtime_state()'::regprocedure) INTO definition;
 IF strpos(definition,$old$  IF OLD.stage IN ('COMPLETE', 'FAILED', 'CANCELED') THEN$old$)=0
   OR strpos(definition,'hosted_api_local_render_recoveries')=0 THEN
  RAISE EXCEPTION 'cloud render recovery runtime preimage drifted'; END IF;
 definition:=replace(definition,$old$  IF OLD.stage IN ('COMPLETE', 'FAILED', 'CANCELED') THEN$old$,
 $new$  IF OLD.stage='FAILED' AND OLD.terminal_reason='RENDER_FAILURE'
   AND NEW.stage='RENDERING' AND NEW.terminal_reason IS NULL AND NEW.terminal_at IS NULL
   AND NEW.final_output_sha256 IS NULL AND NEW.render_manifest_sha256 IS NOT DISTINCT FROM OLD.render_manifest_sha256
   AND EXISTS(SELECT 1 FROM public.cloud_media_render_recoveries recovery
     JOIN public.generation_requests request ON request.id=recovery.generation_request_id
     WHERE recovery.account_id=OLD.account_id AND recovery.workspace_id=OLD.workspace_id
       AND recovery.project_id=OLD.project_id AND recovery.project_revision_id=OLD.project_revision_id
       AND recovery.runtime_id=OLD.id AND recovery.generation_request_id=OLD.generation_request_id
       AND recovery.state='PREPARING' AND request.state='ACTIVE' AND request.terminal_at IS NULL)
   AND NOT EXISTS(SELECT 1 FROM public.video_runtime_lane_states lane
     WHERE lane.runtime_id=OLD.id AND lane.state<>'SUCCEEDED') THEN RETURN NEW; END IF;
  IF OLD.stage IN ('COMPLETE', 'FAILED', 'CANCELED') THEN$new$);
 EXECUTE definition;
END; $migration$;
CREATE FUNCTION public.videoforge_prepare_cloud_media_render_recovery(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_user_id uuid,
  supplied_project_id uuid, supplied_failed_attempt_id uuid, supplied_retry_attempt_id uuid,
  supplied_replacement_bundle_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_catalog AS $$
DECLARE
  request public.generation_requests%ROWTYPE;
  runtime public.video_runtime_states%ROWTYPE;
  failed public.hosted_cpu_job_attempts%ROWTYPE;
  recovery public.cloud_media_render_recoveries%ROWTYPE;
  provider_lease public.provider_workload_leases%ROWTYPE;
  db_now timestamptz:=transaction_timestamp();
  attempt_count integer;
  failure_code text;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR supplied_retry_attempt_id IS NULL
     OR supplied_replacement_bundle_sha256 IS NULL
     OR supplied_replacement_bundle_sha256 !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'cloud render recovery tenant or identity invalid' USING ERRCODE='42501';
  END IF;
  SELECT row.* INTO request FROM public.generation_requests row
    WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
      AND row.project_id=supplied_project_id
    ORDER BY row.created_at DESC,row.id DESC LIMIT 1 FOR UPDATE;
  IF request.id IS NULL THEN
    RAISE EXCEPTION 'cloud render recovery request missing' USING ERRCODE='23514';
  END IF;
  SELECT row.* INTO recovery FROM public.cloud_media_render_recoveries row
    WHERE row.generation_request_id=request.id
      AND row.failed_attempt_id=supplied_failed_attempt_id FOR UPDATE;
  IF recovery.generation_request_id IS NOT NULL THEN
    IF recovery.failed_attempt_id<>supplied_failed_attempt_id
       OR recovery.replacement_bundle_sha256<>supplied_replacement_bundle_sha256
       OR recovery.state<>'CONSUMED' THEN
      RAISE EXCEPTION 'cloud render recovery identity drift' USING ERRCODE='23514';
    END IF;
    RETURN jsonb_build_object('schema_version','videoforge-hosted-render-disk-recovery/v1',
      'revision_id',recovery.project_revision_id,'retry_attempt_id',recovery.retry_attempt_id,
      'recovery_kind','CLOUD','recovery_key','render-cloud-recovery:'||recovery.retry_attempt_id::text,'replayed',true);
  END IF;
  SELECT row.* INTO runtime FROM public.video_runtime_states row
    WHERE row.account_id=request.account_id AND row.workspace_id=request.workspace_id
      AND row.generation_request_id=request.id FOR UPDATE;
  SELECT row.* INTO failed FROM public.hosted_cpu_job_attempts row
    WHERE row.account_id=request.account_id AND row.workspace_id=request.workspace_id
      AND row.id=supplied_failed_attempt_id AND row.project_id=request.project_id
      AND row.project_revision_id=request.project_revision_id AND row.kind='RENDER' FOR UPDATE;
  SELECT row.* INTO provider_lease FROM public.provider_workload_leases row
    WHERE row.account_id=request.account_id AND row.workspace_id=request.workspace_id
      AND row.generation_request_id=request.id FOR UPDATE;
  SELECT count(*) INTO attempt_count FROM public.hosted_cpu_job_attempts job
    WHERE job.account_id=request.account_id AND job.workspace_id=request.workspace_id
      AND job.project_revision_id=request.project_revision_id AND job.kind='RENDER';
  SELECT COALESCE(failed.failure_code,lease.failure_code) INTO failure_code FROM public.media_worker_leases lease
    WHERE lease.account_id=failed.account_id AND lease.workspace_id=failed.workspace_id
      AND lease.attempt_id=failed.id AND lease.state='FAILED'
    ORDER BY lease.created_at DESC LIMIT 1;
  failure_code:=COALESCE(failure_code,failed.failure_code);
  IF EXISTS(SELECT 1 FROM public.cloud_media_reservations r
       JOIN public.cloud_media_jobs j ON j.reservation_id=r.id
       WHERE j.attempt_id=failed.id AND r.state<>'CLEAN')
     OR EXISTS(SELECT 1 FROM public.cloud_media_reservations r
       WHERE r.account_id=supplied_account_id AND r.state NOT IN ('WAITING_CAPACITY','CLEAN'))
     OR NOT EXISTS (SELECT 1 FROM public.projects project
       WHERE project.account_id=request.account_id AND project.workspace_id=request.workspace_id
         AND project.id=request.project_id AND project.status='ACTIVE'
         AND project.generation_provider='KIE_FAL')
     OR request.state<>'FAILED' OR request.terminal_at IS NULL
     OR request.created_by_user_id<>supplied_user_id
     OR runtime.id IS NULL OR runtime.stage<>'FAILED'
     OR runtime.terminal_reason<>'RENDER_FAILURE' OR runtime.terminal_at IS NULL
     OR runtime.final_output_sha256 IS NOT NULL OR runtime.render_manifest_sha256 IS NULL
     OR failed.id IS NULL OR failed.state<>'FAILED' OR failed.terminal_at IS NULL
     OR failed.result_content_length IS NOT NULL OR failed.result_checksum_sha256 IS NOT NULL
     OR failed.result_receipt_sha256 IS NOT NULL
     OR failed.image_digest IS NULL OR failed.image_digest !~ '^sha256:[0-9a-f]{64}$'
     OR failed.execution_bundle_sha256 IS DISTINCT FROM failed.image_digest
     OR (failure_code IN ('RENDER_INPUT_INVALID','RENDER_OUTPUT_INVALID')
       AND supplied_replacement_bundle_sha256=failed.image_digest)
     OR attempt_count NOT BETWEEN 1 AND 4
     OR failure_code IS NULL OR failure_code NOT IN (
       'RENDER_INPUT_INVALID','RENDER_OUTPUT_INVALID','RENDER_PROCESS_FAILED',
       'MEDIA_EXECUTION_DISK_SPACE_INSUFFICIENT','MEDIA_EXECUTION_IO_FAILED',
       'MEDIA_EXECUTION_TIMEOUT','MEDIA_EXECUTION_SUBPROCESS_FAILED','MEDIA_EXECUTION_FAILED',
       'CLOUD_MEDIA_CAPACITY_EXHAUSTED','CLOUD_MEDIA_DEADLINE_EXCEEDED','CLOUD_MEDIA_PROVIDER_FAILED',
       'CLOUD_MEDIA_RUNTIME_MISMATCH','CLOUD_MEDIA_RUNTIME_PIN_MISMATCH','CLOUD_MEDIA_RUNTIME_REJECTED',
       'CLOUD_MEDIA_UPLOAD_FAILED','CLOUD_MEDIA_FAILED','CLOUD_MEDIA_PLACEMENT_REJECTED')
     OR EXISTS (SELECT 1 FROM public.hosted_cpu_job_attempts later
       WHERE later.account_id=request.account_id AND later.workspace_id=request.workspace_id
         AND later.project_revision_id=request.project_revision_id AND later.kind='RENDER'
         AND (later.created_at,later.id)>(failed.created_at,failed.id))
     OR EXISTS (SELECT 1 FROM public.media_worker_leases lease
       WHERE lease.attempt_id=failed.id AND lease.state IN ('CLAIMED','RUNNING','COMPLETING'))
     OR provider_lease.id IS NULL OR provider_lease.state<>'RELEASED'
     OR provider_lease.release_reason<>'HOSTED_API_OUTPUTS_ACCEPTED'
     OR EXISTS (SELECT 1 FROM public.provider_workload_leases active_lease
       WHERE active_lease.generation_request_id=request.id AND active_lease.state='ACTIVE')
     OR EXISTS (SELECT 1 FROM public.serverless_attempts paid
       WHERE paid.generation_request_id=request.id)
     OR NOT public.videoforge_v209_api_outputs_accepted(
       request.account_id,request.workspace_id,request.id,runtime.id)
     OR NOT EXISTS (SELECT 1 FROM public.hosted_render_plans plan
       WHERE plan.account_id=request.account_id AND plan.workspace_id=request.workspace_id
         AND plan.project_id=request.project_id AND plan.project_revision_id=request.project_revision_id
         AND plan.schema_version='videoforge-hosted-cpu-submission/v1'
         AND plan.payload->>'kind'='RENDER'
         AND plan.payload_sha256='sha256:'||encode(sha256(convert_to(
           public.videoforge_canonical_jsonb(plan.payload),'UTF8')),'hex'))
     OR EXISTS (SELECT 1 FROM public.video_runtime_events event
       WHERE event.runtime_id=runtime.id AND event.reason='FINAL_OUTPUT_DURABLE') THEN
    RAISE EXCEPTION 'cloud render recovery evidence rejected' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.cloud_media_render_recoveries(
    generation_request_id,retry_ordinal,account_id,workspace_id,project_id,project_revision_id,
    runtime_id,failed_attempt_id,retry_attempt_id,replacement_bundle_sha256,state)
  VALUES(request.id,attempt_count+1,request.account_id,request.workspace_id,request.project_id,
    request.project_revision_id,runtime.id,failed.id,supplied_retry_attempt_id,
    supplied_replacement_bundle_sha256,'PREPARING');
  UPDATE public.generation_requests
    SET state='ACTIVE',terminal_at=NULL,version=version+1,updated_at=db_now
    WHERE id=request.id AND state='FAILED';
  UPDATE public.video_runtime_states
    SET stage='RENDERING',terminal_reason=NULL,terminal_at=NULL,
        version=version+1,updated_at=db_now
    WHERE id=runtime.id AND stage='FAILED';
  UPDATE public.cloud_media_render_recoveries SET state='CONSUMED'
    WHERE generation_request_id=request.id AND failed_attempt_id=failed.id AND state='PREPARING';
  INSERT INTO public.video_runtime_events(
    id,account_id,workspace_id,runtime_id,project_revision_id,lane,
    from_state,to_state,reason,detail,occurred_at)
  VALUES(md5('cloud-media-render-recovery:'||failed.id::text)::uuid,
    request.account_id,request.workspace_id,runtime.id,request.project_revision_id,NULL,
    'FAILED','RENDERING','CLOUD_RENDER_RECOVERY',
    jsonb_build_object('failed_attempt_id',failed.id,'retry_attempt_id',supplied_retry_attempt_id,
      'replacement_bundle_sha256',supplied_replacement_bundle_sha256,
      'provider_actions_created',false),db_now);
  RETURN jsonb_build_object('schema_version','videoforge-hosted-render-disk-recovery/v1',
    'revision_id',request.project_revision_id,'retry_attempt_id',supplied_retry_attempt_id,
    'recovery_kind','CLOUD','recovery_key','render-cloud-recovery:'||supplied_retry_attempt_id::text,'replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_prepare_cloud_media_render_recovery(
  uuid,uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC;


GRANT SELECT ON public.cloud_media_render_recoveries TO videoforge_v209_runtime_dc9612d6;
GRANT EXECUTE ON FUNCTION public.videoforge_prepare_cloud_media_render_recovery(uuid,uuid,uuid,uuid,uuid,uuid,text)
 TO videoforge_v209_runtime_dc9612d6;

-- Backend is revision lineage: stored revisions cannot be switched in place.
CREATE FUNCTION public.videoforge_guard_media_backend_lineage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE previous_backend text;
BEGIN
 IF TG_TABLE_NAME='project_revisions' THEN
  IF TG_OP='UPDATE' AND NEW.media_execution_backend IS DISTINCT FROM OLD.media_execution_backend THEN
   RAISE EXCEPTION 'revision media execution backend is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND NEW.revision_number>1 THEN
   SELECT r.media_execution_backend INTO previous_backend FROM project_revisions r
    WHERE r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id
    ORDER BY r.revision_number DESC,r.id DESC LIMIT 1;
   IF previous_backend IS NOT NULL THEN NEW.media_execution_backend:=previous_backend; END IF;
  END IF;
 ELSE
  IF TG_OP='UPDATE' AND (NEW.execution_backend,NEW.execution_bundle_sha256,NEW.image_digest,
      NEW.account_id,NEW.workspace_id,NEW.project_id,NEW.project_revision_id,NEW.kind,NEW.request_sha256)
     IS DISTINCT FROM (OLD.execution_backend,OLD.execution_bundle_sha256,OLD.image_digest,
      OLD.account_id,OLD.workspace_id,OLD.project_id,OLD.project_revision_id,OLD.kind,OLD.request_sha256) THEN
   RAISE EXCEPTION 'CPU attempt execution identity is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND NEW.execution_backend IN ('PERSONAL_WORKER','RUNPOD_POD') THEN
   SELECT r.media_execution_backend INTO previous_backend FROM project_revisions r
    WHERE r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id AND r.id=NEW.project_revision_id;
   IF NEW.execution_backend IS DISTINCT FROM previous_backend AND NOT (
     NEW.execution_backend='RUNPOD_POD' AND NEW.kind='RENDER' AND EXISTS(
      SELECT 1 FROM cloud_media_render_recoveries recovery WHERE recovery.retry_attempt_id=NEW.id
       AND recovery.account_id=NEW.account_id AND recovery.workspace_id=NEW.workspace_id
       AND recovery.project_id=NEW.project_id AND recovery.project_revision_id=NEW.project_revision_id
       AND recovery.state='CONSUMED' AND recovery.replacement_bundle_sha256=NEW.execution_bundle_sha256
       AND NEW.submission_idempotency_key='render-cloud-recovery:'||NEW.id::text)) THEN
    RAISE EXCEPTION 'CPU backend differs from immutable revision or recovery authority' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER zz_project_revision_media_backend_guard BEFORE INSERT OR UPDATE ON project_revisions
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_guard_media_backend_lineage();
CREATE TRIGGER zz_cpu_attempt_media_backend_guard BEFORE INSERT OR UPDATE ON hosted_cpu_job_attempts
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_guard_media_backend_lineage();
REVOKE ALL ON FUNCTION public.videoforge_guard_media_backend_lineage() FROM PUBLIC;

-- Unconfirmed cleanup still occupies the original account/video admission boundary.
CREATE FUNCTION public.videoforge_guard_admission_against_cloud_cleanup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF NEW.state<>'ACTIVE' THEN RETURN NEW; END IF;
 PERFORM 1 FROM global_generation_capacity WHERE singleton FOR UPDATE;
 IF EXISTS(SELECT 1 FROM cloud_media_reservations r WHERE r.account_id=NEW.account_id
   AND r.state NOT IN ('WAITING_CAPACITY','CLEAN') AND (NEW.request_kind<>'VIDEO' OR NOT EXISTS(
     SELECT 1 FROM generation_requests g WHERE g.id=NEW.generation_request_id
       AND g.account_id=r.account_id AND g.workspace_id=r.workspace_id
       AND g.project_id=r.project_id AND g.project_revision_id=r.project_revision_id)))
  OR (SELECT count(DISTINCT occupied.account_id) FROM (
    SELECT l.account_id FROM provider_workload_leases l WHERE l.id<>NEW.id AND l.state='ACTIVE' AND l.expires_at>now()
    UNION ALL SELECT r.account_id FROM cloud_media_reservations r WHERE r.state NOT IN ('WAITING_CAPACITY','CLEAN')
    UNION ALL SELECT NEW.account_id) occupied)>2 THEN
  RAISE EXCEPTION 'admission held by cloud execution or unconfirmed cleanup' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER zz_provider_admission_cloud_cleanup_guard BEFORE INSERT OR UPDATE ON provider_workload_leases
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_guard_admission_against_cloud_cleanup();
REVOKE ALL ON FUNCTION public.videoforge_guard_admission_against_cloud_cleanup() FROM PUBLIC;

-- Multipart signing records belong to the exact leased attempt's durable authority.
CREATE FUNCTION public.videoforge_guard_cloud_multipart_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.account_id,NEW.workspace_id,NEW.reservation_id,NEW.authority_id,
     NEW.object_key,NEW.content_length,NEW.checksum_sha256,NEW.part_size) IS DISTINCT FROM
   (OLD.account_id,OLD.workspace_id,OLD.reservation_id,OLD.authority_id,
     OLD.object_key,OLD.content_length,OLD.checksum_sha256,OLD.part_size) THEN
  RAISE EXCEPTION 'cloud multipart identity immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM cloud_media_reservations r
    JOIN hosted_cpu_job_attempts a ON a.id=r.leased_attempt_id AND a.account_id=r.account_id AND a.workspace_id=r.workspace_id
    JOIN hosted_cpu_upload_authorities u ON u.attempt_id=a.id AND u.account_id=a.account_id AND u.workspace_id=a.workspace_id
    WHERE r.id=NEW.reservation_id AND r.account_id=NEW.account_id AND r.workspace_id=NEW.workspace_id
      AND r.state='SAVING' AND a.state='RUNNING' AND r.deadline_at>now() AND a.deadline_at>now()
      AND u.id=NEW.authority_id AND u.object_key=NEW.object_key AND u.issued_at IS NOT NULL
      AND u.issued_content_length=NEW.content_length AND u.issued_checksum_sha256=NEW.checksum_sha256) THEN
  RAISE EXCEPTION 'cloud multipart upload authority rejected' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER zz_cloud_multipart_authority_guard BEFORE INSERT OR UPDATE ON cloud_media_multipart_uploads
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_guard_cloud_multipart_authority();
REVOKE ALL ON FUNCTION public.videoforge_guard_cloud_multipart_authority() FROM PUBLIC;
CREATE TABLE cloud_media_multipart_parts (
 account_id uuid NOT NULL, workspace_id uuid NOT NULL, upload_id uuid NOT NULL REFERENCES cloud_media_multipart_uploads(id),
 part_number integer NOT NULL CHECK(part_number BETWEEN 1 AND 10000),
 content_length bigint NOT NULL CHECK(content_length BETWEEN 1 AND 67108864),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(upload_id,part_number)
);
ALTER TABLE cloud_media_multipart_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_media_multipart_parts FORCE ROW LEVEL SECURITY;
CREATE POLICY cloud_media_multipart_parts_tenant ON cloud_media_multipart_parts
 USING(account_id=public.videoforge_current_account_id()) WITH CHECK(account_id=public.videoforge_current_account_id());
CREATE TRIGGER cloud_media_multipart_parts_write_guard BEFORE INSERT OR UPDATE ON cloud_media_multipart_parts
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE FUNCTION public.videoforge_guard_cloud_multipart_part() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM cloud_media_multipart_uploads u
   JOIN cloud_media_reservations r ON r.id=u.reservation_id
   JOIN hosted_cpu_job_attempts a ON a.id=r.leased_attempt_id
   JOIN hosted_cpu_upload_authorities authority ON authority.id=u.authority_id
     AND authority.attempt_id=a.id AND authority.account_id=a.account_id AND authority.workspace_id=a.workspace_id
   WHERE u.id=NEW.upload_id AND u.account_id=NEW.account_id AND u.workspace_id=NEW.workspace_id
     AND u.state='OPEN' AND r.state='SAVING' AND a.state='RUNNING'
     AND r.deadline_at>now() AND a.deadline_at>now()
     AND NEW.part_number<=ceil(u.content_length::numeric/u.part_size)
     AND NEW.content_length=LEAST(u.part_size,u.content_length-(NEW.part_number-1)::bigint*u.part_size)) THEN
  RAISE EXCEPTION 'cloud multipart part rejected' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER zz_cloud_multipart_part_guard BEFORE INSERT OR UPDATE ON cloud_media_multipart_parts
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_guard_cloud_multipart_part();
REVOKE ALL ON FUNCTION public.videoforge_guard_cloud_multipart_part() FROM PUBLIC;
GRANT SELECT,INSERT ON cloud_media_multipart_parts TO videoforge_v209_runtime_dc9612d6;

-- Reuse a Pod only for immediately ready spans. The original reservation,
-- budget, runtime, disk and rental deadline remain unchanged.
ALTER TABLE cloud_media_jobs ADD COLUMN claim_ordinal integer NOT NULL DEFAULT 1
 CHECK(claim_ordinal BETWEEN 1 AND 4);
CREATE UNIQUE INDEX cloud_media_jobs_reservation_ordinal ON cloud_media_jobs(reservation_id,claim_ordinal);
CREATE FUNCTION public.videoforge_claim_cloud_media_span(
 reservation uuid, completed_attempt uuid, executed_count integer
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
 r cloud_media_reservations%ROWTYPE;
 previous hosted_cpu_job_attempts%ROWTYPE;
 candidate hosted_cpu_job_attempts%ROWTYPE;
 completed_ordinal integer;
 duration_ms bigint;
BEGIN
 SELECT * INTO r FROM cloud_media_reservations WHERE id=reservation FOR UPDATE;
 IF r.id IS NULL OR r.account_id IS DISTINCT FROM public.videoforge_current_account_id()
   OR completed_attempt IS NULL OR executed_count IS NULL OR executed_count NOT BETWEEN 1 AND 4 THEN
  RAISE EXCEPTION 'cloud span claim tenant or ordinal rejected' USING ERRCODE='42501'; END IF;
 SELECT a.* INTO previous FROM hosted_cpu_job_attempts a
  JOIN cloud_media_jobs j ON j.attempt_id=a.id AND j.reservation_id=r.id
  WHERE a.id=completed_attempt AND a.account_id=r.account_id AND a.workspace_id=r.workspace_id
    AND a.project_id=r.project_id AND a.project_revision_id=r.project_revision_id FOR UPDATE OF a;
 SELECT j.claim_ordinal INTO completed_ordinal FROM cloud_media_jobs j
  WHERE j.reservation_id=r.id AND j.attempt_id=completed_attempt;
 IF previous.id IS NULL OR previous.kind<>'SPAN_AUDIO' OR previous.execution_backend<>'RUNPOD_POD'
   OR previous.state<>'SUCCEEDED' OR previous.terminal_at IS NULL
   OR previous.result_receipt_sha256 IS NULL OR previous.image_digest IS DISTINCT FROM r.source_sha256
   OR previous.execution_bundle_sha256 IS DISTINCT FROM r.source_sha256 OR completed_ordinal IS DISTINCT FROM executed_count THEN
  RAISE EXCEPTION 'cloud span completed receipt rejected' USING ERRCODE='23514'; END IF;
 IF r.state NOT IN ('STARTING','DOWNLOADING','RENDERING','CHECKING','SAVING')
   OR r.verified_at IS NULL OR r.pod_id IS NULL OR r.deadline_at IS NULL OR r.deadline_at<=now() THEN RETURN NULL; END IF;
 -- A lost cleanup acknowledgment replays the same next member, never another claim.
 IF r.leased_attempt_id<>completed_attempt THEN
  IF r.span_job_count=executed_count+1 AND EXISTS(
    SELECT 1 FROM cloud_media_jobs j JOIN hosted_cpu_job_attempts a ON a.id=j.attempt_id
    WHERE j.reservation_id=r.id AND j.attempt_id=r.leased_attempt_id
      AND j.claim_ordinal=executed_count+1 AND a.state='RUNNING'
      AND a.account_id=r.account_id AND a.workspace_id=r.workspace_id
      AND a.project_id=r.project_id AND a.project_revision_id=r.project_revision_id
      AND a.execution_backend='RUNPOD_POD' AND a.kind='SPAN_AUDIO' AND a.deadline_at>now()) THEN
   RETURN r.leased_attempt_id;
  END IF;
  RAISE EXCEPTION 'cloud span cleanup ordinal stale' USING ERRCODE='23514';
 END IF;
 IF r.span_job_count<>executed_count THEN
  RAISE EXCEPTION 'cloud span cleanup ordinal stale' USING ERRCODE='23514'; END IF;
 IF r.span_job_count>=4 THEN RETURN NULL; END IF;
 PERFORM 1 FROM generation_requests g WHERE g.account_id=r.account_id AND g.workspace_id=r.workspace_id
  AND g.project_id=r.project_id AND g.project_revision_id=r.project_revision_id AND g.state='ACTIVE'
  AND EXISTS(SELECT 1 FROM provider_workload_leases l WHERE l.generation_request_id=g.id
    AND l.state='ACTIVE' AND l.expires_at>now()) FOR UPDATE OF g;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT v.duration_ms INTO duration_ms FROM project_revisions revision
  JOIN assets v ON v.id=revision.voiceover_asset_id AND v.account_id=r.account_id AND v.workspace_id=r.workspace_id
  WHERE revision.id=r.project_revision_id AND revision.account_id=r.account_id AND revision.workspace_id=r.workspace_id;
 IF duration_ms IS NULL OR duration_ms NOT BETWEEN 1 AND 3600000 THEN RETURN NULL; END IF;
 SELECT a.* INTO candidate FROM hosted_cpu_job_attempts a
  WHERE a.account_id=r.account_id AND a.workspace_id=r.workspace_id
    AND a.project_id=r.project_id AND a.project_revision_id=r.project_revision_id
    AND a.kind='SPAN_AUDIO' AND a.execution_backend='RUNPOD_POD' AND a.state='OUTBOXED'
    AND a.deadline_at>now() AND a.image_digest=r.source_sha256 AND a.execution_bundle_sha256=r.source_sha256
    AND a.job_spec_content_length>0 AND a.job_spec_checksum_sha256 IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM media_worker_leases l WHERE l.attempt_id=a.id
      AND l.state IN ('CLAIMED','RUNNING','COMPLETING'))
    AND NOT EXISTS(SELECT 1 FROM cloud_media_jobs j WHERE j.attempt_id=a.id)
    AND NOT EXISTS(SELECT 1 FROM cloud_media_reservations other
      WHERE other.id<>r.id AND (other.attempt_id=a.id OR other.leased_attempt_id=a.id))
    AND EXISTS(SELECT 1 FROM media_worker_input_objects input WHERE input.attempt_id=a.id
      AND input.account_id=r.account_id AND input.workspace_id=r.workspace_id)
    AND r.disk_gb>=GREATEST(100,ceil((
      (SELECT sum(input.content_length)::numeric*3 FROM media_worker_input_objects input
       WHERE input.attempt_id=a.id AND input.account_id=r.account_id AND input.workspace_id=r.workspace_id)
      + duration_ms::numeric/1000*4000000*3+32::numeric*1073741824)/10000000000)*10)
  ORDER BY a.created_at,a.id LIMIT 1 FOR UPDATE OF a SKIP LOCKED;
 IF candidate.id IS NULL THEN RETURN NULL; END IF;
 INSERT INTO cloud_media_jobs(account_id,workspace_id,reservation_id,attempt_id,claim_ordinal)
  VALUES(r.account_id,r.workspace_id,r.id,candidate.id,r.span_job_count+1);
 UPDATE hosted_cpu_job_attempts SET state='RUNNING',submitted_at=now(),version=version+1,updated_at=now()
  WHERE id=candidate.id AND state='OUTBOXED';
 UPDATE cloud_media_reservations SET leased_attempt_id=candidate.id,span_job_count=span_job_count+1,
  state='STARTING',updated_at=now(),last_heartbeat_at=now() WHERE id=r.id;
 RETURN candidate.id;
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_claim_cloud_media_span(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_claim_cloud_media_span(uuid,uuid,integer)
 TO videoforge_v209_runtime_dc9612d6;

ALTER TABLE cloud_media_reservations ADD COLUMN failure_settled_at timestamptz;

-- Failure settlement never changes a paid API job's state or accepted media.
CREATE FUNCTION public.videoforge_settle_cloud_media_cpu_failure(target_attempt uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE a hosted_cpu_job_attempts%ROWTYPE; request generation_requests%ROWTYPE;
 runtime video_runtime_states%ROWTYPE; materialized hosted_v209_span_audio_materializations%ROWTYPE;
 now_at timestamptz:=transaction_timestamp(); canceled boolean; lease_count integer;
BEGIN
 SELECT * INTO a FROM hosted_cpu_job_attempts WHERE id=target_attempt FOR UPDATE;
 IF a.id IS NULL OR a.account_id IS DISTINCT FROM public.videoforge_current_account_id()
   OR a.execution_backend<>'RUNPOD_POD' OR a.kind NOT IN ('ASR','SPAN_AUDIO')
   OR a.state NOT IN ('FAILED','CANCELLED','EXPIRED') OR a.terminal_at IS NULL THEN
  RAISE EXCEPTION 'cloud CPU failure identity rejected' USING ERRCODE='42501'; END IF;
 canceled:=a.state='CANCELLED';
 -- Fence only this failed video's unstarted or still-owned Cloud executions.
 UPDATE hosted_cpu_job_attempts sibling SET state='CANCEL_REQUESTED',cancellation_requested_at=COALESCE(cancellation_requested_at,now_at),
   version=version+1,updated_at=now_at
 WHERE sibling.account_id=a.account_id AND sibling.workspace_id=a.workspace_id
   AND sibling.project_id=a.project_id AND sibling.project_revision_id=a.project_revision_id
   AND sibling.execution_backend='RUNPOD_POD' AND sibling.kind IN ('ASR','SPAN_AUDIO')
   AND sibling.id<>a.id AND sibling.state IN ('RUNNING','SUBMITTED','RECONCILING')
   AND EXISTS(SELECT 1 FROM cloud_media_jobs j JOIN cloud_media_reservations r ON r.id=j.reservation_id
     WHERE j.attempt_id=sibling.id AND r.state NOT IN ('WAITING_CAPACITY','CLEAN'));
 UPDATE hosted_cpu_job_attempts sibling SET state='CANCELLED',submitted_at=COALESCE(submitted_at,now_at),
   terminal_at=now_at,retain_until=GREATEST(sibling.deadline_at,now_at+interval '30 minutes'),version=version+1,updated_at=now_at
 WHERE sibling.account_id=a.account_id AND sibling.workspace_id=a.workspace_id
   AND sibling.project_id=a.project_id AND sibling.project_revision_id=a.project_revision_id
   AND sibling.execution_backend='RUNPOD_POD' AND sibling.kind IN ('ASR','SPAN_AUDIO')
   AND sibling.id<>a.id AND sibling.state IN ('PLANNED','OUTBOXED','RECONCILING')
   AND NOT EXISTS(SELECT 1 FROM cloud_media_jobs j JOIN cloud_media_reservations r ON r.id=j.reservation_id
     WHERE j.attempt_id=sibling.id AND r.state NOT IN ('WAITING_CAPACITY','CLEAN'));
 UPDATE cloud_media_reservations r SET state='CLEAN',cleanup_verified_at=now_at,updated_at=now_at
 WHERE r.account_id=a.account_id AND r.workspace_id=a.workspace_id AND r.project_id=a.project_id
   AND r.project_revision_id=a.project_revision_id AND r.state='WAITING_CAPACITY' AND r.pod_id IS NULL
   AND (r.launch_outcome IS NULL OR r.launch_outcome='REFUSED');
 IF EXISTS(SELECT 1 FROM cloud_media_reservations r WHERE r.account_id=a.account_id AND r.workspace_id=a.workspace_id
   AND r.project_id=a.project_id AND r.project_revision_id=a.project_revision_id AND r.state<>'CLEAN') THEN RETURN false; END IF;
 IF a.kind='SPAN_AUDIO' THEN
  SELECT * INTO materialized FROM hosted_v209_span_audio_materializations m
   WHERE m.attempt_id=a.id AND m.account_id=a.account_id AND m.workspace_id=a.workspace_id
     AND m.project_id=a.project_id AND m.project_revision_id=a.project_revision_id;
  IF materialized.attempt_id IS NULL THEN RAISE EXCEPTION 'cloud span failure materialization missing' USING ERRCODE='23514'; END IF;
  SELECT * INTO request FROM generation_requests g WHERE g.id=materialized.generation_request_id
    AND g.account_id=a.account_id AND g.workspace_id=a.workspace_id AND g.project_id=a.project_id
    AND g.project_revision_id=a.project_revision_id FOR UPDATE;
 ELSE
  SELECT * INTO request FROM generation_requests g WHERE g.account_id=a.account_id AND g.workspace_id=a.workspace_id
   AND g.project_id=a.project_id AND g.project_revision_id=a.project_revision_id ORDER BY g.created_at DESC,g.id DESC LIMIT 1 FOR UPDATE;
 END IF;
 IF request.id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=request.project_id AND p.account_id=request.account_id
    AND p.workspace_id=request.workspace_id AND p.owner_user_id=request.created_by_user_id AND p.generation_provider='KIE_FAL') THEN
   RAISE EXCEPTION 'cloud CPU failure project ownership invalid' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM hosted_api_generation_jobs j WHERE j.generation_request_id=request.id ORDER BY j.id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM hosted_api_generation_jobs j WHERE j.generation_request_id=request.id
    AND j.state IN ('SUBMITTING','UNKNOWN_NO_RETRY','SUBMITTED')) THEN RETURN false; END IF;
  IF request.state IN ('FAILED','CANCELLED') THEN
   IF EXISTS(SELECT 1 FROM provider_workload_leases l WHERE l.generation_request_id=request.id AND l.state='ACTIVE') THEN RETURN false; END IF;
  ELSE
   IF request.state NOT IN ('ACTIVE','ADMITTED','CANCELLING') OR request.terminal_at IS NOT NULL THEN RETURN false; END IF;
   SELECT * INTO runtime FROM video_runtime_states v WHERE v.account_id=a.account_id AND v.workspace_id=a.workspace_id
     AND v.generation_request_id=request.id FOR UPDATE;
   IF a.kind='ASR' AND (runtime.id IS NOT NULL OR EXISTS(SELECT 1 FROM hosted_api_generation_jobs j WHERE j.generation_request_id=request.id)) THEN
    RAISE EXCEPTION 'cloud ASR failure has downstream execution' USING ERRCODE='23514'; END IF;
   IF a.kind='SPAN_AUDIO' THEN
    IF runtime.id IS NULL OR runtime.stage<>'WAITING_FOR_WORKER' OR runtime.terminal_at IS NOT NULL
      OR materialized.user_id<>request.created_by_user_id THEN
     RAISE EXCEPTION 'cloud span failure runtime invalid' USING ERRCODE='23514'; END IF;
    UPDATE generation_tasks task SET state=CASE WHEN canceled THEN 'CANCELLED' ELSE 'FAILED' END,
      finished_at=now_at,version=task.version+1,updated_at=now_at
    WHERE task.account_id=a.account_id AND task.workspace_id=a.workspace_id
      AND task.state NOT IN ('COMPLETE','FAILED','CANCELLED') AND (task.id=materialized.task_id OR EXISTS(
        SELECT 1 FROM hosted_api_generation_jobs j WHERE j.generation_request_id=request.id
          AND j.generation_task_id=task.id AND j.state IN ('PREPARED','FAILED') AND task.state='BLOCKED'));
    UPDATE video_runtime_lane_states lane SET state=CASE WHEN canceled THEN 'CANCELED' ELSE 'FAILED' END,
      version=lane.version+1,updated_at=now_at WHERE lane.runtime_id=runtime.id AND lane.state NOT IN ('SUCCEEDED','FAILED','CANCELED');
    UPDATE video_runtime_states SET stage=CASE WHEN canceled THEN 'CANCELED' ELSE 'FAILED' END,
      terminal_reason=CASE WHEN canceled THEN 'OWNER_CANCELLED' ELSE 'LANE_PERMANENT_FAILURE' END,
      terminal_at=now_at,version=version+1,updated_at=now_at WHERE id=runtime.id;
   END IF;
   UPDATE generation_requests SET state=CASE WHEN canceled THEN 'CANCELLED' ELSE 'FAILED' END,
     terminal_at=now_at,version=version+1,updated_at=now_at WHERE id=request.id;
   UPDATE provider_workload_leases SET state='RELEASED',released_at=now_at,release_reason='CLOUD_MEDIA_CPU_TERMINAL',
     version=version+1,heartbeat_at=now_at,expires_at=GREATEST(expires_at,now_at+interval '1 second')
   WHERE account_id=a.account_id AND workspace_id=a.workspace_id AND generation_request_id=request.id
     AND request_kind='VIDEO' AND state='ACTIVE';
   GET DIAGNOSTICS lease_count=ROW_COUNT;
   IF lease_count<>1 THEN RAISE EXCEPTION 'cloud CPU failure exact admission release missing' USING ERRCODE='55000'; END IF;
  END IF;
 END IF;
 UPDATE cloud_media_reservations r SET failure_settled_at=now_at WHERE r.account_id=a.account_id
   AND r.workspace_id=a.workspace_id AND r.project_id=a.project_id AND r.project_revision_id=a.project_revision_id
   AND r.state='CLEAN' AND r.failure_settled_at IS NULL;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_settle_cloud_media_cpu_failure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_settle_cloud_media_cpu_failure(uuid) TO videoforge_v209_runtime_dc9612d6;

CREATE OR REPLACE FUNCTION public.videoforge_cloud_media_reconciliation_scope()
RETURNS TABLE(attempt_id uuid,account_id uuid,workspace_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT r.attempt_id,r.account_id,r.workspace_id FROM cloud_media_reservations r
 JOIN hosted_cpu_job_attempts a ON a.id=r.leased_attempt_id
 WHERE r.state<>'CLEAN' OR (r.failure_settled_at IS NULL AND a.state IN ('FAILED','CANCELLED','EXPIRED'))
 ORDER BY r.created_at,r.id LIMIT 100;
$$;

-- New paid API claims stop after this exact video's Cloud CPU failure. Existing polls and commits continue.
DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_claim_hosted_api_job(uuid,uuid,uuid,uuid,uuid)'::regprocedure) INTO definition;
 IF strpos(definition,$old$  IF job.state<>'PREPARED' THEN$old$)=0 THEN RAISE EXCEPTION 'cloud failure API claim preimage drifted'; END IF;
 definition:=replace(definition,$old$  IF job.state<>'PREPARED' THEN$old$,$new$  IF job.state='PREPARED' AND EXISTS(
    SELECT 1 FROM public.generation_requests r JOIN public.hosted_cpu_job_attempts a
      ON a.account_id=r.account_id AND a.workspace_id=r.workspace_id AND a.project_id=r.project_id
      AND a.project_revision_id=r.project_revision_id
    WHERE r.id=supplied_generation_request_id AND a.execution_backend='RUNPOD_POD'
      AND a.kind IN ('ASR','SPAN_AUDIO') AND a.state IN ('FAILED','CANCELLED','EXPIRED')) THEN
    RAISE EXCEPTION 'cloud media failure prevents a new paid API claim' USING ERRCODE='55000';
  END IF;
  IF job.state<>'PREPARED' THEN$new$);
 EXECUTE definition;
END; $migration$;

-- Explicit rerender of accepted media. Preserve the source request/runtime/final/approvals.
-- Each run owns a fresh ordinary VIDEO admission and CPU attempt, never provider jobs/runtime rows.
CREATE TABLE public.hosted_render_only_runs (
 id uuid PRIMARY KEY, account_id uuid NOT NULL, workspace_id uuid NOT NULL,
 project_id uuid NOT NULL, project_revision_id uuid NOT NULL,
 source_attempt_id uuid NOT NULL, source_request_id uuid NOT NULL, source_runtime_id uuid NOT NULL,
 generation_request_id uuid NOT NULL UNIQUE, created_by_user_id uuid NOT NULL,
 idempotency_key uuid NOT NULL, execution_bundle_sha256 text NOT NULL CHECK(execution_bundle_sha256 ~ '^sha256:[0-9a-f]{64}$'),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 3),
 state text NOT NULL DEFAULT 'PREPARING' CHECK(state IN ('PREPARING','SUCCEEDED','FAILED','CANCELLED')),
 output_receipt_id uuid, final_output jsonb, created_at timestamptz NOT NULL DEFAULT now(), terminal_at timestamptz,
 UNIQUE(account_id,workspace_id,id), UNIQUE(account_id,idempotency_key), UNIQUE(source_attempt_id,ordinal),
 FOREIGN KEY(account_id,workspace_id,project_id) REFERENCES public.projects(account_id,workspace_id,id),
 FOREIGN KEY(account_id,workspace_id,project_revision_id) REFERENCES public.project_revisions(account_id,workspace_id,id),
 FOREIGN KEY(account_id,workspace_id,source_attempt_id) REFERENCES public.hosted_cpu_job_attempts(account_id,workspace_id,id),
 FOREIGN KEY(account_id,workspace_id,source_request_id) REFERENCES public.generation_requests(account_id,workspace_id,id),
 FOREIGN KEY(account_id,workspace_id,source_runtime_id) REFERENCES public.video_runtime_states(account_id,workspace_id,id),
 FOREIGN KEY(account_id,workspace_id,generation_request_id) REFERENCES public.generation_requests(account_id,workspace_id,id),
 CHECK((state<>'PREPARING')=(terminal_at IS NOT NULL)),
 CHECK((state='SUCCEEDED')=(output_receipt_id IS NOT NULL AND final_output IS NOT NULL))
);
ALTER TABLE public.hosted_render_only_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_render_only_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_render_only_runs_tenant ON public.hosted_render_only_runs
 USING(account_id=public.videoforge_current_account_id()) WITH CHECK(account_id=public.videoforge_current_account_id());
REVOKE ALL ON public.hosted_render_only_runs FROM PUBLIC;
GRANT SELECT ON public.hosted_render_only_runs TO videoforge_v209_runtime_dc9612d6;
CREATE FUNCTION public.videoforge_guard_render_only_run() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (OLD.state<>'PREPARING' OR
  (NEW.id,NEW.account_id,NEW.workspace_id,NEW.project_id,NEW.project_revision_id,NEW.source_attempt_id,
   NEW.source_request_id,NEW.source_runtime_id,NEW.generation_request_id,NEW.created_by_user_id,
   NEW.idempotency_key,NEW.execution_bundle_sha256,NEW.ordinal,NEW.created_at) IS DISTINCT FROM
  (OLD.id,OLD.account_id,OLD.workspace_id,OLD.project_id,OLD.project_revision_id,OLD.source_attempt_id,
   OLD.source_request_id,OLD.source_runtime_id,OLD.generation_request_id,OLD.created_by_user_id,
   OLD.idempotency_key,OLD.execution_bundle_sha256,OLD.ordinal,OLD.created_at))) THEN
  RAISE EXCEPTION 'render-only lineage is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER hosted_render_only_run_immutable BEFORE UPDATE OR DELETE ON public.hosted_render_only_runs
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_guard_render_only_run();
REVOKE ALL ON FUNCTION public.videoforge_guard_render_only_run() FROM PUBLIC;

CREATE FUNCTION public.videoforge_render_only_source_valid(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.hosted_render_only_runs run
 JOIN public.projects p ON p.id=run.project_id AND p.account_id=run.account_id AND p.workspace_id=run.workspace_id
 JOIN public.project_revisions rev ON rev.id=run.project_revision_id AND rev.account_id=run.account_id
  AND rev.workspace_id=run.workspace_id AND rev.project_id=run.project_id
 JOIN public.hosted_cpu_job_attempts a ON a.id=run.source_attempt_id AND a.account_id=run.account_id
  AND a.workspace_id=run.workspace_id AND a.project_id=run.project_id AND a.project_revision_id=run.project_revision_id
 JOIN public.generation_requests g ON g.id=run.source_request_id AND g.account_id=run.account_id AND g.workspace_id=run.workspace_id
  AND g.project_id=run.project_id AND g.project_revision_id=run.project_revision_id
 JOIN public.video_runtime_states v ON v.id=run.source_runtime_id AND v.account_id=run.account_id AND v.workspace_id=run.workspace_id
  AND v.generation_request_id=g.id AND v.project_id=run.project_id AND v.project_revision_id=run.project_revision_id
 JOIN public.hosted_render_plans plan ON plan.account_id=run.account_id AND plan.workspace_id=run.workspace_id
  AND plan.project_id=run.project_id AND plan.project_revision_id=run.project_revision_id
 JOIN public.hosted_cpu_upload_authorities output ON output.attempt_id=a.id AND output.account_id=run.account_id
  AND output.workspace_id=run.workspace_id AND output.source='PRIMARY_RESULT_OUTPUT'
 JOIN public.artifact_receipts receipt ON receipt.id=md5('v209-final-receipt:'||a.id::text)::uuid
  AND receipt.account_id=run.account_id AND receipt.workspace_id=run.workspace_id
 JOIN public.artifact_reservations reservation ON reservation.id=receipt.reservation_id AND reservation.account_id=run.account_id
  AND reservation.workspace_id=run.workspace_id AND reservation.project_id=run.project_id AND reservation.project_revision_id=run.project_revision_id
 WHERE run.id=target AND run.account_id=public.videoforge_current_account_id()
  AND p.status='ACTIVE' AND p.generation_provider='KIE_FAL' AND rev.status='LOCKED'
  AND a.kind='RENDER' AND a.state='SUCCEEDED' AND a.result_receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'
  AND a.retention_deleted_at IS NULL AND g.state='SUCCEEDED' AND g.terminal_at IS NOT NULL
  AND v.stage='COMPLETE' AND v.terminal_reason='SUCCEEDED' AND v.final_output_sha256=output.issued_checksum_sha256
  AND v.render_manifest_sha256=plan.payload#>>'{input_document,resolved_render_manifest,sha256}'
  AND plan.payload_sha256='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(plan.payload),'UTF8')),'hex')
  AND a.request_sha256=public.videoforge_hosted_cpu_submission_request_sha256(plan.payload)
  AND receipt.deleted_at IS NULL AND receipt.content_type='video/mp4' AND receipt.checksum_sha256=v.final_output_sha256
  AND receipt.object_key=output.object_key AND receipt.content_length=output.issued_content_length
  AND reservation.state='COMMITTED' AND reservation.retention_class='FINAL'
  AND output.issued_at IS NOT NULL AND output.content_type='video/mp4'
  AND public.videoforge_v209_api_outputs_accepted(run.account_id,run.workspace_id,g.id,v.id));
$$;
REVOKE ALL ON FUNCTION public.videoforge_render_only_source_valid(uuid) FROM PUBLIC;

CREATE FUNCTION public.videoforge_prepare_cloud_render_only_run(
 account uuid,workspace uuid,actor uuid,project uuid,source_attempt uuid,idempotency uuid,new_attempt uuid,bundle text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE run public.hosted_render_only_runs%ROWTYPE; a public.hosted_cpu_job_attempts%ROWTYPE;
 v public.video_runtime_states%ROWTYPE; request_id uuid:=gen_random_uuid(); next_ordinal integer;
BEGIN
 IF public.videoforge_current_account_id() IS DISTINCT FROM account OR bundle !~ '^sha256:[0-9a-f]{64}$'
  OR idempotency IS NULL OR new_attempt IS NULL OR NOT EXISTS(SELECT 1 FROM public.projects p
    JOIN public.memberships m ON m.workspace_id=p.workspace_id AND m.user_id=actor AND m.status='ACTIVE'
    WHERE p.id=project AND p.account_id=account AND p.workspace_id=workspace AND p.owner_user_id=actor AND p.status='ACTIVE') THEN
  RAISE EXCEPTION 'render-only owner scope rejected' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.projects p WHERE p.id=project AND p.account_id=account AND p.workspace_id=workspace FOR UPDATE;
 SELECT * INTO run FROM public.hosted_render_only_runs r WHERE r.account_id=account AND r.idempotency_key=idempotency;
 IF run.id IS NOT NULL THEN
  IF run.project_id<>project OR run.workspace_id<>workspace OR run.source_attempt_id<>source_attempt
    OR run.execution_bundle_sha256<>bundle OR run.created_by_user_id<>actor THEN
   RAISE EXCEPTION 'render-only idempotency conflict' USING ERRCODE='23505'; END IF;
 ELSE
  SELECT * INTO a FROM public.hosted_cpu_job_attempts x WHERE x.id=source_attempt AND x.account_id=account
   AND x.workspace_id=workspace AND x.project_id=project AND x.kind='RENDER' AND x.state='SUCCEEDED';
  SELECT * INTO v FROM public.video_runtime_states x WHERE x.account_id=account AND x.workspace_id=workspace
   AND x.project_id=project AND x.project_revision_id=a.project_revision_id AND x.stage='COMPLETE';
  IF a.id IS NULL OR v.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.project_revisions rev WHERE rev.id=a.project_revision_id
    AND rev.account_id=account AND rev.workspace_id=workspace AND rev.project_id=project AND rev.status='LOCKED'
    AND rev.revision_number=(SELECT max(r.revision_number) FROM public.project_revisions r WHERE r.account_id=account
      AND r.workspace_id=workspace AND r.project_id=project))
   OR EXISTS(SELECT 1 FROM public.generation_requests g WHERE g.account_id=account AND g.state IN ('WAITING','ADMITTED','ACTIVE','CANCELLING','RETRY_WAIT'))
   OR EXISTS(SELECT 1 FROM public.hosted_cpu_job_attempts c WHERE c.account_id=account AND c.state IN ('PLANNED','OUTBOXED','RUNNING','CANCEL_REQUESTED','RECONCILING'))
   OR EXISTS(SELECT 1 FROM public.provider_workload_leases l WHERE l.account_id=account AND l.state='ACTIVE')
   OR EXISTS(SELECT 1 FROM public.cloud_media_reservations r WHERE r.account_id=account AND (r.state<>'CLEAN' OR r.cleanup_verified_at IS NULL))
   OR EXISTS(SELECT 1 FROM public.media_worker_leases l WHERE l.account_id=account AND l.state IN ('CLAIMED','RUNNING','COMPLETING')) THEN
   RAISE EXCEPTION 'render-only source or cleanup is not ready' USING ERRCODE='23514'; END IF;
  SELECT count(*)+1 INTO next_ordinal FROM public.hosted_render_only_runs r WHERE r.source_attempt_id=a.id;
  IF next_ordinal>3 THEN RAISE EXCEPTION 'render-only retry bound exhausted' USING ERRCODE='23514'; END IF;
  INSERT INTO public.generation_requests(id,account_id,workspace_id,project_id,project_revision_id,created_by_user_id,
   state,queue_order,available_at,attempt_ordinal,idempotency_key,created_at,updated_at)
  VALUES(request_id,account,workspace,project,a.project_revision_id,actor,'WAITING',
   (SELECT coalesce(max(g.queue_order),0)+1 FROM public.generation_requests g WHERE g.account_id=account),now(),1,'render-only:'||new_attempt::text,now(),now());
  INSERT INTO public.hosted_render_only_runs(id,account_id,workspace_id,project_id,project_revision_id,source_attempt_id,
   source_request_id,source_runtime_id,generation_request_id,created_by_user_id,idempotency_key,execution_bundle_sha256,ordinal)
  VALUES(new_attempt,account,workspace,project,a.project_revision_id,a.id,v.generation_request_id,v.id,request_id,actor,idempotency,bundle,next_ordinal)
  RETURNING * INTO run;
  IF NOT public.videoforge_render_only_source_valid(run.id) THEN RAISE EXCEPTION 'render-only accepted source proof invalid' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN jsonb_build_object('schema_version','videoforge-hosted-render-disk-recovery/v1','revision_id',run.project_revision_id,
  'retry_attempt_id',run.id,'recovery_kind','CLOUD_RENDER_ONLY','recovery_key','render-only:'||run.id::text);
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_prepare_cloud_render_only_run(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_prepare_cloud_render_only_run(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text)
 TO videoforge_v209_runtime_dc9612d6;
CREATE FUNCTION public.videoforge_read_cloud_render_only_run(target uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT jsonb_build_object('attemptId',r.id,'accountId',r.account_id,'workspaceId',r.workspace_id,'projectId',r.project_id,'projectRevisionId',r.project_revision_id,'generationRequestId',r.generation_request_id,'sourceAttemptId',r.source_attempt_id,'state',r.state)
 FROM public.hosted_render_only_runs r WHERE r.id=target AND r.account_id=public.videoforge_current_account_id();
$$;
REVOKE ALL ON FUNCTION public.videoforge_read_cloud_render_only_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_read_cloud_render_only_run(uuid) TO videoforge_v209_runtime_dc9612d6;

-- Provider-inert by construction: the new request cannot own paid API/serverless jobs or runtime.
CREATE FUNCTION public.videoforge_guard_render_only_provider_inert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.hosted_render_only_runs r WHERE r.generation_request_id=NEW.generation_request_id) THEN
  RAISE EXCEPTION 'render-only requests cannot generate provider work or runtime' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER hosted_render_only_api_inert BEFORE INSERT OR UPDATE ON public.hosted_api_generation_jobs
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_guard_render_only_provider_inert();
CREATE TRIGGER hosted_render_only_serverless_inert BEFORE INSERT OR UPDATE ON public.serverless_attempts
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_guard_render_only_provider_inert();
CREATE TRIGGER hosted_render_only_runtime_inert BEFORE INSERT OR UPDATE ON public.video_runtime_states
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_guard_render_only_provider_inert();
REVOKE ALL ON FUNCTION public.videoforge_guard_render_only_provider_inert() FROM PUBLIC;

CREATE FUNCTION public.videoforge_settle_cloud_render_only_run(target uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE run public.hosted_render_only_runs%ROWTYPE; a public.hosted_cpu_job_attempts%ROWTYPE;
BEGIN
 SELECT * INTO run FROM public.hosted_render_only_runs r WHERE r.id=target AND r.account_id=public.videoforge_current_account_id() FOR UPDATE;
 IF run.id IS NULL THEN RETURN false; END IF;
 IF run.state IN ('FAILED','CANCELLED') THEN RETURN true; END IF;
 SELECT * INTO a FROM public.hosted_cpu_job_attempts c WHERE c.id=run.id AND c.account_id=run.account_id
  AND c.workspace_id=run.workspace_id AND c.project_id=run.project_id AND c.project_revision_id=run.project_revision_id FOR UPDATE;
 IF a.id IS NULL OR a.execution_backend<>'RUNPOD_POD' OR a.kind<>'RENDER' OR a.state NOT IN ('FAILED','CANCELLED','EXPIRED')
  OR a.result_receipt_sha256 IS NOT NULL OR EXISTS(SELECT 1 FROM public.cloud_media_reservations r WHERE r.account_id=run.account_id
   AND r.project_id=run.project_id AND (r.state<>'CLEAN' OR r.cleanup_verified_at IS NULL)) THEN RETURN false; END IF;
 UPDATE public.provider_workload_leases l SET state='RELEASED',released_at=now(),release_reason='OWNER_CANCELLED_BEFORE_PROVIDER_DISPATCH',
  version=version+1 WHERE l.generation_request_id=run.generation_request_id AND l.state='ACTIVE';
 UPDATE public.generation_requests g SET state=CASE WHEN a.state='CANCELLED' THEN 'CANCELLED' ELSE 'FAILED' END,
  terminal_at=now(),version=version+1,updated_at=now() WHERE g.id=run.generation_request_id AND g.state IN ('WAITING','ADMITTED','ACTIVE','CANCELLING','RETRY_WAIT');
 UPDATE public.hosted_render_only_runs r SET state=CASE WHEN a.state='CANCELLED' THEN 'CANCELLED' ELSE 'FAILED' END,terminal_at=now() WHERE r.id=run.id;
 UPDATE public.cloud_media_reservations r SET failure_settled_at=coalesce(failure_settled_at,now()) WHERE r.attempt_id=run.id AND r.state='CLEAN';
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_settle_cloud_render_only_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_settle_cloud_render_only_run(uuid) TO videoforge_v209_runtime_dc9612d6;

-- Extend only exact render-only backend/admission proofs; leave ordinary paths untouched.
DO $patch$
DECLARE definition text; marker text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_guard_media_backend_lineage()'::regprocedure) INTO definition;
 marker:=$old$AND NEW.submission_idempotency_key='render-cloud-recovery:'||NEW.id::text))$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'render-only backend preimage mismatch'; END IF;
 definition:=replace(definition,marker,$new$AND NEW.submission_idempotency_key='render-cloud-recovery:'||NEW.id::text)
   OR EXISTS(SELECT 1 FROM public.hosted_render_only_runs run WHERE run.id=NEW.id
    AND run.account_id=NEW.account_id AND run.workspace_id=NEW.workspace_id AND run.project_id=NEW.project_id
    AND run.project_revision_id=NEW.project_revision_id AND run.state='PREPARING'
    AND run.execution_bundle_sha256=NEW.execution_bundle_sha256 AND NEW.submission_idempotency_key='render-only:'||NEW.id::text
    AND public.videoforge_render_only_source_valid(run.id)))$new$);
 EXECUTE definition;
 SELECT pg_get_functiondef('public.videoforge_cloud_render_inputs_valid(uuid)'::regprocedure) INTO definition;
 marker:=$old$r.status='LOCKED' AND r.media_execution_backend='RUNPOD_POD'$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'render-only input preimage mismatch'; END IF;
 definition:=replace(definition,marker,$new$r.status='LOCKED' AND (r.media_execution_backend='RUNPOD_POD' OR EXISTS(
  SELECT 1 FROM public.hosted_render_only_runs run WHERE run.id=a.id AND run.account_id=a.account_id
   AND run.workspace_id=a.workspace_id AND run.project_id=a.project_id AND run.project_revision_id=a.project_revision_id
   AND run.state='PREPARING' AND run.execution_bundle_sha256=a.execution_bundle_sha256
   AND a.submission_idempotency_key='render-only:'||run.id::text AND public.videoforge_render_only_source_valid(run.id)))$new$);
 EXECUTE definition;
END; $patch$;

-- Capture the reviewed ordinary implementations privately before adding the explicit-run branch.
DO $copy$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_read_v209_render_terminal_candidate(uuid,uuid,uuid)'::regprocedure) INTO definition;
 IF strpos(definition,'apiOutputsAccepted')=0 OR strpos(definition,'acceptedLaneCount')=0 THEN RAISE EXCEPTION 'render-only candidate preimage mismatch'; END IF;
 definition:=replace(definition,$old$AND row.kind='RENDER' AND row.state NOT IN ('FAILED','CANCELLED')$old$,$new$AND row.kind='RENDER' AND row.state NOT IN ('FAILED','CANCELLED') AND NOT EXISTS(SELECT 1 FROM public.hosted_render_only_runs run WHERE run.id=row.id)$new$);
 EXECUTE replace(definition,'videoforge_read_v209_render_terminal_candidate(','videoforge_read_v209_render_terminal_legacy222(');
 SELECT pg_get_functiondef('public.videoforge_finalize_v209_render_terminal(jsonb)'::regprocedure) INTO definition;
 IF strpos(definition,'videoforge_v209_api_outputs_accepted')=0 OR strpos(definition,'videoforge_hosted_cpu_submission_request_sha256')=0 THEN RAISE EXCEPTION 'render-only finalizer preimage mismatch'; END IF;
 definition:=replace(definition,$old$AND row.kind='RENDER' AND row.state NOT IN ('FAILED','CANCELLED')$old$,$new$AND row.kind='RENDER' AND row.state NOT IN ('FAILED','CANCELLED') AND NOT EXISTS(SELECT 1 FROM public.hosted_render_only_runs run WHERE run.id=row.id)$new$);
 EXECUTE replace(definition,'videoforge_finalize_v209_render_terminal(','videoforge_finalize_v209_render_terminal_legacy222(');
END; $copy$;
REVOKE ALL ON FUNCTION public.videoforge_read_v209_render_terminal_legacy222(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_finalize_v209_render_terminal_legacy222(jsonb) FROM PUBLIC;

CREATE FUNCTION public.videoforge_render_only_completion_proven(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.hosted_render_only_runs run
 JOIN public.hosted_cpu_job_attempts a ON a.id=run.id AND a.account_id=run.account_id AND a.workspace_id=run.workspace_id
  AND a.project_id=run.project_id AND a.project_revision_id=run.project_revision_id
 JOIN public.cloud_media_jobs j ON j.attempt_id=a.id AND j.account_id=a.account_id AND j.workspace_id=a.workspace_id
 JOIN public.cloud_media_reservations r ON r.id=j.reservation_id AND r.account_id=a.account_id AND r.workspace_id=a.workspace_id
  AND r.project_id=a.project_id AND r.project_revision_id=a.project_revision_id AND r.attempt_id=a.id AND r.leased_attempt_id=a.id
 JOIN public.hosted_cpu_job_events e ON e.attempt_id=a.id AND e.account_id=a.account_id AND e.workspace_id=a.workspace_id
  AND e.kind='SUCCEEDED' AND e.facts_sha256='sha256:'||encode(sha256(convert_to(r.id::text||':SUCCEEDED:'||a.result_receipt_sha256,'UTF8')),'hex')
 WHERE run.id=target AND run.account_id=public.videoforge_current_account_id()
  AND a.kind='RENDER' AND a.execution_backend='RUNPOD_POD' AND a.state='SUCCEEDED' AND a.cancellation_requested_at IS NULL
  AND a.terminal_at>=j.claimed_at AND a.result_receipt_sha256 IS NOT NULL
  AND a.execution_bundle_sha256=run.execution_bundle_sha256 AND a.image_digest=r.source_sha256 AND a.execution_bundle_sha256=r.source_sha256
  AND a.submission_idempotency_key='render-only:'||a.id::text AND j.claim_ordinal=1 AND r.span_job_count=1
  AND r.state='CLEAN' AND r.cleanup_verified_at IS NOT NULL AND r.launch_outcome='CONFIRMED' AND r.verified_at IS NOT NULL
  AND r.pod_id IS NOT NULL AND r.fence_id IS NOT NULL AND public.videoforge_render_only_source_valid(run.id));
$$;
REVOKE ALL ON FUNCTION public.videoforge_render_only_completion_proven(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.videoforge_read_v209_render_terminal_candidate(supplied_account_id uuid,supplied_workspace_id uuid,supplied_attempt_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE account uuid:=supplied_account_id; workspace uuid:=supplied_workspace_id; target uuid:=supplied_attempt_id; run public.hosted_render_only_runs%ROWTYPE; candidate jsonb; lease public.provider_workload_leases%ROWTYPE;
 request public.generation_requests%ROWTYPE; receipt public.artifact_receipts%ROWTYPE;
BEGIN
 IF public.videoforge_current_account_id() IS DISTINCT FROM account THEN RAISE EXCEPTION 'render-only terminal tenant rejected' USING ERRCODE='42501'; END IF;
 SELECT * INTO run FROM public.hosted_render_only_runs r WHERE r.id=target AND r.account_id=account AND r.workspace_id=workspace;
 IF run.id IS NULL THEN RETURN public.videoforge_read_v209_render_terminal_legacy222(account,workspace,target); END IF;
 IF run.state NOT IN('PREPARING','SUCCEEDED') OR NOT public.videoforge_render_only_completion_proven(target) THEN RETURN NULL; END IF;
 candidate:=public.videoforge_read_v209_render_terminal_legacy222(account,workspace,target);
 SELECT * INTO request FROM public.generation_requests g WHERE g.id=run.generation_request_id AND g.account_id=account AND g.workspace_id=workspace;
 SELECT * INTO lease FROM public.provider_workload_leases l WHERE l.generation_request_id=request.id AND l.account_id=account AND l.workspace_id=workspace;
 SELECT * INTO receipt FROM public.artifact_receipts r WHERE r.id=run.output_receipt_id AND r.account_id=account AND r.workspace_id=workspace AND r.deleted_at IS NULL;
 IF candidate IS NULL OR lease.id IS NULL OR lease.request_kind<>'VIDEO' OR
 (run.state='PREPARING' AND (request.state<>'ACTIVE' OR lease.state<>'ACTIVE')) OR
 (run.state='SUCCEEDED' AND (request.state<>'SUCCEEDED' OR lease.state<>'RELEASED' OR receipt.id IS NULL)) THEN RETURN NULL; END IF;
 RETURN candidate||jsonb_build_object('renderOnlyRun',true,'renderOnlyState',run.state,'generationRequestId',request.id,
  'generationRequestState',request.state,'leaseId',lease.id,'leaseState',lease.state,'leaseReleaseReason',lease.release_reason,
  'leaseCount',(SELECT count(*) FROM public.provider_workload_leases l WHERE l.generation_request_id=request.id),
  'renderAttemptCount',1,'runtimeCount',1,'finalOutputSha256',run.final_output->>'checksumSha256',
  'finalEventCount',CASE WHEN run.state='SUCCEEDED' THEN 1 ELSE 0 END,'finalReceiptSha256',receipt.receipt_sha256,
  'finalArtifact',run.final_output);
END; $$;

CREATE FUNCTION public.videoforge_finalize_cloud_render_only_run(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
#variable_conflict use_variable
DECLARE account_id uuid; workspace_id uuid; attempt_id uuid; output jsonb; probe jsonb;
 run public.hosted_render_only_runs%ROWTYPE; attempt public.hosted_cpu_job_attempts%ROWTYPE;
 plan public.hosted_render_plans%ROWTYPE; primary_output public.hosted_cpu_upload_authorities%ROWTYPE;
 result_output public.hosted_cpu_upload_authorities%ROWTYPE; request public.generation_requests%ROWTYPE;
 lease public.provider_workload_leases%ROWTYPE; reservation public.artifact_reservations%ROWTYPE;
 receipt public.artifact_receipts%ROWTYPE; reservation_id uuid; receipt_id uuid; receipt_sha text; receipt_facts jsonb;
 initial_path boolean; db_now timestamptz:=transaction_timestamp();
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)<>
        ARRAY['accountId','attemptId','finalOutput','schemaVersion','workspaceId']::text[]
     OR supplied->>'schemaVersion'<>'videoforge.v2-09-render-terminal-finalize/v1'
     OR jsonb_typeof(supplied->'finalOutput')<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied->'finalOutput') key)<>
        ARRAY['assetId','checksumSha256','contentLength','contentType','objectKey','probe',
          'renderManifestSha256','resultDocumentSha256']::text[] THEN
    RAISE EXCEPTION 'V2-09 render terminal request invalid' USING ERRCODE='23514';
  END IF;
  account_id:=(supplied->>'accountId')::uuid;
  workspace_id:=(supplied->>'workspaceId')::uuid;
  attempt_id:=(supplied->>'attemptId')::uuid;
  output:=supplied->'finalOutput'; probe:=output->'probe';
  IF output->>'contentType'<>'video/mp4'
     OR output->>'assetId' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
     OR output->>'checksumSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR output->>'resultDocumentSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR output->>'renderManifestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(output->'contentLength')<>'number'
     OR (output->>'contentLength')::numeric<>trunc((output->>'contentLength')::numeric)
     OR (output->>'contentLength')::numeric<1
     OR (output->>'contentLength')::numeric>9223372036854775807
     OR jsonb_typeof(probe)<>'object'
     OR probe->>'schema_version'<>'technical-probe/v1'
     OR probe->>'asset_id'<>output->>'assetId'
     OR probe->>'sha256'<>output->>'checksumSha256'
     OR jsonb_typeof(probe->'bytes')<>'number'
     OR (probe->>'bytes')::numeric<>trunc((probe->>'bytes')::numeric)
     OR (probe->>'bytes')::numeric<1
     OR (probe->>'bytes')::bigint<>(output->>'contentLength')::bigint
     OR jsonb_typeof(probe->'duration_ms')<>'number'
     OR (probe->>'duration_ms')::numeric<>trunc((probe->>'duration_ms')::numeric)
     OR (probe->>'duration_ms')::bigint<1
     OR jsonb_typeof(probe->'total_frames')<>'number'
     OR (probe->>'total_frames')::numeric<>trunc((probe->>'total_frames')::numeric)
     OR (probe->>'total_frames')::bigint<1
     OR probe->>'container'<>'mp4' OR probe->>'decode_ok'<>'true'
     OR jsonb_typeof(probe->'decode_ok')<>'boolean'
     OR probe#>>'{video,codec}'<>'h264' OR probe#>>'{video,pixel_format}'<>'yuv420p'
     OR probe#>>'{video,width}'<>'1920' OR probe#>>'{video,height}'<>'1080'
     OR probe#>>'{video,fps_num}'<>'30' OR probe#>>'{video,fps_den}'<>'1'
     OR probe#>>'{audio,codec}'<>'aac' OR probe#>>'{audio,sample_rate_hz}'<>'48000'
     OR probe#>>'{stream_counts,video}'<>'1' OR probe#>>'{stream_counts,audio}'<>'1'
     OR probe#>>'{stream_counts,subtitle}'<>'0' OR probe#>>'{stream_counts,data}'<>'0' THEN
    RAISE EXCEPTION 'V2-09 render terminal output invalid' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(account_id::text||':'||attempt_id::text,20983));
  IF public.videoforge_current_account_id() IS DISTINCT FROM account_id THEN RAISE EXCEPTION 'render-only terminal tenant rejected' USING ERRCODE='42501'; END IF;

 SELECT * INTO run FROM public.hosted_render_only_runs r WHERE r.id=attempt_id AND r.account_id=account_id AND r.workspace_id=workspace_id FOR UPDATE;
 IF run.id IS NULL OR NOT public.videoforge_render_only_completion_proven(attempt_id) THEN RAISE EXCEPTION 'render-only completion proof rejected' USING ERRCODE='42501'; END IF;
 SELECT * INTO attempt FROM public.hosted_cpu_job_attempts a WHERE a.id=run.id FOR UPDATE;
 SELECT * INTO plan FROM public.hosted_render_plans p WHERE p.account_id=account_id AND p.workspace_id=workspace_id AND p.project_id=run.project_id AND p.project_revision_id=run.project_revision_id;
 SELECT * INTO primary_output FROM public.hosted_cpu_upload_authorities a WHERE a.attempt_id=run.id AND a.account_id=account_id AND a.workspace_id=workspace_id AND a.source='PRIMARY_RESULT_OUTPUT';
 SELECT * INTO result_output FROM public.hosted_cpu_upload_authorities a WHERE a.attempt_id=run.id AND a.account_id=account_id AND a.workspace_id=workspace_id AND a.source='RESULT_DOCUMENT';
 SELECT * INTO request FROM public.generation_requests g WHERE g.id=run.generation_request_id FOR UPDATE;
 SELECT * INTO lease FROM public.provider_workload_leases l WHERE l.generation_request_id=request.id FOR UPDATE;
 IF primary_output.issued_at IS NULL OR result_output.issued_at IS NULL
  OR attempt.result_object_key IS DISTINCT FROM result_output.object_key OR attempt.result_content_length IS DISTINCT FROM result_output.issued_content_length
  OR attempt.result_checksum_sha256 IS DISTINCT FROM result_output.issued_checksum_sha256 OR attempt.result_checksum_sha256 IS DISTINCT FROM output->>'resultDocumentSha256'
  OR primary_output.object_key IS DISTINCT FROM output->>'objectKey' OR primary_output.content_type IS DISTINCT FROM 'video/mp4'
  OR primary_output.issued_content_length IS DISTINCT FROM (output->>'contentLength')::bigint OR primary_output.issued_checksum_sha256 IS DISTINCT FROM output->>'checksumSha256'
  OR plan.payload_sha256 IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(plan.payload),'UTF8')),'hex')
  OR attempt.request_sha256 IS DISTINCT FROM public.videoforge_hosted_cpu_submission_request_sha256(plan.payload)
  OR plan.payload#>>'{input_document,resolved_render_manifest,sha256}' IS DISTINCT FROM output->>'renderManifestSha256'
  OR lease.id IS NULL OR lease.request_kind<>'VIDEO' OR (SELECT count(*) FROM public.provider_workload_leases l WHERE l.generation_request_id=request.id)<>1
  OR NOT ((run.state='PREPARING' AND request.state='ACTIVE' AND lease.state='ACTIVE') OR
          (run.state='SUCCEEDED' AND request.state='SUCCEEDED' AND lease.state='RELEASED' AND run.final_output=output)) THEN
  RAISE EXCEPTION 'render-only output lineage rejected' USING ERRCODE='23514'; END IF;
 reservation_id:=md5('render-only-final-reservation:'||attempt.id::text)::uuid;
 receipt_id:=md5('render-only-final-receipt:'||attempt.id::text)::uuid;
 receipt_facts:=jsonb_build_object('run',run.id,'sourceAttempt',run.source_attempt_id,'finalOutput',output);
 receipt_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(receipt_facts),'UTF8')),'hex');
 initial_path:=run.state='PREPARING';
 IF initial_path THEN
    INSERT INTO public.artifact_reservations (
      id,account_id,workspace_id,project_id,project_revision_id,lane,job_id,artifact_id,
      object_key,method,content_type,content_length,checksum_sha256,expires_at,max_uses,used_count,
      state,retention_class,deletion_owner_account_id,created_at,updated_at
    ) VALUES (reservation_id,account_id,workspace_id,attempt.project_id,attempt.project_revision_id,
      'RENDER',attempt.id::text,regexp_replace(output->>'objectKey','^.*/artifact/',''),
      output->>'objectKey','PUT','video/mp4',
      (output->>'contentLength')::bigint,output->>'checksumSha256',db_now+interval '1 hour',1,1,
      'COMMITTED','FINAL',account_id,db_now,db_now) ON CONFLICT(id) DO NOTHING;
    INSERT INTO public.artifact_receipts (
      id,account_id,workspace_id,reservation_id,callback_id,object_key,content_type,content_length,
      checksum_sha256,probe,receipt_sha256,committed_at
    ) VALUES (receipt_id,account_id,workspace_id,reservation_id,attempt.id::text,
      output->>'objectKey','video/mp4',(output->>'contentLength')::bigint,
      output->>'checksumSha256',jsonb_build_object(
        'render_manifest_sha256',output->>'renderManifestSha256',
        'render_result_sha256',output->>'resultDocumentSha256','technical_probe',probe,
        'output_asset_id',output->>'assetId',
        'width',1920,'height',1080,'video_codec','h264','audio_codec','aac',
        'duration_ms',(probe->>'duration_ms')::bigint,'total_frames',(probe->>'total_frames')::bigint,
        'renderer','ffmpeg-render-v3'),receipt_sha,db_now) ON CONFLICT(id) DO NOTHING;
  END IF;
  SELECT * INTO reservation FROM public.artifact_reservations row WHERE row.id=reservation_id;
  SELECT * INTO receipt FROM public.artifact_receipts row WHERE row.id=receipt_id;
  IF reservation.id IS NULL OR receipt.id IS NULL OR reservation.account_id<>account_id
     OR reservation.workspace_id<>workspace_id OR reservation.project_id<>attempt.project_id
     OR reservation.project_revision_id<>attempt.project_revision_id OR reservation.lane<>'RENDER'
     OR reservation.job_id<>attempt.id::text
     OR reservation.artifact_id<>regexp_replace(output->>'objectKey','^.*/artifact/','')
     OR reservation.object_key<>output->>'objectKey' OR reservation.content_type<>'video/mp4'
     OR reservation.content_length<>(output->>'contentLength')::bigint
     OR reservation.checksum_sha256<>output->>'checksumSha256'
     OR reservation.state<>'COMMITTED' OR reservation.retention_class<>'FINAL'
     OR receipt.reservation_id<>reservation.id OR receipt.deleted_at IS NOT NULL
     OR receipt.object_key<>output->>'objectKey' OR receipt.content_type<>'video/mp4'
     OR receipt.content_length<>(output->>'contentLength')::bigint
     OR receipt.checksum_sha256<>output->>'checksumSha256'
     OR receipt.receipt_sha256<>receipt_sha
     OR receipt.probe->>'render_manifest_sha256'<>output->>'renderManifestSha256'
     OR receipt.probe->>'render_result_sha256'<>output->>'resultDocumentSha256'
     OR receipt.probe->>'output_asset_id'<>output->>'assetId'
     OR receipt.probe->'technical_probe'<>probe THEN
    RAISE EXCEPTION 'V2-09 FINAL receipt replay drifted' USING ERRCODE='23514';
  END IF;

 IF initial_path THEN
  UPDATE public.hosted_render_only_runs SET state='SUCCEEDED',output_receipt_id=receipt.id,final_output=output,terminal_at=db_now WHERE id=run.id;
  UPDATE public.provider_workload_leases SET state='RELEASED',released_at=db_now,release_reason='HOSTED_API_OUTPUTS_ACCEPTED',version=version+1 WHERE id=lease.id AND state='ACTIVE';
  UPDATE public.generation_requests SET state='SUCCEEDED',terminal_at=db_now,version=version+1,updated_at=db_now WHERE id=request.id AND state='ACTIVE';
 END IF;
 RETURN jsonb_build_object('schemaVersion','videoforge.v2-09-render-terminal-result/v1','state','SUCCEEDED',
  'accountId',account_id,'workspaceId',workspace_id,'generationRequestId',request.id,'runtimeId',run.source_runtime_id,
  'renderAttemptId',run.id,'finalOutputSha256',output->>'checksumSha256','finalOutputReceiptSha256',receipt_sha,'replayed',NOT initial_path);
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_finalize_cloud_render_only_run(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.videoforge_finalize_v209_render_terminal(supplied jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.hosted_render_only_runs r WHERE r.id=(supplied->>'attemptId')::uuid AND r.account_id=public.videoforge_current_account_id()) THEN
  RETURN public.videoforge_finalize_cloud_render_only_run(supplied);
 END IF;
 RETURN public.videoforge_finalize_v209_render_terminal_legacy222(supplied);
END; $$;

-- New-project account scope is explicit, finite, operator-only and disabled on every historical authority.
ALTER TABLE public.cloud_media_budget_authorities ADD COLUMN allow_new_cloud_projects boolean NOT NULL DEFAULT false;
ALTER TABLE public.cloud_media_budget_authorities ADD COLUMN max_reservations integer CHECK(max_reservations>0);
CREATE FUNCTION public.videoforge_cloud_media_new_project_ready(authority_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.cloud_media_budget_authorities b WHERE b.id=$1
  AND b.allow_new_cloud_projects AND b.enabled AND b.expires_at>now()
  AND public.videoforge_current_account_id()=ANY(b.allowed_account_ids)
  AND b.max_reservations IS NOT NULL AND b.debited_usd+b.max_reservation_usd<=b.total_cap_usd
  AND (SELECT count(*) FROM public.cloud_media_reservations r WHERE r.budget_authority_id=b.id)<b.max_reservations);
$$;
REVOKE ALL ON FUNCTION public.videoforge_cloud_media_new_project_ready(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_cloud_media_new_project_ready(uuid) TO videoforge_v209_runtime_dc9612d6;
CREATE FUNCTION public.videoforge_cloud_media_authority_project_allowed(authority_id uuid,account_id uuid,project_id uuid,revision_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.cloud_media_budget_authorities b WHERE b.id=$1 AND $2=ANY(b.allowed_account_ids)
  AND $2=public.videoforge_current_account_id() AND ($3=ANY(b.allowed_project_ids) OR (b.allow_new_cloud_projects
   AND b.max_reservations IS NOT NULL AND EXISTS(SELECT 1 FROM public.projects p JOIN public.project_revisions r
    ON r.project_id=p.id AND r.account_id=p.account_id AND r.workspace_id=p.workspace_id
    WHERE p.id=$3 AND p.account_id=$2 AND r.id=$4 AND r.status='LOCKED' AND r.media_execution_backend='RUNPOD_POD'))));
$$;
REVOKE ALL ON FUNCTION public.videoforge_cloud_media_authority_project_allowed(uuid,uuid,uuid,uuid) FROM PUBLIC;
DO $budget$
DECLARE definition text; marker text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_cloud_media_reserve_budget(uuid)'::regprocedure) INTO definition;
 marker:='OR NOT r.account_id=ANY(authority.allowed_account_ids) OR NOT r.project_id=ANY(authority.allowed_project_ids)';
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'render-only budget preimage mismatch'; END IF;
 definition:=replace(definition,marker,'OR NOT public.videoforge_cloud_media_authority_project_allowed(authority.id,r.account_id,r.project_id,r.project_revision_id)');
 marker:='IF authority.debited_usd+r.budget_usd>authority.total_cap_usd THEN';
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'render-only budget count preimage mismatch'; END IF;
 definition:=replace(definition,marker,$new$IF authority.max_reservations IS NOT NULL AND
  (SELECT count(*) FROM public.cloud_media_reservations other WHERE other.budget_authority_id=authority.id AND other.id<>r.id)>=authority.max_reservations THEN
  RAISE EXCEPTION 'cloud finite reservation count exhausted' USING ERRCODE='55000'; END IF;
 IF authority.debited_usd+r.budget_usd>authority.total_cap_usd THEN$new$);
 EXECUTE definition;
 SELECT pg_get_functiondef('public.videoforge_cloud_media_reservation_authority(uuid,uuid,uuid)'::regprocedure) INTO definition;
 marker:='r.account_id=ANY(b.allowed_account_ids) AND r.project_id=ANY(b.allowed_project_ids)';
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'render-only authority projection preimage mismatch'; END IF;
 EXECUTE replace(definition,marker,'public.videoforge_cloud_media_authority_project_allowed(b.id,r.account_id,r.project_id,r.project_revision_id)');
END; $budget$;

CREATE FUNCTION public.videoforge_cloud_media_reservation_count_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE approved_limit integer;
BEGIN
 SELECT b.max_reservations INTO approved_limit FROM public.cloud_media_budget_authorities b WHERE b.id=NEW.budget_authority_id FOR UPDATE;
 IF NOT public.videoforge_cloud_media_authority_project_allowed(NEW.budget_authority_id,NEW.account_id,NEW.project_id,NEW.project_revision_id) THEN
  RAISE EXCEPTION 'cloud reservation approved owner scope rejected' USING ERRCODE='42501'; END IF;
 IF approved_limit IS NOT NULL AND (SELECT count(*) FROM public.cloud_media_reservations r WHERE r.budget_authority_id=NEW.budget_authority_id)>=approved_limit THEN
  RAISE EXCEPTION 'cloud finite reservation count exhausted' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_cloud_media_reservation_count_guard() FROM PUBLIC;
CREATE TRIGGER cloud_media_reservation_count_guard BEFORE INSERT ON public.cloud_media_reservations
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_cloud_media_reservation_count_guard();

-- Project Cancel handles only the new run; active media uses the existing exact CPU Cancel.
DO $cancel$
DECLARE definition text; marker text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_cancel_hosted_project_predispatch(uuid,uuid,uuid)'::regprocedure) INTO definition;
 marker:=$old$  SELECT count(*) INTO request_count
    FROM public.generation_requests request$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'render-only cancel preimage mismatch'; END IF;
 definition:=replace(definition,marker,$new$  IF EXISTS(SELECT 1 FROM public.hosted_render_only_runs run JOIN public.generation_requests g ON g.id=run.generation_request_id
    WHERE run.account_id=supplied_account_id AND run.workspace_id=supplied_workspace_id AND run.project_id=supplied_project_id
      AND run.state='PREPARING' AND g.state IN('WAITING','RETRY_WAIT','ADMITTED','ACTIVE','CANCELLING')) THEN
    SELECT g.* INTO target_request FROM public.hosted_render_only_runs run JOIN public.generation_requests g ON g.id=run.generation_request_id
    WHERE run.account_id=supplied_account_id AND run.workspace_id=supplied_workspace_id AND run.project_id=supplied_project_id
      AND run.state='PREPARING' AND g.state IN('WAITING','RETRY_WAIT','ADMITTED','ACTIVE','CANCELLING') FOR UPDATE OF g;
    IF EXISTS(SELECT 1 FROM public.hosted_cpu_job_attempts a JOIN public.hosted_render_only_runs run ON run.id=a.id
       WHERE run.generation_request_id=target_request.id AND (a.state NOT IN('FAILED','CANCELLED','EXPIRED') OR a.result_receipt_sha256 IS NOT NULL))
      OR EXISTS(SELECT 1 FROM public.cloud_media_reservations r WHERE r.account_id=supplied_account_id AND r.project_id=supplied_project_id
        AND (r.state<>'CLEAN' OR r.cleanup_verified_at IS NULL)) THEN
      RAISE EXCEPTION 'hosted project CPU cancellation required' USING ERRCODE='55000'; END IF;
    UPDATE public.provider_workload_leases l SET state='RELEASED',released_at=db_now,release_reason='OWNER_CANCELLED_BEFORE_PROVIDER_DISPATCH',version=version+1
      WHERE l.generation_request_id=target_request.id AND l.state='ACTIVE';
    UPDATE public.generation_requests g SET state='CANCELLED',terminal_at=db_now,version=version+1,updated_at=db_now WHERE g.id=target_request.id;
    UPDATE public.hosted_render_only_runs run SET state='CANCELLED',terminal_at=db_now WHERE run.generation_request_id=target_request.id;
    project_id:=supplied_project_id; generation_request_id:=target_request.id; state:='CANCELLED'; replayed:=false; RETURN NEXT; RETURN;
  END IF;
  SELECT count(*) INTO request_count
    FROM public.generation_requests request$new$);
 EXECUTE definition;
END; $cancel$;

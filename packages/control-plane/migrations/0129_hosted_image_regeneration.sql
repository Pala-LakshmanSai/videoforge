-- Isolated scene attempts retain the ordinary accepted output and its provenance.
CREATE TABLE public.hosted_image_regeneration_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL, workspace_id uuid NOT NULL,
 project_id uuid NOT NULL, project_revision_id uuid NOT NULL, image_task_id uuid NOT NULL,
 source_attempt_id uuid NOT NULL, generation_request_id uuid NOT NULL,
 attempt_id uuid NOT NULL DEFAULT gen_random_uuid(), output_reservation_id uuid NOT NULL DEFAULT gen_random_uuid(),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
 edited_prompt text NOT NULL CHECK(length(btrim(edited_prompt)) BETWEEN 1 AND 12000),
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','PREPARED','SENT','ASSIGNED','DISPATCH_ACK_UNKNOWN','REQUEST_REJECTED','COMPLETED','FAILED','CANCELLED')),
 request_body jsonb, envelope jsonb, request_hash text, envelope_hash text, lineage jsonb,
 dispatch_token text, endpoint_id_sha256 text, provider_job_id text, accepted jsonb,
 lease_id uuid, deadline_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,workspace_id,idempotency_key), UNIQUE(attempt_id),
 FOREIGN KEY(account_id,workspace_id,project_id) REFERENCES projects(account_id,workspace_id,id),
 FOREIGN KEY(account_id,workspace_id,project_revision_id) REFERENCES project_revisions(account_id,workspace_id,id),
 FOREIGN KEY(workspace_id,image_task_id) REFERENCES generation_tasks(workspace_id,id),
 FOREIGN KEY(account_id,workspace_id,source_attempt_id) REFERENCES serverless_attempts(account_id,workspace_id,id),
 FOREIGN KEY(account_id,workspace_id,generation_request_id) REFERENCES generation_requests(account_id,workspace_id,id),
 FOREIGN KEY(account_id,workspace_id,lease_id) REFERENCES provider_workload_leases(account_id,workspace_id,id),
 CHECK (request_hash IS NULL OR request_hash ~ '^sha256:[0-9a-f]{64}$'),
 CHECK (envelope_hash IS NULL OR envelope_hash ~ '^sha256:[0-9a-f]{64}$')
);
-- Regeneration owns a distinct workload identity; it must never reopen the original video.
ALTER TABLE public.hosted_image_regeneration_requests ADD UNIQUE(account_id,workspace_id,id);
ALTER TABLE public.provider_workload_leases ADD COLUMN image_regeneration_request_id uuid,
 ADD FOREIGN KEY(account_id,workspace_id,image_regeneration_request_id) REFERENCES public.hosted_image_regeneration_requests(account_id,workspace_id,id);
DO $$ DECLARE constraint_name text; BEGIN
 FOR constraint_name IN SELECT conname FROM pg_constraint WHERE conrelid='public.provider_workload_leases'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%request_kind%' LOOP
  EXECUTE format('ALTER TABLE public.provider_workload_leases DROP CONSTRAINT %I',constraint_name);
 END LOOP;
END $$;
ALTER TABLE public.provider_workload_leases ADD CONSTRAINT provider_workload_lease_request_identity CHECK(
 (request_kind='VIDEO' AND generation_request_id IS NOT NULL AND preset_preview_request_id IS NULL AND image_regeneration_request_id IS NULL) OR
 (request_kind='PRESET_PREVIEW' AND preset_preview_request_id IS NOT NULL AND generation_request_id IS NULL AND image_regeneration_request_id IS NULL) OR
 (request_kind='IMAGE_REGENERATION' AND image_regeneration_request_id IS NOT NULL AND generation_request_id IS NULL AND preset_preview_request_id IS NULL)
);
CREATE UNIQUE INDEX hosted_image_regeneration_active_task ON public.hosted_image_regeneration_requests(account_id,workspace_id,image_task_id) WHERE state IN ('QUEUED','PREPARED','SENT','ASSIGNED','DISPATCH_ACK_UNKNOWN');
CREATE INDEX hosted_image_regeneration_project ON public.hosted_image_regeneration_requests(account_id,workspace_id,project_id,image_task_id,updated_at DESC);
ALTER TABLE public.hosted_image_regeneration_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_image_regeneration_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_image_regeneration_owner ON public.hosted_image_regeneration_requests USING(account_id=public.videoforge_current_account_id()) WITH CHECK(account_id=public.videoforge_current_account_id());
REVOKE ALL ON public.hosted_image_regeneration_requests FROM PUBLIC;

CREATE FUNCTION public.videoforge_create_hosted_image_regeneration(a uuid,w uuid,p uuid,r uuid,t uuid,prompt text,k text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE found_row public.hosted_image_regeneration_requests%ROWTYPE; source_row record;
BEGIN
 IF public.videoforge_current_account_id() IS DISTINCT FROM a OR length(btrim(prompt)) NOT BETWEEN 1 AND 12000 OR length(k) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid regeneration scope or prompt' USING ERRCODE='23514'; END IF;
 -- Shared lock also serializes ordinary admission and idempotent creates.
 PERFORM 1 FROM global_generation_capacity WHERE singleton FOR UPDATE;
 SELECT * INTO found_row FROM hosted_image_regeneration_requests WHERE account_id=a AND workspace_id=w AND idempotency_key=k;
 IF FOUND THEN
  IF found_row.project_id<>p OR found_row.project_revision_id<>r OR found_row.image_task_id<>t OR found_row.edited_prompt<>prompt THEN RAISE EXCEPTION 'regeneration idempotency conflict' USING ERRCODE='23505'; END IF;
  RETURN to_jsonb(found_row);
 END IF;
 SELECT attempt.id,attempt.generation_request_id INTO source_row
 FROM projects project JOIN project_revisions revision ON revision.account_id=a AND revision.workspace_id=w AND revision.project_id=project.id
 JOIN generation_tasks task ON task.account_id=a AND task.workspace_id=w AND task.project_revision_id=revision.id AND task.id=t AND task.lane='IMAGE'
 JOIN video_runtime_accepted_units unit ON unit.account_id=a AND unit.workspace_id=w AND unit.project_revision_id=r AND unit.item_id=t::text AND unit.lane='mage_image'
 JOIN serverless_attempts attempt ON attempt.account_id=a AND attempt.workspace_id=w AND attempt.id=unit.accepted_attempt_id AND attempt.project_id=p AND attempt.project_revision_id=r
 JOIN artifact_reservations reservation ON reservation.account_id=a AND reservation.workspace_id=w AND reservation.project_id=p AND reservation.project_revision_id=r AND reservation.job_id=attempt.id::text AND reservation.artifact_id=t::text AND reservation.object_key=unit.object_key AND reservation.state='COMMITTED'
 JOIN artifact_receipts receipt ON receipt.account_id=a AND receipt.workspace_id=w AND receipt.reservation_id=reservation.id AND receipt.deleted_at IS NULL AND receipt.checksum_sha256=unit.checksum_sha256 AND receipt.content_length=unit.content_length
 WHERE project.account_id=a AND project.workspace_id=w AND project.id=p AND project.status='ACTIVE' AND revision.id=r AND revision.status='LOCKED'
 AND NOT EXISTS(SELECT 1 FROM project_revisions newer WHERE newer.account_id=a AND newer.workspace_id=w AND newer.project_id=p AND newer.revision_number>revision.revision_number);
 IF NOT FOUND THEN RAISE EXCEPTION 'current accepted scene not found' USING ERRCODE='02000'; END IF;
 INSERT INTO hosted_image_regeneration_requests(account_id,workspace_id,project_id,project_revision_id,image_task_id,source_attempt_id,generation_request_id,idempotency_key,edited_prompt)
 VALUES(a,w,p,r,t,source_row.id,source_row.generation_request_id,k,prompt) RETURNING * INTO found_row;
 RETURN to_jsonb(found_row);
END $$;

CREATE FUNCTION public.videoforge_get_hosted_image_regeneration(a uuid,w uuid,p uuid,t uuid,req uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT to_jsonb(r) FROM hosted_image_regeneration_requests r WHERE r.id=req AND r.account_id=a AND r.workspace_id=w AND r.project_id=p AND r.image_task_id=t AND a=public.videoforge_current_account_id()
$$;

CREATE FUNCTION public.videoforge_prepare_hosted_image_regeneration(req uuid,body jsonb,env jsonb,body_hash text,env_hash text,prepared_lineage jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE r hosted_image_regeneration_requests%ROWTYPE; chosen_slot integer; lease uuid:=gen_random_uuid(); until_at timestamptz;
BEGIN
 PERFORM 1 FROM global_generation_capacity WHERE singleton FOR UPDATE;
 SELECT * INTO r FROM hosted_image_regeneration_requests WHERE id=req AND account_id=public.videoforge_current_account_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'regeneration not found' USING ERRCODE='02000'; END IF;
 IF r.state<>'QUEUED' THEN
  IF r.request_hash IS DISTINCT FROM body_hash OR r.envelope_hash IS DISTINCT FROM env_hash THEN RAISE EXCEPTION 'immutable regeneration request changed' USING ERRCODE='23505'; END IF;
  RETURN to_jsonb(r);
 END IF;
 until_at:=(env->'limits'->>'expires_at')::timestamptz;
 IF body_hash !~ '^sha256:[0-9a-f]{64}$' OR env_hash !~ '^sha256:[0-9a-f]{64}$'
 OR body_hash IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(body),'UTF8')),'hex')
 OR env_hash IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(env),'UTF8')),'hex')
 OR body->'envelope' IS DISTINCT FROM env
 OR env->'tenant'->>'account_id' IS DISTINCT FROM r.account_id::text OR env->'tenant'->>'workspace_id' IS DISTINCT FROM r.workspace_id::text
 OR env->'work'->>'attempt_id' IS DISTINCT FROM r.attempt_id::text OR env->'work'->>'project_revision_id' IS DISTINCT FROM r.project_revision_id::text
 OR env->'work'->>'lane' IS DISTINCT FROM 'mage_image' OR (env->'work'->>'item_count')::int<>1
 OR until_at<=now() OR until_at>now()+interval '1 hour' THEN RAISE EXCEPTION 'invalid prepared regeneration' USING ERRCODE='23514'; END IF;
 SELECT s INTO chosen_slot FROM generate_series(1,2) s WHERE NOT EXISTS(SELECT 1 FROM provider_workload_leases l WHERE l.slot=s AND l.state='ACTIVE') ORDER BY s LIMIT 1;
 IF chosen_slot IS NULL OR EXISTS(SELECT 1 FROM provider_workload_leases WHERE account_id=r.account_id AND state='ACTIVE') THEN RAISE EXCEPTION 'provider capacity occupied' USING ERRCODE='55P03'; END IF;
 INSERT INTO provider_workload_leases(id,slot,account_id,workspace_id,request_kind,image_regeneration_request_id,owner_token_sha256,state,acquired_at,heartbeat_at,expires_at)
 VALUES(lease,chosen_slot,r.account_id,r.workspace_id,'IMAGE_REGENERATION',r.id,body_hash,'ACTIVE',now(),now(),until_at);
 UPDATE hosted_image_regeneration_requests SET state='PREPARED',request_body=body,envelope=env,request_hash=body_hash,envelope_hash=env_hash,lineage=prepared_lineage,dispatch_token=env->>'dispatch_token',endpoint_id_sha256=prepared_lineage->'binding'->>'endpointIdSha256',lease_id=lease,deadline_at=until_at,updated_at=now() WHERE id=req RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;

CREATE FUNCTION public.videoforge_image_regeneration_transition(req uuid,next_state text,job text,expected_body text DEFAULT NULL,expected_envelope text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE r hosted_image_regeneration_requests%ROWTYPE; acquired boolean:=false;
BEGIN
 SELECT * INTO r FROM hosted_image_regeneration_requests WHERE id=req AND account_id=public.videoforge_current_account_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'regeneration not found' USING ERRCODE='02000'; END IF;
 IF next_state='SENT' AND r.state='PREPARED' THEN
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

CREATE FUNCTION public.videoforge_commit_hosted_image_regeneration(req uuid,artifact jsonb,receipt_hash text,provenance jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE r hosted_image_regeneration_requests%ROWTYPE; receipt_id uuid:=gen_random_uuid(); expected_key text;
BEGIN
 SELECT * INTO r FROM hosted_image_regeneration_requests WHERE id=req AND account_id=public.videoforge_current_account_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'regeneration not found' USING ERRCODE='02000'; END IF;
 IF r.state='COMPLETED' THEN
  IF r.accepted->>'receiptSha256' IS DISTINCT FROM receipt_hash THEN RAISE EXCEPTION 'regeneration receipt conflict' USING ERRCODE='23505'; END IF;
  RETURN to_jsonb(r);
 END IF;
 expected_key:='tenant/'||r.account_id||'/workspace/'||r.workspace_id||'/project/'||r.project_id||'/revision/'||r.project_revision_id||'/lane/mage-image/job/'||r.attempt_id||'/artifact/'||r.image_task_id;
 IF r.state<>'ASSIGNED' OR artifact->>'itemId' IS DISTINCT FROM r.image_task_id::text OR artifact->>'reservationId' IS DISTINCT FROM r.output_reservation_id::text OR artifact->>'objectKey' IS DISTINCT FROM expected_key OR artifact->>'contentType' IS DISTINCT FROM 'image/png' OR (artifact->>'contentLength')::bigint<=0 THEN RAISE EXCEPTION 'regeneration artifact binding rejected' USING ERRCODE='23514'; END IF;
 INSERT INTO artifact_reservations(id,account_id,workspace_id,project_id,project_revision_id,lane,job_id,artifact_id,object_key,method,content_type,content_length,checksum_sha256,expires_at,max_uses,used_count,state,retention_class,retain_until,deletion_owner_account_id)
 VALUES(r.output_reservation_id,r.account_id,r.workspace_id,r.project_id,r.project_revision_id,'MAGE_IMAGE',r.attempt_id::text,r.image_task_id::text,expected_key,'PUT','image/png',(artifact->>'contentLength')::bigint,artifact->>'checksumSha256',r.deadline_at,1,1,'COMMITTED','PROJECT',NULL,r.account_id);
 INSERT INTO artifact_receipts(id,account_id,workspace_id,reservation_id,callback_id,object_key,content_type,content_length,checksum_sha256,probe,receipt_sha256,committed_at)
 VALUES(receipt_id,r.account_id,r.workspace_id,r.output_reservation_id,'regen:'||r.id,expected_key,'image/png',(artifact->>'contentLength')::bigint,artifact->>'checksumSha256',artifact->'probe',receipt_hash,now());
 UPDATE hosted_image_regeneration_requests SET state='COMPLETED',accepted=artifact||jsonb_build_object('receiptId',receipt_id,'receiptSha256',receipt_hash,'provenance',provenance),updated_at=now() WHERE id=req RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;

REVOKE ALL ON FUNCTION public.videoforge_create_hosted_image_regeneration(uuid,uuid,uuid,uuid,uuid,text,text),public.videoforge_get_hosted_image_regeneration(uuid,uuid,uuid,uuid,uuid),public.videoforge_prepare_hosted_image_regeneration(uuid,jsonb,jsonb,text,text,jsonb),public.videoforge_image_regeneration_transition(uuid,text,text,text,text),public.videoforge_commit_hosted_image_regeneration(uuid,jsonb,text,jsonb) FROM PUBLIC;


CREATE FUNCTION public.videoforge_load_hosted_image_regeneration(req uuid,w uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT to_jsonb(r)||jsonb_build_object('source_lineage',public.videoforge_read_hosted_v209_terminal_lineage(r.account_id,r.workspace_id,r.source_attempt_id,'mage_image',assignment.provider_job_id))
 FROM hosted_image_regeneration_requests r JOIN serverless_provider_assignments assignment ON assignment.account_id=r.account_id AND assignment.workspace_id=r.workspace_id AND assignment.attempt_id=r.source_attempt_id AND assignment.is_current
 WHERE r.id=req AND r.workspace_id=w AND r.account_id=public.videoforge_current_account_id()
$$;
REVOKE ALL ON FUNCTION public.videoforge_load_hosted_image_regeneration(uuid,uuid) FROM PUBLIC;


CREATE FUNCTION public.videoforge_release_hosted_image_regeneration(req uuid,proof jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE r hosted_image_regeneration_requests%ROWTYPE;
BEGIN
 PERFORM 1 FROM global_generation_capacity WHERE singleton FOR UPDATE;
 SELECT * INTO r FROM hosted_image_regeneration_requests WHERE id=req AND account_id=public.videoforge_current_account_id() FOR UPDATE;
 IF NOT FOUND OR r.state NOT IN ('COMPLETED','FAILED','CANCELLED','REQUEST_REJECTED') OR proof->>'billableWorkers' IS DISTINCT FROM '0' OR proof->>'queuedJobs' IS DISTINCT FROM '0' OR (proof->>'observedAt')::timestamptz<now()-interval '2 minutes' THEN RAISE EXCEPTION 'regeneration drain proof invalid' USING ERRCODE='23514'; END IF;
 UPDATE provider_workload_leases SET state='RELEASED',version=version+1,released_at=now(),release_reason='image regeneration provider absence verified' WHERE id=r.lease_id AND account_id=r.account_id AND state='ACTIVE';
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.videoforge_release_hosted_image_regeneration(uuid,jsonb) FROM PUBLIC;


CREATE FUNCTION public.videoforge_image_regeneration_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'regeneration history is immutable' USING ERRCODE='55000'; END IF;
 IF (to_jsonb(NEW)-ARRAY['state','request_body','envelope','request_hash','envelope_hash','lineage','dispatch_token','endpoint_id_sha256','provider_job_id','accepted','lease_id','deadline_at','updated_at','render_stale']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['state','request_body','envelope','request_hash','envelope_hash','lineage','dispatch_token','endpoint_id_sha256','provider_job_id','accepted','lease_id','deadline_at','updated_at','render_stale'])
 OR (OLD.state<>'QUEUED' AND (to_jsonb(NEW)-ARRAY['state','provider_job_id','accepted','updated_at','render_stale']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','provider_job_id','accepted','updated_at','render_stale']))
 OR (OLD.accepted IS NOT NULL AND NEW.accepted IS DISTINCT FROM OLD.accepted)
 OR (OLD.provider_job_id IS NOT NULL AND NEW.provider_job_id IS DISTINCT FROM OLD.provider_job_id) THEN RAISE EXCEPTION 'regeneration identity is immutable' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hosted_image_regeneration_immutable BEFORE UPDATE OR DELETE ON public.hosted_image_regeneration_requests FOR EACH ROW EXECUTE FUNCTION public.videoforge_image_regeneration_identity_guard();

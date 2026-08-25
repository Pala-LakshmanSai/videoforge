-- Narrow runtime executor for the atomic 0042 pair. Provider transport remains outside PostgreSQL;
-- these SECURITY DEFINER functions are the only runtime-role mutation capability.

CREATE TABLE public.hosted_pair_runtime_states (
  generation_request_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  phase text NOT NULL CHECK (phase IN (
    'MAGE_READY','MAGE_SENT','MAGE_ASSIGNED','SOULX_SENT','BOTH_ASSIGNED','CLEANUP_ONLY','SETTLED'
  )),
  cleanup_reason text CHECK (length(cleanup_reason) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE(account_id,workspace_id,generation_request_id),
  FOREIGN KEY(account_id,workspace_id,generation_request_id)
    REFERENCES public.generation_requests(account_id,workspace_id,id),
  CHECK ((phase='CLEANUP_ONLY')=(cleanup_reason IS NOT NULL))
);
CREATE TRIGGER hosted_pair_runtime_states_tenant_write_guard BEFORE INSERT OR UPDATE
  ON public.hosted_pair_runtime_states FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE public.hosted_pair_runtime_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_pair_runtime_states FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_pair_runtime_states_tenant_rls ON public.hosted_pair_runtime_states
  USING(account_id=public.videoforge_current_account_id())
  WITH CHECK(account_id=public.videoforge_current_account_id());
REVOKE ALL ON TABLE public.hosted_pair_runtime_states FROM PUBLIC;

CREATE FUNCTION public.videoforge_hosted_pair_assignment_uuid(supplied_attempt_id uuid)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=public,pg_catalog AS $$
DECLARE digest text;
BEGIN
  digest:=encode(sha256(convert_to('hosted-pair-assignment:'||supplied_attempt_id::text,'UTF8')),'hex');
  digest:=substring(digest,1,12)||'5'||substring(digest,14,3)||'8'||substring(digest,18,15);
  RETURN (substring(digest,1,8)||'-'||substring(digest,9,4)||'-'||substring(digest,13,4)||'-'||substring(digest,17,4)||'-'||substring(digest,21,12))::uuid;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_hosted_pair_assignment_uuid(uuid) FROM PUBLIC;

-- Read-only, freshness-checked projection used to verify both final signed envelopes before the
-- one-shot SENT mutation. The begin function rechecks the returned attempt/hash under its lock.
CREATE FUNCTION public.videoforge_prepare_hosted_pair_send(uuid,uuid,uuid)
RETURNS TABLE(lane text,attempt_id uuid,dispatch_token text,dispatch_token_sha256 text,
  endpoint_id_sha256 text,request_body_sha256 text,deployment_id uuid,expected_envelope_sha256 text,
  attempt_state text,outbox_state text,provider_job_id text,envelope_template jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE prepared_count integer; prepare_allowed boolean;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM $1 THEN
    RAISE EXCEPTION 'hosted pair prepare tenant mismatch' USING ERRCODE='42501';
  END IF;
  SELECT
    (count(*) FILTER(WHERE a.state='OUTBOXED' AND o.state='READY_TO_DISPATCH' AND o.send_attempt_count=0)=2)
    OR (
      count(*) FILTER(WHERE a.lane='mage_image' AND a.state='ASSIGNED' AND o.state='ASSIGNED'
        AND o.send_attempt_count=1 AND s.id IS NOT NULL)=1
      AND count(*) FILTER(WHERE a.lane='soulx_avatar' AND a.state='OUTBOXED'
        AND o.state='READY_TO_DISPATCH' AND o.send_attempt_count=0)=1
    ) INTO prepare_allowed
  FROM public.serverless_attempts a JOIN public.serverless_dispatch_outbox o ON o.attempt_id=a.id
  LEFT JOIN public.serverless_provider_assignments s ON s.attempt_id=a.id AND s.is_current
  WHERE a.account_id=$1 AND a.workspace_id=$2 AND a.generation_request_id=$3;
  IF NOT coalesce(prepare_allowed,false) THEN
    RAISE EXCEPTION 'hosted pair prepare is not sendable' USING ERRCODE='55000';
  END IF;
  RETURN QUERY SELECT recovered.lane,recovered.attempt_id,recovered.dispatch_token,
    recovered.dispatch_token_sha256,p.endpoint_id_sha256,p.request_body_sha256,p.deployment_id,
    p.envelope_sha256,a.state,o.state,s.provider_job_id,b.payload->'envelope'
  FROM public.videoforge_recover_hosted_atomic_pair_tokens($1,$2,$3) recovered
  JOIN public.serverless_predispatch_authorities p ON p.attempt_id=recovered.attempt_id
  JOIN public.serverless_attempts a ON a.id=recovered.attempt_id
  JOIN public.serverless_dispatch_outbox o ON o.attempt_id=a.id
  JOIN public.hosted_lane_batches b ON b.account_id=$1 AND b.workspace_id=$2
    AND b.generation_request_id=$3 AND b.lane=recovered.lane
  LEFT JOIN public.serverless_provider_assignments s ON s.attempt_id=a.id AND s.is_current
  WHERE a.account_id=$1 AND a.workspace_id=$2 AND a.generation_request_id=$3
  ORDER BY CASE recovered.lane WHEN 'mage_image' THEN 1 ELSE 2 END;
  GET DIAGNOSTICS prepared_count=ROW_COUNT;
  IF prepared_count<>2 THEN RAISE EXCEPTION 'hosted pair prepare is not sendable' USING ERRCODE='55000'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_prepare_hosted_pair_send(uuid,uuid,uuid) FROM PUBLIC;

-- Persist SENT before returning the one recoverable token. A crash after this call is cleanup-only;
-- SENT is deliberately never returned as sendable and never transitions back to READY.
CREATE FUNCTION public.videoforge_begin_hosted_pair_send(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_generation_request_id uuid,
  supplied_lane text, supplied_expected_attempt_id uuid, supplied_expected_envelope_sha256 text
) RETURNS TABLE (
  lane text, attempt_id uuid, dispatch_token text, dispatch_token_sha256 text,
  endpoint_id_sha256 text, request_body_sha256 text, deployment_id uuid, phase text,
  expected_envelope_sha256 text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE db_now timestamptz:=transaction_timestamp(); token_key text:=current_setting('videoforge.dispatch_token_key',true);
  pair public.hosted_pair_runtime_states%ROWTYPE; target record; other record; raw_token text; recovered_count integer;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR supplied_lane NOT IN ('mage_image','soulx_avatar') OR token_key IS NULL OR length(token_key)<32 THEN
    RAISE EXCEPTION 'hosted pair send input invalid' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_generation_request_id::text,43));
  -- Reuse 0042's complete DB-time authority predicate before plaintext is exposed or state moves.
  SELECT count(*) INTO recovered_count FROM public.videoforge_recover_hosted_atomic_pair_tokens(
    supplied_account_id,supplied_workspace_id,supplied_generation_request_id);
  IF recovered_count<>2 THEN RAISE EXCEPTION 'hosted pair authority is stale' USING ERRCODE='42501'; END IF;
  SELECT a.id,a.task_id,a.attempt_ordinal,a.reconciliation_deadline_at,a.state attempt_state,a.dispatch_token_sha256,o.state outbox_state,
         o.send_attempt_count,p.endpoint_id_sha256,p.request_body_sha256,p.deployment_id,
         p.envelope_sha256,v.token_ciphertext
    INTO target
    FROM public.serverless_attempts a JOIN public.serverless_dispatch_outbox o ON o.attempt_id=a.id
    JOIN public.serverless_predispatch_authorities p ON p.attempt_id=a.id
    JOIN public.hosted_dispatch_token_vault v ON v.attempt_id=a.id
   WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id
     AND a.generation_request_id=supplied_generation_request_id AND a.lane=supplied_lane FOR UPDATE OF a,o;
  SELECT a.state attempt_state,o.state outbox_state INTO other
    FROM public.serverless_attempts a JOIN public.serverless_dispatch_outbox o ON o.attempt_id=a.id
   WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id
     AND a.generation_request_id=supplied_generation_request_id
     AND a.lane=CASE supplied_lane WHEN 'mage_image' THEN 'soulx_avatar' ELSE 'mage_image' END
   FOR UPDATE OF a,o;
  IF target.id IS NULL OR other.attempt_state IS NULL THEN
    RAISE EXCEPTION 'hosted pair is incomplete' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.hosted_pair_runtime_states(generation_request_id,account_id,workspace_id,phase,created_at,updated_at)
  VALUES(supplied_generation_request_id,supplied_account_id,supplied_workspace_id,'MAGE_READY',db_now,db_now)
  ON CONFLICT(generation_request_id) DO NOTHING;
  SELECT * INTO pair FROM public.hosted_pair_runtime_states p
   WHERE p.generation_request_id=supplied_generation_request_id FOR UPDATE;
  IF (supplied_lane='mage_image' AND pair.phase<>'MAGE_READY')
     OR (supplied_lane='soulx_avatar' AND (pair.phase<>'MAGE_ASSIGNED'
       OR other.attempt_state<>'ASSIGNED' OR other.outbox_state<>'ASSIGNED'))
     OR target.attempt_state<>'OUTBOXED' OR target.outbox_state<>'READY_TO_DISPATCH'
     OR target.id IS DISTINCT FROM supplied_expected_attempt_id
     OR target.envelope_sha256 IS DISTINCT FROM supplied_expected_envelope_sha256
     OR (supplied_lane='mage_image' AND (other.attempt_state<>'OUTBOXED' OR other.outbox_state<>'READY_TO_DISPATCH'))
     OR target.send_attempt_count<>0 THEN
    RAISE EXCEPTION 'hosted pair lane is not sendable' USING ERRCODE='55000';
  END IF;
  raw_token:=pgp_sym_decrypt(target.token_ciphertext,token_key);
  IF 'sha256:'||encode(sha256(convert_to(raw_token,'UTF8')),'hex')<>target.dispatch_token_sha256 THEN
    RAISE EXCEPTION 'hosted pair token binding invalid' USING ERRCODE='42501';
  END IF;
  UPDATE public.serverless_dispatch_outbox AS send_outbox SET state='SENT',send_attempt_count=1,
    lease_id=public.videoforge_hosted_predispatch_uuid('cost-event',supplied_generation_request_id,
      target.task_id,target.attempt_ordinal),
    lease_holder_sha256='sha256:'||encode(sha256(convert_to('hosted-pair-runtime:'||
      supplied_generation_request_id::text||':'||supplied_lane,'UTF8')),'hex'),
    leased_at=db_now,lease_expires_at=target.reconciliation_deadline_at,
    version=send_outbox.version+1,updated_at=db_now WHERE send_outbox.attempt_id=target.id;
  UPDATE public.serverless_attempts SET state='DISPATCHING',submitted_at=db_now,
    ttl_expires_at=deadline_at,version=version+1,updated_at=db_now WHERE id=target.id;
  UPDATE public.hosted_pair_runtime_states SET phase=CASE supplied_lane WHEN 'mage_image' THEN 'MAGE_SENT' ELSE 'SOULX_SENT' END,
    version=version+1,updated_at=db_now WHERE generation_request_id=supplied_generation_request_id;
  lane:=supplied_lane; attempt_id:=target.id; dispatch_token:=raw_token;
  dispatch_token_sha256:=target.dispatch_token_sha256; endpoint_id_sha256:=target.endpoint_id_sha256;
  request_body_sha256:=target.request_body_sha256; deployment_id:=target.deployment_id;
  expected_envelope_sha256:=target.envelope_sha256;
  phase:=CASE supplied_lane WHEN 'mage_image' THEN 'MAGE_SENT' ELSE 'SOULX_SENT' END; RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_begin_hosted_pair_send(uuid,uuid,uuid,text,uuid,text) FROM PUBLIC;

-- Records the exact /run outcome. Only a definite REQUEST_REJECTED may prove no job was created.
CREATE FUNCTION public.videoforge_finish_hosted_pair_send(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_generation_request_id uuid,
  supplied_lane text, supplied_outcome text, supplied_provider_job_id text DEFAULT NULL,
  supplied_deployment_id uuid DEFAULT NULL, supplied_dispatch_token_sha256 text DEFAULT NULL
) RETURNS TABLE(phase text, attempt_state text, outbox_state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE db_now timestamptz:=transaction_timestamp(); pair public.hosted_pair_runtime_states%ROWTYPE;
  target public.serverless_attempts%ROWTYPE; outbox public.serverless_dispatch_outbox%ROWTYPE;
  authority public.serverless_predispatch_authorities%ROWTYPE; assignment_id uuid;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR supplied_lane NOT IN ('mage_image','soulx_avatar')
     OR supplied_outcome NOT IN ('ASSIGNED','DISPATCH_ACK_UNKNOWN','REQUEST_REJECTED') THEN
    RAISE EXCEPTION 'hosted pair result invalid' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_generation_request_id::text,43));
  SELECT * INTO pair FROM public.hosted_pair_runtime_states p WHERE p.generation_request_id=supplied_generation_request_id FOR UPDATE;
  SELECT * INTO target FROM public.serverless_attempts a WHERE a.account_id=supplied_account_id
    AND a.workspace_id=supplied_workspace_id AND a.generation_request_id=supplied_generation_request_id
    AND a.lane=supplied_lane FOR UPDATE;
  SELECT * INTO outbox FROM public.serverless_dispatch_outbox o WHERE o.attempt_id=target.id FOR UPDATE;
  SELECT * INTO authority FROM public.serverless_predispatch_authorities p WHERE p.attempt_id=target.id;
  IF pair.generation_request_id IS NULL OR target.id IS NULL OR target.state<>'DISPATCHING'
     OR outbox.state<>'SENT' OR outbox.send_attempt_count<>1
     OR supplied_dispatch_token_sha256 IS DISTINCT FROM target.dispatch_token_sha256
     OR supplied_deployment_id IS DISTINCT FROM target.deployment_id
     OR authority.deployment_id<>target.deployment_id
     OR pair.phase<>(CASE supplied_lane WHEN 'mage_image' THEN 'MAGE_SENT' ELSE 'SOULX_SENT' END) THEN
    RAISE EXCEPTION 'hosted pair result binding/state invalid' USING ERRCODE='55000';
  END IF;
  IF supplied_outcome='ASSIGNED' THEN
    IF supplied_provider_job_id IS NULL OR supplied_provider_job_id !~ '^[A-Za-z0-9._:-]{1,200}$' THEN
      RAISE EXCEPTION 'provider assignment invalid' USING ERRCODE='23514';
    END IF;
    assignment_id:=public.videoforge_hosted_pair_assignment_uuid(target.id);
    INSERT INTO public.serverless_provider_assignments(id,account_id,workspace_id,project_revision_id,
      attempt_id,dispatch_token_sha256,provider_job_id,provider_job_id_sha256,assignment_source,
      assigned_at,is_current)
    VALUES(assignment_id,supplied_account_id,supplied_workspace_id,target.project_revision_id,target.id,
      target.dispatch_token_sha256,supplied_provider_job_id,
      'sha256:'||encode(sha256(convert_to(supplied_provider_job_id,'UTF8')),'hex'),'RUN_RESPONSE',db_now,true);
    UPDATE public.serverless_dispatch_outbox SET state='ASSIGNED',version=version+1,updated_at=db_now WHERE id=outbox.id;
    UPDATE public.serverless_attempts SET state='ASSIGNED',version=version+1,updated_at=db_now WHERE id=target.id;
    UPDATE public.hosted_pair_runtime_states SET phase=CASE supplied_lane WHEN 'mage_image' THEN 'MAGE_ASSIGNED' ELSE 'BOTH_ASSIGNED' END,
      version=version+1,updated_at=db_now WHERE generation_request_id=supplied_generation_request_id;
  ELSIF supplied_outcome='DISPATCH_ACK_UNKNOWN' THEN
    IF supplied_provider_job_id IS NOT NULL THEN RAISE EXCEPTION 'unknown acknowledgement cannot assert job id' USING ERRCODE='23514'; END IF;
    UPDATE public.serverless_dispatch_outbox SET state='DISPATCH_ACK_UNKNOWN',version=version+1,updated_at=db_now WHERE id=outbox.id;
    UPDATE public.serverless_attempts SET state='RECONCILING',version=version+1,updated_at=db_now WHERE id=target.id;
    UPDATE public.hosted_pair_runtime_states SET phase='CLEANUP_ONLY',cleanup_reason=supplied_lane||'_ACK_UNKNOWN',
      version=version+1,updated_at=db_now WHERE generation_request_id=supplied_generation_request_id;
  ELSE
    IF supplied_provider_job_id IS NOT NULL THEN RAISE EXCEPTION 'definite rejection cannot assert job id' USING ERRCODE='23514'; END IF;
    UPDATE public.serverless_dispatch_outbox SET state='DEAD_LETTER',version=version+1,updated_at=db_now WHERE id=outbox.id;
    UPDATE public.serverless_attempts SET state='PERMANENT_FAILED',terminal_at=db_now,version=version+1,updated_at=db_now WHERE id=target.id;
    UPDATE public.hosted_pair_runtime_states SET phase='CLEANUP_ONLY',cleanup_reason=supplied_lane||'_REQUEST_REJECTED',
      version=version+1,updated_at=db_now WHERE generation_request_id=supplied_generation_request_id;
  END IF;
  SELECT p.phase,a.state,o.state INTO phase,attempt_state,outbox_state
    FROM public.hosted_pair_runtime_states p JOIN public.serverless_attempts a ON a.generation_request_id=p.generation_request_id AND a.lane=supplied_lane
    JOIN public.serverless_dispatch_outbox o ON o.attempt_id=a.id WHERE p.generation_request_id=supplied_generation_request_id;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_finish_hosted_pair_send(uuid,uuid,uuid,text,text,text,uuid,text) FROM PUBLIC;

-- Read-only recovery decision. Missing vault rows, SENT, ACK_UNKNOWN, or any non-exact pair are
-- cleanup-only. Raw tokens are never returned from this inspection function.
CREATE FUNCTION public.videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid)
RETURNS TABLE(lane text,attempt_id uuid,attempt_state text,outbox_state text,provider_job_id text,
  deployment_id uuid,dispatch_token_sha256 text,pair_phase text,recovery_action text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM $1 THEN RAISE EXCEPTION 'tenant mismatch' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT a.lane,a.id,a.state,o.state,s.provider_job_id,a.deployment_id,a.dispatch_token_sha256,p.phase,
    CASE WHEN count(v.attempt_id) OVER()<>2 THEN 'CLEANUP_ONLY'
      WHEN p.phase='MAGE_READY' AND a.lane='mage_image' AND a.state='OUTBOXED' AND o.state='READY_TO_DISPATCH'
       AND (SELECT count(*) FROM public.serverless_attempts a2 JOIN public.serverless_dispatch_outbox o2 ON o2.attempt_id=a2.id
         WHERE a2.generation_request_id=p.generation_request_id AND a2.state='OUTBOXED' AND o2.state='READY_TO_DISPATCH')=2
        THEN 'SEND_MAGE_ONLY'
      WHEN p.phase='MAGE_ASSIGNED' AND a.lane='soulx_avatar' AND a.state='OUTBOXED' AND o.state='READY_TO_DISPATCH'
       AND (SELECT count(*) FROM public.serverless_attempts a2 JOIN public.serverless_dispatch_outbox o2 ON o2.attempt_id=a2.id
         JOIN public.serverless_provider_assignments s2 ON s2.attempt_id=a2.id AND s2.is_current
         WHERE a2.generation_request_id=p.generation_request_id AND a2.lane='mage_image'
           AND a2.state='ASSIGNED' AND o2.state='ASSIGNED')=1 THEN 'SEND_SOULX_ONLY'
      WHEN p.phase='BOTH_ASSIGNED' AND a.state='ASSIGNED' AND o.state='ASSIGNED' AND s.id IS NOT NULL
        THEN 'RECONCILE_ASSIGNED'
      ELSE 'CLEANUP_ONLY' END
  FROM public.hosted_pair_runtime_states p JOIN public.serverless_attempts a ON a.generation_request_id=p.generation_request_id
  JOIN public.serverless_dispatch_outbox o ON o.attempt_id=a.id
  LEFT JOIN public.hosted_dispatch_token_vault v ON v.attempt_id=a.id
  LEFT JOIN public.serverless_provider_assignments s ON s.attempt_id=a.id AND s.is_current
  WHERE p.account_id=$1 AND p.workspace_id=$2 AND p.generation_request_id=$3
  ORDER BY CASE a.lane WHEN 'mage_image' THEN 1 ELSE 2 END;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid) FROM PUBLIC;

-- Trusted activation snapshot. The runtime cannot select approval, qualification, deployment, or
-- migration-ledger tables directly; this projection returns only exact hashes and bounded facts.
CREATE FUNCTION public.videoforge_load_hosted_pair_activation(uuid,uuid,uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE snapshot jsonb; db_now timestamptz:=transaction_timestamp();
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM $1 THEN
    RAISE EXCEPTION 'hosted pair activation tenant mismatch' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object(
    'databaseNow',to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'migrationLedger',(SELECT jsonb_agg(jsonb_build_object('version',m.version,'sha256',m.sha256)
      ORDER BY m.version) FROM public.videoforge_schema_migrations m WHERE m.version BETWEEN 37 AND 43),
    'paidApproval',(SELECT jsonb_build_object(
      'approved',c.id IS NOT NULL,'exact',c.approval_sha256=a.approval_sha256
        AND c.account_id=a.account_id AND c.workspace_id=a.workspace_id
        AND c.generation_request_id=a.generation_request_id AND c.lease_id=a.lease_id
        AND c.lane_bindings IS NOT DISTINCT FROM a.lane_bindings
        AND c.total_cap_usd=a.maximum_cumulative_finite_cap_usd
        AND c.expires_at IS NOT DISTINCT FROM a.expires_at,
      'expiresAt',to_char(c.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      FROM public.hosted_paid_dispatch_claims c JOIN public.hosted_paid_dispatch_approvals a ON a.id=c.approval_id
      WHERE c.account_id=$1 AND c.workspace_id=$2 AND c.generation_request_id=$3),
    'lanes',(SELECT jsonb_object_agg(a2.lane,jsonb_build_object(
      'qualification',jsonb_build_object('accepted',q.independent_audit_accepted,
        'verifiedAt',to_char(q.verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'expiresAt',to_char(q.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'qualificationRecordSha256',q.qualification_record_sha256,
        'deploymentSnapshotSha256',q.deployment_snapshot_sha256),
      'deployment',jsonb_build_object('deploymentId',d.id,'endpointIdSha256',d.endpoint_id_sha256,
        'endpointConfigSha256',d.endpoint_config_sha256,'workerImageDigest',d.worker_image_digest,
        'modelManifestSha256',d.model_manifest_sha256,'volumeIdSha256',d.volume_id_sha256,
        'volumeManifestSha256',d.volume_manifest_sha256,'region',d.region,'gpuAllowlist',d.gpu_allowlist,
        'deploymentSnapshotSha256',public.videoforge_hosted_deployment_snapshot_sha256(d.id)),
      'authority',jsonb_build_object('endpointIdSha256',p.endpoint_id_sha256,
        'endpointConfigSha256',p.endpoint_config_sha256,'workerImageDigest',p.worker_image_digest,
        'modelManifestSha256',p.model_manifest_sha256,'volumeIdSha256',p.volume_id_sha256,
        'volumeManifestSha256',p.volume_manifest_sha256,'region',p.region,'gpuAllowlist',p.gpu_allowlist)
    )) FROM public.serverless_attempts a2
      JOIN public.serverless_predispatch_authorities p ON p.attempt_id=a2.id
      JOIN public.hosted_lane_batches b ON b.account_id=a2.account_id AND b.workspace_id=a2.workspace_id
        AND b.generation_request_id=a2.generation_request_id AND b.lane=a2.lane
      JOIN public.hosted_paid_dispatch_claims c2 ON c2.account_id=a2.account_id
        AND c2.workspace_id=a2.workspace_id AND c2.generation_request_id=a2.generation_request_id
      JOIN LATERAL jsonb_array_elements(c2.lane_bindings) binding
        ON binding->>'lane'=a2.lane
      JOIN public.hosted_serverless_qualification_attestations q
        ON q.id=(binding->>'qualification_attestation_id')::uuid
      JOIN public.serverless_endpoint_deployments d ON d.id=a2.deployment_id AND d.lane=a2.lane
      WHERE a2.account_id=$1 AND a2.workspace_id=$2 AND a2.generation_request_id=$3)
  ) INTO snapshot;
  IF snapshot->'paidApproval'='null'::jsonb
     OR (SELECT count(*) FROM jsonb_object_keys(snapshot->'lanes'))<>2 THEN
    RAISE EXCEPTION 'hosted pair activation snapshot incomplete' USING ERRCODE='42501';
  END IF;
  RETURN snapshot;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_load_hosted_pair_activation(uuid,uuid,uuid) FROM PUBLIC;

CREATE TABLE public.hosted_pair_cleanup_observations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  generation_request_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  lane text NOT NULL CHECK(lane IN ('mage_image','soulx_avatar')),
  deployment_id uuid NOT NULL,
  dispatch_token_sha256 text NOT NULL CHECK(dispatch_token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  provider_job_id text CHECK(provider_job_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
  provider_state text NOT NULL CHECK(provider_state IN ('COMPLETED','FAILED','CANCELLED','TIMED_OUT','ABSENT')),
  provider_proof_sha256 text NOT NULL CHECK(provider_proof_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(attempt_id,provider_proof_sha256),
  FOREIGN KEY(account_id,workspace_id,attempt_id) REFERENCES public.serverless_attempts(account_id,workspace_id,id)
);
CREATE TRIGGER hosted_pair_cleanup_observations_append_only BEFORE UPDATE OR DELETE
  ON public.hosted_pair_cleanup_observations FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_pair_cleanup_observations_tenant_write_guard BEFORE INSERT
  ON public.hosted_pair_cleanup_observations FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE public.hosted_pair_cleanup_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_pair_cleanup_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_pair_cleanup_observations_tenant_rls ON public.hosted_pair_cleanup_observations
  USING(account_id=public.videoforge_current_account_id()) WITH CHECK(account_id=public.videoforge_current_account_id());
REVOKE ALL ON TABLE public.hosted_pair_cleanup_observations FROM PUBLIC;

-- Final release requires two exact provider terminal/absence proofs in one transaction. An assigned
-- lane can never be declared ABSENT and its exact current provider job id must match.
CREATE FUNCTION public.videoforge_settle_hosted_pair_cleanup(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_generation_request_id uuid,
  supplied_observations jsonb
) RETURNS TABLE(pair_phase text,released boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE db_now timestamptz:=transaction_timestamp(); item jsonb; target record; assigned record;
  observation_id uuid; observed_count integer:=0; released_count integer; all_completed boolean:=true;
  pair public.hosted_pair_runtime_states%ROWTYPE;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR jsonb_typeof(supplied_observations)<>'array' OR jsonb_array_length(supplied_observations)<>2 THEN
    RAISE EXCEPTION 'hosted pair cleanup input invalid' USING ERRCODE='42501';
  END IF;
  IF (SELECT array_agg(value->>'lane' ORDER BY value->>'lane') FROM jsonb_array_elements(supplied_observations))
       IS DISTINCT FROM ARRAY['mage_image','soulx_avatar']::text[] THEN
    RAISE EXCEPTION 'hosted pair cleanup requires both exact lanes' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_generation_request_id::text,43));
  SELECT * INTO pair FROM public.hosted_pair_runtime_states p WHERE p.account_id=supplied_account_id
    AND p.workspace_id=supplied_workspace_id AND p.generation_request_id=supplied_generation_request_id FOR UPDATE;
  IF pair.phase NOT IN ('CLEANUP_ONLY','BOTH_ASSIGNED') THEN
    RAISE EXCEPTION 'hosted pair is not cleanup eligible' USING ERRCODE='55000';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(supplied_observations) e(value)
    ORDER BY CASE value->>'lane' WHEN 'mage_image' THEN 1 ELSE 2 END LOOP
    SELECT a.*,o.state outbox_state,o.send_attempt_count INTO target FROM public.serverless_attempts a
      JOIN public.serverless_dispatch_outbox o ON o.attempt_id=a.id
     WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id
       AND a.generation_request_id=supplied_generation_request_id AND a.lane=item->>'lane' FOR UPDATE OF a,o;
    SELECT * INTO assigned FROM public.serverless_provider_assignments s WHERE s.attempt_id=target.id AND s.is_current;
    IF target.id IS NULL OR item->>'attempt_id'<>target.id::text
       OR item->>'deployment_id'<>target.deployment_id::text
       OR item->>'dispatch_token_sha256'<>target.dispatch_token_sha256
       OR item->>'provider_state' NOT IN ('COMPLETED','FAILED','CANCELLED','TIMED_OUT','ABSENT')
       OR item->>'provider_proof_sha256' !~ '^sha256:[0-9a-f]{64}$'
       OR (item->>'observed_at')::timestamptz>db_now
       OR (item->>'observed_at')::timestamptz<db_now-interval '5 minutes'
       OR (assigned.id IS NOT NULL AND (item->>'provider_state'='ABSENT'
         OR item->>'provider_job_id' IS DISTINCT FROM assigned.provider_job_id))
       OR (assigned.id IS NULL AND item->>'provider_state'<>'ABSENT')
       OR (item->>'provider_state'='COMPLETED' AND NOT EXISTS (
         SELECT 1 FROM public.hosted_serverless_output_barrier_completions completion
          WHERE completion.account_id=supplied_account_id AND completion.workspace_id=supplied_workspace_id
            AND completion.attempt_id=target.id AND completion.provider_job_id=assigned.provider_job_id))
       OR (item->>'provider_state'='ABSENT' AND NOT (
         (target.send_attempt_count=0 AND target.outbox_state='READY_TO_DISPATCH' AND target.state='OUTBOXED')
         OR (target.outbox_state='DEAD_LETTER' AND target.state='PERMANENT_FAILED')))
       OR item->>'provider_proof_sha256'<>(
         'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
           item-'provider_proof_sha256'-'observed_at'),'UTF8')),'hex')) THEN
      RAISE EXCEPTION 'hosted pair cleanup proof binding invalid' USING ERRCODE='23514';
    END IF;
    observation_id:=public.videoforge_hosted_pair_assignment_uuid(target.id);
    -- Separate deterministic namespace from assignment UUID.
    observation_id:=public.videoforge_hosted_predispatch_uuid('ledger',supplied_generation_request_id,target.task_id,target.attempt_ordinal);
    INSERT INTO public.hosted_pair_cleanup_observations(id,account_id,workspace_id,generation_request_id,
      attempt_id,lane,deployment_id,dispatch_token_sha256,provider_job_id,provider_state,
      provider_proof_sha256,observed_at,created_at)
    VALUES(observation_id,supplied_account_id,supplied_workspace_id,supplied_generation_request_id,
      target.id,target.lane,target.deployment_id,target.dispatch_token_sha256,item->>'provider_job_id',
      item->>'provider_state',item->>'provider_proof_sha256',(item->>'observed_at')::timestamptz,db_now)
    ON CONFLICT(attempt_id,provider_proof_sha256) DO NOTHING;
    IF item->>'provider_state'='COMPLETED' THEN
      -- The 0037 barrier has already proved that every expected object is a committed tenant
      -- artifact of this exact attempt. Materialize the durable V2-05 accepted-unit facts before
      -- making the lane terminal; the lane trigger independently recounts these rows.
      INSERT INTO public.video_runtime_accepted_units(
        id,account_id,workspace_id,runtime_id,project_revision_id,lane,item_id,object_key,
        checksum_sha256,content_length,accepted_attempt_id,accepted_at)
      SELECT md5('hosted-pair-accepted:'||target.id::text||':'||(expected->>'item_id'))::uuid,
        supplied_account_id,supplied_workspace_id,r.id,r.project_revision_id,target.lane,
        expected->>'item_id',expected->>'object_key',expected->>'checksum_sha256',
        (expected->>'content_length')::bigint,target.id,db_now
      FROM public.hosted_serverless_output_barrier_completions completion
      JOIN public.video_runtime_states r
        ON r.generation_request_id=supplied_generation_request_id,
        LATERAL jsonb_array_elements(completion.expected_objects) expected
      WHERE completion.attempt_id=target.id
      ON CONFLICT(runtime_id,lane,item_id) DO NOTHING;
    END IF;
    IF item->>'provider_state'<>'COMPLETED' THEN all_completed:=false; END IF;
    IF target.state NOT IN ('SUCCEEDED','PERMANENT_FAILED','CANCELLED') THEN
      UPDATE public.serverless_attempts SET state=CASE item->>'provider_state'
        WHEN 'COMPLETED' THEN 'SUCCEEDED' WHEN 'CANCELLED' THEN 'CANCELLED' ELSE 'PERMANENT_FAILED' END,
        terminal_at=db_now,version=version+1,updated_at=db_now WHERE id=target.id;
    END IF;
    UPDATE public.serverless_dispatch_outbox SET state=CASE WHEN item->>'provider_state'='ABSENT' THEN 'DEAD_LETTER' ELSE 'TERMINAL' END,
      version=version+1,updated_at=db_now WHERE attempt_id=target.id AND state NOT IN ('TERMINAL','DEAD_LETTER');
    observed_count:=observed_count+1;
  END LOOP;
  IF observed_count<>2 THEN RAISE EXCEPTION 'hosted pair cleanup requires exact pair' USING ERRCODE='23514'; END IF;
  UPDATE public.video_runtime_lane_states SET state=CASE WHEN all_completed THEN 'SUCCEEDED' ELSE 'FAILED' END,
    accepted_item_count=CASE WHEN all_completed THEN planned_item_count ELSE accepted_item_count END,
    current_attempt_id=NULL,version=version+1,updated_at=db_now
    WHERE account_id=supplied_account_id AND workspace_id=supplied_workspace_id
      AND runtime_id=(SELECT id FROM public.video_runtime_states WHERE generation_request_id=supplied_generation_request_id)
      AND state NOT IN ('SUCCEEDED','FAILED','CANCELED');
  -- GPU success ends at the render barrier. CPU rendering owns RENDERING -> COMPLETE together with
  -- the render/final hashes and request success; provider cleanup must never forge those facts.
  UPDATE public.video_runtime_states SET stage=CASE WHEN all_completed THEN 'RENDERING' ELSE 'FAILED' END,
    terminal_reason=CASE WHEN all_completed THEN NULL ELSE 'LANE_PERMANENT_FAILURE' END,
    terminal_at=CASE WHEN all_completed THEN NULL ELSE db_now END,
    version=version+1,updated_at=db_now WHERE account_id=supplied_account_id AND workspace_id=supplied_workspace_id
      AND generation_request_id=supplied_generation_request_id AND stage NOT IN ('COMPLETE','FAILED','CANCELED');
  UPDATE public.generation_requests SET state='FAILED',terminal_at=db_now,version=version+1,updated_at=db_now
    WHERE account_id=supplied_account_id AND workspace_id=supplied_workspace_id AND id=supplied_generation_request_id
      AND NOT all_completed AND state IN ('ADMITTED','ACTIVE','CANCELLING');
  UPDATE public.provider_workload_leases SET state='RELEASED',released_at=db_now,
    release_reason=CASE WHEN all_completed THEN 'HOSTED_PAIR_OUTPUTS_ACCEPTED' ELSE 'HOSTED_PAIR_PROVIDER_TERMINAL' END,
    version=version+1,heartbeat_at=db_now,expires_at=greatest(expires_at,db_now+interval '1 second')
    WHERE account_id=supplied_account_id AND workspace_id=supplied_workspace_id
      AND generation_request_id=supplied_generation_request_id AND state='ACTIVE';
  GET DIAGNOSTICS released_count=ROW_COUNT;
  IF released_count<>1 THEN RAISE EXCEPTION 'hosted pair exact active lease release failed' USING ERRCODE='55000'; END IF;
  UPDATE public.hosted_pair_runtime_states SET phase='SETTLED',cleanup_reason=NULL,version=version+1,updated_at=db_now
    WHERE generation_request_id=supplied_generation_request_id;
  IF (SELECT count(*) FROM public.serverless_attempts WHERE generation_request_id=supplied_generation_request_id
        AND state IN ('SUCCEEDED','PERMANENT_FAILED','CANCELLED'))<>2
     OR (SELECT count(*) FROM public.serverless_dispatch_outbox o JOIN public.serverless_attempts a ON a.id=o.attempt_id
        WHERE a.generation_request_id=supplied_generation_request_id AND o.state IN ('TERMINAL','DEAD_LETTER'))<>2
     OR (SELECT count(*) FROM public.video_runtime_lane_states l JOIN public.video_runtime_states r ON r.id=l.runtime_id
        WHERE r.generation_request_id=supplied_generation_request_id AND l.state IN ('SUCCEEDED','FAILED','CANCELED'))<>2
     OR EXISTS(SELECT 1 FROM public.provider_workload_leases WHERE generation_request_id=supplied_generation_request_id AND state='ACTIVE')
     OR (all_completed AND EXISTS(SELECT 1 FROM public.video_runtime_states
          WHERE generation_request_id=supplied_generation_request_id AND stage<>'RENDERING'))
     OR (all_completed AND EXISTS(SELECT 1 FROM public.generation_requests
          WHERE id=supplied_generation_request_id AND state<>'ACTIVE'))
     OR (NOT all_completed AND EXISTS(SELECT 1 FROM public.generation_requests
          WHERE id=supplied_generation_request_id AND state NOT IN ('FAILED','CANCELLED'))) THEN
    RAISE EXCEPTION 'hosted pair terminal zero postcondition failed' USING ERRCODE='55000';
  END IF;
  pair_phase:='SETTLED'; released:=true; RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_settle_hosted_pair_cleanup(uuid,uuid,uuid,jsonb) FROM PUBLIC;

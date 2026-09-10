-- 0117_hosted_v209_parallel_pair_dispatch.sql
--
-- The original 0043 executor deliberately made SoulX wait for a durable Mage assignment. That
-- protected the one-shot boundary, but it also serialized two independent RunPod lanes and made a
-- normal Stage 6/7 pair unnecessarily long. Begin both exact lanes atomically, then let the
-- application issue the two provider requests concurrently. A lost acknowledgement remains
-- cleanup-only; it is never converted into a resend.

ALTER TABLE public.hosted_pair_runtime_states
  DROP CONSTRAINT IF EXISTS hosted_pair_runtime_states_phase_check;
ALTER TABLE public.hosted_pair_runtime_states
  ADD CONSTRAINT hosted_pair_runtime_states_phase_check CHECK (phase IN (
    'MAGE_READY','MAGE_SENT','MAGE_ASSIGNED','SOULX_SENT','SOULX_ASSIGNED','BOTH_SENT',
    'BOTH_ASSIGNED','CLEANUP_ONLY','SETTLED'
  ));

CREATE FUNCTION public.videoforge_begin_hosted_pair_parallel_send(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_generation_request_id uuid,
  supplied_mage_attempt_id uuid, supplied_mage_envelope_sha256 text,
  supplied_soulx_attempt_id uuid, supplied_soulx_envelope_sha256 text
) RETURNS TABLE (
  lane text, attempt_id uuid, dispatch_token text, dispatch_token_sha256 text,
  endpoint_id_sha256 text, request_body_sha256 text, deployment_id uuid, phase text,
  expected_envelope_sha256 text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  token_key text:=current_setting('videoforge.dispatch_token_key',true);
  pair public.hosted_pair_runtime_states%ROWTYPE;
  mage record; soulx record; raw_token text; recovered_count integer;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR token_key IS NULL OR length(token_key)<32
     OR supplied_mage_envelope_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_soulx_envelope_sha256 !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'hosted parallel pair send input invalid' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_generation_request_id::text,43));
  SELECT count(*) INTO recovered_count
    FROM public.videoforge_recover_hosted_atomic_pair_tokens(
      supplied_account_id,supplied_workspace_id,supplied_generation_request_id);
  IF recovered_count<>2 THEN
    RAISE EXCEPTION 'hosted parallel pair authority is stale' USING ERRCODE='42501';
  END IF;

  SELECT a.id,a.task_id,a.attempt_ordinal,a.reconciliation_deadline_at,
         a.state AS attempt_state,o.id AS outbox_id,o.state AS outbox_state,
         o.send_attempt_count,p.endpoint_id_sha256,p.request_body_sha256,p.deployment_id,
         p.envelope_sha256,v.token_ciphertext
    INTO mage
    FROM public.serverless_attempts a
    JOIN public.serverless_dispatch_outbox o ON o.attempt_id=a.id
    JOIN public.serverless_predispatch_authorities p ON p.attempt_id=a.id
    JOIN public.hosted_dispatch_token_vault v ON v.attempt_id=a.id
   WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id
     AND a.generation_request_id=supplied_generation_request_id AND a.lane='mage_image'
   FOR UPDATE OF a,o;
  SELECT a.id,a.task_id,a.attempt_ordinal,a.reconciliation_deadline_at,
         a.state AS attempt_state,o.id AS outbox_id,o.state AS outbox_state,
         o.send_attempt_count,p.endpoint_id_sha256,p.request_body_sha256,p.deployment_id,
         p.envelope_sha256,v.token_ciphertext
    INTO soulx
    FROM public.serverless_attempts a
    JOIN public.serverless_dispatch_outbox o ON o.attempt_id=a.id
    JOIN public.serverless_predispatch_authorities p ON p.attempt_id=a.id
    JOIN public.hosted_dispatch_token_vault v ON v.attempt_id=a.id
   WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id
     AND a.generation_request_id=supplied_generation_request_id AND a.lane='soulx_avatar'
   FOR UPDATE OF a,o;
  IF mage.id IS NULL OR soulx.id IS NULL
     OR mage.id IS DISTINCT FROM supplied_mage_attempt_id
     OR soulx.id IS DISTINCT FROM supplied_soulx_attempt_id
     OR mage.attempt_state<>'OUTBOXED' OR mage.outbox_state<>'READY_TO_DISPATCH'
     OR soulx.attempt_state<>'OUTBOXED' OR soulx.outbox_state<>'READY_TO_DISPATCH'
     OR mage.send_attempt_count<>0 OR soulx.send_attempt_count<>0
     OR mage.envelope_sha256 IS DISTINCT FROM supplied_mage_envelope_sha256
     OR soulx.envelope_sha256 IS DISTINCT FROM supplied_soulx_envelope_sha256 THEN
    RAISE EXCEPTION 'hosted parallel pair is not sendable' USING ERRCODE='55000';
  END IF;
  INSERT INTO public.hosted_pair_runtime_states(
    generation_request_id,account_id,workspace_id,phase,created_at,updated_at)
  VALUES(supplied_generation_request_id,supplied_account_id,supplied_workspace_id,
    'MAGE_READY',db_now,db_now)
  ON CONFLICT(generation_request_id) DO NOTHING;
  SELECT * INTO pair FROM public.hosted_pair_runtime_states p
   WHERE p.generation_request_id=supplied_generation_request_id FOR UPDATE;
  IF pair.phase<>'MAGE_READY' THEN
    RAISE EXCEPTION 'hosted parallel pair runtime is not ready' USING ERRCODE='55000';
  END IF;

  raw_token:=pgp_sym_decrypt(mage.token_ciphertext,token_key);
  IF 'sha256:'||encode(sha256(convert_to(raw_token,'UTF8')),'hex')<>mage.dispatch_token_sha256 THEN
    RAISE EXCEPTION 'hosted parallel Mage token binding invalid' USING ERRCODE='42501';
  END IF;
  raw_token:=pgp_sym_decrypt(soulx.token_ciphertext,token_key);
  IF 'sha256:'||encode(sha256(convert_to(raw_token,'UTF8')),'hex')<>soulx.dispatch_token_sha256 THEN
    RAISE EXCEPTION 'hosted parallel SoulX token binding invalid' USING ERRCODE='42501';
  END IF;

  UPDATE public.serverless_dispatch_outbox SET state='SENT',send_attempt_count=1,
    lease_id=public.videoforge_hosted_predispatch_uuid('cost-event',supplied_generation_request_id,
      mage.task_id,mage.attempt_ordinal),
    lease_holder_sha256='sha256:'||encode(sha256(convert_to('hosted-pair-runtime:'||
      supplied_generation_request_id::text||':mage_image','UTF8')),'hex'),
    leased_at=db_now,lease_expires_at=mage.reconciliation_deadline_at,
    version=version+1,updated_at=db_now WHERE id=mage.outbox_id;
  UPDATE public.serverless_dispatch_outbox SET state='SENT',send_attempt_count=1,
    lease_id=public.videoforge_hosted_predispatch_uuid('cost-event',supplied_generation_request_id,
      soulx.task_id,soulx.attempt_ordinal),
    lease_holder_sha256='sha256:'||encode(sha256(convert_to('hosted-pair-runtime:'||
      supplied_generation_request_id::text||':soulx_avatar','UTF8')),'hex'),
    leased_at=db_now,lease_expires_at=soulx.reconciliation_deadline_at,
    version=version+1,updated_at=db_now WHERE id=soulx.outbox_id;
  UPDATE public.serverless_attempts SET state='DISPATCHING',submitted_at=db_now,
    ttl_expires_at=deadline_at,version=version+1,updated_at=db_now
   WHERE id IN (mage.id,soulx.id);
  UPDATE public.hosted_pair_runtime_states SET phase='BOTH_SENT',version=version+1,updated_at=db_now
   WHERE generation_request_id=supplied_generation_request_id;

  lane:='mage_image'; attempt_id:=mage.id; dispatch_token:=pgp_sym_decrypt(
    mage.token_ciphertext,token_key); dispatch_token_sha256:=mage.dispatch_token_sha256;
  endpoint_id_sha256:=mage.endpoint_id_sha256; request_body_sha256:=mage.request_body_sha256;
  deployment_id:=mage.deployment_id; phase:='BOTH_SENT';
  expected_envelope_sha256:=mage.envelope_sha256; RETURN NEXT;
  lane:='soulx_avatar'; attempt_id:=soulx.id; dispatch_token:=pgp_sym_decrypt(
    soulx.token_ciphertext,token_key); dispatch_token_sha256:=soulx.dispatch_token_sha256;
  endpoint_id_sha256:=soulx.endpoint_id_sha256; request_body_sha256:=soulx.request_body_sha256;
  deployment_id:=soulx.deployment_id; phase:='BOTH_SENT';
  expected_envelope_sha256:=soulx.envelope_sha256; RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_begin_hosted_pair_parallel_send(
  uuid,uuid,uuid,uuid,text,uuid,text) FROM PUBLIC;

CREATE FUNCTION public.videoforge_finish_hosted_pair_parallel_send(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_generation_request_id uuid,
  supplied_lane text, supplied_outcome text, supplied_provider_job_id text DEFAULT NULL,
  supplied_deployment_id uuid DEFAULT NULL, supplied_dispatch_token_sha256 text DEFAULT NULL
) RETURNS TABLE(phase text, attempt_state text, outbox_state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  pair public.hosted_pair_runtime_states%ROWTYPE;
  target public.serverless_attempts%ROWTYPE;
  outbox public.serverless_dispatch_outbox%ROWTYPE;
  authority public.serverless_predispatch_authorities%ROWTYPE;
  assignment_id uuid; other_attempt_state text; other_outbox_state text;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR supplied_lane NOT IN ('mage_image','soulx_avatar')
     OR supplied_outcome NOT IN ('ASSIGNED','DISPATCH_ACK_UNKNOWN','REQUEST_REJECTED') THEN
    RAISE EXCEPTION 'hosted parallel pair result invalid' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_generation_request_id::text,43));
  SELECT * INTO pair FROM public.hosted_pair_runtime_states p
   WHERE p.generation_request_id=supplied_generation_request_id FOR UPDATE;
  SELECT * INTO target FROM public.serverless_attempts a
   WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id
     AND a.generation_request_id=supplied_generation_request_id AND a.lane=supplied_lane FOR UPDATE;
  SELECT * INTO outbox FROM public.serverless_dispatch_outbox o WHERE o.attempt_id=target.id FOR UPDATE;
  SELECT * INTO authority FROM public.serverless_predispatch_authorities p
   WHERE p.attempt_id=target.id;
  IF pair.generation_request_id IS NULL OR target.id IS NULL OR target.state<>'DISPATCHING'
     OR outbox.state<>'SENT' OR outbox.send_attempt_count<>1
     OR supplied_dispatch_token_sha256 IS DISTINCT FROM target.dispatch_token_sha256
     OR supplied_deployment_id IS DISTINCT FROM target.deployment_id
     OR authority.deployment_id<>target.deployment_id
     OR pair.phase NOT IN ('BOTH_SENT','MAGE_ASSIGNED','SOULX_ASSIGNED','CLEANUP_ONLY') THEN
    RAISE EXCEPTION 'hosted parallel pair result binding/state invalid' USING ERRCODE='55000';
  END IF;
  IF supplied_outcome='ASSIGNED' THEN
    IF supplied_provider_job_id IS NULL
       OR supplied_provider_job_id !~ '^[A-Za-z0-9._:-]{1,200}$' THEN
      RAISE EXCEPTION 'provider assignment invalid' USING ERRCODE='23514';
    END IF;
    assignment_id:=public.videoforge_hosted_pair_assignment_uuid(target.id);
    INSERT INTO public.serverless_provider_assignments(
      id,account_id,workspace_id,project_revision_id,attempt_id,dispatch_token_sha256,
      provider_job_id,provider_job_id_sha256,assignment_source,assigned_at,is_current)
    VALUES(assignment_id,supplied_account_id,supplied_workspace_id,target.project_revision_id,target.id,
      target.dispatch_token_sha256,supplied_provider_job_id,
      'sha256:'||encode(sha256(convert_to(supplied_provider_job_id,'UTF8')),'hex'),
      'RUN_RESPONSE',db_now,true);
    UPDATE public.serverless_dispatch_outbox SET state='ASSIGNED',version=version+1,updated_at=db_now
     WHERE id=outbox.id;
    UPDATE public.serverless_attempts SET state='ASSIGNED',version=version+1,updated_at=db_now
     WHERE id=target.id;
    SELECT a.state,o.state INTO other_attempt_state,other_outbox_state
      FROM public.serverless_attempts a
      JOIN public.serverless_dispatch_outbox o ON o.attempt_id=a.id
     WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id
       AND a.generation_request_id=supplied_generation_request_id
       AND a.lane=CASE supplied_lane WHEN 'mage_image' THEN 'soulx_avatar' ELSE 'mage_image' END;
    IF pair.phase<>'CLEANUP_ONLY' THEN
      UPDATE public.hosted_pair_runtime_states SET phase=CASE
        WHEN other_attempt_state='ASSIGNED' AND other_outbox_state='ASSIGNED' THEN 'BOTH_ASSIGNED'
        WHEN supplied_lane='mage_image' THEN 'MAGE_ASSIGNED'
        ELSE 'SOULX_ASSIGNED' END,
        version=version+1,updated_at=db_now
       WHERE generation_request_id=supplied_generation_request_id;
    END IF;
  ELSIF supplied_outcome='DISPATCH_ACK_UNKNOWN' THEN
    IF supplied_provider_job_id IS NOT NULL THEN
      RAISE EXCEPTION 'unknown acknowledgement cannot assert job id' USING ERRCODE='23514';
    END IF;
    UPDATE public.serverless_dispatch_outbox SET state='DISPATCH_ACK_UNKNOWN',version=version+1,
      updated_at=db_now WHERE id=outbox.id;
    UPDATE public.serverless_attempts SET state='RECONCILING',version=version+1,updated_at=db_now
     WHERE id=target.id;
    UPDATE public.hosted_pair_runtime_states SET phase='CLEANUP_ONLY',
      cleanup_reason=supplied_lane||'_ACK_UNKNOWN',version=version+1,updated_at=db_now
     WHERE generation_request_id=supplied_generation_request_id;
  ELSE
    IF supplied_provider_job_id IS NOT NULL THEN
      RAISE EXCEPTION 'definite rejection cannot assert job id' USING ERRCODE='23514';
    END IF;
    UPDATE public.serverless_dispatch_outbox SET state='DEAD_LETTER',version=version+1,
      updated_at=db_now WHERE id=outbox.id;
    UPDATE public.serverless_attempts SET state='PERMANENT_FAILED',terminal_at=db_now,
      version=version+1,updated_at=db_now WHERE id=target.id;
    UPDATE public.hosted_pair_runtime_states SET phase='CLEANUP_ONLY',
      cleanup_reason=supplied_lane||'_REQUEST_REJECTED',version=version+1,updated_at=db_now
     WHERE generation_request_id=supplied_generation_request_id;
  END IF;
  SELECT p.phase,a.state,o.state INTO phase,attempt_state,outbox_state
    FROM public.hosted_pair_runtime_states p
    JOIN public.serverless_attempts a ON a.generation_request_id=p.generation_request_id
      AND a.lane=supplied_lane
    JOIN public.serverless_dispatch_outbox o ON o.attempt_id=a.id
   WHERE p.generation_request_id=supplied_generation_request_id;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_finish_hosted_pair_parallel_send(
  uuid,uuid,uuid,text,text,text,uuid,text) FROM PUBLIC;

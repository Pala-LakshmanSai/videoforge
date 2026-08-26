-- Atomic hosted two-lane paid predispatch. This is the only runtime capability that may consume a
-- 0040 approval and create provider-sendable state. Both lane batches, cost reservations, runtime
-- bindings, and one-time raw dispatch tokens are committed in the same database transaction.

CREATE TABLE public.hosted_serverless_qualification_attestations (
  id uuid PRIMARY KEY,
  lane text NOT NULL CHECK (lane IN ('mage_image','soulx_avatar')),
  deployment_id uuid NOT NULL,
  deployment_snapshot_sha256 text NOT NULL CHECK (deployment_snapshot_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  qualification_record_sha256 text NOT NULL UNIQUE CHECK (qualification_record_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  independent_audit_accepted boolean NOT NULL CHECK (independent_audit_accepted),
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_by_operator text NOT NULL CHECK (length(created_by_operator) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY (deployment_id,lane) REFERENCES public.serverless_endpoint_deployments(id,lane),
  CHECK (expires_at>verified_at AND expires_at<=verified_at+interval '24 hours')
);

-- Ciphertext is operational secret state: it is excluded from portable metadata snapshots. The
-- key exists only in the transaction-local setting and never in a row, function result, or log.
CREATE TABLE public.hosted_dispatch_token_vault (
  attempt_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  generation_request_id uuid NOT NULL,
  lane text NOT NULL CHECK (lane IN ('mage_image','soulx_avatar')),
  dispatch_token_sha256 text NOT NULL UNIQUE CHECK (dispatch_token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  token_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(account_id,workspace_id,attempt_id),
  FOREIGN KEY(account_id,workspace_id,attempt_id) REFERENCES public.serverless_attempts(account_id,workspace_id,id)
);

-- Exact V2-09 admission is durable authority state, not a browser assertion. It is inserted in the
-- same transaction as the paid claim and pair, and is immutable thereafter.
CREATE TABLE public.hosted_v209_short_admissions (
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  generation_request_id uuid PRIMARY KEY,
  admission_sha256 text NOT NULL UNIQUE CHECK(admission_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  plan_sha256 text NOT NULL CHECK(plan_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  work_manifest_sha256 text NOT NULL CHECK(work_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  phase_cap_micro_usd integer NOT NULL CHECK(phase_cap_micro_usd=2000000),
  combined_cap_micro_usd integer NOT NULL CHECK(combined_cap_micro_usd=17500000),
  billing_baseline_micro_usd bigint NOT NULL CHECK(billing_baseline_micro_usd>=0),
  billing_baseline_checked_at timestamptz NOT NULL,
  database_observed_at timestamptz NOT NULL,
  provider_observed_at timestamptz NOT NULL,
  cancel_at timestamptz NOT NULL,
  stop_at timestamptz NOT NULL,
  no_redispatch boolean NOT NULL CHECK(no_redispatch),
  admission_document jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(account_id,workspace_id,generation_request_id),
  FOREIGN KEY(account_id,workspace_id,generation_request_id)
    REFERENCES public.generation_requests(account_id,workspace_id,id),
  CHECK(cancel_at=database_observed_at+interval '20 minutes'),
  CHECK(stop_at=database_observed_at+interval '30 minutes')
);
CREATE TRIGGER hosted_serverless_qualification_attestations_append_only BEFORE UPDATE OR DELETE
  ON public.hosted_serverless_qualification_attestations FOR EACH ROW
  EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_dispatch_token_vault_append_only BEFORE UPDATE OR DELETE
  ON public.hosted_dispatch_token_vault FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_v209_short_admissions_append_only BEFORE UPDATE OR DELETE
  ON public.hosted_v209_short_admissions FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_dispatch_token_vault_tenant_write_guard BEFORE INSERT
  ON public.hosted_dispatch_token_vault FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE public.hosted_dispatch_token_vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_dispatch_token_vault FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_v209_short_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_v209_short_admissions FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_dispatch_token_vault_tenant_rls ON public.hosted_dispatch_token_vault
  USING(account_id=public.videoforge_current_account_id())
  WITH CHECK(account_id=public.videoforge_current_account_id());
CREATE POLICY hosted_v209_short_admissions_tenant_rls ON public.hosted_v209_short_admissions
  USING(account_id=public.videoforge_current_account_id())
  WITH CHECK(account_id=public.videoforge_current_account_id());
REVOKE ALL ON TABLE public.hosted_serverless_qualification_attestations FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_dispatch_token_vault FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_v209_short_admissions FROM PUBLIC;

CREATE FUNCTION public.videoforge_hosted_predispatch_uuid(
  supplied_kind text, supplied_generation_request_id uuid, supplied_task_id uuid,
  supplied_attempt_ordinal integer
) RETURNS uuid LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=public,pg_catalog AS $$
DECLARE digest text;
BEGIN
  IF supplied_kind NOT IN ('authority','outbox','ledger','cost-event')
     OR supplied_attempt_ordinal NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'hosted predispatch uuid input invalid' USING ERRCODE='22023';
  END IF;
  digest:=encode(sha256(convert_to('hosted-serverless-'||supplied_kind||':'||
    supplied_generation_request_id::text||':'||supplied_task_id::text||':'||
    supplied_attempt_ordinal::text,'UTF8')),'hex');
  digest:=substring(digest,1,12)||'5'||substring(digest,14,3)||'8'||substring(digest,18,15);
  RETURN (substring(digest,1,8)||'-'||substring(digest,9,4)||'-'||substring(digest,13,4)||'-'||
    substring(digest,17,4)||'-'||substring(digest,21,12))::uuid;
END;
$$;

CREATE FUNCTION public.videoforge_commit_hosted_atomic_pair_predispatch(
  supplied_approval_id uuid, supplied_approval_sha256 text, supplied_claim_id uuid,
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_project_id uuid,
  supplied_project_revision_id uuid, supplied_generation_request_id uuid,
  supplied_generation_plan_sha256 text, supplied_lease_id uuid, supplied_lane_bindings jsonb,
  supplied_total_cap_usd numeric, supplied_expires_at timestamptz, supplied_pair jsonb,
  supplied_v209_admission jsonb
) RETURNS TABLE (
  lane text, attempt_id uuid, authority_id uuid, outbox_id uuid, dispatch_token text,
  dispatch_token_sha256 text, unsigned_envelope jsonb, unsigned_envelope_sha256 text,
  request_body_sha256 text, endpoint_id_sha256 text, output_prefix text,
  authority_sha256 text, request_ttl_seconds integer,
  deadline_at timestamptz, reconciliation_deadline_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  item jsonb; batch public.hosted_lane_batches%ROWTYPE; deployment public.serverless_endpoint_deployments%ROWTYPE;
  runtime public.video_runtime_states%ROWTYPE; runtime_lane public.video_runtime_lane_states%ROWTYPE;
  claim_row record; lane_name text; task_id uuid; ordinal integer; expected_attempt uuid;
  authority_id uuid; outbox_id uuid; ledger_id uuid; cost_event_id uuid;
  raw_token text; token_sha text; tokenized_envelope jsonb; envelope_hash text;
  deadline timestamptz; reconciliation_deadline timestamptz; reservation_total numeric;
  authority_document jsonb; authority_hash text;
  qualification public.hosted_serverless_qualification_attestations%ROWTYPE;
  approval_binding jsonb;
  token_key text:=current_setting('videoforge.dispatch_token_key',true);
  admission_hash text;
  expected_work jsonb;
  canonical_v209_work jsonb:=jsonb_build_object(
    'mage_image',jsonb_build_array(jsonb_build_object('segmentId','seg_v209_split','role','right_image',
      'assetId','asset_v209_split_right','sha256','sha256:'||repeat('6',64))),
    'soulx_avatar',jsonb_build_array(
      jsonb_build_object('segmentId','seg_v209_full','role','avatar','assetId','asset_v209_avatar_full',
        'sha256','sha256:'||repeat('4',64)),
      jsonb_build_object('segmentId','seg_v209_split','role','avatar','assetId','asset_v209_avatar_split',
        'sha256','sha256:'||repeat('5',64))));
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR jsonb_typeof(supplied_pair)<>'array' OR jsonb_array_length(supplied_pair)<>2
     OR supplied_total_cap_usd<>2 OR token_key IS NULL OR length(token_key)<32
     OR jsonb_typeof(supplied_v209_admission)<>'object' THEN
    RAISE EXCEPTION 'hosted atomic pair input invalid' USING ERRCODE='42501';
  END IF;
  admission_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
    supplied_v209_admission-'admissionSha256'),'UTF8')),'hex');
  IF supplied_v209_admission->>'schemaVersion'<>'videoforge-v2-09-short-live-admission/v1'
     OR supplied_v209_admission->>'admissionSha256'<>admission_hash
     OR supplied_generation_plan_sha256<>
        'sha256:f975e2be15db227e96c6ea06f025c3f7ead025a5f80b80e9e2b0ac1f9fd6a4ea'
     OR supplied_v209_admission->>'planSha256'<>supplied_generation_plan_sha256
     OR supplied_v209_admission->>'workManifestSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_v209_admission->>'workManifestSha256'<>'sha256:'||encode(sha256(convert_to(
        public.videoforge_canonical_jsonb(supplied_v209_admission->'work'),'UTF8')),'hex')
     OR (supplied_v209_admission#>>'{cost,hardVariableCostCeilingMicroUsd}')::integer<>2000000
     OR (supplied_v209_admission#>>'{cost,combinedCompletionCapMicroUsd}')::integer<>17500000
     OR (supplied_v209_admission#>>'{cost,noRedispatch}')::boolean IS DISTINCT FROM true
     OR (supplied_v209_admission->>'billingBaselineMicroUsd')::bigint<0
     OR (supplied_v209_admission->>'databaseNow')::timestamptz>db_now
     OR (supplied_v209_admission->>'databaseNow')::timestamptz<db_now-interval '5 minutes'
     OR (supplied_v209_admission->>'providerObservedAt')::timestamptz>
        (supplied_v209_admission->>'databaseNow')::timestamptz
     OR (supplied_v209_admission->>'billingBaselineCheckedAt')::timestamptz>
        (supplied_v209_admission->>'databaseNow')::timestamptz
     OR (supplied_v209_admission->>'providerObservedAt')::timestamptz<db_now-interval '5 minutes'
     OR (supplied_v209_admission->>'billingBaselineCheckedAt')::timestamptz<db_now-interval '5 minutes'
     OR (supplied_v209_admission->>'cancelAt')::timestamptz<>
        (supplied_v209_admission->>'databaseNow')::timestamptz+interval '20 minutes'
     OR (supplied_v209_admission->>'stopAt')::timestamptz<>
        (supplied_v209_admission->>'databaseNow')::timestamptz+interval '30 minutes' THEN
    RAISE EXCEPTION 'hosted V2-09 admission invalid' USING ERRCODE='23514';
  END IF;
  IF (SELECT array_agg(value->>'lane' ORDER BY value->>'lane') FROM jsonb_array_elements(supplied_pair))
       IS DISTINCT FROM ARRAY['mage_image','soulx_avatar']::text[] THEN
    RAISE EXCEPTION 'hosted atomic pair requires both exact lanes' USING ERRCODE='23514';
  END IF;
  -- Same namespace as 0041 materialization; materialize/claim/predispatch cannot interleave.
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_generation_request_id::text,41));
  SELECT jsonb_build_object(
    'mage_image',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'segmentId',i.artifact_input->>'segment_id','role',i.artifact_input->>'role',
      'assetId',i.artifact_input->>'asset_id','sha256',i.artifact_input->>'sha256')
      ORDER BY i.item_ordinal) FROM public.hosted_lane_batches b
      JOIN public.hosted_lane_batch_items i ON i.batch_id=b.id
      WHERE b.account_id=supplied_account_id AND b.workspace_id=supplied_workspace_id
        AND b.generation_request_id=supplied_generation_request_id AND b.lane='mage_image'),'[]'::jsonb),
    'soulx_avatar',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'segmentId',i.artifact_input->>'segment_id','role',i.artifact_input->>'role',
      'assetId',i.artifact_input->>'asset_id','sha256',i.artifact_input->>'sha256')
      ORDER BY i.item_ordinal) FROM public.hosted_lane_batches b
      JOIN public.hosted_lane_batch_items i ON i.batch_id=b.id
      WHERE b.account_id=supplied_account_id AND b.workspace_id=supplied_workspace_id
        AND b.generation_request_id=supplied_generation_request_id AND b.lane='soulx_avatar'),'[]'::jsonb))
    INTO expected_work;
  IF supplied_v209_admission->'work' IS DISTINCT FROM expected_work
     OR EXISTS(SELECT 1 FROM public.hosted_lane_batches b JOIN public.hosted_lane_batch_items i
       ON i.batch_id=b.id WHERE b.account_id=supplied_account_id
       AND b.workspace_id=supplied_workspace_id AND b.generation_request_id=supplied_generation_request_id
       AND (i.artifact_input->>'segment_id' IS NULL OR i.artifact_input->>'asset_id' IS NULL
         OR i.artifact_input->>'sha256' !~ '^sha256:[0-9a-f]{64}$'
         OR i.artifact_input->>'role' NOT IN ('image','right_image','avatar')))
     OR expected_work IS DISTINCT FROM canonical_v209_work THEN
    RAISE EXCEPTION 'hosted V2-09 durable work mismatch' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.serverless_attempts a
    WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id
      AND a.generation_request_id=supplied_generation_request_id) THEN
    RAISE EXCEPTION 'hosted V2-09 redispatch forbidden' USING ERRCODE='23505';
  END IF;
  SELECT coalesce(sum((value->>'reservation_usd')::numeric),0) INTO reservation_total
    FROM jsonb_array_elements(supplied_pair);
  IF reservation_total<0 OR reservation_total>supplied_total_cap_usd
     OR (supplied_v209_admission->>'billingBaselineMicroUsd')::bigint+
        2000000>17500000
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(supplied_pair) value
       WHERE (value->>'reservation_usd')::numeric<0
         OR (value->>'reservation_usd')::numeric>(value->>'spend_ceiling_usd')::numeric) THEN
    RAISE EXCEPTION 'hosted atomic pair exceeds finite cap' USING ERRCODE='23514';
  END IF;

  -- Any later failure rolls this insert back with every predispatch row and binding.
  SELECT * INTO claim_row FROM public.videoforge_claim_hosted_paid_dispatch(
    supplied_approval_id,supplied_approval_sha256,supplied_claim_id,supplied_account_id,
    supplied_workspace_id,supplied_project_id,supplied_project_revision_id,
    supplied_generation_request_id,supplied_generation_plan_sha256,supplied_lease_id,
    supplied_lane_bindings,supplied_total_cap_usd,reservation_total,supplied_expires_at);

  INSERT INTO public.hosted_v209_short_admissions(account_id,workspace_id,generation_request_id,
    admission_sha256,plan_sha256,work_manifest_sha256,phase_cap_micro_usd,combined_cap_micro_usd,
    billing_baseline_micro_usd,billing_baseline_checked_at,database_observed_at,provider_observed_at,
    cancel_at,stop_at,no_redispatch,admission_document,created_at)
  VALUES(supplied_account_id,supplied_workspace_id,supplied_generation_request_id,admission_hash,
    supplied_generation_plan_sha256,supplied_v209_admission->>'workManifestSha256',2000000,17500000,
    (supplied_v209_admission->>'billingBaselineMicroUsd')::bigint,
    (supplied_v209_admission->>'billingBaselineCheckedAt')::timestamptz,
    (supplied_v209_admission->>'databaseNow')::timestamptz,
    (supplied_v209_admission->>'providerObservedAt')::timestamptz,
    (supplied_v209_admission->>'cancelAt')::timestamptz,
    (supplied_v209_admission->>'stopAt')::timestamptz,true,supplied_v209_admission,db_now);

  SELECT * INTO runtime FROM public.video_runtime_states r
   WHERE r.account_id=supplied_account_id AND r.workspace_id=supplied_workspace_id
     AND r.generation_request_id=supplied_generation_request_id FOR UPDATE;
  IF runtime.id IS NULL OR runtime.project_id<>supplied_project_id
     OR runtime.project_revision_id<>supplied_project_revision_id OR runtime.stage<>'WAITING_FOR_WORKER' THEN
    RAISE EXCEPTION 'hosted atomic pair runtime lineage mismatch' USING ERRCODE='23514';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(supplied_pair) WITH ORDINALITY e(value,n)
               ORDER BY CASE value->>'lane' WHEN 'mage_image' THEN 1 ELSE 2 END LOOP
    lane_name:=item->>'lane'; task_id:=(item->>'task_id')::uuid;
    SELECT value INTO approval_binding FROM jsonb_array_elements(supplied_lane_bindings) value
      WHERE value->>'lane'=lane_name;
    SELECT * INTO batch FROM public.hosted_lane_batches b
     WHERE b.account_id=supplied_account_id AND b.workspace_id=supplied_workspace_id
       AND b.generation_request_id=supplied_generation_request_id AND b.lane=lane_name FOR SHARE;
    SELECT * INTO runtime_lane FROM public.video_runtime_lane_states l
     WHERE l.account_id=supplied_account_id AND l.workspace_id=supplied_workspace_id
       AND l.runtime_id=runtime.id AND l.lane=lane_name FOR UPDATE;
    IF batch.id IS NULL OR batch.dispatch_task_id<>task_id OR batch.project_id<>supplied_project_id
       OR batch.project_revision_id<>supplied_project_revision_id
       OR batch.generation_plan_sha256<>supplied_generation_plan_sha256
       OR runtime_lane.id IS NULL OR runtime_lane.state<>'MANIFEST_DURABLE'
       OR runtime_lane.current_attempt_id IS NOT NULL
       OR approval_binding IS NULL OR approval_binding->>'deployment_id'<>batch.deployment_id::text
       OR approval_binding->>'qualification_attestation_id'<>item->>'qualification_attestation_id'
       OR approval_binding->>'qualification_record_sha256'<>item->>'qualification_record_sha256'
       OR item->>'batch_id'<>batch.id::text OR item->>'deployment_id'<>batch.deployment_id::text
       OR item->>'request_body_sha256'<>batch.request_body_sha256
       OR item->>'items_manifest_sha256'<>batch.items_manifest_sha256
       OR item->>'input_manifest_sha256'<>batch.input_manifest_sha256
       OR item->>'output_prefix'<>batch.output_prefix
       OR (item->>'reservation_usd')::numeric<>(batch.payload->>'reservation_usd')::numeric
       OR (item->>'spend_ceiling_usd')::numeric<>(batch.payload->>'spend_ceiling_usd')::numeric
       OR item->>'rate_source'<>batch.payload->>'rate_source'
       OR (item->>'rate_checked_at')::timestamptz IS DISTINCT FROM
          (batch.payload->>'rate_checked_at')::timestamptz
       OR length(item->>'rate_source') NOT BETWEEN 1 AND 400
       OR (item->>'rate_checked_at')::timestamptz>db_now
       OR (item->>'spend_ceiling_usd')::numeric<=0 OR (item->>'spend_ceiling_usd')::numeric>2
       OR item->'unsigned_envelope' IS DISTINCT FROM batch.payload->'envelope' THEN
      RAISE EXCEPTION 'hosted atomic pair exact batch lineage mismatch' USING ERRCODE='23514';
    END IF;
    SELECT * INTO deployment FROM public.serverless_endpoint_deployments d
     WHERE d.id=batch.deployment_id AND d.lane=lane_name AND d.is_active FOR SHARE;
    IF deployment.id IS NULL OR item->>'deployment_snapshot_sha256'<>
       public.videoforge_hosted_deployment_snapshot_sha256(deployment.id) THEN
      RAISE EXCEPTION 'hosted atomic pair deployment lineage mismatch' USING ERRCODE='23514';
    END IF;
    SELECT * INTO qualification FROM public.hosted_serverless_qualification_attestations q
     WHERE q.id=(item->>'qualification_attestation_id')::uuid AND q.lane=lane_name
       AND q.deployment_id=deployment.id FOR SHARE;
    IF qualification.id IS NULL OR NOT qualification.independent_audit_accepted
       OR qualification.expires_at<=db_now OR qualification.verified_at>db_now
       OR qualification.qualification_record_sha256<>item->>'qualification_record_sha256'
       OR qualification.deployment_snapshot_sha256<>item->>'deployment_snapshot_sha256' THEN
      RAISE EXCEPTION 'hosted atomic pair qualification is absent, stale, or mismatched'
        USING ERRCODE='42501';
    END IF;
    ordinal:=runtime_lane.attempt_ordinal+1;
    expected_attempt:=public.videoforge_hosted_dispatch_uuid('attempt',supplied_generation_request_id,task_id,ordinal);
    IF item->>'attempt_id'<>expected_attempt::text OR ordinal<>1 THEN
      RAISE EXCEPTION 'hosted atomic pair attempt lineage mismatch' USING ERRCODE='23514';
    END IF;
    authority_id:=public.videoforge_hosted_predispatch_uuid('authority',supplied_generation_request_id,task_id,ordinal);
    outbox_id:=public.videoforge_hosted_predispatch_uuid('outbox',supplied_generation_request_id,task_id,ordinal);
    ledger_id:=public.videoforge_hosted_predispatch_uuid('ledger',supplied_generation_request_id,task_id,ordinal);
    cost_event_id:=public.videoforge_hosted_predispatch_uuid('cost-event',supplied_generation_request_id,task_id,ordinal);
    raw_token:='dt-'||encode(gen_random_bytes(24),'hex');
    token_sha:='sha256:'||encode(sha256(convert_to(raw_token,'UTF8')),'hex');
    tokenized_envelope:=item->'unsigned_envelope'||jsonb_build_object('dispatch_token',raw_token);
    envelope_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(tokenized_envelope),'UTF8')),'hex');
    deadline:=db_now+make_interval(secs=>deployment.request_ttl_seconds);
    reconciliation_deadline:=db_now+make_interval(secs=>least(deployment.reconciliation_deadline_seconds,deployment.request_ttl_seconds));
    authority_document:=jsonb_build_object('schema_version','videoforge-hosted-atomic-predispatch/v1',
      'approval_sha256',supplied_approval_sha256,'claim_id',supplied_claim_id,'lane',lane_name,
      'batch_id',batch.id,'attempt_id',expected_attempt,'dispatch_token_sha256',token_sha,
      'unsigned_envelope_sha256',envelope_hash,'request_body_sha256',batch.request_body_sha256,
      'generation_plan_sha256',supplied_generation_plan_sha256,'deployment_snapshot_sha256',
      item->>'deployment_snapshot_sha256','lease_id',supplied_lease_id,'reservation_usd',
      (item->>'reservation_usd')::numeric,'total_cap_usd',supplied_total_cap_usd,
      'committed_at',to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    authority_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(authority_document),'UTF8')),'hex');

    INSERT INTO public.serverless_attempts(id,account_id,workspace_id,project_id,project_revision_id,
      generation_request_id,task_id,deployment_id,lane,attempt_ordinal,state,dispatch_token_sha256,
      items_manifest_sha256,item_count,input_manifest_sha256,output_prefix,deadline_at,
      reconciliation_deadline_at,created_at,updated_at)
    VALUES(expected_attempt,supplied_account_id,supplied_workspace_id,supplied_project_id,
      supplied_project_revision_id,supplied_generation_request_id,task_id,deployment.id,lane_name,
      ordinal,'PLANNED',token_sha,batch.items_manifest_sha256,batch.item_count,
      batch.input_manifest_sha256,batch.output_prefix,deadline,reconciliation_deadline,db_now,db_now);
    INSERT INTO public.serverless_predispatch_authorities(id,account_id,workspace_id,project_revision_id,
      attempt_id,dispatch_token_sha256,checkpoint_id,authority_mode,non_transferable,
      allowed_operations,deployment_id,endpoint_id_sha256,endpoint_config_sha256,worker_image_digest,
      model_manifest_sha256,volume_id_sha256,volume_manifest_sha256,region,gpu_allowlist,
      items_manifest_sha256,input_manifest_sha256,request_body_sha256,envelope_sha256,deadline_at,
      reconciliation_deadline_at,request_ttl_seconds,execution_timeout_seconds,init_timeout_seconds,
      spend_ceiling_usd,reservation_usd,rate_source,rate_checked_at,fixed_retained_volume_usd_excluded,
      authority_sha256,committed_at)
    VALUES(authority_id,supplied_account_id,supplied_workspace_id,supplied_project_revision_id,
      expected_attempt,token_sha,CASE lane_name WHEN 'mage_image' THEN 'V2-07' ELSE 'V2-08' END,
      'paid',true,ARRAY['serverless_run','serverless_status','serverless_cancel']::text[],deployment.id,
      deployment.endpoint_id_sha256,deployment.endpoint_config_sha256,deployment.worker_image_digest,
      deployment.model_manifest_sha256,deployment.volume_id_sha256,deployment.volume_manifest_sha256,
      'EU-RO-1',ARRAY['NVIDIA GeForce RTX 4090']::text[],batch.items_manifest_sha256,
      batch.input_manifest_sha256,batch.request_body_sha256,envelope_hash,deadline,reconciliation_deadline,
      deployment.request_ttl_seconds,deployment.execution_timeout_seconds,deployment.init_timeout_seconds,
      (item->>'spend_ceiling_usd')::numeric,(item->>'reservation_usd')::numeric,item->>'rate_source',
      (item->>'rate_checked_at')::timestamptz,true,authority_hash,db_now);
    INSERT INTO public.serverless_dispatch_outbox(id,account_id,workspace_id,project_revision_id,
      attempt_id,dispatch_token_sha256,authority_sha256,request_body_sha256,state,created_at,updated_at)
    VALUES(outbox_id,supplied_account_id,supplied_workspace_id,supplied_project_revision_id,
      expected_attempt,token_sha,authority_hash,batch.request_body_sha256,'READY_TO_DISPATCH',db_now,db_now);
    INSERT INTO public.hosted_dispatch_token_vault(attempt_id,account_id,workspace_id,
      generation_request_id,lane,dispatch_token_sha256,token_ciphertext,created_at)
    VALUES(expected_attempt,supplied_account_id,supplied_workspace_id,supplied_generation_request_id,
      lane_name,token_sha,pgp_sym_encrypt(raw_token,token_key,'cipher-algo=aes256,compress-algo=0'),db_now);
    INSERT INTO public.serverless_cost_ledgers(id,account_id,workspace_id,project_revision_id,attempt_id,
      owner_type,owner_id,ceiling_usd,estimated_usd,reserved_usd,fixed_retained_volume_usd_excluded,updated_at)
    VALUES(ledger_id,supplied_account_id,supplied_workspace_id,supplied_project_revision_id,
      expected_attempt,'PROJECT_REVISION',supplied_project_revision_id,(item->>'spend_ceiling_usd')::numeric,
      (item->>'reservation_usd')::numeric,(item->>'reservation_usd')::numeric,true,db_now);
    INSERT INTO public.serverless_cost_events(id,account_id,workspace_id,project_revision_id,attempt_id,
      ledger_id,sequence,kind,amount_usd,rate_source,rate_checked_at,confidence,recorded_at)
    VALUES(cost_event_id,supplied_account_id,supplied_workspace_id,supplied_project_revision_id,
      expected_attempt,ledger_id,1,'RESERVATION',(item->>'reservation_usd')::numeric,item->>'rate_source',
      (item->>'rate_checked_at')::timestamptz,'ESTIMATED',db_now);
    UPDATE public.serverless_attempts SET state='OUTBOXED',version=version+1,updated_at=db_now
      WHERE id=expected_attempt;
    UPDATE public.video_runtime_lane_states SET state='WAITING_FOR_WORKER',
      current_attempt_id=expected_attempt,attempt_ordinal=ordinal,version=version+1,updated_at=db_now
      WHERE id=runtime_lane.id;
    lane:=lane_name; attempt_id:=expected_attempt; dispatch_token:=raw_token;
    dispatch_token_sha256:=token_sha; unsigned_envelope:=tokenized_envelope;
    unsigned_envelope_sha256:=envelope_hash; request_body_sha256:=batch.request_body_sha256;
    endpoint_id_sha256:=deployment.endpoint_id_sha256; output_prefix:=batch.output_prefix;
    authority_sha256:=authority_hash; request_ttl_seconds:=deployment.request_ttl_seconds;
    deadline_at:=deadline; reconciliation_deadline_at:=reconciliation_deadline;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_hosted_predispatch_uuid(text,uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_commit_hosted_atomic_pair_predispatch(
  uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,numeric,timestamptz,jsonb,jsonb) FROM PUBLIC;

CREATE FUNCTION public.videoforge_recover_hosted_atomic_pair_tokens(
  supplied_account_id uuid,supplied_workspace_id uuid,supplied_generation_request_id uuid
) RETURNS TABLE(lane text,attempt_id uuid,dispatch_token text,dispatch_token_sha256 text,
  outbox_state text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE token_key text:=current_setting('videoforge.dispatch_token_key',true);
  recovered_count integer;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR token_key IS NULL OR length(token_key)<32 THEN
    RAISE EXCEPTION 'hosted token recovery denied' USING ERRCODE='42501';
  END IF;
  -- Recovery rechecks every mutable authority predicate against DB time before exposing plaintext.
  -- SENT/ACK_UNKNOWN rows are returned only so the caller can reconcile/cancel; never resend them.
  RETURN QUERY SELECT v.lane,v.attempt_id,decrypted.token,
    v.dispatch_token_sha256,o.state FROM public.hosted_dispatch_token_vault v
    JOIN public.serverless_dispatch_outbox o ON o.account_id=v.account_id AND o.workspace_id=v.workspace_id
      AND o.attempt_id=v.attempt_id
    JOIN public.serverless_attempts a ON a.account_id=v.account_id AND a.workspace_id=v.workspace_id
      AND a.id=v.attempt_id
    JOIN public.hosted_lane_batches b ON b.account_id=v.account_id AND b.workspace_id=v.workspace_id
      AND b.generation_request_id=v.generation_request_id AND b.lane=v.lane AND b.dispatch_task_id=a.task_id
    JOIN public.serverless_endpoint_deployments d ON d.id=a.deployment_id AND d.lane=a.lane
    JOIN public.hosted_paid_dispatch_claims c ON c.account_id=v.account_id AND c.workspace_id=v.workspace_id
      AND c.generation_request_id=v.generation_request_id
    JOIN public.hosted_paid_dispatch_approvals p ON p.id=c.approval_id
    JOIN public.generation_requests r ON r.account_id=v.account_id AND r.workspace_id=v.workspace_id
      AND r.id=v.generation_request_id
    JOIN public.project_revisions revision ON revision.account_id=v.account_id
      AND revision.workspace_id=v.workspace_id AND revision.id=a.project_revision_id
    JOIN public.provider_workload_leases lease ON lease.account_id=v.account_id
      AND lease.workspace_id=v.workspace_id AND lease.id=c.lease_id
    CROSS JOIN LATERAL (SELECT value FROM jsonb_array_elements(c.lane_bindings) value
      WHERE value->>'lane'=v.lane) binding
    JOIN public.hosted_serverless_qualification_attestations q
      ON q.id=(binding.value->>'qualification_attestation_id')::uuid AND q.lane=v.lane
    CROSS JOIN LATERAL (SELECT pgp_sym_decrypt(v.token_ciphertext,token_key) AS token) decrypted
   WHERE v.account_id=supplied_account_id AND v.workspace_id=supplied_workspace_id
     AND v.generation_request_id=supplied_generation_request_id
     AND a.generation_request_id=v.generation_request_id AND a.deadline_at>transaction_timestamp()
     AND a.state NOT IN ('SUCCEEDED','PERMANENT_FAILED','CANCELLED')
     AND r.state='ACTIVE' AND r.terminal_at IS NULL
     AND revision.status='LOCKED'
     AND lease.generation_request_id=v.generation_request_id AND lease.state='ACTIVE'
     AND lease.released_at IS NULL AND lease.expires_at>transaction_timestamp()
     AND c.expires_at>transaction_timestamp() AND p.expires_at>transaction_timestamp()
     AND q.independent_audit_accepted AND q.verified_at<=transaction_timestamp()
     AND q.expires_at>transaction_timestamp() AND q.deployment_id=d.id
     AND q.qualification_record_sha256=binding.value->>'qualification_record_sha256'
     AND q.deployment_snapshot_sha256=public.videoforge_hosted_deployment_snapshot_sha256(d.id)
     AND binding.value->>'deployment_snapshot_sha256'=q.deployment_snapshot_sha256
     AND d.is_active
     AND ('sha256:'||encode(sha256(convert_to(decrypted.token,'UTF8')),'hex'))=v.dispatch_token_sha256
   ORDER BY CASE v.lane WHEN 'mage_image' THEN 1 ELSE 2 END;
  GET DIAGNOSTICS recovered_count=ROW_COUNT;
  IF recovered_count<>2 THEN
    RAISE EXCEPTION 'hosted token recovery authority is stale or incomplete' USING ERRCODE='42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_recover_hosted_atomic_pair_tokens(uuid,uuid,uuid) FROM PUBLIC;

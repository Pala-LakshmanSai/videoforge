-- The retained 0046 promotion gate was intentionally bound to its then-terminal 46-row
-- ledger.  Replace only that gate after 0047/0048 so promotion sees the exact current 49-row
-- manifest.  The 0049 row is checked by immutable identity and sha256 shape, never by its own
-- hash, avoiding a self-referential migration hash.
CREATE OR REPLACE FUNCTION public.videoforge_promote_hosted_full_live(
  supplied_promotion_id uuid, supplied_authority_id uuid, supplied_promotion jsonb
) RETURNS TABLE(decision_sha256 text, migration_ledger_sha256 text, database_now timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp(); authority public.hosted_full_live_authorities%ROWTYPE;
  mage_q public.hosted_serverless_qualification_attestations%ROWTYPE;
  soulx_q public.hosted_serverless_qualification_attestations%ROWTYPE;
  mage_d public.serverless_endpoint_deployments%ROWTYPE;
  soulx_d public.serverless_endpoint_deployments%ROWTYPE;
  existing public.hosted_full_live_promotions%ROWTYPE;
  ledger jsonb; ledger_hash text; decision jsonb; decision_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_authority_id::text,45));
  SELECT * INTO authority FROM public.hosted_full_live_authorities WHERE id=supplied_authority_id FOR UPDATE;
  IF authority.id IS NULL OR authority.expires_at<db_now OR authority.approved_at>db_now
     OR supplied_promotion->>'authorityDocumentSha256'<>authority.authority_document_sha256
     OR supplied_promotion->>'sourceCommit'<>authority.source_commit
     OR supplied_promotion->>'executorSha256'<>authority.executor_sha256 THEN
    RAISE EXCEPTION 'hosted full-live authority unavailable or consumed' USING ERRCODE='42501';
  END IF;
  SELECT * INTO existing FROM public.hosted_full_live_promotions
    WHERE authority_id=supplied_authority_id;
  IF existing.id IS NOT NULL THEN
    IF existing.id<>supplied_promotion_id
       OR existing.migration_ledger_sha256<>supplied_promotion->>'migrationLedgerSha256'
       OR existing.disabled_config_sha256<>supplied_promotion->>'disabledConfigSha256'
       OR existing.enabled_config_sha256<>supplied_promotion->>'enabledConfigSha256'
       OR existing.decision_document->>'authorityDocumentSha256'<>supplied_promotion->>'authorityDocumentSha256'
       OR existing.decision_document->>'sourceCommit'<>supplied_promotion->>'sourceCommit'
       OR existing.decision_document->>'executorSha256'<>supplied_promotion->>'executorSha256'
       OR existing.decision_document->'lanes' IS DISTINCT FROM supplied_promotion->'lanes' THEN
      RAISE EXCEPTION 'hosted full-live promotion replay drift' USING ERRCODE='23505';
    END IF;
    RETURN QUERY SELECT existing.decision_sha256,existing.migration_ledger_sha256,existing.promoted_at;
    RETURN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.videoforge_schema_migrations WHERE version=40 AND sha256='sha256:9e7cbbecd515c8781f66a6888d1283abeb2e91baee4f61d6ad1857775a67c1a3')
     OR NOT EXISTS(SELECT 1 FROM public.videoforge_schema_migrations WHERE version=41 AND sha256='sha256:24f161e5c441f7cfa6b7837d185e64b3eae182d729c8ef21ef6850aeec9bcf84')
     OR NOT EXISTS(SELECT 1 FROM public.videoforge_schema_migrations WHERE version=42 AND sha256='sha256:d7168a4143a813df7b9114f76f1efe71aa287bec4b1f137ab414a98e65e6b967')
     OR NOT EXISTS(SELECT 1 FROM public.videoforge_schema_migrations WHERE version=44 AND sha256='sha256:8ab2a30c7df970531e521fac0662f666ef2689a908057fa4525a623c11622a6f')
     OR NOT EXISTS(SELECT 1 FROM public.videoforge_schema_migrations WHERE version=47 AND sha256='sha256:d9840c7033b823a7f9a03e13d7213c50b81d40c7f89423f6c6f4ecc7e8e8649a')
     OR NOT EXISTS(SELECT 1 FROM public.videoforge_schema_migrations WHERE version=48 AND sha256='sha256:8181d1c050690a8e15ce5cef7473a5caa872d5f868b18f059574dbd4fcbdc82d')
     OR NOT EXISTS(SELECT 1 FROM public.videoforge_schema_migrations
       WHERE version=49 AND name='hosted_full_live_promotion_lineage'
         AND filename='0049_hosted_full_live_promotion_lineage.sql'
         AND sha256 ~ '^sha256:[0-9a-f]{64}$')
     OR (SELECT count(*) FROM public.videoforge_schema_migrations)<>49
     OR (SELECT max(version) FROM public.videoforge_schema_migrations)<>49 THEN
    RAISE EXCEPTION 'hosted full-live migration lineage invalid' USING ERRCODE='23514';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('version',version,'name',name,'filename',filename,'sha256',sha256) ORDER BY version)
    INTO ledger FROM public.videoforge_schema_migrations;
  ledger_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(ledger),'UTF8')),'hex');
  IF supplied_promotion->>'migrationLedgerSha256'<>ledger_hash THEN
    RAISE EXCEPTION 'hosted full-live migration ledger hash invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO mage_q FROM public.hosted_serverless_qualification_attestations
    WHERE id=(supplied_promotion#>>'{lanes,mage_image,qualificationId}')::uuid FOR SHARE;
  SELECT * INTO soulx_q FROM public.hosted_serverless_qualification_attestations
    WHERE id=(supplied_promotion#>>'{lanes,soulx_avatar,qualificationId}')::uuid FOR SHARE;
  SELECT * INTO mage_d FROM public.serverless_endpoint_deployments
    WHERE id=(supplied_promotion#>>'{lanes,mage_image,deploymentId}')::uuid FOR SHARE;
  SELECT * INTO soulx_d FROM public.serverless_endpoint_deployments
    WHERE id=(supplied_promotion#>>'{lanes,soulx_avatar,deploymentId}')::uuid FOR SHARE;
  IF mage_q.lane<>'mage_image' OR soulx_q.lane<>'soulx_avatar'
     OR mage_q.deployment_id<>mage_d.id OR soulx_q.deployment_id<>soulx_d.id
     OR NOT mage_q.independent_audit_accepted OR NOT soulx_q.independent_audit_accepted
     OR mage_q.verified_at>db_now OR soulx_q.verified_at>db_now
     OR mage_q.expires_at<db_now OR soulx_q.expires_at<db_now
     OR mage_q.qualification_record_sha256<>supplied_promotion#>>'{lanes,mage_image,qualificationSha256}'
     OR soulx_q.qualification_record_sha256<>supplied_promotion#>>'{lanes,soulx_avatar,qualificationSha256}'
     OR NOT mage_d.is_active OR NOT soulx_d.is_active
     OR mage_d.worker_count_min<>0 OR soulx_d.worker_count_min<>0
     OR mage_d.worker_count_max<>1 OR soulx_d.worker_count_max<>1
     OR mage_d.region<>'EU-RO-1' OR soulx_d.region<>'EU-RO-1'
     OR mage_d.gpu_allowlist<>ARRAY['NVIDIA GeForce RTX 4090']::text[]
     OR soulx_d.gpu_allowlist<>ARRAY['NVIDIA GeForce RTX 4090']::text[]
     OR mage_q.deployment_snapshot_sha256<>public.videoforge_hosted_deployment_snapshot_sha256(mage_d.id)
     OR soulx_q.deployment_snapshot_sha256<>public.videoforge_hosted_deployment_snapshot_sha256(soulx_d.id)
     OR mage_q.deployment_snapshot_sha256<>supplied_promotion#>>'{lanes,mage_image,deploymentSnapshotSha256}'
     OR soulx_q.deployment_snapshot_sha256<>supplied_promotion#>>'{lanes,soulx_avatar,deploymentSnapshotSha256}'
     OR supplied_promotion->>'disabledConfigSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_promotion->>'enabledConfigSha256' !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'hosted full-live qualification or deployment invalid' USING ERRCODE='23514';
  END IF;
  decision:=jsonb_build_object('schemaVersion','videoforge-v2-13-full-live-promotion/v1',
    'authorityId',supplied_authority_id,'authorityDocumentSha256',authority.authority_document_sha256,
    'sourceCommit',authority.source_commit,'executorSha256',authority.executor_sha256,
    'migrationLedgerSha256',ledger_hash,'lanes',supplied_promotion->'lanes',
    'disabledConfigSha256',supplied_promotion->>'disabledConfigSha256',
    'enabledConfigSha256',supplied_promotion->>'enabledConfigSha256','databaseNow',db_now);
  decision_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(decision),'UTF8')),'hex');
  INSERT INTO public.hosted_full_live_promotions(id,authority_id,migration_ledger_sha256,
    mage_qualification_id,mage_qualification_sha256,mage_deployment_id,mage_deployment_snapshot_sha256,
    soulx_qualification_id,soulx_qualification_sha256,soulx_deployment_id,soulx_deployment_snapshot_sha256,
    disabled_config_sha256,enabled_config_sha256,decision_document,decision_sha256,promoted_by_operator,promoted_at)
  VALUES(supplied_promotion_id,supplied_authority_id,ledger_hash,mage_q.id,mage_q.qualification_record_sha256,
    mage_d.id,mage_q.deployment_snapshot_sha256,soulx_q.id,soulx_q.qualification_record_sha256,
    soulx_d.id,soulx_q.deployment_snapshot_sha256,supplied_promotion->>'disabledConfigSha256',
    supplied_promotion->>'enabledConfigSha256',decision,decision_hash,session_user,db_now);
  RETURN QUERY SELECT decision_hash,ledger_hash,db_now;
END;
$$;

-- Replacement preserves the 0045 grant and keeps the promotion boundary private.
REVOKE ALL ON FUNCTION public.videoforge_promote_hosted_full_live(uuid,uuid,jsonb) FROM PUBLIC;

-- Keep the activation read model on the same current ledger.  The original 0045 routine only
-- projected its 37..45 prefix, which would make a promoted 0049 database report stale lineage.
CREATE OR REPLACE FUNCTION public.videoforge_load_hosted_gpu_activation_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp(); promotion public.hosted_full_live_promotions%ROWTYPE;
  authority public.hosted_full_live_authorities%ROWTYPE; mage_q public.hosted_serverless_qualification_attestations%ROWTYPE;
  soulx_q public.hosted_serverless_qualification_attestations%ROWTYPE; mage_d public.serverless_endpoint_deployments%ROWTYPE;
  soulx_d public.serverless_endpoint_deployments%ROWTYPE; ledger jsonb; gate jsonb; evidence jsonb;
  cloudflare public.hosted_full_live_cloudflare_activations%ROWTYPE;
  evidence_hash text; gate_hash text; verification jsonb; verification_expiry timestamptz;
BEGIN
  SELECT p.* INTO promotion FROM public.hosted_full_live_promotions p
    JOIN public.hosted_full_live_authorities a ON a.id=p.authority_id
    WHERE a.expires_at>db_now ORDER BY p.promoted_at DESC LIMIT 1;
  IF promotion.id IS NULL THEN
    RAISE EXCEPTION 'hosted GPU activation unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO authority FROM public.hosted_full_live_authorities WHERE id=promotion.authority_id;
  SELECT * INTO mage_q FROM public.hosted_serverless_qualification_attestations WHERE id=promotion.mage_qualification_id;
  SELECT * INTO soulx_q FROM public.hosted_serverless_qualification_attestations WHERE id=promotion.soulx_qualification_id;
  SELECT * INTO mage_d FROM public.serverless_endpoint_deployments WHERE id=promotion.mage_deployment_id;
  SELECT * INTO soulx_d FROM public.serverless_endpoint_deployments WHERE id=promotion.soulx_deployment_id;
  SELECT * INTO cloudflare FROM public.hosted_full_live_cloudflare_activations WHERE promotion_id=promotion.id;
  IF mage_q.expires_at<=db_now OR soulx_q.expires_at<=db_now OR NOT mage_d.is_active OR NOT soulx_d.is_active
     OR cloudflare.id IS NULL OR cloudflare.source_commit<>authority.source_commit
     OR EXISTS(SELECT 1 FROM public.hosted_full_live_cloudflare_rollbacks rollback
       WHERE rollback.activation_id=cloudflare.id)
     OR cloudflare.deployed_config_sha256<>promotion.enabled_config_sha256
     OR cloudflare.observed_at>db_now OR cloudflare.observed_at<db_now-interval '5 minutes'
     OR mage_d.worker_count_max<>1 OR soulx_d.worker_count_max<>1
     OR mage_q.deployment_snapshot_sha256<>public.videoforge_hosted_deployment_snapshot_sha256(mage_d.id)
     OR soulx_q.deployment_snapshot_sha256<>public.videoforge_hosted_deployment_snapshot_sha256(soulx_d.id) THEN
    RAISE EXCEPTION 'hosted GPU activation drifted' USING ERRCODE='23514';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('version',version,'sha256',sha256) ORDER BY version)
    INTO ledger FROM public.videoforge_schema_migrations WHERE version BETWEEN 37 AND 49;
  gate:=jsonb_build_object('gpuTransport','QUALIFIED_EXACT','migrationLedger',ledger,
    'now',to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'cloudflare',jsonb_build_object('sourceCommit',cloudflare.source_commit,
      'versionIdSha256',cloudflare.version_id_sha256,'deployedConfigSha256',cloudflare.deployed_config_sha256,
      'readbackSha256',cloudflare.readback_sha256,
      'observedAt',to_char(cloudflare.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'qualifications',jsonb_build_object(
      'mage_image',jsonb_build_object('accepted',true,'verifiedAt',to_char(mage_q.verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'expiresAt',to_char(mage_q.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'qualificationRecordSha256',mage_q.qualification_record_sha256,'deploymentSnapshotSha256',mage_q.deployment_snapshot_sha256),
      'soulx_avatar',jsonb_build_object('accepted',true,'verifiedAt',to_char(soulx_q.verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'expiresAt',to_char(soulx_q.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'qualificationRecordSha256',soulx_q.qualification_record_sha256,'deploymentSnapshotSha256',soulx_q.deployment_snapshot_sha256)),
    'deployments',jsonb_build_object(
      'mage_image',jsonb_build_object('deploymentId',mage_d.id,'endpointIdSha256',mage_d.endpoint_id_sha256,
        'endpointConfigSha256',mage_d.endpoint_config_sha256,'workerImageDigest',mage_d.worker_image_digest,
        'modelManifestSha256',mage_d.model_manifest_sha256,'volumeIdSha256',mage_d.volume_id_sha256,
        'volumeManifestSha256',mage_d.volume_manifest_sha256,'region',mage_d.region,'gpuAllowlist',mage_d.gpu_allowlist,
        'deploymentSnapshotSha256',mage_q.deployment_snapshot_sha256,'authority',jsonb_build_object(
          'endpointConfigSha256',mage_d.endpoint_config_sha256,'endpointIdSha256',mage_d.endpoint_id_sha256,
          'gpuAllowlist',mage_d.gpu_allowlist,'modelManifestSha256',mage_d.model_manifest_sha256,'region',mage_d.region,
          'volumeIdSha256',mage_d.volume_id_sha256,'volumeManifestSha256',mage_d.volume_manifest_sha256,
          'workerImageDigest',mage_d.worker_image_digest)),
      'soulx_avatar',jsonb_build_object('deploymentId',soulx_d.id,'endpointIdSha256',soulx_d.endpoint_id_sha256,
        'endpointConfigSha256',soulx_d.endpoint_config_sha256,'workerImageDigest',soulx_d.worker_image_digest,
        'modelManifestSha256',soulx_d.model_manifest_sha256,'volumeIdSha256',soulx_d.volume_id_sha256,
        'volumeManifestSha256',soulx_d.volume_manifest_sha256,'region',soulx_d.region,'gpuAllowlist',soulx_d.gpu_allowlist,
        'deploymentSnapshotSha256',soulx_q.deployment_snapshot_sha256,'authority',jsonb_build_object(
          'endpointConfigSha256',soulx_d.endpoint_config_sha256,'endpointIdSha256',soulx_d.endpoint_id_sha256,
          'gpuAllowlist',soulx_d.gpu_allowlist,'modelManifestSha256',soulx_d.model_manifest_sha256,'region',soulx_d.region,
          'volumeIdSha256',soulx_d.volume_id_sha256,'volumeManifestSha256',soulx_d.volume_manifest_sha256,
          'workerImageDigest',soulx_d.worker_image_digest))),
    'paidApproval',jsonb_build_object('approved',true,'exact',true,
      'expiresAt',to_char(authority.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'bindings',jsonb_build_object('runtimeDatabase','VIDEOFORGE_RUNTIME_DATABASE',
      'reconcilerDatabase','VIDEOFORGE_RECONCILER_DATABASE','dispatchTokenKey','VIDEOFORGE_DISPATCH_TOKEN_KEY',
      'envelopeSignerKey','VIDEOFORGE_ENVELOPE_SIGNING_KEY','providerProofVerifierKey','VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY',
      'workflowOperatorToken','VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN'));
  evidence:=promotion.decision_document;
  evidence_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(evidence),'UTF8')),'hex');
  gate_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(gate),'UTF8')),'hex');
  verification_expiry:=least(authority.expires_at,db_now+interval '5 minutes');
  verification:=jsonb_build_object('verifierId','videoforge-hosted-qualified-gpu-activation-verifier-v1',
    'accepted',true,'signatureVerified',true,'canonicalEvidenceSha256',evidence_hash,
    'verifierSignatureSha256',promotion.decision_sha256,'sourceCommit',authority.source_commit,
    'databaseObservedAt',to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt',to_char(verification_expiry AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'activationSnapshotSha256',gate_hash,'paidApprovalLedgerSha256',authority.approval_sha256,'gate',gate);
  RETURN jsonb_build_object('evidence',evidence,'verification',verification);
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_load_hosted_gpu_activation_v1() FROM PUBLIC;

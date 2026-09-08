-- Permit an append-only activation rebind when the same source/config is deployed as a
-- distinct immutable Cloudflare version.  Historical activation evidence and its frozen lane
-- qualification references remain untouched; a repeated source/config/version triple is still
-- rejected by the unique constraint.
DO $rebind_constraint$
DECLARE
  old_constraint text;
  old_constraint_count integer;
BEGIN
  -- PostgreSQL truncates the auto-generated name for the historical two-column UNIQUE. Resolve
  -- it by its exact column set so a missing or already-rebound schema fails closed.
  SELECT count(*)::integer,min(c.conname) INTO old_constraint_count,old_constraint
    FROM pg_constraint c
   WHERE c.conrelid='public.hosted_v209_qualified_activations'::regclass
     AND c.contype='u'
     AND c.conkey=ARRAY[
       (SELECT attnum FROM pg_attribute
         WHERE attrelid=c.conrelid AND attname='source_commit' AND NOT attisdropped),
       (SELECT attnum FROM pg_attribute
         WHERE attrelid=c.conrelid AND attname='deployed_config_sha256' AND NOT attisdropped)
     ]::smallint[];
  IF old_constraint_count<>1 OR old_constraint IS NULL THEN
    RAISE EXCEPTION 'hosted V2-09 activation rebind predecessor uniqueness is not exact'
      USING ERRCODE='23514';
  END IF;
  EXECUTE format('ALTER TABLE public.hosted_v209_qualified_activations DROP CONSTRAINT %I',old_constraint);
END;
$rebind_constraint$;
ALTER TABLE public.hosted_v209_qualified_activations
  ADD CONSTRAINT hosted_v209_qualified_activations_source_config_version_key
  UNIQUE(source_commit,deployed_config_sha256,cloudflare_version_id_sha256);

-- Select the most recently imported immutable activation deterministically.  imported_at remains
-- the primary recency boundary; id is a stable final tie-breaker for same-transaction imports.
CREATE OR REPLACE FUNCTION public.videoforge_load_hosted_gpu_activation_v2() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  activation public.hosted_v209_qualified_activations%ROWTYPE;
  mage_d public.serverless_endpoint_deployments%ROWTYPE;
  soulx_d public.serverless_endpoint_deployments%ROWTYPE;
  mage_q public.hosted_serverless_qualification_attestations%ROWTYPE;
  soulx_q public.hosted_serverless_qualification_attestations%ROWTYPE;
  ledger jsonb; gate jsonb; evidence jsonb; evidence_hash text; gate_hash text;
  verification_expiry timestamptz;
BEGIN
  SELECT * INTO activation FROM public.hosted_v209_qualified_activations
    WHERE observed_at<=db_now
    ORDER BY imported_at DESC,id DESC LIMIT 1;
  IF activation.id IS NULL THEN
    RAISE EXCEPTION 'hosted GPU activation v2 unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO mage_d FROM public.serverless_endpoint_deployments WHERE id=activation.mage_deployment_id;
  SELECT * INTO soulx_d FROM public.serverless_endpoint_deployments WHERE id=activation.soulx_deployment_id;
  SELECT * INTO mage_q FROM public.hosted_serverless_qualification_attestations WHERE id=activation.mage_qualification_id;
  SELECT * INTO soulx_q FROM public.hosted_serverless_qualification_attestations WHERE id=activation.soulx_qualification_id;
  IF NOT mage_d.is_active OR NOT soulx_d.is_active OR mage_d.worker_count_min<>0
     OR soulx_d.worker_count_min<>0 OR mage_d.worker_count_max<>1 OR soulx_d.worker_count_max<>1
     OR mage_d.handler_concurrency<>1 OR soulx_d.handler_concurrency<>1
     OR mage_d.region<>'EU-RO-1' OR soulx_d.region<>'EU-RO-1'
     OR mage_d.gpu_allowlist<>ARRAY['NVIDIA GeForce RTX 4090']::text[]
     OR soulx_d.gpu_allowlist<>ARRAY['NVIDIA GeForce RTX 4090']::text[]
     OR mage_q.expires_at<=db_now OR soulx_q.expires_at<=db_now
     OR mage_q.deployment_snapshot_sha256<>
        public.videoforge_hosted_deployment_snapshot_sha256(mage_d.id)
     OR soulx_q.deployment_snapshot_sha256<>
        public.videoforge_hosted_deployment_snapshot_sha256(soulx_d.id)
     OR NOT mage_q.independent_audit_accepted OR NOT soulx_q.independent_audit_accepted THEN
    RAISE EXCEPTION 'hosted GPU activation v2 drifted' USING ERRCODE='23514';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('version',version,'sha256',sha256) ORDER BY version)
    INTO ledger FROM public.videoforge_schema_migrations WHERE version BETWEEN 37 AND 87;
  gate:=jsonb_build_object('gpuTransport','QUALIFIED_EXACT','migrationLedger',ledger,
    'now',to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'cloudflare',jsonb_build_object('sourceCommit',activation.source_commit,
      'versionIdSha256',activation.cloudflare_version_id_sha256,
      'deployedConfigSha256',activation.deployed_config_sha256,
      'readbackSha256',activation.readback_sha256,
      'observedAt',to_char(activation.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'databaseVerification',jsonb_build_object('kind','PERSISTED_EXACT_ACTIVATION',
        'observedAt',to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'expiresAt',to_char(least(mage_q.expires_at,soulx_q.expires_at,db_now+interval '5 minutes')
          AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
    'qualifications',jsonb_build_object(
      'mage_image',jsonb_build_object('accepted',true,
        'verifiedAt',to_char(mage_q.verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'expiresAt',to_char(mage_q.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'qualificationRecordSha256',mage_q.qualification_record_sha256,
        'deploymentSnapshotSha256',mage_q.deployment_snapshot_sha256),
      'soulx_avatar',jsonb_build_object('accepted',true,
        'verifiedAt',to_char(soulx_q.verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'expiresAt',to_char(soulx_q.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'qualificationRecordSha256',soulx_q.qualification_record_sha256,
        'deploymentSnapshotSha256',soulx_q.deployment_snapshot_sha256)),
    'deployments',jsonb_build_object(
      'mage_image',jsonb_build_object('deploymentId',mage_d.id,'endpointIdSha256',mage_d.endpoint_id_sha256,
        'endpointConfigSha256',mage_d.endpoint_config_sha256,'workerImageDigest',mage_d.worker_image_digest,
        'modelManifestSha256',mage_d.model_manifest_sha256,'volumeIdSha256',mage_d.volume_id_sha256,
        'volumeManifestSha256',mage_d.volume_manifest_sha256,'region',mage_d.region,
        'gpuAllowlist',mage_d.gpu_allowlist,'deploymentSnapshotSha256',mage_q.deployment_snapshot_sha256,
        'authority',jsonb_build_object('endpointConfigSha256',mage_d.endpoint_config_sha256,
          'endpointIdSha256',mage_d.endpoint_id_sha256,'gpuAllowlist',mage_d.gpu_allowlist,
          'modelManifestSha256',mage_d.model_manifest_sha256,'region',mage_d.region,
          'volumeIdSha256',mage_d.volume_id_sha256,'volumeManifestSha256',mage_d.volume_manifest_sha256,
          'workerImageDigest',mage_d.worker_image_digest)),
      'soulx_avatar',jsonb_build_object('deploymentId',soulx_d.id,'endpointIdSha256',soulx_d.endpoint_id_sha256,
        'endpointConfigSha256',soulx_d.endpoint_config_sha256,'workerImageDigest',soulx_d.worker_image_digest,
        'modelManifestSha256',soulx_d.model_manifest_sha256,'volumeIdSha256',soulx_d.volume_id_sha256,
        'volumeManifestSha256',soulx_d.volume_manifest_sha256,'region',soulx_d.region,
        'gpuAllowlist',soulx_d.gpu_allowlist,'deploymentSnapshotSha256',soulx_q.deployment_snapshot_sha256,
        'authority',jsonb_build_object('endpointConfigSha256',soulx_d.endpoint_config_sha256,
          'endpointIdSha256',soulx_d.endpoint_id_sha256,'gpuAllowlist',soulx_d.gpu_allowlist,
          'modelManifestSha256',soulx_d.model_manifest_sha256,'region',soulx_d.region,
          'volumeIdSha256',soulx_d.volume_id_sha256,'volumeManifestSha256',soulx_d.volume_manifest_sha256,
          'workerImageDigest',soulx_d.worker_image_digest))),
    'paidApproval',jsonb_build_object('approved',true,'exact',true,
      'expiresAt',to_char(least(mage_q.expires_at,soulx_q.expires_at) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'bindings',jsonb_build_object('runtimeDatabase','VIDEOFORGE_RUNTIME_DATABASE',
      'reconcilerDatabase','VIDEOFORGE_RECONCILER_DATABASE',
      'dispatchTokenKey','VIDEOFORGE_DISPATCH_TOKEN_KEY',
      'envelopeSignerKey','VIDEOFORGE_ENVELOPE_SIGNING_KEY',
      'providerProofVerifierKey','VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY',
      'workflowOperatorToken','VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN'));
  gate_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(gate),'UTF8')),'hex');
  evidence:=activation.evidence_document||jsonb_build_object(
    'enabledConfigSha256',activation.deployed_config_sha256);
  evidence_hash:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(evidence),'UTF8')),'hex');
  verification_expiry:=least(mage_q.expires_at,soulx_q.expires_at,db_now+interval '5 minutes');
  RETURN jsonb_build_object('evidence',evidence,'verification',jsonb_build_object(
    'verifierId','videoforge-hosted-qualified-gpu-activation-verifier-v1','accepted',true,
    'signatureVerified',true,'canonicalEvidenceSha256',evidence_hash,
    'verifierSignatureSha256',activation.evidence_sha256,'sourceCommit',activation.source_commit,
    'databaseObservedAt',to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt',to_char(verification_expiry AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'activationSnapshotSha256',gate_hash,'paidApprovalLedgerSha256',activation.evidence_sha256,
    'gate',gate));
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_load_hosted_gpu_activation_v2() FROM PUBLIC;

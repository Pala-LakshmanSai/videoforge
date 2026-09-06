-- Ordinary authenticated V2-09 dispatch and narrow qualified activation.
--
-- This migration is additive.  The historical 0042 fixed qualification fixture remains byte-for-byte
-- unchanged.  Browser callers provide only tenant/user/project scope.  PostgreSQL derives every
-- revision, request, lease, deployment, qualification, task, prompt, span, reservation, and authority
-- identity from durable state before it creates provider-sendable rows.

CREATE TABLE public.hosted_v209_ordinary_dispatch_candidates (
  generation_request_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  generation_plan_sha256 text NOT NULL CHECK(generation_plan_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  work_manifest_sha256 text NOT NULL CHECK(work_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  candidate_sha256 text NOT NULL UNIQUE CHECK(candidate_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  approval_id uuid NOT NULL UNIQUE,
  candidate_document jsonb NOT NULL CHECK(
    jsonb_typeof(candidate_document)='object'
    AND candidate_document->>'schemaVersion'='videoforge.hosted-v209-ordinary-dispatch/v1'
  ),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(account_id,workspace_id,generation_request_id),
  FOREIGN KEY(account_id,workspace_id,generation_request_id)
    REFERENCES public.generation_requests(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,project_id)
    REFERENCES public.projects(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,project_revision_id)
    REFERENCES public.project_revisions(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,lease_id)
    REFERENCES public.provider_workload_leases(account_id,workspace_id,id),
  FOREIGN KEY(approval_id) REFERENCES public.hosted_paid_dispatch_approvals(id),
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours')
);

CREATE TRIGGER hosted_v209_ordinary_dispatch_candidates_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_v209_ordinary_dispatch_candidates
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_v209_ordinary_dispatch_candidates_tenant_write_guard
  BEFORE INSERT ON public.hosted_v209_ordinary_dispatch_candidates
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE public.hosted_v209_ordinary_dispatch_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_v209_ordinary_dispatch_candidates FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_v209_ordinary_dispatch_candidates_tenant_rls
  ON public.hosted_v209_ordinary_dispatch_candidates
  USING(account_id=public.videoforge_current_account_id())
  WITH CHECK(account_id=public.videoforge_current_account_id());

-- Exact worker input is materialized only after the DB pair exists and the runtime has minted
-- one-use signed ports.  This append-only CAS is the durable boundary between construction and
-- the irreversible one-shot /run send.
CREATE TABLE public.hosted_v209_ordinary_lane_materializations (
  attempt_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  generation_request_id uuid NOT NULL,
  lane text NOT NULL CHECK(lane IN ('mage_image','soulx_avatar')),
  envelope_sha256 text NOT NULL CHECK(envelope_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  full_request_sha256 text NOT NULL CHECK(full_request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  request_body jsonb NOT NULL CHECK(jsonb_typeof(request_body)='object'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(account_id,workspace_id,generation_request_id,lane),
  UNIQUE(full_request_sha256),
  FOREIGN KEY(account_id,workspace_id,generation_request_id)
    REFERENCES public.generation_requests(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,attempt_id)
    REFERENCES public.serverless_attempts(account_id,workspace_id,id)
);
CREATE TRIGGER hosted_v209_ordinary_lane_materializations_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_v209_ordinary_lane_materializations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_v209_ordinary_lane_materializations_tenant_write_guard
  BEFORE INSERT ON public.hosted_v209_ordinary_lane_materializations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE public.hosted_v209_ordinary_lane_materializations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_v209_ordinary_lane_materializations FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_v209_ordinary_lane_materializations_tenant_rls
  ON public.hosted_v209_ordinary_lane_materializations
  USING(account_id=public.videoforge_current_account_id())
  WITH CHECK(account_id=public.videoforge_current_account_id());

-- Operator-only import.  It pins the exact frozen qualification acceptance artifacts and immutable
-- image/source/config identities, then binds them to fresh readbacks of two already-created exact
-- max-one production deployments.  It does not invent historical receipts for new endpoint IDs.
CREATE TABLE public.hosted_v209_qualified_activations (
  id uuid PRIMARY KEY,
  source_commit text NOT NULL CHECK(source_commit ~ '^[0-9a-f]{40}$'),
  deployed_config_sha256 text NOT NULL CHECK(deployed_config_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  cloudflare_version_id_sha256 text NOT NULL CHECK(cloudflare_version_id_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  readback_sha256 text NOT NULL CHECK(readback_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  mage_deployment_id uuid NOT NULL,
  mage_qualification_id uuid NOT NULL,
  soulx_deployment_id uuid NOT NULL,
  soulx_qualification_id uuid NOT NULL,
  evidence_sha256 text NOT NULL UNIQUE CHECK(evidence_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  evidence_document jsonb NOT NULL CHECK(jsonb_typeof(evidence_document)='object'),
  imported_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE(source_commit,deployed_config_sha256),
  FOREIGN KEY(mage_deployment_id) REFERENCES public.serverless_endpoint_deployments(id),
  FOREIGN KEY(soulx_deployment_id) REFERENCES public.serverless_endpoint_deployments(id),
  FOREIGN KEY(mage_qualification_id) REFERENCES public.hosted_serverless_qualification_attestations(id),
  FOREIGN KEY(soulx_qualification_id) REFERENCES public.hosted_serverless_qualification_attestations(id)
);

CREATE TRIGGER hosted_v209_qualified_activations_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_v209_qualified_activations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();

CREATE FUNCTION public.videoforge_hosted_v209_uuid(
  supplied_kind text, supplied_generation_request_id uuid, supplied_discriminator text
) RETURNS uuid LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=public,pg_catalog AS $$
DECLARE digest text;
BEGIN
  IF supplied_kind NOT IN ('candidate','approval','batch','dispatch-task','input-reservation',
       'output-reservation','claim') OR length(supplied_discriminator) NOT BETWEEN 1 AND 240 THEN
    RAISE EXCEPTION 'hosted V2-09 UUID input invalid' USING ERRCODE='22023';
  END IF;
  digest:=encode(sha256(convert_to('hosted-v209-ordinary-'||supplied_kind||':'||
    supplied_generation_request_id::text||':'||supplied_discriminator,'UTF8')),'hex');
  digest:=substring(digest,1,12)||'5'||substring(digest,14,3)||'8'||substring(digest,18,15);
  RETURN (substring(digest,1,8)||'-'||substring(digest,9,4)||'-'||substring(digest,13,4)||'-'||
    substring(digest,17,4)||'-'||substring(digest,21,12))::uuid;
END;
$$;

CREATE FUNCTION public.videoforge_import_hosted_v209_qualified_activation(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  lane_name text; lane_doc jsonb; qualification_document jsonb;
  deployment public.serverless_endpoint_deployments%ROWTYPE;
  existing public.hosted_serverless_qualification_attestations%ROWTYPE;
  activation public.hosted_v209_qualified_activations%ROWTYPE;
  qualification_id uuid; evidence_hash text; activation_evidence jsonb;
  mage_deployment uuid; soulx_deployment uuid; mage_qualification uuid; soulx_qualification uuid;
  expected_acceptance text; expected_image text; expected_source text; expected_config text;
  expected_anonymous_proof text; expected_model_manifest text; expected_volume_id text;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['activationId','cloudflareVersionIdSha256','deployedConfigSha256',
         'lanes','observedAt','readbackSha256','schemaVersion','sourceCommit']::text[]
     OR supplied->>'schemaVersion'<>'videoforge.hosted-v209-qualified-activation-import/v1'
     OR supplied->>'activationId' !~ '^[0-9a-f-]{36}$'
     OR supplied->>'sourceCommit' !~ '^[0-9a-f]{40}$'
     OR supplied->>'deployedConfigSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'cloudflareVersionIdSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'readbackSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR (supplied->>'observedAt')::timestamptz>db_now
     OR (supplied->>'observedAt')::timestamptz<db_now-interval '5 minutes'
     OR jsonb_typeof(supplied->'lanes')<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied->'lanes') key)
       IS DISTINCT FROM ARRAY['mage_image','soulx_avatar']::text[] THEN
    RAISE EXCEPTION 'hosted V2-09 qualified activation import invalid' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied->>'sourceCommit',74));
  SELECT * INTO activation FROM public.hosted_v209_qualified_activations
    WHERE id=(supplied->>'activationId')::uuid;
  IF activation.id IS NOT NULL THEN
    IF activation.evidence_document IS DISTINCT FROM supplied THEN
      RAISE EXCEPTION 'hosted V2-09 qualified activation replay drift' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('schemaVersion','videoforge.hosted-v209-qualified-activation-result/v1',
      'activationId',activation.id,'evidenceSha256',activation.evidence_sha256,'replayed',true);
  END IF;

  FOREACH lane_name IN ARRAY ARRAY['mage_image','soulx_avatar'] LOOP
    lane_doc:=supplied->'lanes'->lane_name;
    IF jsonb_typeof(lane_doc)<>'object'
       OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(lane_doc) key)
         IS DISTINCT FROM ARRAY['acceptanceArtifactSha256','anonymousProofSha256','deploymentId',
           'deploymentReadbackSha256','imageConfigSha256','imageSourceCommit','qualificationId']::text[]
       OR lane_doc->>'deploymentId' !~ '^[0-9a-f-]{36}$'
       OR lane_doc->>'qualificationId' !~ '^[0-9a-f-]{36}$'
       OR lane_doc->>'acceptanceArtifactSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR lane_doc->>'anonymousProofSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR lane_doc->>'deploymentReadbackSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR lane_doc->>'imageConfigSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR lane_doc->>'imageSourceCommit' !~ '^[0-9a-f]{40}$' THEN
      RAISE EXCEPTION 'hosted V2-09 qualification lane import invalid' USING ERRCODE='23514';
    END IF;
    IF lane_name='mage_image' THEN
      expected_acceptance:='sha256:aeef45f237fd07e0937cdd51eaaf545ac0d8bb4c90eb105708f1681da787cc79';
      expected_image:='sha256:0f3203ceaedd8d570dcca301e32ca6d0ecb4d1136c32d5cd7d76fdc292a030cb';
      expected_source:='aceef8e0d0d678468ea9560f1faa94aa562fc466';
      expected_config:='sha256:fe08710bb809b702d8efe46b4d67d100b9f9630c8969f62efe7fd1b54d069897';
      expected_anonymous_proof:='sha256:eca6cfe6acec62ed63ec1f7c9d40e7fb14e908c6e594da3864f936fa53670704';
      expected_model_manifest:='sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b';
      expected_volume_id:='sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619';
    ELSE
      expected_acceptance:='sha256:aec6b4eca1b51db5b1742e806d28a26c32359a1ddecb615afae1a834dbdf15aa';
      expected_image:='sha256:f3b1d1414308d0783fe006d33e6482c027e05b6029a07843af66e4a9e1c1380e';
      expected_source:='73181707e49be61955af4f2891f4c7185a1c288f';
      expected_config:='sha256:224b2a728490cf1c708b42e56702da2b71bd2374658f0c640dd39ef23e860935';
      expected_anonymous_proof:='sha256:9929d19da89ab2c20e280ac45ad152bc325b8bf56ef1e9c21e83d473c3408bc4';
      expected_model_manifest:='sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626';
      expected_volume_id:='sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be';
    END IF;
    IF lane_doc->>'acceptanceArtifactSha256'<>expected_acceptance
       OR lane_doc->>'imageSourceCommit'<>expected_source
       OR lane_doc->>'imageConfigSha256'<>expected_config
       OR lane_doc->>'anonymousProofSha256'<>expected_anonymous_proof THEN
      RAISE EXCEPTION 'hosted V2-09 frozen qualification identity drifted' USING ERRCODE='23514';
    END IF;
    SELECT * INTO deployment FROM public.serverless_endpoint_deployments d
      WHERE d.id=(lane_doc->>'deploymentId')::uuid AND d.lane=lane_name FOR SHARE;
    IF deployment.id IS NULL OR NOT deployment.is_active OR deployment.worker_count_min<>0
       OR deployment.worker_count_max<>1 OR deployment.handler_concurrency<>1
       OR deployment.region<>'EU-RO-1'
       OR deployment.gpu_allowlist<>ARRAY['NVIDIA GeForce RTX 4090']::text[]
       OR deployment.gpu_count_per_worker<>1 OR deployment.volume_mount<>'/runpod-volume'
       OR deployment.volume_size_gb<>50 OR deployment.blind_resubmit_permitted
       OR deployment.retained_active_workers<>0 OR deployment.worker_image_digest<>expected_image
       OR deployment.model_manifest_sha256<>expected_model_manifest
       OR deployment.volume_manifest_sha256<>expected_model_manifest
       OR deployment.volume_id_sha256<>expected_volume_id THEN
      RAISE EXCEPTION 'hosted V2-09 production deployment is not exact max-one' USING ERRCODE='23514';
    END IF;
    qualification_document:=jsonb_build_object('schemaVersion',
      'videoforge.hosted-v209-frozen-qualification-binding/v1','checkpointId',
      CASE lane_name WHEN 'mage_image' THEN 'V2-07' ELSE 'V2-08' END,
      'status','QUALIFIED_PASS_CLEAN','acceptanceArtifactSha256',expected_acceptance,
      'imageDigest',expected_image,'imageSourceCommit',expected_source,
      'imageConfigSha256',expected_config,'anonymousProofSha256',expected_anonymous_proof,
      'deploymentId',deployment.id,'deploymentSnapshotSha256',
      public.videoforge_hosted_deployment_snapshot_sha256(deployment.id),
      'deploymentReadbackSha256',lane_doc->>'deploymentReadbackSha256',
      'noRedispatch',true,'retainedVolumeMutation',false);
    evidence_hash:='sha256:'||encode(sha256(convert_to(
      public.videoforge_canonical_jsonb(qualification_document),'UTF8')),'hex');
    qualification_id:=(lane_doc->>'qualificationId')::uuid;
    SELECT * INTO existing FROM public.hosted_serverless_qualification_attestations
      WHERE id=qualification_id;
    IF existing.id IS NOT NULL THEN
      IF existing.lane<>lane_name OR existing.deployment_id<>deployment.id
         OR existing.qualification_record_sha256<>evidence_hash
         OR existing.deployment_snapshot_sha256<>
            public.videoforge_hosted_deployment_snapshot_sha256(deployment.id)
         OR NOT existing.independent_audit_accepted OR existing.expires_at<=db_now THEN
        RAISE EXCEPTION 'hosted V2-09 qualification attestation replay drift' USING ERRCODE='23505';
      END IF;
    ELSE
      INSERT INTO public.hosted_serverless_qualification_attestations(id,lane,deployment_id,
        deployment_snapshot_sha256,qualification_record_sha256,independent_audit_accepted,
        verified_at,expires_at,created_by_operator,created_at)
      VALUES(qualification_id,lane_name,deployment.id,
        public.videoforge_hosted_deployment_snapshot_sha256(deployment.id),evidence_hash,true,
        db_now,db_now+interval '24 hours',session_user,db_now);
    END IF;
    IF lane_name='mage_image' THEN
      mage_deployment:=deployment.id; mage_qualification:=qualification_id;
    ELSE
      soulx_deployment:=deployment.id; soulx_qualification:=qualification_id;
    END IF;
  END LOOP;
  activation_evidence:=supplied;
  evidence_hash:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(activation_evidence),'UTF8')),'hex');
  INSERT INTO public.hosted_v209_qualified_activations(id,source_commit,deployed_config_sha256,
    cloudflare_version_id_sha256,readback_sha256,observed_at,mage_deployment_id,
    mage_qualification_id,soulx_deployment_id,soulx_qualification_id,evidence_sha256,
    evidence_document,imported_at)
  VALUES((supplied->>'activationId')::uuid,supplied->>'sourceCommit',
    supplied->>'deployedConfigSha256',supplied->>'cloudflareVersionIdSha256',
    supplied->>'readbackSha256',(supplied->>'observedAt')::timestamptz,mage_deployment,
    mage_qualification,soulx_deployment,soulx_qualification,evidence_hash,activation_evidence,db_now);
  RETURN jsonb_build_object('schemaVersion','videoforge.hosted-v209-qualified-activation-result/v1',
    'activationId',supplied->>'activationId','evidenceSha256',evidence_hash,'replayed',false);
END;
$$;

CREATE FUNCTION public.videoforge_load_hosted_gpu_activation_v2() RETURNS jsonb
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
    WHERE observed_at<=db_now AND observed_at>=db_now-interval '5 minutes'
    ORDER BY imported_at DESC LIMIT 1;
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
    INTO ledger FROM public.videoforge_schema_migrations WHERE version BETWEEN 37 AND 49;
  gate:=jsonb_build_object('gpuTransport','QUALIFIED_EXACT','migrationLedger',ledger,
    'now',to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'cloudflare',jsonb_build_object('sourceCommit',activation.source_commit,
      'versionIdSha256',activation.cloudflare_version_id_sha256,
      'deployedConfigSha256',activation.deployed_config_sha256,
      'readbackSha256',activation.readback_sha256,
      'observedAt',to_char(activation.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
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

CREATE FUNCTION public.videoforge_materialize_hosted_v209_ordinary_dispatch(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_user_id uuid,
  supplied_project_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  request public.generation_requests%ROWTYPE;
  revision public.project_revisions%ROWTYPE;
  lease public.provider_workload_leases%ROWTYPE;
  bridge public.hosted_canonical_timing_bridges%ROWTYPE;
  plan public.timeline_plans%ROWTYPE;
  runtime public.video_runtime_states%ROWTYPE;
  stored public.hosted_v209_ordinary_dispatch_candidates%ROWTYPE;
  deployment public.serverless_endpoint_deployments%ROWTYPE;
  qualification public.hosted_serverless_qualification_attestations%ROWTYPE;
  task_row record; prompt_row record; span_row record; lane_name text;
  generation_tasks jsonb; generation_plan jsonb; render_plan jsonb;
  batches jsonb:='[]'::jsonb; batch jsonb; items jsonb; item jsonb;
  mage_work jsonb:='[]'::jsonb; soulx_work jsonb:='[]'::jsonb; work jsonb;
  lane_bindings jsonb:='[]'::jsonb; lane_binding jsonb; pair jsonb:='[]'::jsonb;
  item_manifest jsonb; input_manifest jsonb; reservation_manifest jsonb; reservation_ids jsonb;
  worker_reservation_ids jsonb;
  batch_id uuid; dispatch_task_id uuid; attempt_id uuid; input_id uuid; output_id uuid;
  avatar_input_id uuid;
  output_prefix text; role_name text; artifact_input jsonb; output_reservation jsonb;
  artifact_sha text; work_item jsonb; request_body jsonb; envelope jsonb;
  items_sha text; input_sha text; reservation_sha text; request_sha text; envelope_sha text;
  approval_id uuid; approval_base jsonb; approval_sha text; candidate_base jsonb; candidate_sha text;
  expires_at timestamptz; materialized_replay boolean; attempt_count integer;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR NOT EXISTS(SELECT 1 FROM public.memberships m WHERE m.account_id=supplied_account_id
       AND m.workspace_id=supplied_workspace_id AND m.user_id=supplied_user_id AND m.status='ACTIVE')
     OR NOT EXISTS(SELECT 1 FROM public.projects p WHERE p.account_id=supplied_account_id
       AND p.workspace_id=supplied_workspace_id AND p.id=supplied_project_id AND p.status='ACTIVE') THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary project scope invalid' USING ERRCODE='42501';
  END IF;
  SELECT r.* INTO request FROM public.generation_requests r
    WHERE r.account_id=supplied_account_id AND r.workspace_id=supplied_workspace_id
      AND r.project_id=supplied_project_id AND r.state='ACTIVE' AND r.terminal_at IS NULL
    ORDER BY r.created_at DESC,r.id DESC LIMIT 1 FOR UPDATE;
  IF request.id IS NULL OR request.created_by_user_id<>supplied_user_id THEN
    RAISE EXCEPTION 'hosted V2-09 active generation request unavailable' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(request.id::text,41));
  SELECT c.* INTO stored FROM public.hosted_v209_ordinary_dispatch_candidates c
    WHERE c.account_id=supplied_account_id AND c.workspace_id=supplied_workspace_id
      AND c.generation_request_id=request.id FOR SHARE;
  IF stored.generation_request_id IS NOT NULL THEN
    SELECT count(*)::integer INTO attempt_count FROM public.serverless_attempts a
      WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id
        AND a.generation_request_id=request.id;
    IF attempt_count NOT IN (0,2) OR stored.expires_at<=db_now THEN
      RAISE EXCEPTION 'hosted V2-09 candidate is stale or partially dispatched' USING ERRCODE='23505';
    END IF;
    RETURN stored.candidate_document||jsonb_build_object('candidateSha256',stored.candidate_sha256,
      'replayed',true,'pairExists',attempt_count=2,'existingWorkflowId',
      CASE WHEN attempt_count=2 THEN 'hosted-pair-'||request.id::text ELSE NULL END);
  END IF;
  IF EXISTS(SELECT 1 FROM public.serverless_attempts a WHERE a.account_id=supplied_account_id
       AND a.workspace_id=supplied_workspace_id AND a.generation_request_id=request.id) THEN
    RAISE EXCEPTION 'hosted V2-09 redispatch forbidden' USING ERRCODE='23505';
  END IF;
  SELECT r.* INTO revision FROM public.project_revisions r
    WHERE r.account_id=supplied_account_id AND r.workspace_id=supplied_workspace_id
      AND r.project_id=supplied_project_id AND r.id=request.project_revision_id FOR SHARE;
  SELECT l.* INTO lease FROM public.provider_workload_leases l
    WHERE l.account_id=supplied_account_id AND l.workspace_id=supplied_workspace_id
      AND l.generation_request_id=request.id AND l.request_kind='VIDEO' AND l.state='ACTIVE'
      AND l.released_at IS NULL AND l.expires_at>db_now FOR UPDATE;
  SELECT b.* INTO bridge FROM public.hosted_canonical_timing_bridges b
    WHERE b.account_id=supplied_account_id AND b.workspace_id=supplied_workspace_id
      AND b.project_id=supplied_project_id AND b.project_revision_id=request.project_revision_id FOR SHARE;
  SELECT p.* INTO plan FROM public.timeline_plans p WHERE p.account_id=supplied_account_id
    AND p.workspace_id=supplied_workspace_id AND p.project_revision_id=request.project_revision_id
    AND p.id=bridge.timeline_plan_id FOR SHARE;
  SELECT v.* INTO runtime FROM public.video_runtime_states v WHERE v.account_id=supplied_account_id
    AND v.workspace_id=supplied_workspace_id AND v.generation_request_id=request.id FOR UPDATE;
  IF revision.id IS NULL OR revision.status<>'LOCKED' OR lease.id IS NULL
     OR bridge.hosted_asr_attempt_id IS NULL OR plan.id IS NULL
     OR runtime.id IS NULL OR runtime.project_id<>supplied_project_id
     OR runtime.project_revision_id<>revision.id OR runtime.stage<>'WAITING_FOR_WORKER'
     OR runtime.terminal_at IS NOT NULL
     OR (SELECT count(*) FROM public.video_runtime_lane_states l WHERE l.account_id=supplied_account_id
       AND l.workspace_id=supplied_workspace_id AND l.runtime_id=runtime.id
       AND l.lane IN ('mage_image','soulx_avatar') AND l.state='MANIFEST_DURABLE'
       AND l.current_attempt_id IS NULL)<>2 THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary lineage is not dispatch ready' USING ERRCODE='23514';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('task_id',value->>'id','task_key',value->>'task_key',
      'lane',value->>'lane','state','BLOCKED','timeline_segment_id',value->>'timeline_segment_id',
      'depends_on',value->'depends_on') ORDER BY value->>'task_key')
    INTO generation_tasks FROM jsonb_array_elements(bridge.task_manifest) value;
  generation_plan:=jsonb_build_object('schema_version','videoforge-hosted-generation-plan/v1',
    'project_id',supplied_project_id,'project_revision_id',revision.id,
    'asr_attempt_id',bridge.hosted_asr_attempt_id,'revision_config_sha256',revision.revision_config_hash,
    'transcript_sha256',bridge.transcript_document_hash,'timeline_plan_sha256',bridge.timeline_document_hash,
    'scheduler_config_sha256',plan.scheduler_config_hash,'tasks',generation_tasks,
    'predispatch','WAITING_FOR_GPU_QUALIFICATION');
  IF bridge.generation_plan_sha256<>'sha256:'||encode(sha256(convert_to(
      public.videoforge_canonical_jsonb(generation_plan),'UTF8')),'hex') THEN
    RAISE EXCEPTION 'hosted V2-09 generation plan drifted' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.hosted_prompt_runs h JOIN public.prompt_executions e
       ON e.account_id=h.account_id AND e.workspace_id=h.workspace_id AND e.task_id=h.task_id
       WHERE h.account_id=supplied_account_id AND h.workspace_id=supplied_workspace_id
         AND h.project_id=supplied_project_id AND h.project_revision_id=revision.id
         AND h.timeline_plan_id=plan.id AND h.state='SUCCEEDED') THEN
    RAISE EXCEPTION 'hosted V2-09 successful durable prompts unavailable' USING ERRCODE='23514';
  END IF;
  expires_at:=least(db_now+interval '1 hour',lease.expires_at);

  FOREACH lane_name IN ARRAY ARRAY['mage_image','soulx_avatar'] LOOP
    SELECT d.* INTO deployment FROM public.serverless_endpoint_deployments d
      WHERE d.lane=lane_name AND d.is_active FOR SHARE;
    SELECT q.* INTO qualification FROM public.hosted_serverless_qualification_attestations q
      WHERE q.lane=lane_name AND q.deployment_id=deployment.id AND q.independent_audit_accepted
        AND q.verified_at<=db_now AND q.expires_at>db_now ORDER BY q.expires_at DESC LIMIT 1 FOR SHARE;
    IF deployment.id IS NULL OR qualification.id IS NULL OR deployment.worker_count_min<>0
       OR deployment.worker_count_max<>1 OR deployment.handler_concurrency<>1
       OR deployment.region<>'EU-RO-1'
       OR deployment.gpu_allowlist<>ARRAY['NVIDIA GeForce RTX 4090']::text[]
       OR deployment.gpu_count_per_worker<>1 OR deployment.retained_active_workers<>0
       OR deployment.volume_mount<>'/runpod-volume' OR deployment.blind_resubmit_permitted
       OR qualification.expires_at<db_now+make_interval(secs=>deployment.request_ttl_seconds)
       OR qualification.deployment_snapshot_sha256<>
          public.videoforge_hosted_deployment_snapshot_sha256(deployment.id) THEN
      RAISE EXCEPTION 'hosted V2-09 exact qualified max-one lane unavailable' USING ERRCODE='42501';
    END IF;
    expires_at:=least(expires_at,qualification.expires_at);
    dispatch_task_id:=public.videoforge_hosted_v209_uuid('dispatch-task',request.id,lane_name);
    batch_id:=public.videoforge_hosted_v209_uuid('batch',request.id,lane_name);
    attempt_id:=public.videoforge_hosted_dispatch_uuid('attempt',request.id,dispatch_task_id,1);
    avatar_input_id:=CASE WHEN lane_name='soulx_avatar' THEN
      public.videoforge_hosted_v209_uuid('input-reservation',request.id,'avatar-source') ELSE NULL END;
    output_prefix:='tenant/'||supplied_account_id::text||'/workspace/'||supplied_workspace_id::text||
      '/project/'||supplied_project_id::text||'/revision/'||revision.id::text||'/lane/'||
      CASE lane_name WHEN 'mage_image' THEN 'mage-image' ELSE 'soulx-avatar' END||
      '/job/'||attempt_id::text;
    items:='[]'::jsonb;
    FOR task_row IN
      SELECT t.id,t.task_key,t.lane,(m->>'timeline_segment_id')::uuid timeline_segment_id,
        s.segment_key,s.timeline_composition,s.in_image_shot_role,s.required_slots,
        s.start_frame,s.end_frame_exclusive
      FROM jsonb_array_elements(bridge.task_manifest) m
      JOIN public.generation_tasks t ON t.account_id=supplied_account_id
        AND t.workspace_id=supplied_workspace_id AND t.id=(m->>'id')::uuid
      JOIN public.timeline_segments s ON s.account_id=supplied_account_id
        AND s.workspace_id=supplied_workspace_id AND s.project_revision_id=revision.id
        AND s.timeline_plan_id=plan.id AND s.id=(m->>'timeline_segment_id')::uuid
      WHERE m->>'lane'=CASE lane_name WHEN 'mage_image' THEN 'IMAGE' ELSE 'AVATAR' END
        AND t.project_revision_id=revision.id AND t.state='BLOCKED'
      ORDER BY t.task_key
    LOOP
      input_id:=public.videoforge_hosted_v209_uuid('input-reservation',request.id,task_row.id::text);
      output_id:=public.videoforge_hosted_v209_uuid('output-reservation',request.id,task_row.id::text);
      IF lane_name='mage_image' THEN
        SELECT r.id,r.compiled_prompt,r.positive_prompt_hash,r.negative_prompt_hash,
          e.image_style_version_id,e.style_profile_hash
          INTO prompt_row FROM public.prompt_scene_results r
          JOIN public.prompt_executions e ON e.account_id=supplied_account_id
            AND e.workspace_id=supplied_workspace_id AND e.id=r.prompt_execution_id
          WHERE e.project_id=supplied_project_id AND e.project_revision_id=revision.id
            AND e.timeline_plan_id=plan.id AND r.scene_id=task_row.segment_key;
        IF prompt_row.id IS NULL THEN
          RAISE EXCEPTION 'hosted V2-09 prompt/task coverage incomplete' USING ERRCODE='23514';
        END IF;
        role_name:=CASE task_row.timeline_composition WHEN 'IMAGE_FULL' THEN 'image'
          WHEN 'AVATAR_SPLIT_IMAGE' THEN 'right_image' ELSE '' END;
        artifact_sha:='sha256:'||encode(sha256(convert_to(
          public.videoforge_canonical_jsonb(prompt_row.compiled_prompt),'UTF8')),'hex');
        artifact_input:=jsonb_build_object('reservation_id',input_id,'object_key',
          output_prefix||'/artifact/input-'||(jsonb_array_length(items)+1)::text,
          'segment_id',task_row.segment_key,'role',role_name,'asset_id',prompt_row.id,
          'sha256',artifact_sha,'compiled_prompt',prompt_row.compiled_prompt,
          'positive_prompt_sha256',prompt_row.positive_prompt_hash,
          'negative_prompt_sha256',prompt_row.negative_prompt_hash,
          'image_style_version_id',prompt_row.image_style_version_id,
          'style_profile_sha256',prompt_row.style_profile_hash);
        work_item:=jsonb_build_object('taskId',task_row.id,'segmentId',task_row.segment_key,
          'role',role_name,'promptResultId',prompt_row.id,'promptSha256',artifact_sha,
          'compiledPrompt',prompt_row.compiled_prompt,
          'positivePromptSha256',prompt_row.positive_prompt_hash,
          'negativePromptSha256',prompt_row.negative_prompt_hash,
          'styleVersionId',prompt_row.image_style_version_id,
          'styleProfileSha256',prompt_row.style_profile_hash,'inputReservationId',input_id,
          'outputReservationId',output_id,'outputPrefix',output_prefix);
        mage_work:=mage_work||jsonb_build_array(work_item);
      ELSE
        role_name:='avatar';
        SELECT a.*,source.object_key source_object_key,source.content_type source_content_type,
          source.byte_size source_byte_size,avatar.object_key avatar_object_key,
          avatar.content_type avatar_content_type,avatar.byte_size avatar_byte_size,
          audio.object_key span_object_key,audio.content_type span_content_type,
          audio.byte_size span_byte_size,audio.binary_sha256 span_binary_sha256,
          (audio.metadata->>'sample_rate_hz')::integer span_sample_rate_hz,
          (audio.metadata->>'channels')::integer span_channels,
          (audio.metadata->>'padded_samples_48k')::bigint padded_samples_48k,
          (audio.metadata->>'trim_start_sample_48k')::bigint trim_start_sample_48k,
          (audio.metadata->>'trim_end_sample_exclusive_48k')::bigint trim_end_sample_exclusive_48k
          INTO span_row FROM public.selected_span_audio a
          JOIN public.assets source ON source.account_id=a.account_id
            AND source.workspace_id=a.workspace_id AND source.id=a.source_asset_id
            AND source.state IN ('VERIFIED','ACCEPTED')
            AND source.binary_sha256=a.source_binary_sha256
          JOIN public.assets avatar ON avatar.account_id=a.account_id
            AND avatar.workspace_id=a.workspace_id AND avatar.id=revision.avatar_runtime_source_asset_id
            AND avatar.state IN ('VERIFIED','ACCEPTED')
            AND avatar.binary_sha256=revision.avatar_runtime_source_binary_sha256
          JOIN public.assets audio ON audio.account_id=a.account_id
            AND audio.workspace_id=a.workspace_id AND audio.id=a.materialized_asset_id
            AND audio.project_id=supplied_project_id AND audio.project_revision_id=revision.id
            AND audio.kind='AUDIO_SPAN' AND audio.state IN ('VERIFIED','ACCEPTED')
            AND audio.binary_sha256=a.materialized_binary_sha256
          WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id
            AND a.project_revision_id=revision.id AND a.timeline_plan_id=plan.id
            AND a.timeline_segment_id=task_row.timeline_segment_id
            AND a.task_key=task_row.task_key AND a.state='MATERIALIZED';
        IF span_row.id IS NULL OR span_row.source_object_key IS NULL
           OR span_row.source_content_type NOT IN ('audio/flac','audio/mpeg','audio/mp4','audio/wav')
           OR span_row.source_byte_size IS NULL OR span_row.source_byte_size<1
           OR span_row.avatar_object_key IS NULL
           OR span_row.avatar_content_type NOT IN ('image/jpeg','image/png')
           OR span_row.avatar_byte_size IS NULL OR span_row.avatar_byte_size<1
           OR span_row.span_object_key IS NULL
           OR span_row.span_content_type<>'audio/wav'
           OR span_row.span_byte_size IS NULL OR span_row.span_byte_size<1
           OR span_row.span_sample_rate_hz IS DISTINCT FROM 48000
           OR span_row.span_channels IS DISTINCT FROM 1
           OR span_row.padded_samples_48k IS NULL
           OR span_row.trim_start_sample_48k IS NULL
           OR span_row.trim_end_sample_exclusive_48k IS NULL
           OR span_row.padded_samples_48k NOT BETWEEN 144000 AND 485760
           OR span_row.trim_start_sample_48k<0
           OR span_row.trim_start_sample_48k>=span_row.trim_end_sample_exclusive_48k
           OR span_row.trim_end_sample_exclusive_48k>span_row.padded_samples_48k
           OR span_row.padded_samples_48k%1920<>0
           OR span_row.trim_start_sample_48k%1920<>0
           OR span_row.trim_end_sample_exclusive_48k%1920<>0
           OR span_row.trim_end_sample_exclusive_48k-span_row.trim_start_sample_48k
                NOT BETWEEN 96000 AND 480000
           OR span_row.trim_end_sample_exclusive_48k-span_row.trim_start_sample_48k
                <>(task_row.end_frame_exclusive-task_row.start_frame)*1920 THEN
          RAISE EXCEPTION 'hosted V2-09 avatar span/task coverage incomplete' USING ERRCODE='23514';
        END IF;
        artifact_sha:=span_row.span_binary_sha256;
        artifact_input:=jsonb_build_object('reservation_id',input_id,'object_key',
          span_row.span_object_key,'content_type',span_row.span_content_type,
          'content_length',span_row.span_byte_size,'segment_id',task_row.segment_key,
          'role','avatar','asset_id',span_row.materialized_asset_id,
          'sha256',artifact_sha,'source_voiceover_asset_id',span_row.source_asset_id,
          'source_voiceover_sha256',span_row.source_binary_sha256,
          'source_voiceover_object_key',span_row.source_object_key,
          'source_voiceover_content_type',span_row.source_content_type,
          'source_voiceover_content_length',span_row.source_byte_size,
          'selected_start_ms',span_row.selected_start_ms,
          'selected_end_ms_exclusive',span_row.selected_end_ms_exclusive,
          'padded_start_ms',span_row.padded_start_ms,
          'padded_end_ms_exclusive',span_row.padded_end_ms_exclusive,
          'trim_start_ms',span_row.trim_start_ms,'trim_end_ms_exclusive',span_row.trim_end_ms_exclusive,
          'avatar_source_asset_id',revision.avatar_runtime_source_asset_id,
          'avatar_source_sha256',revision.avatar_runtime_source_binary_sha256,
          'avatar_source_object_key',span_row.avatar_object_key,
          'avatar_source_content_type',span_row.avatar_content_type,
          'avatar_source_content_length',span_row.avatar_byte_size);
        work_item:=jsonb_build_object('taskId',task_row.id,'segmentId',task_row.segment_key,
          'role','avatar','spanAudioId',span_row.id,'spanAudioSha256',artifact_sha,
          'spanAudioAssetId',span_row.materialized_asset_id,
          'spanAudioObjectKey',span_row.span_object_key,
          'spanAudioContentType',span_row.span_content_type,
          'spanAudioContentLength',span_row.span_byte_size,
          'spanAudioSampleRateHz',span_row.span_sample_rate_hz,
          'spanAudioChannels',span_row.span_channels,
          'paddedSamples48k',span_row.padded_samples_48k,
          'trimStartSample48k',span_row.trim_start_sample_48k,
          'trimEndSampleExclusive48k',span_row.trim_end_sample_exclusive_48k,
          'sourceVoiceoverAssetId',span_row.source_asset_id,
          'sourceVoiceoverSha256',span_row.source_binary_sha256,
          'sourceVoiceoverObjectKey',span_row.source_object_key,
          'sourceVoiceoverContentType',span_row.source_content_type,
          'sourceVoiceoverContentLength',span_row.source_byte_size,
          'selectedStartMs',span_row.selected_start_ms,
          'selectedEndMsExclusive',span_row.selected_end_ms_exclusive,
          'paddedStartMs',span_row.padded_start_ms,
          'paddedEndMsExclusive',span_row.padded_end_ms_exclusive,
          'trimStartMs',span_row.trim_start_ms,'trimEndMsExclusive',span_row.trim_end_ms_exclusive,
          'avatarSourceAssetId',revision.avatar_runtime_source_asset_id,
          'avatarSourceSha256',revision.avatar_runtime_source_binary_sha256,
          'avatarSourceObjectKey',span_row.avatar_object_key,
          'avatarSourceContentType',span_row.avatar_content_type,
          'avatarSourceContentLength',span_row.avatar_byte_size,
          'avatarSourceInputReservationId',avatar_input_id,
          'spanAudioInputReservationId',input_id,
          'inputReservationId',input_id,'outputReservationId',output_id,'outputPrefix',output_prefix);
        soulx_work:=soulx_work||jsonb_build_array(work_item);
      END IF;
      IF role_name='' THEN
        RAISE EXCEPTION 'hosted V2-09 task composition invalid' USING ERRCODE='23514';
      END IF;
      output_reservation:=jsonb_build_object('reservation_id',output_id,'object_prefix',output_prefix);
      item:=jsonb_build_object('item_ordinal',jsonb_array_length(items)+1,'item_id',task_row.id,
        'task_id',task_row.id,'task_key',task_row.task_key,
        'timeline_segment_id',task_row.timeline_segment_id,'input_reservation_id',input_id,
        'output_reservation_id',output_id,'artifact_input',artifact_input,
        'output_reservation',output_reservation);
      items:=items||jsonb_build_array(item);
    END LOOP;
    IF jsonb_array_length(items)<1 THEN
      RAISE EXCEPTION 'hosted V2-09 lane has no durable work' USING ERRCODE='23514';
    END IF;
    SELECT jsonb_agg(jsonb_build_object('item_id',value->>'item_id','task_id',value->>'task_id',
        'task_key',value->>'task_key','timeline_segment_id',value->>'timeline_segment_id') ORDER BY ordinal),
      jsonb_agg(value->'artifact_input' ORDER BY ordinal),
      jsonb_agg(jsonb_build_object('input_reservation_id',value->>'input_reservation_id',
        'output_reservation_id',value->>'output_reservation_id','artifact_input',value->'artifact_input',
        'output_reservation',value->'output_reservation') ORDER BY ordinal)
      INTO item_manifest,input_manifest,reservation_manifest
      FROM jsonb_array_elements(items) WITH ORDINALITY e(value,ordinal);
    SELECT jsonb_agg(reservation_id ORDER BY ordinal,reservation_order) INTO reservation_ids
      FROM jsonb_array_elements(items) WITH ORDINALITY entry(value,ordinal)
      CROSS JOIN LATERAL (VALUES(value->>'input_reservation_id',1),
        (value->>'output_reservation_id',2)) reservation(reservation_id,reservation_order);
    IF lane_name='mage_image' THEN
      SELECT jsonb_agg(value->>'output_reservation_id' ORDER BY ordinal)
        INTO worker_reservation_ids
        FROM jsonb_array_elements(items) WITH ORDINALITY entry(value,ordinal);
    ELSE
      worker_reservation_ids:=jsonb_build_array(avatar_input_id)||
        (SELECT jsonb_agg(value->>'input_reservation_id' ORDER BY ordinal)
          FROM jsonb_array_elements(items) WITH ORDINALITY entry(value,ordinal))||
        (SELECT jsonb_agg(value->>'output_reservation_id' ORDER BY ordinal)
          FROM jsonb_array_elements(items) WITH ORDINALITY entry(value,ordinal));
    END IF;
    items_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(item_manifest),'UTF8')),'hex');
    input_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(input_manifest),'UTF8')),'hex');
    reservation_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(reservation_manifest),'UTF8')),'hex');
    request_body:=jsonb_build_object('schema_version','serverless-v3','lane',lane_name,
      'task_id',dispatch_task_id);
    request_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(request_body),'UTF8')),'hex');
    envelope:=jsonb_build_object('schema','serverless-worker-job-envelope/v3',
      'dispatch_token','db-owned-pending-dispatch-token',
      'tenant',jsonb_build_object('account_id',supplied_account_id,'workspace_id',supplied_workspace_id),
      'work',jsonb_build_object('project_revision_id',revision.id,'generation_request_id',request.id,
        'task_id',dispatch_task_id,'attempt_id',attempt_id,'lane',lane_name,
        'items_manifest_sha256',items_sha,'item_count',jsonb_array_length(items)),
      'runtime',jsonb_build_object('endpoint_profile_id',deployment.endpoint_profile_id,
        'deployment_id',deployment.id,'container_digest',deployment.worker_image_digest,
        'model_manifest_sha256',deployment.model_manifest_sha256,'volume_id_sha256',deployment.volume_id_sha256,
        'volume_mount','/runpod-volume','volume_write_policy','APPLICATION_READ_ONLY',
        'scratch_root_policy','JOB_LOCAL_SCRATCH_OUTSIDE_MODEL_VOLUME',
        'gpu_allowlist',to_jsonb(deployment.gpu_allowlist),'region','EU-RO-1'),
      'artifacts',jsonb_build_object('input_manifest_sha256',input_sha,'output_prefix',output_prefix,
        'plan_manifest_sha256',bridge.generation_plan_sha256,
        'transfer_port_reservation_ids',reservation_ids),
      'limits',jsonb_build_object('expires_at',to_char(expires_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'max_items',jsonb_array_length(items),
        'max_input_bytes',CASE lane_name WHEN 'mage_image' THEN 8388608 ELSE 268435456 END,
        'max_output_bytes',2147483648,'execution_timeout_seconds',deployment.execution_timeout_seconds,
        'init_timeout_seconds',deployment.init_timeout_seconds),
      'policy',jsonb_build_object('model_download_permitted',false,'volume_mutation_permitted',false,
        'pod_lifecycle_permitted',false,'queue_purge_permitted',false));
    envelope_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(envelope),'UTF8')),'hex');
    lane_binding:=jsonb_build_object('lane',lane_name,
      'checkpoint_id',CASE lane_name WHEN 'mage_image' THEN 'V2-07' ELSE 'V2-08' END,
      'operations',jsonb_build_array('serverless_run','serverless_status','serverless_cancel'),
      'resources',jsonb_build_array('endpoint:'||deployment.id::text,
        'gpu:nvidia-geforce-rtx-4090-eu-ro-1','image:'||substring(deployment.worker_image_digest FROM 8),
        'volume:'||substring(deployment.volume_id_sha256 FROM 8)),
      'deployment_id',deployment.id,'endpoint_id_sha256',deployment.endpoint_id_sha256,
      'endpoint_config_sha256',deployment.endpoint_config_sha256,
      'worker_image_digest',deployment.worker_image_digest,
      'model_manifest_sha256',deployment.model_manifest_sha256,
      'volume_id_sha256',deployment.volume_id_sha256,
      'volume_manifest_sha256',deployment.volume_manifest_sha256,
      'deployment_snapshot_sha256',qualification.deployment_snapshot_sha256,
      'qualification_attestation_id',qualification.id,
      'qualification_record_sha256',qualification.qualification_record_sha256);
    lane_bindings:=lane_bindings||jsonb_build_array(lane_binding);
    batch:=jsonb_build_object('schema_version','videoforge-hosted-lane-batch/v1','id',batch_id,
      'dispatch_task_id',dispatch_task_id,'lane',lane_name,
      'batch_ordinal',CASE lane_name WHEN 'mage_image' THEN 1 ELSE 2 END,'attempt_ordinal',1,
      'generation_plan_sha256',bridge.generation_plan_sha256,'deployment_id',deployment.id,
      'deployment_snapshot_sha256',qualification.deployment_snapshot_sha256,'items',items,
      'items_manifest_sha256',items_sha,'input_manifest_sha256',input_sha,
      'reservation_manifest_sha256',reservation_sha,'request_body',request_body,
      'request_body_sha256',request_sha,'envelope',envelope,'envelope_sha256',envelope_sha,
      'worker_transfer_port_reservation_ids',worker_reservation_ids,
      'output_prefix',output_prefix,
      'max_input_bytes',CASE lane_name WHEN 'mage_image' THEN 8388608 ELSE 268435456 END,
      'max_output_bytes',2147483648,'spend_ceiling_usd',1,'reservation_usd',0.744,
      'rate_source','V2-09_APPROVED_MAX_USD_1.116_GPU_HOUR','rate_checked_at',
      to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'authority_expires_at',to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'checkpoint_authority',jsonb_build_object('checkpointId',
        CASE lane_name WHEN 'mage_image' THEN 'V2-07' ELSE 'V2-08' END,
        'authorizedOperations',jsonb_build_array('serverless_run','serverless_status','serverless_cancel'),
        'resources',lane_binding->'resources','capUsd',2,'authorizedAt',
        to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'expiresAt',
        to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'rates',jsonb_build_array(jsonb_build_object('resourceId',
          'gpu:nvidia-geforce-rtx-4090-eu-ro-1','checkedAt',
          to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'usdPerGpuHour',1.116))));
    batches:=batches||jsonb_build_array(batch);
  END LOOP;
  IF expires_at<=db_now+interval '30 minutes' THEN
    RAISE EXCEPTION 'hosted V2-09 authority horizon is too short' USING ERRCODE='23514';
  END IF;
  SELECT replayed INTO materialized_replay FROM public.videoforge_materialize_hosted_lane_batches(
    supplied_account_id,supplied_workspace_id,supplied_project_id,revision.id,request.id,
    bridge.generation_plan_sha256,batches);
  work:=jsonb_build_object('mage_image',mage_work,'soulx_avatar',soulx_work);
  pair:=(SELECT jsonb_agg(jsonb_build_object('lane',b->>'lane','batch_id',b->>'id',
      'task_id',b->>'dispatch_task_id','attempt_id',b#>>'{envelope,work,attempt_id}',
      'deployment_id',b->>'deployment_id','deployment_snapshot_sha256',b->>'deployment_snapshot_sha256',
      'request_body_sha256',b->>'request_body_sha256','items_manifest_sha256',b->>'items_manifest_sha256',
      'input_manifest_sha256',b->>'input_manifest_sha256','output_prefix',b->>'output_prefix',
      'unsigned_envelope',b->'envelope','spend_ceiling_usd',b->'spend_ceiling_usd',
      'reservation_usd',b->'reservation_usd','rate_source',b->>'rate_source',
      'rate_checked_at',b->>'rate_checked_at','qualification_attestation_id',
      binding->>'qualification_attestation_id','qualification_record_sha256',
      binding->>'qualification_record_sha256') ORDER BY ordinal)
    FROM jsonb_array_elements(batches) WITH ORDINALITY e(b,ordinal)
    CROSS JOIN LATERAL (SELECT value binding FROM jsonb_array_elements(lane_bindings) value
      WHERE value->>'lane'=b->>'lane') selected);
  render_plan:=jsonb_build_object('schemaVersion','videoforge-v2-09-ordinary-predispatch-plan/v1',
    'generationPlanSha256',bridge.generation_plan_sha256,'timelinePlanId',plan.id,
    'timelineDocumentSha256',bridge.timeline_document_hash,'totalFrames',plan.total_frames,
    'work',work);
  approval_id:=public.videoforge_hosted_v209_uuid('approval',request.id,'pair');
  approval_base:=jsonb_build_object('schemaVersion','videoforge.hosted-v209-paid-approval/v1',
    'accountId',supplied_account_id,'workspaceId',supplied_workspace_id,'projectId',supplied_project_id,
    'projectRevisionId',revision.id,'generationRequestId',request.id,
    'generationPlanSha256',bridge.generation_plan_sha256,'leaseId',lease.id,
    'laneBindings',lane_bindings,'totalCapUsd',2,'expiresAt',
    to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  approval_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(approval_base),'UTF8')),'hex');
  INSERT INTO public.hosted_paid_dispatch_approvals(id,approval_sha256,account_id,workspace_id,
    project_id,project_revision_id,generation_request_id,generation_plan_sha256,lease_id,lane_bindings,
    maximum_cumulative_finite_cap_usd,expires_at,approved_by_operator,approved_at,created_at)
  VALUES(approval_id,approval_sha,supplied_account_id,supplied_workspace_id,supplied_project_id,
    revision.id,request.id,bridge.generation_plan_sha256,lease.id,lane_bindings,2,expires_at,
    'DB_OWNED_V2_09_ORDINARY_GATE',db_now,db_now);
  candidate_base:=jsonb_build_object('schemaVersion','videoforge.hosted-v209-ordinary-dispatch/v1',
    'accountId',supplied_account_id,'workspaceId',supplied_workspace_id,'projectId',supplied_project_id,
    'projectRevisionId',revision.id,'generationRequestId',request.id,
    'generationPlanSha256',bridge.generation_plan_sha256,'leaseId',lease.id,
    'approvalId',approval_id,'approvalSha256',approval_sha,'totalCapUsd',2,
    'avatarSourceInputReservationId',avatar_input_id,
    'expiresAt',to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'laneBindings',lane_bindings,'pair',pair,'batches',batches,'renderPlan',render_plan,
    'work',work,'workManifestSha256','sha256:'||encode(sha256(convert_to(
      public.videoforge_canonical_jsonb(work),'UTF8')),'hex'));
  candidate_sha:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(candidate_base),'UTF8')),'hex');
  INSERT INTO public.hosted_v209_ordinary_dispatch_candidates(generation_request_id,account_id,
    workspace_id,project_id,project_revision_id,lease_id,generation_plan_sha256,work_manifest_sha256,
    candidate_sha256,approval_id,candidate_document,expires_at,created_at)
  VALUES(request.id,supplied_account_id,supplied_workspace_id,supplied_project_id,revision.id,lease.id,
    bridge.generation_plan_sha256,candidate_base->>'workManifestSha256',candidate_sha,approval_id,
    candidate_base,expires_at,db_now);
  RETURN candidate_base||jsonb_build_object('candidateSha256',candidate_sha,'replayed',materialized_replay,
    'pairExists',false,'existingWorkflowId',NULL);
END;
$$;

CREATE FUNCTION public.videoforge_commit_hosted_v209_ordinary_pair(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_user_id uuid,
  supplied_project_id uuid, supplied_admission jsonb
) RETURNS TABLE (
  lane text, attempt_id uuid, authority_id uuid, outbox_id uuid, dispatch_token text,
  dispatch_token_sha256 text, unsigned_envelope jsonb, unsigned_envelope_sha256 text,
  request_body_sha256 text, endpoint_id_sha256 text, output_prefix text,
  authority_sha256 text, request_ttl_seconds integer,
  deadline_at timestamptz, reconciliation_deadline_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  token_key text:=current_setting('videoforge.dispatch_token_key',true);
  candidate public.hosted_v209_ordinary_dispatch_candidates%ROWTYPE;
  request public.generation_requests%ROWTYPE; lease public.provider_workload_leases%ROWTYPE;
  runtime public.video_runtime_states%ROWTYPE; runtime_lane public.video_runtime_lane_states%ROWTYPE;
  batch public.hosted_lane_batches%ROWTYPE; deployment public.serverless_endpoint_deployments%ROWTYPE;
  qualification public.hosted_serverless_qualification_attestations%ROWTYPE;
  claim_row record; item jsonb; lane_name text; task_id uuid; ordinal integer;
  expected_attempt uuid; v_authority_id uuid; v_outbox_id uuid; ledger_id uuid; cost_event_id uuid;
  raw_token text; token_sha text; tokenized_envelope jsonb; envelope_hash text;
  deadline timestamptz; reconcile_deadline timestamptz; reservation_total numeric;
  authority_document jsonb; authority_hash text; approval_binding jsonb;
  admission_hash text; claim_id uuid; pair jsonb; lane_bindings jsonb;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR token_key IS NULL OR length(token_key)<32
     OR jsonb_typeof(supplied_admission)<>'object'
     OR NOT EXISTS(SELECT 1 FROM public.memberships m WHERE m.account_id=supplied_account_id
       AND m.workspace_id=supplied_workspace_id AND m.user_id=supplied_user_id AND m.status='ACTIVE') THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary pair input invalid' USING ERRCODE='42501';
  END IF;
  SELECT c.* INTO candidate FROM public.hosted_v209_ordinary_dispatch_candidates c
    JOIN public.generation_requests r ON r.account_id=c.account_id AND r.workspace_id=c.workspace_id
      AND r.id=c.generation_request_id
    WHERE c.account_id=supplied_account_id AND c.workspace_id=supplied_workspace_id
      AND c.project_id=supplied_project_id AND r.created_by_user_id=supplied_user_id
      AND r.state='ACTIVE' AND r.terminal_at IS NULL
    ORDER BY c.created_at DESC LIMIT 1 FOR UPDATE OF c;
  IF candidate.generation_request_id IS NULL OR candidate.expires_at<=db_now THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary candidate unavailable' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(candidate.generation_request_id::text,41));
  admission_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
    supplied_admission-'admissionSha256'),'UTF8')),'hex');
  IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied_admission) key)
       IS DISTINCT FROM ARRAY['admissionSha256','billingBaselineCheckedAt','billingBaselineMicroUsd',
         'cancelAt','candidateSha256','cost','databaseNow','generationPlanSha256','providerObservedAt',
         'schemaVersion','stopAt','work','workManifestSha256']::text[]
     OR supplied_admission->>'schemaVersion'<>'videoforge-v2-09-ordinary-admission/v1'
     OR supplied_admission->>'admissionSha256'<>admission_hash
     OR supplied_admission->>'candidateSha256'<>candidate.candidate_sha256
     OR supplied_admission->>'generationPlanSha256'<>candidate.generation_plan_sha256
     OR supplied_admission->>'workManifestSha256'<>candidate.work_manifest_sha256
     OR supplied_admission->'work' IS DISTINCT FROM candidate.candidate_document->'work'
     OR supplied_admission->>'workManifestSha256'<>'sha256:'||encode(sha256(convert_to(
        public.videoforge_canonical_jsonb(supplied_admission->'work'),'UTF8')),'hex')
     OR (supplied_admission#>>'{cost,maximumFlexRateMicroUsdPerGpuHour}')::integer<>1116000
     OR (supplied_admission#>>'{cost,primaryExecutionForecastMicroUsd}')::integer<>744000
     OR (supplied_admission#>>'{cost,possibleDuplicateLiabilityMicroUsd}')::integer<>744000
     OR (supplied_admission#>>'{cost,settlementReserveMicroUsd}')::integer<>512000
     OR (supplied_admission#>>'{cost,hardVariableCostCeilingMicroUsd}')::integer<>2000000
     OR (supplied_admission#>>'{cost,combinedCompletionCapMicroUsd}')::integer<>17500000
     OR (supplied_admission#>>'{cost,noRedispatch}')::boolean IS DISTINCT FROM true
     OR (supplied_admission->>'billingBaselineMicroUsd')::bigint<0
     OR (supplied_admission->>'billingBaselineMicroUsd')::bigint+2000000>17500000
     OR (supplied_admission->>'databaseNow')::timestamptz>db_now
     OR (supplied_admission->>'databaseNow')::timestamptz<db_now-interval '5 minutes'
     OR (supplied_admission->>'providerObservedAt')::timestamptz>
        (supplied_admission->>'databaseNow')::timestamptz
     OR (supplied_admission->>'providerObservedAt')::timestamptz<db_now-interval '5 minutes'
     OR (supplied_admission->>'billingBaselineCheckedAt')::timestamptz>
        (supplied_admission->>'databaseNow')::timestamptz
     OR (supplied_admission->>'billingBaselineCheckedAt')::timestamptz<db_now-interval '5 minutes'
     OR (supplied_admission->>'cancelAt')::timestamptz<>
        (supplied_admission->>'databaseNow')::timestamptz+interval '20 minutes'
     OR (supplied_admission->>'stopAt')::timestamptz<>
        (supplied_admission->>'databaseNow')::timestamptz+interval '30 minutes'
     OR (supplied_admission->>'stopAt')::timestamptz>candidate.expires_at THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary admission invalid' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.serverless_attempts a WHERE a.account_id=supplied_account_id
       AND a.workspace_id=supplied_workspace_id AND a.generation_request_id=candidate.generation_request_id) THEN
    RAISE EXCEPTION 'hosted V2-09 redispatch forbidden' USING ERRCODE='23505';
  END IF;
  pair:=candidate.candidate_document->'pair';
  lane_bindings:=candidate.candidate_document->'laneBindings';
  SELECT coalesce(sum((value->>'reservation_usd')::numeric),0) INTO reservation_total
    FROM jsonb_array_elements(pair) value;
  IF reservation_total<>1.488 OR jsonb_array_length(pair)<>2
     OR (SELECT array_agg(value->>'lane' ORDER BY value->>'lane') FROM jsonb_array_elements(pair) value)
        IS DISTINCT FROM ARRAY['mage_image','soulx_avatar']::text[] THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary pair cost or lanes drifted' USING ERRCODE='23514';
  END IF;
  SELECT * INTO request FROM public.generation_requests r WHERE r.account_id=supplied_account_id
    AND r.workspace_id=supplied_workspace_id AND r.id=candidate.generation_request_id FOR UPDATE;
  SELECT * INTO lease FROM public.provider_workload_leases l WHERE l.account_id=supplied_account_id
    AND l.workspace_id=supplied_workspace_id AND l.id=candidate.lease_id FOR UPDATE;
  IF request.state<>'ACTIVE' OR request.terminal_at IS NOT NULL OR lease.state<>'ACTIVE'
     OR lease.released_at IS NOT NULL OR lease.expires_at<=db_now
     OR lease.generation_request_id<>request.id THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary active lease drifted' USING ERRCODE='23514';
  END IF;
  claim_id:=public.videoforge_hosted_v209_uuid('claim',request.id,'pair');
  SELECT * INTO claim_row FROM public.videoforge_claim_hosted_paid_dispatch(
    candidate.approval_id,candidate.candidate_document->>'approvalSha256',claim_id,
    supplied_account_id,supplied_workspace_id,supplied_project_id,candidate.project_revision_id,
    request.id,candidate.generation_plan_sha256,candidate.lease_id,lane_bindings,2,
    reservation_total,candidate.expires_at);
  INSERT INTO public.hosted_v209_short_admissions(account_id,workspace_id,generation_request_id,
    admission_sha256,plan_sha256,work_manifest_sha256,phase_cap_micro_usd,combined_cap_micro_usd,
    billing_baseline_micro_usd,billing_baseline_checked_at,database_observed_at,provider_observed_at,
    cancel_at,stop_at,no_redispatch,admission_document,created_at)
  VALUES(supplied_account_id,supplied_workspace_id,request.id,admission_hash,
    candidate.generation_plan_sha256,candidate.work_manifest_sha256,2000000,17500000,
    (supplied_admission->>'billingBaselineMicroUsd')::bigint,
    (supplied_admission->>'billingBaselineCheckedAt')::timestamptz,
    (supplied_admission->>'databaseNow')::timestamptz,
    (supplied_admission->>'providerObservedAt')::timestamptz,
    (supplied_admission->>'cancelAt')::timestamptz,
    (supplied_admission->>'stopAt')::timestamptz,true,supplied_admission,db_now);
  SELECT * INTO runtime FROM public.video_runtime_states r WHERE r.account_id=supplied_account_id
    AND r.workspace_id=supplied_workspace_id AND r.generation_request_id=request.id FOR UPDATE;
  IF runtime.id IS NULL OR runtime.stage<>'WAITING_FOR_WORKER' OR runtime.terminal_at IS NOT NULL THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary runtime drifted' USING ERRCODE='23514';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(pair) WITH ORDINALITY e(value,n)
      ORDER BY CASE value->>'lane' WHEN 'mage_image' THEN 1 ELSE 2 END LOOP
    lane_name:=item->>'lane'; task_id:=(item->>'task_id')::uuid;
    SELECT value INTO approval_binding FROM jsonb_array_elements(lane_bindings) value
      WHERE value->>'lane'=lane_name;
    SELECT * INTO batch FROM public.hosted_lane_batches b WHERE b.account_id=supplied_account_id
      AND b.workspace_id=supplied_workspace_id AND b.generation_request_id=request.id
      AND b.lane=lane_name FOR SHARE;
    SELECT * INTO runtime_lane FROM public.video_runtime_lane_states l WHERE l.account_id=supplied_account_id
      AND l.workspace_id=supplied_workspace_id AND l.runtime_id=runtime.id AND l.lane=lane_name FOR UPDATE;
    SELECT * INTO deployment FROM public.serverless_endpoint_deployments d
      WHERE d.id=batch.deployment_id AND d.lane=lane_name AND d.is_active FOR SHARE;
    SELECT * INTO qualification FROM public.hosted_serverless_qualification_attestations q
      WHERE q.id=(approval_binding->>'qualification_attestation_id')::uuid
        AND q.lane=lane_name AND q.deployment_id=deployment.id FOR SHARE;
    IF batch.id IS NULL OR batch.dispatch_task_id<>task_id
       OR batch.generation_plan_sha256<>candidate.generation_plan_sha256
       OR runtime_lane.id IS NULL OR runtime_lane.state<>'MANIFEST_DURABLE'
       OR runtime_lane.current_attempt_id IS NOT NULL OR deployment.id IS NULL
       OR qualification.id IS NULL OR NOT qualification.independent_audit_accepted
       OR qualification.expires_at<=db_now
       OR qualification.qualification_record_sha256<>approval_binding->>'qualification_record_sha256'
       OR qualification.deployment_snapshot_sha256<>
          public.videoforge_hosted_deployment_snapshot_sha256(deployment.id)
       OR item->>'batch_id'<>batch.id::text OR item->>'deployment_id'<>deployment.id::text
       OR item->>'request_body_sha256'<>batch.request_body_sha256
       OR item->>'items_manifest_sha256'<>batch.items_manifest_sha256
       OR item->>'input_manifest_sha256'<>batch.input_manifest_sha256
       OR item->>'output_prefix'<>batch.output_prefix
       OR item->'unsigned_envelope' IS DISTINCT FROM batch.payload->'envelope'
       OR (item->>'reservation_usd')::numeric<>(batch.payload->>'reservation_usd')::numeric
       OR (item->>'spend_ceiling_usd')::numeric<>(batch.payload->>'spend_ceiling_usd')::numeric THEN
      RAISE EXCEPTION 'hosted V2-09 ordinary exact pair lineage mismatch' USING ERRCODE='23514';
    END IF;
    ordinal:=runtime_lane.attempt_ordinal+1;
    expected_attempt:=public.videoforge_hosted_dispatch_uuid('attempt',request.id,task_id,ordinal);
    IF item->>'attempt_id'<>expected_attempt::text OR ordinal<>1 THEN
      RAISE EXCEPTION 'hosted V2-09 ordinary attempt lineage mismatch' USING ERRCODE='23514';
    END IF;
    v_authority_id:=public.videoforge_hosted_predispatch_uuid('authority',request.id,task_id,ordinal);
    v_outbox_id:=public.videoforge_hosted_predispatch_uuid('outbox',request.id,task_id,ordinal);
    ledger_id:=public.videoforge_hosted_predispatch_uuid('ledger',request.id,task_id,ordinal);
    cost_event_id:=public.videoforge_hosted_predispatch_uuid('cost-event',request.id,task_id,ordinal);
    raw_token:='dt-'||encode(gen_random_bytes(24),'hex');
    token_sha:='sha256:'||encode(sha256(convert_to(raw_token,'UTF8')),'hex');
    tokenized_envelope:=(item->'unsigned_envelope'-'dispatch_token')||jsonb_build_object('dispatch_token',raw_token);
    envelope_hash:='sha256:'||encode(sha256(convert_to(
      public.videoforge_canonical_jsonb(tokenized_envelope),'UTF8')),'hex');
    deadline:=db_now+make_interval(secs=>deployment.request_ttl_seconds);
    reconcile_deadline:=db_now+make_interval(secs=>
      least(deployment.reconciliation_deadline_seconds,deployment.request_ttl_seconds));
    authority_document:=jsonb_build_object('schema_version','videoforge-hosted-atomic-predispatch/v2',
      'approval_sha256',candidate.candidate_document->>'approvalSha256','claim_id',claim_id,
      'candidate_sha256',candidate.candidate_sha256,'lane',lane_name,'batch_id',batch.id,
      'attempt_id',expected_attempt,'dispatch_token_sha256',token_sha,
      'unsigned_envelope_sha256',envelope_hash,'request_body_sha256',batch.request_body_sha256,
      'generation_plan_sha256',candidate.generation_plan_sha256,
      'deployment_snapshot_sha256',qualification.deployment_snapshot_sha256,
      'lease_id',candidate.lease_id,'reservation_usd',(item->>'reservation_usd')::numeric,
      'total_cap_usd',2,'committed_at',to_char(db_now AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    authority_hash:='sha256:'||encode(sha256(convert_to(
      public.videoforge_canonical_jsonb(authority_document),'UTF8')),'hex');
    INSERT INTO public.serverless_attempts(id,account_id,workspace_id,project_id,project_revision_id,
      generation_request_id,task_id,deployment_id,lane,attempt_ordinal,state,dispatch_token_sha256,
      items_manifest_sha256,item_count,input_manifest_sha256,output_prefix,deadline_at,
      reconciliation_deadline_at,created_at,updated_at)
    VALUES(expected_attempt,supplied_account_id,supplied_workspace_id,supplied_project_id,
      candidate.project_revision_id,request.id,task_id,deployment.id,lane_name,ordinal,'PLANNED',
      token_sha,batch.items_manifest_sha256,batch.item_count,batch.input_manifest_sha256,
      batch.output_prefix,deadline,reconcile_deadline,db_now,db_now);
    -- The exact worker body contains fresh one-use signed ports and cannot exist yet.  Keep the
    -- attempt PLANNED and create no sendable outbox/authority until the materialization CAS below
    -- binds the complete body and signed envelope hashes.
    INSERT INTO public.hosted_dispatch_token_vault(attempt_id,account_id,workspace_id,
      generation_request_id,lane,dispatch_token_sha256,token_ciphertext,created_at)
    VALUES(expected_attempt,supplied_account_id,supplied_workspace_id,request.id,lane_name,token_sha,
      pgp_sym_encrypt(raw_token,token_key,'cipher-algo=aes256,compress-algo=0'),db_now);
    INSERT INTO public.serverless_cost_ledgers(id,account_id,workspace_id,project_revision_id,attempt_id,
      owner_type,owner_id,ceiling_usd,estimated_usd,reserved_usd,fixed_retained_volume_usd_excluded,updated_at)
    VALUES(ledger_id,supplied_account_id,supplied_workspace_id,candidate.project_revision_id,
      expected_attempt,'PROJECT_REVISION',candidate.project_revision_id,
      (item->>'spend_ceiling_usd')::numeric,(item->>'reservation_usd')::numeric,
      (item->>'reservation_usd')::numeric,true,db_now);
    INSERT INTO public.serverless_cost_events(id,account_id,workspace_id,project_revision_id,attempt_id,
      ledger_id,sequence,kind,amount_usd,rate_source,rate_checked_at,confidence,recorded_at)
    VALUES(cost_event_id,supplied_account_id,supplied_workspace_id,candidate.project_revision_id,
      expected_attempt,ledger_id,1,'RESERVATION',(item->>'reservation_usd')::numeric,
      item->>'rate_source',(item->>'rate_checked_at')::timestamptz,'ESTIMATED',db_now);
    lane:=lane_name; attempt_id:=expected_attempt; authority_id:=v_authority_id; outbox_id:=v_outbox_id;
    dispatch_token:=raw_token; dispatch_token_sha256:=token_sha; unsigned_envelope:=tokenized_envelope;
    unsigned_envelope_sha256:=envelope_hash; request_body_sha256:=batch.request_body_sha256;
    endpoint_id_sha256:=deployment.endpoint_id_sha256; output_prefix:=batch.output_prefix;
    authority_sha256:=NULL; request_ttl_seconds:=deployment.request_ttl_seconds;
    deadline_at:=deadline; reconciliation_deadline_at:=reconcile_deadline;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE FUNCTION public.videoforge_load_hosted_v209_ordinary_lane_materialization(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_generation_request_id uuid,
  supplied_lane text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  token_key text:=current_setting('videoforge.dispatch_token_key',true);
  target record; raw_token text; candidate public.hosted_v209_ordinary_dispatch_candidates%ROWTYPE;
  materialized public.hosted_v209_ordinary_lane_materializations%ROWTYPE;
  lane_expires_at timestamptz;
  finalized_envelope jsonb; finalized_envelope_sha text;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR supplied_lane NOT IN ('mage_image','soulx_avatar')
     OR token_key IS NULL OR length(token_key)<32 THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary lane materialization scope invalid' USING ERRCODE='42501';
  END IF;
  SELECT a.id attempt_id,a.state attempt_state,a.dispatch_token_sha256,a.output_prefix,
      a.created_at attempt_created_at,a.deadline_at,
      o.state outbox_state,o.send_attempt_count,a.deployment_id,d.endpoint_id_sha256,
      d.request_ttl_seconds,b.envelope_sha256,d.provider_endpoint_id,v.token_ciphertext,
      b.payload->'envelope' envelope_template,
      b.payload->'worker_transfer_port_reservation_ids' worker_reservation_ids
    INTO target
    FROM public.serverless_attempts a
    LEFT JOIN public.serverless_dispatch_outbox o ON o.attempt_id=a.id
    JOIN public.serverless_endpoint_deployments d ON d.id=a.deployment_id AND d.lane=a.lane
    JOIN public.hosted_dispatch_token_vault v ON v.attempt_id=a.id
    JOIN public.hosted_lane_batches b ON b.account_id=a.account_id AND b.workspace_id=a.workspace_id
      AND b.generation_request_id=a.generation_request_id AND b.lane=a.lane
   WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id
     AND a.generation_request_id=supplied_generation_request_id AND a.lane=supplied_lane
   FOR SHARE OF a,d,v,b;
  SELECT * INTO candidate FROM public.hosted_v209_ordinary_dispatch_candidates c
   WHERE c.account_id=supplied_account_id AND c.workspace_id=supplied_workspace_id
     AND c.generation_request_id=supplied_generation_request_id FOR SHARE;
  SELECT * INTO materialized FROM public.hosted_v209_ordinary_lane_materializations m
   WHERE m.account_id=supplied_account_id AND m.workspace_id=supplied_workspace_id
     AND m.generation_request_id=supplied_generation_request_id AND m.lane=supplied_lane FOR SHARE;
  lane_expires_at:=target.deadline_at;
  IF target.attempt_id IS NULL OR candidate.id IS NULL OR candidate.created_at>transaction_timestamp()
     OR candidate.expires_at<=transaction_timestamp()
     OR (supplied_lane='mage_image' AND target.request_ttl_seconds<>7200)
     OR (supplied_lane='soulx_avatar' AND target.request_ttl_seconds<>3600)
     OR target.deadline_at<>target.attempt_created_at+
        make_interval(secs=>target.request_ttl_seconds)
     OR lane_expires_at<=transaction_timestamp()
     OR target.attempt_state NOT IN ('PLANNED','OUTBOXED')
     OR (target.attempt_state='PLANNED' AND target.outbox_state IS NOT NULL)
     OR (target.attempt_state='OUTBOXED' AND
       (target.outbox_state<>'READY_TO_DISPATCH' OR target.send_attempt_count<>0))
     OR target.provider_endpoint_id IS NULL THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary lane is not materializable' USING ERRCODE='55000';
  END IF;
  raw_token:=pgp_sym_decrypt(target.token_ciphertext,token_key);
  IF 'sha256:'||encode(sha256(convert_to(raw_token,'UTF8')),'hex')<>target.dispatch_token_sha256 THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary lane token binding invalid' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(target.worker_reservation_ids) IS DISTINCT FROM 'array'
     OR jsonb_array_length(target.worker_reservation_ids)<1 THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary worker reservations unavailable' USING ERRCODE='23514';
  END IF;
  finalized_envelope:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(target.envelope_template,
    '{dispatch_token}',to_jsonb(raw_token),false),
    '{artifacts,transfer_port_reservation_ids}',target.worker_reservation_ids,false),
    '{limits,issued_at}',to_jsonb(to_char(target.attempt_created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),true),
    '{limits,expires_at}',to_jsonb(to_char(lane_expires_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),false);
  finalized_envelope_sha:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(finalized_envelope),'UTF8')),'hex');
  RETURN jsonb_build_object('schemaVersion','videoforge.hosted-v209-ordinary-lane-materialization/v1',
    'lane',supplied_lane,'attemptId',target.attempt_id,'deploymentId',target.deployment_id,
    'endpointId',target.provider_endpoint_id,'endpointIdSha256',target.endpoint_id_sha256,
    'dispatchToken',raw_token,'dispatchTokenSha256',target.dispatch_token_sha256,
    'envelopeTemplate',finalized_envelope,
    'baseEnvelopeTemplateSha256',finalized_envelope_sha,'outputPrefix',target.output_prefix,
    'candidateSha256',candidate.candidate_sha256,
    'generationPlanSha256',candidate.generation_plan_sha256,
    'avatarSourceInputReservationId',candidate.candidate_document->>'avatarSourceInputReservationId',
    'issuedAt',to_char(target.attempt_created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt',to_char(lane_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'renderPlan',candidate.candidate_document->'renderPlan',
    'work',candidate.candidate_document->'work'->supplied_lane,
    'existingMaterialization',CASE WHEN materialized.attempt_id IS NULL THEN NULL ELSE
      jsonb_build_object('requestBody',materialized.request_body,
        'requestBodySha256',materialized.full_request_sha256,
        'envelopeSha256',materialized.envelope_sha256) END);
END;
$$;

CREATE FUNCTION public.videoforge_commit_hosted_v209_ordinary_lane_materialization(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_generation_request_id uuid,
  supplied_lane text, supplied_expected_attempt_id uuid, supplied_expected_envelope_sha256 text,
  supplied_request_body jsonb, supplied_request_body_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  target record; candidate public.hosted_v209_ordinary_dispatch_candidates%ROWTYPE;
  stored public.hosted_v209_ordinary_lane_materializations%ROWTYPE;
  computed_request_sha text; computed_envelope_sha text; computed_batch_sha text; lane_work jsonb;
  expected_inputs jsonb; expected_outputs jsonb; expected_ports jsonb;
  deployment public.serverless_endpoint_deployments%ROWTYPE;
  batch public.hosted_lane_batches%ROWTYPE; runtime_lane public.video_runtime_lane_states%ROWTYPE;
  pair_item jsonb; approval_binding jsonb; token_sha text; authority_document jsonb;
  authority_hash text; authority_id uuid; outbox_id uuid; claim_id uuid; db_now timestamptz:=transaction_timestamp();
  lane_expires_at timestamptz;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR supplied_lane NOT IN ('mage_image','soulx_avatar')
     OR jsonb_typeof(supplied_request_body) IS DISTINCT FROM 'object'
     OR supplied_request_body_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_expected_envelope_sha256 !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary request materialization input invalid' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_generation_request_id::text,43));
  SELECT a.id attempt_id,a.state attempt_state,a.output_prefix,o.state outbox_state,
      o.send_attempt_count,a.deployment_id,a.dispatch_token_sha256,a.task_id,a.deadline_at,
      a.reconciliation_deadline_at,a.attempt_ordinal,a.created_at attempt_created_at
    INTO target FROM public.serverless_attempts a
    LEFT JOIN public.serverless_dispatch_outbox o ON o.attempt_id=a.id
   WHERE a.account_id=supplied_account_id AND a.workspace_id=supplied_workspace_id
     AND a.generation_request_id=supplied_generation_request_id AND a.lane=supplied_lane
   FOR UPDATE OF a;
  SELECT * INTO candidate FROM public.hosted_v209_ordinary_dispatch_candidates c
   WHERE c.account_id=supplied_account_id AND c.workspace_id=supplied_workspace_id
     AND c.generation_request_id=supplied_generation_request_id FOR SHARE;
  SELECT * INTO deployment FROM public.serverless_endpoint_deployments d
    WHERE d.id=target.deployment_id AND d.lane=supplied_lane AND d.is_active FOR SHARE;
  SELECT * INTO batch FROM public.hosted_lane_batches b WHERE b.account_id=supplied_account_id
    AND b.workspace_id=supplied_workspace_id AND b.generation_request_id=supplied_generation_request_id
    AND b.lane=supplied_lane FOR SHARE;
  SELECT l.* INTO runtime_lane FROM public.video_runtime_lane_states l
    JOIN public.video_runtime_states r ON r.id=l.runtime_id
    WHERE l.account_id=supplied_account_id AND l.workspace_id=supplied_workspace_id
      AND r.generation_request_id=supplied_generation_request_id AND l.lane=supplied_lane FOR UPDATE OF l;
  SELECT value INTO pair_item FROM jsonb_array_elements(candidate.candidate_document->'pair') value
    WHERE value->>'lane'=supplied_lane;
  SELECT value INTO approval_binding FROM jsonb_array_elements(candidate.candidate_document->'laneBindings') value
    WHERE value->>'lane'=supplied_lane;
  computed_request_sha:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(supplied_request_body),'UTF8')),'hex');
  computed_envelope_sha:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(supplied_request_body->'envelope'),'UTF8')),'hex');
  computed_batch_sha:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(supplied_request_body->'batch'),'UTF8')),'hex');
  lane_work:=candidate.candidate_document->'work'->supplied_lane;
  lane_expires_at:=target.deadline_at;
  IF supplied_lane='mage_image' THEN
    expected_inputs:='[]'::jsonb;
  ELSE
    expected_inputs:=jsonb_build_array(candidate.candidate_document->>'avatarSourceInputReservationId')||
      coalesce((SELECT jsonb_agg(value->>'spanAudioInputReservationId' ORDER BY ordinal)
        FROM jsonb_array_elements(lane_work) WITH ORDINALITY e(value,ordinal)),'[]'::jsonb);
  END IF;
  SELECT coalesce(jsonb_agg(value->>'outputReservationId' ORDER BY ordinal),'[]'::jsonb)
    INTO expected_outputs FROM jsonb_array_elements(lane_work) WITH ORDINALITY e(value,ordinal);
  expected_ports:=expected_inputs||expected_outputs;
  SELECT * INTO stored FROM public.hosted_v209_ordinary_lane_materializations m
   WHERE m.account_id=supplied_account_id AND m.workspace_id=supplied_workspace_id
     AND m.generation_request_id=supplied_generation_request_id AND m.lane=supplied_lane FOR UPDATE;
  IF stored.attempt_id IS NOT NULL THEN
    IF stored.attempt_id<>supplied_expected_attempt_id
       OR stored.envelope_sha256<>supplied_expected_envelope_sha256
       OR stored.full_request_sha256<>supplied_request_body_sha256
       OR stored.request_body IS DISTINCT FROM supplied_request_body THEN
      RAISE EXCEPTION 'hosted V2-09 ordinary request materialization drifted' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('requestBody',stored.request_body,
      'requestBodySha256',stored.full_request_sha256,'envelopeSha256',stored.envelope_sha256,
      'replayed',true);
  END IF;
  IF target.attempt_id IS NULL OR candidate.id IS NULL OR deployment.id IS NULL OR batch.id IS NULL
     OR pair_item IS NULL OR approval_binding IS NULL OR runtime_lane.id IS NULL
     OR jsonb_typeof(lane_work) IS DISTINCT FROM 'array' OR jsonb_array_length(lane_work)<1
     OR target.attempt_state<>'PLANNED' OR target.outbox_state IS NOT NULL
     OR runtime_lane.state<>'MANIFEST_DURABLE' OR runtime_lane.current_attempt_id IS NOT NULL
     OR runtime_lane.attempt_ordinal<>0
     OR target.attempt_id<>supplied_expected_attempt_id
     OR supplied_request_body_sha256<>computed_request_sha
     OR supplied_expected_envelope_sha256<>computed_envelope_sha
     OR supplied_request_body->'envelope'->'tenant'->>'account_id'<>supplied_account_id::text
     OR supplied_request_body->'envelope'->'tenant'->>'workspace_id'<>supplied_workspace_id::text
     OR supplied_request_body->'envelope'->'work'->>'generation_request_id'<>
        supplied_generation_request_id::text
     OR supplied_request_body->'envelope'->'work'->>'attempt_id'<>target.attempt_id::text
     OR supplied_request_body->'envelope'->'work'->>'lane'<>supplied_lane
     OR supplied_request_body->'envelope'->'limits'->>'issued_at'<>
        to_char(target.attempt_created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
     OR supplied_request_body->'envelope'->'limits'->>'expires_at'<>
        to_char(lane_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
     OR candidate.expires_at<=db_now
     OR (supplied_lane='mage_image' AND deployment.request_ttl_seconds<>7200)
     OR (supplied_lane='soulx_avatar' AND deployment.request_ttl_seconds<>3600)
     OR target.deadline_at<>target.attempt_created_at+
        make_interval(secs=>deployment.request_ttl_seconds)
     OR lane_expires_at<=db_now
     OR supplied_request_body->'envelope'->'artifacts'->>'output_prefix'<>target.output_prefix
     OR supplied_request_body->'envelope'->'artifacts'->'transfer_port_reservation_ids'
        IS DISTINCT FROM expected_ports
     OR (supplied_lane='soulx_avatar' AND
       (supplied_request_body->'envelope'->'work'->>'items_manifest_sha256'<>computed_batch_sha
        OR supplied_request_body->'envelope'->'artifacts'->>'plan_manifest_sha256'<>computed_batch_sha))
     OR jsonb_typeof(supplied_request_body->'envelope') IS DISTINCT FROM 'object'
     OR jsonb_typeof(supplied_request_body->'batch') IS DISTINCT FROM 'object'
     OR jsonb_typeof(supplied_request_body->'ports') IS DISTINCT FROM 'object'
     OR jsonb_typeof(supplied_request_body->'ports'->'inputs') IS DISTINCT FROM 'array'
     OR (SELECT coalesce(jsonb_agg(value->>'reservation_id' ORDER BY ordinal),'[]'::jsonb)
          FROM jsonb_array_elements(supplied_request_body->'ports'->'inputs')
            WITH ORDINALITY e(value,ordinal)) IS DISTINCT FROM expected_inputs
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(supplied_request_body->'ports'->'inputs') value
          WHERE value->>'expires_at'<>to_char(lane_expires_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
     OR (supplied_lane='mage_image' AND
       ((SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied_request_body->'ports') key)
          IS DISTINCT FROM ARRAY['inputs','outputs']::text[]
        OR jsonb_typeof(supplied_request_body->'ports'->'outputs') IS DISTINCT FROM 'array'
        OR jsonb_array_length(supplied_request_body->'ports'->'outputs')<>0))
     OR (supplied_lane='soulx_avatar' AND
       (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied_request_body->'ports') key)
          IS DISTINCT FROM ARRAY['inputs']::text[])
     OR jsonb_typeof(supplied_request_body->'generated_output_authorities') IS DISTINCT FROM 'array'
     OR (SELECT coalesce(jsonb_agg(value->>'reservation_id' ORDER BY ordinal),'[]'::jsonb)
          FROM jsonb_array_elements(supplied_request_body->'generated_output_authorities')
            WITH ORDINALITY e(value,ordinal)) IS DISTINCT FROM expected_outputs
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(supplied_request_body->'generated_output_authorities') value
          WHERE value->>'expires_at'<>to_char(lane_expires_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
     OR jsonb_typeof(supplied_request_body->'input_get_urls') IS DISTINCT FROM 'array'
     OR jsonb_array_length(supplied_request_body->'input_get_urls')<>jsonb_array_length(expected_inputs)
     OR jsonb_typeof(supplied_request_body->'output_put_urls') IS DISTINCT FROM 'array'
     OR jsonb_array_length(supplied_request_body->'output_put_urls')<>jsonb_array_length(expected_outputs)
     OR supplied_request_body->'batch'->>'attempt_id'<>target.attempt_id::text THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary exact worker request is invalid' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.hosted_v209_ordinary_lane_materializations(attempt_id,account_id,workspace_id,
    generation_request_id,lane,envelope_sha256,full_request_sha256,request_body)
  VALUES(target.attempt_id,supplied_account_id,supplied_workspace_id,supplied_generation_request_id,
    supplied_lane,supplied_expected_envelope_sha256,supplied_request_body_sha256,supplied_request_body);
  token_sha:=target.dispatch_token_sha256;
  authority_id:=public.videoforge_hosted_predispatch_uuid('authority',supplied_generation_request_id,
    target.task_id,target.attempt_ordinal);
  outbox_id:=public.videoforge_hosted_predispatch_uuid('outbox',supplied_generation_request_id,
    target.task_id,target.attempt_ordinal);
  claim_id:=public.videoforge_hosted_v209_uuid('claim',supplied_generation_request_id,'pair');
  authority_document:=jsonb_build_object('schema_version','videoforge-hosted-atomic-predispatch/v2',
    'approval_sha256',candidate.candidate_document->>'approvalSha256','claim_id',claim_id,
    'candidate_sha256',candidate.candidate_sha256,'lane',supplied_lane,'batch_id',batch.id,
    'attempt_id',target.attempt_id,'dispatch_token_sha256',token_sha,
    'envelope_sha256',supplied_expected_envelope_sha256,
    'request_body_sha256',supplied_request_body_sha256,
    'generation_plan_sha256',candidate.generation_plan_sha256,
    'deployment_snapshot_sha256',approval_binding->>'deployment_snapshot_sha256',
    'lease_id',candidate.lease_id,'reservation_usd',(pair_item->>'reservation_usd')::numeric,
    'total_cap_usd',2,'committed_at',to_char(db_now AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  authority_hash:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(authority_document),'UTF8')),'hex');
  INSERT INTO public.serverless_predispatch_authorities(id,account_id,workspace_id,project_revision_id,
    attempt_id,dispatch_token_sha256,checkpoint_id,authority_mode,non_transferable,
    allowed_operations,deployment_id,endpoint_id_sha256,endpoint_config_sha256,worker_image_digest,
    model_manifest_sha256,volume_id_sha256,volume_manifest_sha256,region,gpu_allowlist,
    items_manifest_sha256,input_manifest_sha256,request_body_sha256,envelope_sha256,deadline_at,
    reconciliation_deadline_at,request_ttl_seconds,execution_timeout_seconds,init_timeout_seconds,
    spend_ceiling_usd,reservation_usd,rate_source,rate_checked_at,fixed_retained_volume_usd_excluded,
    authority_sha256,committed_at)
  VALUES(authority_id,supplied_account_id,supplied_workspace_id,candidate.project_revision_id,
    target.attempt_id,token_sha,CASE supplied_lane WHEN 'mage_image' THEN 'V2-07' ELSE 'V2-08' END,
    'paid',true,ARRAY['serverless_run','serverless_status','serverless_cancel']::text[],deployment.id,
    deployment.endpoint_id_sha256,deployment.endpoint_config_sha256,deployment.worker_image_digest,
    deployment.model_manifest_sha256,deployment.volume_id_sha256,deployment.volume_manifest_sha256,
    'EU-RO-1',ARRAY['NVIDIA GeForce RTX 4090']::text[],batch.items_manifest_sha256,
    batch.input_manifest_sha256,supplied_request_body_sha256,supplied_expected_envelope_sha256,
    target.deadline_at,target.reconciliation_deadline_at,deployment.request_ttl_seconds,
    deployment.execution_timeout_seconds,deployment.init_timeout_seconds,
    (pair_item->>'spend_ceiling_usd')::numeric,(pair_item->>'reservation_usd')::numeric,
    pair_item->>'rate_source',(pair_item->>'rate_checked_at')::timestamptz,true,authority_hash,db_now);
  INSERT INTO public.serverless_dispatch_outbox(id,account_id,workspace_id,project_revision_id,
    attempt_id,dispatch_token_sha256,authority_sha256,request_body_sha256,state,created_at,updated_at)
  VALUES(outbox_id,supplied_account_id,supplied_workspace_id,candidate.project_revision_id,
    target.attempt_id,token_sha,authority_hash,supplied_request_body_sha256,
    'READY_TO_DISPATCH',db_now,db_now);
  UPDATE public.serverless_attempts SET state='OUTBOXED',version=version+1,updated_at=db_now
    WHERE id=target.attempt_id;
  UPDATE public.video_runtime_lane_states SET state='WAITING_FOR_WORKER',
    current_attempt_id=target.attempt_id,attempt_ordinal=target.attempt_ordinal,
    version=version+1,updated_at=db_now WHERE id=runtime_lane.id;
  RETURN jsonb_build_object('requestBody',supplied_request_body,
    'requestBodySha256',supplied_request_body_sha256,
    'envelopeSha256',supplied_expected_envelope_sha256,'authorityId',authority_id,
    'authoritySha256',authority_hash,'outboxId',outbox_id,'replayed',false);
END;
$$;

CREATE FUNCTION public.videoforge_begin_hosted_v209_ordinary_send(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_generation_request_id uuid,
  supplied_lane text, supplied_expected_attempt_id uuid, supplied_expected_envelope_sha256 text,
  supplied_expected_request_body_sha256 text
) RETURNS TABLE(lane text,attempt_id uuid,dispatch_token text,dispatch_token_sha256 text,
  endpoint_id_sha256 text,request_body_sha256 text,deployment_id uuid,phase text,
  expected_envelope_sha256 text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE materialized public.hosted_v209_ordinary_lane_materializations%ROWTYPE; begun record;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary begin tenant mismatch' USING ERRCODE='42501';
  END IF;
  SELECT * INTO materialized FROM public.hosted_v209_ordinary_lane_materializations m
   WHERE m.account_id=supplied_account_id AND m.workspace_id=supplied_workspace_id
     AND m.generation_request_id=supplied_generation_request_id AND m.lane=supplied_lane FOR SHARE;
  IF materialized.attempt_id IS NULL OR materialized.attempt_id<>supplied_expected_attempt_id
     OR materialized.envelope_sha256<>supplied_expected_envelope_sha256
     OR materialized.full_request_sha256<>supplied_expected_request_body_sha256 THEN
    RAISE EXCEPTION 'hosted V2-09 ordinary full request is not durably bound' USING ERRCODE='55000';
  END IF;
  SELECT * INTO begun FROM public.videoforge_begin_hosted_pair_send(supplied_account_id,
    supplied_workspace_id,supplied_generation_request_id,supplied_lane,
    supplied_expected_attempt_id,
    (SELECT p.envelope_sha256 FROM public.serverless_predispatch_authorities p
      WHERE p.attempt_id=supplied_expected_attempt_id));
  lane:=begun.lane; attempt_id:=begun.attempt_id; dispatch_token:=begun.dispatch_token;
  dispatch_token_sha256:=begun.dispatch_token_sha256; endpoint_id_sha256:=begun.endpoint_id_sha256;
  request_body_sha256:=materialized.full_request_sha256; deployment_id:=begun.deployment_id;
  phase:=begun.phase; expected_envelope_sha256:=materialized.envelope_sha256;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON TABLE public.hosted_v209_ordinary_dispatch_candidates FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_v209_qualified_activations FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_v209_ordinary_lane_materializations FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_hosted_v209_uuid(text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_import_hosted_v209_qualified_activation(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_load_hosted_gpu_activation_v2() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_materialize_hosted_v209_ordinary_dispatch(uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_commit_hosted_v209_ordinary_pair(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_load_hosted_v209_ordinary_lane_materialization(uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_commit_hosted_v209_ordinary_lane_materialization(uuid,uuid,uuid,text,uuid,text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_begin_hosted_v209_ordinary_send(uuid,uuid,uuid,text,uuid,text,text) FROM PUBLIC;

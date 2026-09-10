-- 0116_hosted_v209_mage_volume_manifest_rebind.sql
--
-- The retained Mage model volume held no weights and no marker, so every Stage 6 job failed with
-- MAGE_VOLUME_MARKER_INVALID before inference. The volume has now been prepared from the pinned
-- Hugging Face revision and sealed with a fresh marker. A marker seals its own prepared_at, so the
-- volume manifest hash necessarily differs from the value 0074 froze for the previous preparation.
--
-- Rebind only the Mage model manifest to the prepared volume. The SoulX lane, both volume ids and
-- every image identity stay exactly as 0114 left them.
--
--   mage_image model manifest sha256:ffaf47d13c92407a51d2aa78337612daf2733f5a5bb93e27336822a5389ba1c9

CREATE OR REPLACE FUNCTION public.videoforge_import_hosted_v209_qualified_activation(supplied jsonb)
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
      expected_acceptance:='sha256:12bc1b0fa85606ed1adad23b0b6df97d5c16e1e5d0f8e417fadad0403076be5f';
      expected_image:='sha256:26680786552e7a40f88a312e97720dffa6944173eb83080a100989beac2216b0';
      expected_source:='737b59cf783ce4de24ac5beb1db760fb0b97b0a6';
      expected_config:='sha256:9758825b923a26832570ff68fb841a95f24d9b0f5c684f67443039e6ebf36e34';
      expected_anonymous_proof:='sha256:92a8ca6f5736d3d5210c174cd49b1e9fd33a363a4de8b3fb6804747d76be3b61';
      expected_model_manifest:='sha256:ffaf47d13c92407a51d2aa78337612daf2733f5a5bb93e27336822a5389ba1c9';
      expected_volume_id:='sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619';
    ELSE
      expected_acceptance:='sha256:d6fff986aa950becbd345c72090c0d2d8fdabb4bc0b920d194b57e6a596f72b8';
      expected_image:='sha256:047881a3e85fcb98683c2851989ec064628fa803123588ac25929bd6ca6b243a';
      expected_source:='54c4b06bd524756ccf83e960ca4a18181de134ce';
      expected_config:='sha256:d08c7eba4c923db9e524974ff0590fde0f713eae74bec85b5614afc956bfa5cd';
      expected_anonymous_proof:='sha256:16329b6cc8516f28ff4e18136204b2a602debae9ba01c5a432b574a7e18449cc';
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

REVOKE ALL ON FUNCTION public.videoforge_import_hosted_v209_qualified_activation(jsonb) FROM PUBLIC;

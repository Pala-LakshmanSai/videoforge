-- 0118_hosted_v209_repaired_image_successor.sql
--
-- Bind the next immutable Stage 6/7 worker pair.  The previous activation contract remains
-- append-only and its historical lane identities are not edited.  This successor accepts only
-- the freshly published Mage image carrying the 3600-second authority-TTL repair and the
-- already published SoulX image carrying the prepared-span-input repair.

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
    RAISE EXCEPTION 'hosted V2-09 repaired activation import invalid' USING ERRCODE='23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(supplied->>'sourceCommit',74));
  SELECT * INTO activation FROM public.hosted_v209_qualified_activations
    WHERE id=(supplied->>'activationId')::uuid;
  IF activation.id IS NOT NULL THEN
    IF activation.evidence_document IS DISTINCT FROM supplied THEN
      RAISE EXCEPTION 'hosted V2-09 repaired activation replay drift' USING ERRCODE='23505';
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
      RAISE EXCEPTION 'hosted V2-09 repaired qualification lane import invalid' USING ERRCODE='23514';
    END IF;

    IF lane_name='mage_image' THEN
      expected_acceptance:='sha256:c28a0fc82b5b36f75952a4860214aff25364d37ed4c461ba1b90a0e7c6fa641e';
      expected_image:='sha256:5aff610dd00075ac0601eda9dbd3caf07d7ebf96a73fca849d075a215e4e7161';
      expected_source:='619393e74e2ea42ed6082e78d1efeafa9366b238';
      expected_config:='sha256:0cf8478722ba1769b154ee47f257bbe599fb83a7fef22336dfc31d8de2a5e13d';
      expected_anonymous_proof:='sha256:62b6f5a5905aa85a31108a27ada9ceafcfd6f14cafd9408ac69aec7e25a311a7';
      expected_model_manifest:='sha256:ffaf47d13c92407a51d2aa78337612daf2733f5a5bb93e27336822a5389ba1c9';
      expected_volume_id:='sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619';
    ELSE
      expected_acceptance:='sha256:586c235e3854ece80ca17b7728d3bdddea47e4e4f3b9fb445584bd7cd2fc17b5';
      expected_image:='sha256:7bf51f87035928a4ec1f2826021fa688ef526973887ee9f80117ae4619315bff';
      expected_source:='737b59cf783ce4de24ac5beb1db760fb0b97b0a6';
      expected_config:='sha256:d4133ee6b582d44032ba7886a5c19a844cbb75347527943f6a40d5327e793122';
      expected_anonymous_proof:='sha256:5d842aa90bad61378087b790e44fc182e9d52acb27399e6ed9faacac73150f33';
      expected_model_manifest:='sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626';
      expected_volume_id:='sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be';
    END IF;

    IF lane_doc->>'acceptanceArtifactSha256'<>expected_acceptance
       OR lane_doc->>'imageSourceCommit'<>expected_source
       OR lane_doc->>'imageConfigSha256'<>expected_config
       OR lane_doc->>'anonymousProofSha256'<>expected_anonymous_proof THEN
      RAISE EXCEPTION 'hosted V2-09 repaired qualification identity drifted' USING ERRCODE='23514';
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
      RAISE EXCEPTION 'hosted V2-09 repaired production deployment is not exact max-one'
        USING ERRCODE='23514';
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
        RAISE EXCEPTION 'hosted V2-09 repaired qualification replay drift' USING ERRCODE='23505';
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

\set ON_ERROR_STOP on

BEGIN;
CREATE TEMP TABLE v209_persist_input(payload jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO v209_persist_input(payload)
VALUES(convert_from(decode(:'payload_base64','base64'),'UTF8')::jsonb);

DO $v209$
DECLARE
  supplied jsonb;
  item jsonb;
  existing public.serverless_endpoint_deployments%ROWTYPE;
  db_now timestamptz:=transaction_timestamp();
  version integer;
  record_hash text;
  timeout_evidence jsonb;
BEGIN
  SELECT payload INTO supplied FROM v209_persist_input;
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['rows','schemaVersion','sourceCommit']::text[]
     OR supplied->>'schemaVersion'<>'videoforge.v2-09-qualified-production-persistence/v1'
     OR supplied->>'sourceCommit' !~ '^[0-9a-f]{40}$'
     OR jsonb_typeof(supplied->'rows')<>'array'
     OR jsonb_array_length(supplied->'rows')<>2 THEN
    RAISE EXCEPTION 'V209 production persistence input invalid' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('videoforge:v209:production-pair',209));
  FOR item IN SELECT value FROM jsonb_array_elements(supplied->'rows') LOOP
    IF jsonb_typeof(item)<>'object'
       OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(item) key)
         IS DISTINCT FROM ARRAY['deploymentId','deploymentSha256','endpointId','endpointIdSha256',
           'imageSha256','lane','sourceCommit','templateId','templateIdSha256','volumeIdSha256',
           'volumeManifestSha256']::text[]
       OR item->>'deploymentId' !~ '^[0-9a-f-]{36}$'
       OR item->>'lane' NOT IN ('mage_image','soulx_avatar')
       OR item->>'sourceCommit'<>supplied->>'sourceCommit'
       OR item->>'endpointId' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$'
       OR item->>'templateId' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$'
       OR item->>'endpointIdSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR item->>'templateIdSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR item->>'deploymentSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR item->>'imageSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR item->>'volumeIdSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR item->>'volumeManifestSha256' !~ '^sha256:[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'V209 production persistence lane invalid' USING ERRCODE='23514';
    END IF;
    IF item->>'lane'='mage_image' AND (
      item->>'imageSha256'<>'sha256:26680786552e7a40f88a312e97720dffa6944173eb83080a100989beac2216b0'
      OR item->>'volumeIdSha256'<>'sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619'
      OR item->>'volumeManifestSha256'<>'sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b'
    ) THEN RAISE EXCEPTION 'V209 Mage persistence identity drift' USING ERRCODE='23514'; END IF;
    IF item->>'lane'='soulx_avatar' AND (
      item->>'imageSha256'<>'sha256:7bf51f87035928a4ec1f2826021fa688ef526973887ee9f80117ae4619315bff'
      OR item->>'volumeIdSha256'<>'sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be'
      OR item->>'volumeManifestSha256'<>'sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626'
    ) THEN RAISE EXCEPTION 'V209 SoulX persistence identity drift' USING ERRCODE='23514'; END IF;

    SELECT * INTO existing FROM public.serverless_endpoint_deployments
      WHERE id=(item->>'deploymentId')::uuid FOR UPDATE;
    IF existing.id IS NOT NULL THEN
      IF existing.lane<>item->>'lane' OR NOT existing.is_active
         OR existing.provider_endpoint_id IS DISTINCT FROM item->>'endpointId'
         OR existing.provider_template_id IS DISTINCT FROM item->>'templateId'
         OR existing.endpoint_id_sha256<>item->>'endpointIdSha256'
         OR existing.endpoint_config_sha256<>item->>'deploymentSha256'
         OR existing.worker_image_digest<>item->>'imageSha256'
         OR existing.model_manifest_sha256<>item->>'volumeManifestSha256'
         OR existing.volume_id_sha256<>item->>'volumeIdSha256'
         OR existing.volume_manifest_sha256<>item->>'volumeManifestSha256'
         OR existing.worker_count_min<>0 OR existing.worker_count_max<>1
         OR existing.handler_concurrency<>1 THEN
        RAISE EXCEPTION 'V209 production persistence replay drift' USING ERRCODE='23505';
      END IF;
      CONTINUE;
    END IF;
    IF EXISTS(SELECT 1 FROM public.serverless_endpoint_deployments d
      WHERE d.lane=item->>'lane' AND d.is_active) THEN
      RAISE EXCEPTION 'V209 active production lane already exists' USING ERRCODE='23505';
    END IF;
    SELECT coalesce(max(d.deployment_version),0)+1 INTO version
      FROM public.serverless_endpoint_deployments d WHERE d.lane=item->>'lane';
    timeout_evidence:=jsonb_build_object('provider_defaults_accepted','false','sealed_lineage',
      jsonb_build_object('schemaVersion','videoforge.v2-09-qualified-production-lineage/v1',
        'sourceCommit',supplied->>'sourceCommit','endpointIdSha256',item->>'endpointIdSha256',
        'templateIdSha256',item->>'templateIdSha256','deploymentSha256',item->>'deploymentSha256',
        'workerImageDigest',item->>'imageSha256','volumeIdSha256',item->>'volumeIdSha256',
        'volumeManifestSha256',item->>'volumeManifestSha256','region','EU-RO-1',
        'gpu','NVIDIA GeForce RTX 4090','noRedispatch',true));
    record_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
      jsonb_build_object('schemaVersion','serverless-endpoint-deployment/v3',
        'deploymentId',item->>'deploymentId','lane',item->>'lane',
        'endpointProfileId','template:'||(item->>'templateIdSha256'),
        'endpointIdSha256',item->>'endpointIdSha256','endpointConfigSha256',item->>'deploymentSha256',
        'workerImageDigest',item->>'imageSha256','modelManifestSha256',item->>'volumeManifestSha256',
        'volumeIdSha256',item->>'volumeIdSha256','volumeManifestSha256',item->>'volumeManifestSha256',
        'timeoutEvidence',timeout_evidence,'deploymentVersion',version)),'UTF8')),'hex');
    INSERT INTO public.serverless_endpoint_deployments(id,lane,endpoint_profile_id,
      provider_endpoint_id,provider_template_id,endpoint_id_sha256,endpoint_config_sha256,
      worker_image_digest,model_manifest_sha256,region,volume_id_sha256,volume_manifest_sha256,
      volume_mount,volume_size_gb,gpu_allowlist,gpu_count_per_worker,worker_count_min,worker_count_max,
      worker_ceiling_scope,retained_active_workers,scaler_type,scaler_value,handler_concurrency,
      idle_timeout_seconds,init_timeout_seconds,execution_timeout_seconds,request_ttl_seconds,
      request_ttl_scope,reconciliation_deadline_seconds,provider_result_window_seconds,
      polling_interval_seconds,max_replacement_attempts,blind_resubmit_permitted,timeout_evidence,
      deployment_version,is_active,record_sha256,created_at)
    VALUES((item->>'deploymentId')::uuid,item->>'lane','template:'||(item->>'templateIdSha256'),
      item->>'endpointId',item->>'templateId',item->>'endpointIdSha256',item->>'deploymentSha256',
      item->>'imageSha256',item->>'volumeManifestSha256','EU-RO-1',item->>'volumeIdSha256',
      item->>'volumeManifestSha256','/runpod-volume',50,ARRAY['NVIDIA GeForce RTX 4090']::text[],
      1,0,1,'ACTIVE_PLUS_FLEX',0,'REQUEST_COUNT',1,1,5,800,2400,3600,
      'PROVIDER_QUEUE_PLUS_EXECUTION_PLUS_OUTPUT_UPLOAD',1200,1800,5,0,false,timeout_evidence,
      version,true,record_hash,db_now);
  END LOOP;
  IF (SELECT count(DISTINCT value->>'lane') FROM jsonb_array_elements(supplied->'rows'))<>2 THEN
    RAISE EXCEPTION 'V209 production persistence pair invalid' USING ERRCODE='23514';
  END IF;
END
$v209$;

SELECT jsonb_build_object(
  'schemaVersion','videoforge.v2-09-qualified-production-persistence-result/v1',
  'rows',jsonb_agg(jsonb_build_object(
    'deploymentId',d.id,
    'deploymentRowIdSha256','sha256:'||encode(sha256(convert_to(d.id::text,'UTF8')),'hex'),
    'lane',CASE d.lane WHEN 'mage_image' THEN 'mage' ELSE 'soulx' END,
    'deploymentSha256',d.endpoint_config_sha256,
    'endpointIdSha256',d.endpoint_id_sha256,
    'templateIdSha256',substring(d.endpoint_profile_id from '^template:(sha256:[0-9a-f]{64})$')
  ) ORDER BY CASE d.lane WHEN 'mage_image' THEN 1 ELSE 2 END)
)
FROM public.serverless_endpoint_deployments d
JOIN LATERAL (SELECT payload FROM v209_persist_input) p ON true
WHERE d.id IN (SELECT (value->>'deploymentId')::uuid FROM jsonb_array_elements(p.payload->'rows'));
COMMIT;

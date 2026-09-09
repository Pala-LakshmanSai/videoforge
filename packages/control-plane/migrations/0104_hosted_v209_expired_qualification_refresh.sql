-- Append-only refresh of an exact retained V2-09 pair after (or shortly before)
-- its 24-hour qualification window closes.  The refresh is provider-dispatch
-- free: it binds a fresh read-only inventory observation to the immutable
-- V2-07/V2-08 qualification lineage and never updates historical attestations.

CREATE TABLE public.hosted_v209_qualification_activation_refreshes (
  refresh_id uuid PRIMARY KEY,
  previous_activation_id uuid NOT NULL,
  activation_id uuid NOT NULL UNIQUE,
  request_sha256 text NOT NULL CHECK(request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  inventory_evidence_sha256 text NOT NULL CHECK(inventory_evidence_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  result_document jsonb NOT NULL CHECK(jsonb_typeof(result_document)='object'),
  created_by_operator text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY(previous_activation_id) REFERENCES public.hosted_v209_qualified_activations(id),
  FOREIGN KEY(activation_id) REFERENCES public.hosted_v209_qualified_activations(id)
);

CREATE TRIGGER hosted_v209_qualification_activation_refreshes_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_v209_qualification_activation_refreshes
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();

ALTER TABLE public.hosted_v209_qualification_activation_refreshes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_v209_qualification_activation_refreshes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.hosted_v209_qualification_activation_refreshes FROM PUBLIC;

CREATE FUNCTION public.videoforge_refresh_hosted_v209_expired_qualification(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  request_hash text;
  inventory_hash text;
  prior public.hosted_v209_qualified_activations%ROWTYPE;
  prior_q public.hosted_serverless_qualification_attestations%ROWTYPE;
  deployment public.serverless_endpoint_deployments%ROWTYPE;
  existing public.hosted_v209_qualification_activation_refreshes%ROWTYPE;
  lane_name text;
  lane_doc jsonb;
  observed_lane jsonb;
  inventory jsonb;
  qualification_document jsonb;
  qualification_hash text;
  qualification_id uuid;
  mage_q uuid;
  soulx_q uuid;
  activation_evidence jsonb;
  activation_hash text;
  result jsonb;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['activationId','cloudflareVersionIdSha256','deployedConfigSha256',
         'inventoryEvidence','inventoryEvidenceSha256','lanes','previousActivationId',
         'readbackSha256','refreshId','schemaVersion','sourceCommit']::text[]
     OR supplied->>'schemaVersion'<>'videoforge.hosted-v209-expired-qualification-refresh/v1'
     OR supplied->>'refreshId' !~ '^[0-9a-f-]{36}$'
     OR supplied->>'previousActivationId' !~ '^[0-9a-f-]{36}$'
     OR supplied->>'activationId' !~ '^[0-9a-f-]{36}$'
     OR supplied->>'sourceCommit' !~ '^[0-9a-f]{40}$'
     OR supplied->>'deployedConfigSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'cloudflareVersionIdSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'readbackSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'inventoryEvidenceSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(supplied->'lanes')<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied->'lanes') key)
       IS DISTINCT FROM ARRAY['mage_image','soulx_avatar']::text[] THEN
    RAISE EXCEPTION 'hosted V2-09 qualification refresh invalid' USING ERRCODE='23514';
  END IF;

  request_hash:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(supplied),'UTF8')),'hex');
  SELECT * INTO existing FROM public.hosted_v209_qualification_activation_refreshes
    WHERE refresh_id=(supplied->>'refreshId')::uuid;
  IF existing.refresh_id IS NOT NULL THEN
    IF existing.request_sha256<>request_hash THEN
      RAISE EXCEPTION 'hosted V2-09 qualification refresh replay drift' USING ERRCODE='23505';
    END IF;
    RETURN existing.result_document||jsonb_build_object('replayed',true);
  END IF;

  inventory:=supplied->'inventoryEvidence';
  inventory_hash:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(inventory),'UTF8')),'hex');
  IF inventory_hash<>supplied->>'inventoryEvidenceSha256'
     OR jsonb_typeof(inventory)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(inventory) key)
       IS DISTINCT FROM ARRAY['cloudflareVersionIdSha256','deployedConfigSha256','lanes',
         'observationKind','observedAt','providerActionsCreated','providerMutationObserved',
         'readbackSha256','schemaVersion','sourceCommit']::text[]
     OR inventory->>'schemaVersion'<>'videoforge.hosted-v209-read-only-provider-inventory/v1'
     OR inventory->>'observationKind'<>'READ_ONLY_PROVIDER_INVENTORY'
     OR (inventory->>'providerActionsCreated')::integer<>0
     OR (inventory->>'providerMutationObserved')::boolean
     OR (inventory->>'observedAt')::timestamptz>db_now
     OR (inventory->>'observedAt')::timestamptz<db_now-interval '5 minutes'
     OR inventory->>'sourceCommit'<>supplied->>'sourceCommit'
     OR inventory->>'cloudflareVersionIdSha256'<>supplied->>'cloudflareVersionIdSha256'
     OR inventory->>'deployedConfigSha256'<>supplied->>'deployedConfigSha256'
     OR inventory->>'readbackSha256'<>supplied->>'readbackSha256'
     OR jsonb_typeof(inventory->'lanes')<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(inventory->'lanes') key)
       IS DISTINCT FROM ARRAY['mage_image','soulx_avatar']::text[] THEN
    RAISE EXCEPTION 'hosted V2-09 qualification refresh inventory invalid' USING ERRCODE='23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('v209-qualified-refresh',104));
  SELECT * INTO prior FROM public.hosted_v209_qualified_activations
    WHERE id=(supplied->>'previousActivationId')::uuid FOR SHARE;
  IF prior.id IS NULL OR prior.id IS DISTINCT FROM (
       SELECT id FROM public.hosted_v209_qualified_activations
        WHERE observed_at<=db_now ORDER BY imported_at DESC,id DESC LIMIT 1)
     OR prior.mage_qualification_id=prior.soulx_qualification_id THEN
    RAISE EXCEPTION 'hosted V2-09 qualification refresh predecessor invalid' USING ERRCODE='23514';
  END IF;

  FOREACH lane_name IN ARRAY ARRAY['mage_image','soulx_avatar'] LOOP
    lane_doc:=supplied->'lanes'->lane_name;
    observed_lane:=inventory->'lanes'->lane_name;
    IF jsonb_typeof(lane_doc)<>'object'
       OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(lane_doc) key)
         IS DISTINCT FROM ARRAY['deploymentId','previousQualificationId','qualificationId']::text[]
       OR jsonb_typeof(observed_lane)<>'object'
       OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(observed_lane) key)
         IS DISTINCT FROM ARRAY['deploymentId','deploymentSnapshotSha256','isActive',
           'retainedActiveWorkers','workerCountMax','workerCountMin']::text[]
       OR lane_doc->>'deploymentId' !~ '^[0-9a-f-]{36}$'
       OR lane_doc->>'previousQualificationId' !~ '^[0-9a-f-]{36}$'
       OR lane_doc->>'qualificationId' !~ '^[0-9a-f-]{36}$'
       OR lane_doc->>'qualificationId'=lane_doc->>'previousQualificationId'
       OR observed_lane->>'deploymentId'<>lane_doc->>'deploymentId'
       OR observed_lane->>'deploymentSnapshotSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR (observed_lane->>'isActive')::boolean IS DISTINCT FROM true
       OR (observed_lane->>'workerCountMin')::integer<>0
       OR (observed_lane->>'workerCountMax')::integer<>1
       OR (observed_lane->>'retainedActiveWorkers')::integer<>0 THEN
      RAISE EXCEPTION 'hosted V2-09 qualification refresh lane invalid' USING ERRCODE='23514';
    END IF;

    SELECT * INTO deployment FROM public.serverless_endpoint_deployments d
      WHERE d.id=(lane_doc->>'deploymentId')::uuid AND d.lane=lane_name FOR SHARE;
    qualification_id:=(lane_doc->>'previousQualificationId')::uuid;
    SELECT * INTO prior_q FROM public.hosted_serverless_qualification_attestations q
      WHERE q.id=qualification_id AND q.lane=lane_name FOR SHARE;
    IF deployment.id IS NULL OR prior_q.id IS NULL OR prior_q.deployment_id<>deployment.id
       OR qualification_id<>(CASE lane_name WHEN 'mage_image' THEN prior.mage_qualification_id
          ELSE prior.soulx_qualification_id END)
       OR prior_q.expires_at>db_now+interval '2 hours'
       OR NOT prior_q.independent_audit_accepted
       OR NOT deployment.is_active OR deployment.worker_count_min<>0 OR deployment.worker_count_max<>1
       OR deployment.handler_concurrency<>1 OR deployment.region<>'EU-RO-1'
       OR deployment.gpu_allowlist<>ARRAY['NVIDIA GeForce RTX 4090']::text[]
       OR deployment.gpu_count_per_worker<>1 OR deployment.volume_mount<>'/runpod-volume'
       OR deployment.volume_size_gb<>50 OR deployment.blind_resubmit_permitted
       OR deployment.retained_active_workers<>0
       OR observed_lane->>'deploymentSnapshotSha256'<>
          public.videoforge_hosted_deployment_snapshot_sha256(deployment.id) THEN
      RAISE EXCEPTION 'hosted V2-09 qualification refresh deployment drifted' USING ERRCODE='23514';
    END IF;

    qualification_document:=jsonb_build_object(
      'schemaVersion','videoforge.hosted-v209-qualified-renewal-binding/v1',
      'refreshId',supplied->>'refreshId','lane',lane_name,
      'previousQualificationId',prior_q.id,
      'previousQualificationRecordSha256',prior_q.qualification_record_sha256,
      'deploymentId',deployment.id,
      'deploymentSnapshotSha256',public.videoforge_hosted_deployment_snapshot_sha256(deployment.id),
      'inventoryEvidenceSha256',inventory_hash,
      'observedAt',inventory->>'observedAt','sourceCommit',supplied->>'sourceCommit',
      'cloudflareVersionIdSha256',supplied->>'cloudflareVersionIdSha256',
      'noRedispatch',true,'providerActionsCreated',0,'retainedVolumeMutation',false);
    qualification_hash:='sha256:'||encode(sha256(convert_to(
      public.videoforge_canonical_jsonb(qualification_document),'UTF8')),'hex');
    qualification_id:=(lane_doc->>'qualificationId')::uuid;
    INSERT INTO public.hosted_serverless_qualification_attestations(id,lane,deployment_id,
      deployment_snapshot_sha256,qualification_record_sha256,independent_audit_accepted,
      verified_at,expires_at,created_by_operator,created_at)
    VALUES(qualification_id,lane_name,deployment.id,
      public.videoforge_hosted_deployment_snapshot_sha256(deployment.id),qualification_hash,true,
      db_now,db_now+interval '24 hours',session_user,db_now);
    IF lane_name='mage_image' THEN mage_q:=qualification_id; ELSE soulx_q:=qualification_id; END IF;
  END LOOP;

  activation_evidence:=supplied;
  activation_hash:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(activation_evidence),'UTF8')),'hex');
  INSERT INTO public.hosted_v209_qualified_activations(id,source_commit,deployed_config_sha256,
    cloudflare_version_id_sha256,readback_sha256,observed_at,mage_deployment_id,
    mage_qualification_id,soulx_deployment_id,soulx_qualification_id,evidence_sha256,
    evidence_document,imported_at)
  VALUES((supplied->>'activationId')::uuid,supplied->>'sourceCommit',
    supplied->>'deployedConfigSha256',supplied->>'cloudflareVersionIdSha256',
    supplied->>'readbackSha256',(inventory->>'observedAt')::timestamptz,
    (supplied#>>'{lanes,mage_image,deploymentId}')::uuid,mage_q,
    (supplied#>>'{lanes,soulx_avatar,deploymentId}')::uuid,soulx_q,
    activation_hash,activation_evidence,db_now);

  result:=jsonb_build_object(
    'schemaVersion','videoforge.hosted-v209-expired-qualification-refresh-result/v1',
    'refreshId',supplied->>'refreshId','activationId',supplied->>'activationId',
    'mageQualificationId',mage_q,'soulxQualificationId',soulx_q,
    'inventoryEvidenceSha256',inventory_hash,'qualificationExpiresAt',
      to_char((db_now+interval '24 hours') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'providerActionsCreated',0,'replayed',false);
  INSERT INTO public.hosted_v209_qualification_activation_refreshes(refresh_id,
    previous_activation_id,activation_id,request_sha256,inventory_evidence_sha256,
    result_document,created_by_operator,created_at)
  VALUES((supplied->>'refreshId')::uuid,prior.id,(supplied->>'activationId')::uuid,
    request_hash,inventory_hash,result,session_user,db_now);
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_refresh_hosted_v209_expired_qualification(jsonb)
  FROM PUBLIC;

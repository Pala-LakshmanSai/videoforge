-- Append-only binding of the latest still-valid renewed qualification pair to an
-- exact newly deployed Cloudflare source/config/version identity. This creates no
-- provider action and never changes historical activation or qualification rows.

CREATE FUNCTION public.videoforge_rebind_hosted_v209_renewed_activation(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  db_now timestamptz:=transaction_timestamp();
  prior public.hosted_v209_qualified_activations%ROWTYPE;
  prior_refresh public.hosted_v209_qualification_activation_refreshes%ROWTYPE;
  mage_d public.serverless_endpoint_deployments%ROWTYPE;
  soulx_d public.serverless_endpoint_deployments%ROWTYPE;
  mage_q public.hosted_serverless_qualification_attestations%ROWTYPE;
  soulx_q public.hosted_serverless_qualification_attestations%ROWTYPE;
  existing public.hosted_v209_qualified_activations%ROWTYPE;
  evidence_hash text;
  result jsonb;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['activationId','cloudflareVersionIdSha256','deployedConfigSha256',
         'observedAt','previousActivationId','readbackSha256','schemaVersion','sourceCommit']::text[]
     OR supplied->>'schemaVersion'<>'videoforge.hosted-v209-renewed-activation-rebind/v1'
     OR supplied->>'activationId' !~ '^[0-9a-f-]{36}$'
     OR supplied->>'previousActivationId' !~ '^[0-9a-f-]{36}$'
     OR supplied->>'activationId'=supplied->>'previousActivationId'
     OR supplied->>'sourceCommit' !~ '^[0-9a-f]{40}$'
     OR supplied->>'deployedConfigSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'cloudflareVersionIdSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'readbackSha256' !~ '^sha256:[0-9a-f]{64}$'
     OR (supplied->>'observedAt')::timestamptz>db_now
     OR (supplied->>'observedAt')::timestamptz<db_now-interval '5 minutes' THEN
    RAISE EXCEPTION 'hosted V2-09 renewed activation rebind invalid' USING ERRCODE='23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('v209-renewed-activation-rebind',106));
  SELECT * INTO existing FROM public.hosted_v209_qualified_activations
    WHERE id=(supplied->>'activationId')::uuid;
  IF existing.id IS NOT NULL THEN
    IF existing.evidence_document IS DISTINCT FROM supplied THEN
      RAISE EXCEPTION 'hosted V2-09 renewed activation rebind replay drift' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object(
      'schemaVersion','videoforge.hosted-v209-renewed-activation-rebind-result/v1',
      'activationId',existing.id,'previousActivationId',supplied->>'previousActivationId',
      'evidenceSha256',existing.evidence_sha256,
      'mageQualificationId',existing.mage_qualification_id,
      'soulxQualificationId',existing.soulx_qualification_id,
      'providerActionsCreated',0,'replayed',true);
  END IF;

  SELECT * INTO prior FROM public.hosted_v209_qualified_activations
    WHERE id=(supplied->>'previousActivationId')::uuid FOR SHARE;
  SELECT * INTO prior_refresh FROM public.hosted_v209_qualification_activation_refreshes
    WHERE activation_id=prior.id FOR SHARE;
  IF prior.id IS NULL OR prior_refresh.refresh_id IS NULL
     OR prior.id IS DISTINCT FROM (
       SELECT id FROM public.hosted_v209_qualified_activations
        WHERE observed_at<=db_now ORDER BY imported_at DESC,id DESC LIMIT 1)
     OR prior.source_commit=supplied->>'sourceCommit' THEN
    RAISE EXCEPTION 'hosted V2-09 renewed activation predecessor invalid' USING ERRCODE='23514';
  END IF;

  SELECT * INTO mage_d FROM public.serverless_endpoint_deployments
    WHERE id=prior.mage_deployment_id FOR SHARE;
  SELECT * INTO soulx_d FROM public.serverless_endpoint_deployments
    WHERE id=prior.soulx_deployment_id FOR SHARE;
  SELECT * INTO mage_q FROM public.hosted_serverless_qualification_attestations
    WHERE id=prior.mage_qualification_id FOR SHARE;
  SELECT * INTO soulx_q FROM public.hosted_serverless_qualification_attestations
    WHERE id=prior.soulx_qualification_id FOR SHARE;
  IF mage_d.id IS NULL OR soulx_d.id IS NULL OR mage_q.id IS NULL OR soulx_q.id IS NULL
     OR mage_d.lane<>'mage_image' OR soulx_d.lane<>'soulx_avatar'
     OR mage_q.lane<>'mage_image' OR soulx_q.lane<>'soulx_avatar'
     OR mage_q.deployment_id<>mage_d.id OR soulx_q.deployment_id<>soulx_d.id
     OR mage_q.expires_at<=db_now OR soulx_q.expires_at<=db_now
     OR NOT mage_q.independent_audit_accepted OR NOT soulx_q.independent_audit_accepted
     OR mage_q.deployment_snapshot_sha256<>
        public.videoforge_hosted_deployment_snapshot_sha256(mage_d.id)
     OR soulx_q.deployment_snapshot_sha256<>
        public.videoforge_hosted_deployment_snapshot_sha256(soulx_d.id)
     OR NOT mage_d.is_active OR NOT soulx_d.is_active
     OR mage_d.worker_count_min<>0 OR soulx_d.worker_count_min<>0
     OR mage_d.worker_count_max<>1 OR soulx_d.worker_count_max<>1
     OR mage_d.handler_concurrency<>1 OR soulx_d.handler_concurrency<>1
     OR mage_d.region<>'EU-RO-1' OR soulx_d.region<>'EU-RO-1'
     OR mage_d.gpu_allowlist<>ARRAY['NVIDIA GeForce RTX 4090']::text[]
     OR soulx_d.gpu_allowlist<>ARRAY['NVIDIA GeForce RTX 4090']::text[]
     OR mage_d.gpu_count_per_worker<>1 OR soulx_d.gpu_count_per_worker<>1
     OR mage_d.volume_mount<>'/runpod-volume' OR soulx_d.volume_mount<>'/runpod-volume'
     OR mage_d.volume_size_gb<>50 OR soulx_d.volume_size_gb<>50
     OR mage_d.blind_resubmit_permitted OR soulx_d.blind_resubmit_permitted
     OR mage_d.retained_active_workers<>0 OR soulx_d.retained_active_workers<>0 THEN
    RAISE EXCEPTION 'hosted V2-09 renewed activation pair drifted' USING ERRCODE='23514';
  END IF;

  evidence_hash:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(supplied),'UTF8')),'hex');
  INSERT INTO public.hosted_v209_qualified_activations(id,source_commit,deployed_config_sha256,
    cloudflare_version_id_sha256,readback_sha256,observed_at,mage_deployment_id,
    mage_qualification_id,soulx_deployment_id,soulx_qualification_id,evidence_sha256,
    evidence_document,imported_at)
  VALUES((supplied->>'activationId')::uuid,supplied->>'sourceCommit',
    supplied->>'deployedConfigSha256',supplied->>'cloudflareVersionIdSha256',
    supplied->>'readbackSha256',(supplied->>'observedAt')::timestamptz,
    mage_d.id,mage_q.id,soulx_d.id,soulx_q.id,evidence_hash,supplied,db_now);

  result:=jsonb_build_object(
    'schemaVersion','videoforge.hosted-v209-renewed-activation-rebind-result/v1',
    'activationId',supplied->>'activationId','previousActivationId',prior.id,
    'evidenceSha256',evidence_hash,'mageQualificationId',mage_q.id,
    'soulxQualificationId',soulx_q.id,'providerActionsCreated',0,'replayed',false);
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_rebind_hosted_v209_renewed_activation(jsonb)
  FROM PUBLIC;

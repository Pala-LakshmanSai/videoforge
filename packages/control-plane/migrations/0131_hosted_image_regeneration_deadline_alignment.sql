-- Bound regeneration capacity leases to the ten-minute operational deadline.
-- Keep the signed Mage envelope expiry at one hour for provider compatibility.
CREATE OR REPLACE FUNCTION public.videoforge_prepare_hosted_image_regeneration(req uuid,body jsonb,env jsonb,body_hash text,env_hash text,prepared_lineage jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE r hosted_image_regeneration_requests%ROWTYPE; chosen_slot integer; lease uuid:=gen_random_uuid(); issued_at timestamptz; envelope_expires_at timestamptz; lineage_deadline_at timestamptz; until_at timestamptz;
BEGIN
 PERFORM 1 FROM global_generation_capacity WHERE singleton FOR UPDATE;
 SELECT * INTO r FROM hosted_image_regeneration_requests WHERE id=req AND account_id=public.videoforge_current_account_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'regeneration not found' USING ERRCODE='02000'; END IF;
 IF r.state<>'QUEUED' THEN
  IF r.request_hash IS DISTINCT FROM body_hash OR r.envelope_hash IS DISTINCT FROM env_hash THEN RAISE EXCEPTION 'immutable regeneration request changed' USING ERRCODE='23505'; END IF;
  RETURN to_jsonb(r);
 END IF;
 issued_at:=(env->'limits'->>'issued_at')::timestamptz; envelope_expires_at:=(env->'limits'->>'expires_at')::timestamptz; lineage_deadline_at:=(prepared_lineage->>'deadlineAt')::timestamptz; until_at:=issued_at+interval '10 minutes';
 IF body_hash !~ '^sha256:[0-9a-f]{64}$' OR env_hash !~ '^sha256:[0-9a-f]{64}$'
 OR body_hash IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(body),'UTF8')),'hex')
 OR env_hash IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(env),'UTF8')),'hex')
 OR body->'envelope' IS DISTINCT FROM env
 OR env->'tenant'->>'account_id' IS DISTINCT FROM r.account_id::text OR env->'tenant'->>'workspace_id' IS DISTINCT FROM r.workspace_id::text
 OR env->'work'->>'attempt_id' IS DISTINCT FROM r.attempt_id::text OR env->'work'->>'project_revision_id' IS DISTINCT FROM r.project_revision_id::text
 OR env->'work'->>'lane' IS DISTINCT FROM 'mage_image' OR (env->'work'->>'item_count')::int<>1
 OR issued_at IS NULL OR issued_at>now() OR envelope_expires_at IS DISTINCT FROM issued_at+interval '1 hour' OR lineage_deadline_at IS DISTINCT FROM until_at OR until_at<=now() OR until_at>now()+interval '1 hour' THEN RAISE EXCEPTION 'invalid prepared regeneration' USING ERRCODE='23514'; END IF;
 SELECT s INTO chosen_slot FROM generate_series(1,2) s WHERE NOT EXISTS(SELECT 1 FROM provider_workload_leases l WHERE l.slot=s AND l.state='ACTIVE') ORDER BY s LIMIT 1;
 IF chosen_slot IS NULL OR EXISTS(SELECT 1 FROM provider_workload_leases WHERE account_id=r.account_id AND state='ACTIVE') THEN RAISE EXCEPTION 'provider capacity occupied' USING ERRCODE='55P03'; END IF;
 INSERT INTO provider_workload_leases(id,slot,account_id,workspace_id,request_kind,image_regeneration_request_id,owner_token_sha256,state,acquired_at,heartbeat_at,expires_at)
 VALUES(lease,chosen_slot,r.account_id,r.workspace_id,'IMAGE_REGENERATION',r.id,body_hash,'ACTIVE',now(),now(),until_at);
 UPDATE hosted_image_regeneration_requests SET state='PREPARED',request_body=body,envelope=env,request_hash=body_hash,envelope_hash=env_hash,lineage=prepared_lineage,dispatch_token=env->>'dispatch_token',endpoint_id_sha256=prepared_lineage->'binding'->>'endpointIdSha256',lease_id=lease,deadline_at=until_at,updated_at=now() WHERE id=req RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;

REVOKE ALL ON FUNCTION public.videoforge_prepare_hosted_image_regeneration(uuid,jsonb,jsonb,text,text,jsonb) FROM PUBLIC;

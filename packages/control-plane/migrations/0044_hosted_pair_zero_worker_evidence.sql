-- Signed, append-only endpoint-zero evidence required before 0043 settlement may release the
-- provider lease. The reconciler can write only through these SECURITY DEFINER functions.
CREATE TABLE public.hosted_provider_proof_keys (
  key_id text PRIMARY KEY CHECK(key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$'),
  secret_hex text NOT NULL CHECK(secret_hex ~ '^(?:[0-9a-f]{2}){32,}$'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
REVOKE ALL ON TABLE public.hosted_provider_proof_keys FROM PUBLIC;

CREATE TABLE public.hosted_pair_zero_worker_observations (
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  generation_request_id uuid NOT NULL,
  lane text NOT NULL CHECK(lane IN ('mage_image','soulx_avatar')),
  endpoint_id_sha256 text NOT NULL CHECK(endpoint_id_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  workers_total integer NOT NULL CHECK(workers_total=0),
  queued_jobs integer NOT NULL CHECK(queued_jobs=0),
  observed_at timestamptz NOT NULL,
  proof_sha256 text NOT NULL CHECK(proof_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  signature_sha256 text NOT NULL CHECK(signature_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  signature_key_id text NOT NULL CHECK(signature_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$'),
  signature_value text NOT NULL CHECK(signature_value ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY(generation_request_id,lane),
  FOREIGN KEY(account_id,workspace_id,generation_request_id)
    REFERENCES public.generation_requests(account_id,workspace_id,id)
);
CREATE TRIGGER hosted_pair_zero_worker_observations_append_only BEFORE UPDATE OR DELETE
  ON public.hosted_pair_zero_worker_observations FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
ALTER TABLE public.hosted_pair_zero_worker_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_pair_zero_worker_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_pair_zero_worker_observations_tenant_rls ON public.hosted_pair_zero_worker_observations
  USING(account_id=public.videoforge_current_account_id()) WITH CHECK(account_id=public.videoforge_current_account_id());
REVOKE ALL ON TABLE public.hosted_pair_zero_worker_observations FROM PUBLIC;

CREATE FUNCTION public.videoforge_record_hosted_pair_zero_worker(uuid,uuid,uuid,jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE item jsonb; db_now timestamptz:=transaction_timestamp(); inserted integer:=0;
  proof_secret text;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM $1 OR jsonb_typeof($4)<>'array'
     OR jsonb_array_length($4)<>2 THEN RAISE EXCEPTION 'zero evidence invalid' USING ERRCODE='42501'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements($4) e(value) LOOP
    SELECT k.secret_hex INTO proof_secret FROM public.hosted_provider_proof_keys k
      WHERE k.key_id=item->>'signature_key_id' AND k.active;
    IF item->>'lane' NOT IN ('mage_image','soulx_avatar') OR (item->>'workers_total')::integer<>0
       OR item->>'account_id' IS DISTINCT FROM $1::text
       OR item->>'workspace_id' IS DISTINCT FROM $2::text
       OR item->>'generation_request_id' IS DISTINCT FROM $3::text
       OR (item->>'queued_jobs')::integer<>0 OR (item->>'observed_at')::timestamptz>db_now
       OR (item->>'observed_at')::timestamptz<db_now-interval '2 minutes'
       OR item->>'proof_sha256' !~ '^sha256:[0-9a-f]{64}$'
       OR item->>'signature_sha256' !~ '^sha256:[0-9a-f]{64}$'
       OR item->>'signature_key_id' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$'
       OR item->>'signature_value' !~ '^[0-9a-f]{64}$'
       OR proof_secret IS NULL
       OR NOT EXISTS(SELECT 1 FROM public.serverless_attempts a
         JOIN public.serverless_predispatch_authorities p ON p.attempt_id=a.id
         WHERE a.account_id=$1 AND a.workspace_id=$2 AND a.generation_request_id=$3
           AND a.lane=item->>'lane' AND p.endpoint_id_sha256=item->>'endpoint_id_sha256') THEN
      RAISE EXCEPTION 'zero evidence binding invalid' USING ERRCODE='23514';
    END IF;
    IF item->>'proof_sha256'<>'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
         item-'proof_sha256'-'signature_key_id'-'signature_value'-'signature_sha256'),'UTF8')),'hex')
       OR item->>'signature_sha256'<>'sha256:'||encode(sha256(convert_to(item->>'signature_value','UTF8')),'hex') THEN
      RAISE EXCEPTION 'zero evidence binding invalid' USING ERRCODE='23514';
    END IF;
    IF item->>'signature_value'<>encode(hmac(convert_to(public.videoforge_canonical_jsonb(
         item-'proof_sha256'-'signature_key_id'-'signature_value'-'signature_sha256'),'UTF8'),
         decode(proof_secret,'hex'),'sha256'),'hex') THEN
      RAISE EXCEPTION 'zero evidence binding invalid' USING ERRCODE='23514';
    END IF;
    INSERT INTO public.hosted_pair_zero_worker_observations(account_id,workspace_id,generation_request_id,
      lane,endpoint_id_sha256,workers_total,queued_jobs,observed_at,proof_sha256,signature_sha256,
      signature_key_id,signature_value,created_at)
    VALUES($1,$2,$3,item->>'lane',item->>'endpoint_id_sha256',0,0,(item->>'observed_at')::timestamptz,
      item->>'proof_sha256',item->>'signature_sha256',item->>'signature_key_id',item->>'signature_value',db_now)
    ON CONFLICT DO NOTHING;
    inserted:=inserted+1;
  END LOOP;
  IF inserted<>2 OR (SELECT count(*) FROM public.hosted_pair_zero_worker_observations z
    WHERE z.account_id=$1 AND z.workspace_id=$2 AND z.generation_request_id=$3)<>2 THEN
    RAISE EXCEPTION 'exact zero pair required' USING ERRCODE='23514'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_record_hosted_pair_zero_worker(uuid,uuid,uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION public.videoforge_settle_hosted_pair_cleanup_v2(uuid,uuid,uuid,jsonb,jsonb)
RETURNS TABLE(pair_phase text,released boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  PERFORM public.videoforge_record_hosted_pair_zero_worker($1,$2,$3,$5);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements($5) p WHERE NOT EXISTS(
    SELECT 1 FROM public.hosted_pair_zero_worker_observations z WHERE z.account_id=$1 AND z.workspace_id=$2
      AND z.generation_request_id=$3 AND z.lane=p->>'lane' AND z.proof_sha256=p->>'proof_sha256')) THEN
    RAISE EXCEPTION 'zero proof persistence mismatch' USING ERRCODE='23514'; END IF;
  RETURN QUERY SELECT * FROM public.videoforge_settle_hosted_pair_cleanup($1,$2,$3,$4);
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_settle_hosted_pair_cleanup_v2(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC;

CREATE FUNCTION public.videoforge_load_hosted_pair_activation_v2(uuid,uuid,uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE snapshot jsonb;
BEGIN
  snapshot:=public.videoforge_load_hosted_pair_activation($1,$2,$3);
  RETURN jsonb_set(snapshot,'{migrationLedger}',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'version',m.version,'sha256',m.sha256) ORDER BY m.version) FROM public.videoforge_schema_migrations m
    WHERE m.version BETWEEN 37 AND 44),'[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_load_hosted_pair_activation_v2(uuid,uuid,uuid) FROM PUBLIC;

CREATE FUNCTION public.videoforge_load_hosted_pair_workflow_schedule(uuid,uuid,uuid)
RETURNS TABLE(existing_pair boolean,cancel_at timestamptz,stop_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE claim public.hosted_paid_dispatch_claims%ROWTYPE; pair_count integer; schedule_anchor timestamptz;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM $1 THEN RAISE EXCEPTION 'tenant mismatch' USING ERRCODE='42501'; END IF;
  SELECT * INTO claim FROM public.hosted_paid_dispatch_claims c WHERE c.account_id=$1 AND c.workspace_id=$2
    AND c.generation_request_id=$3;
  SELECT count(*) INTO pair_count FROM public.serverless_attempts a WHERE a.account_id=$1 AND a.workspace_id=$2
    AND a.generation_request_id=$3 AND a.lane IN ('mage_image','soulx_avatar');
  IF pair_count NOT IN (0,2) THEN RAISE EXCEPTION 'partial hosted pair invalid' USING ERRCODE='23514'; END IF;
  existing_pair:=pair_count=2; schedule_anchor:=coalesce(claim.claimed_at,transaction_timestamp());
  cancel_at:=schedule_anchor+interval '20 minutes'; stop_at:=schedule_anchor+interval '30 minutes'; RETURN NEXT;
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_load_hosted_pair_workflow_schedule(uuid,uuid,uuid) FROM PUBLIC;

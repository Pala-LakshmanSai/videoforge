-- Preserve actual standby records; v2 proves independently zero compute and pending work.
CREATE FUNCTION public.videoforge_hosted_zero_compute_document(proof jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path=public,pg_catalog AS $$
  SELECT (jsonb_typeof(proof->'workers_total')='number'
    AND (proof->>'workers_total') ~ '^[0-9]+$'
    AND proof->'queued_jobs'='0'::jsonb
    AND CASE proof->>'schema_version'
      WHEN 'videoforge-hosted-zero-worker-proof/v1' THEN proof->'workers_total'='0'::jsonb
      WHEN 'videoforge-hosted-zero-worker-proof/v2' THEN
        proof->'inventory_zero_confirmed'='true'::jsonb
        AND proof->'billable_workers'='0'::jsonb
        AND proof->'running_workers'='0'::jsonb
        AND proof->'initializing_workers'='0'::jsonb
        AND proof->'throttled_workers'='0'::jsonb
        AND proof->'unhealthy_workers'='0'::jsonb
        AND proof->'pending_jobs'='0'::jsonb
      ELSE false END) IS TRUE;
$$;
REVOKE ALL ON FUNCTION public.videoforge_hosted_zero_compute_document(jsonb) FROM PUBLIC;
ALTER TABLE public.hosted_pair_zero_worker_observations
  ADD COLUMN signed_proof_document jsonb,
  DROP CONSTRAINT hosted_pair_zero_worker_observations_workers_total_check,
  ADD CONSTRAINT hosted_pair_zero_compute_evidence CHECK (
    workers_total>=0 AND (workers_total=0 OR (
      signed_proof_document IS NOT NULL
      AND public.videoforge_hosted_zero_compute_document(signed_proof_document)
      AND (signed_proof_document->>'workers_total')::integer=workers_total
    )));
DO $migration$
DECLARE definition text; prior text; corrected text;
BEGIN
  definition:=pg_get_functiondef('public.videoforge_record_hosted_pair_zero_worker(uuid,uuid,uuid,jsonb)'::regprocedure);
  prior:=$old$(item->>'workers_total')::integer<>0$old$;
  corrected:=$new$NOT public.videoforge_hosted_zero_compute_document(item)$new$;
  IF position(prior IN definition)=0 THEN RAISE EXCEPTION 'standby zero verifier predecessor drift'; END IF;
  definition:=replace(definition,prior,corrected);
  prior:='signature_key_id,signature_value,created_at)';
  IF position(prior IN definition)=0 THEN RAISE EXCEPTION 'standby zero insert predecessor drift'; END IF;
  definition:=replace(definition,prior,'signature_key_id,signature_value,created_at,signed_proof_document)');
  prior:=$old$item->>'endpoint_id_sha256',0,0,(item->>'observed_at')::timestamptz$old$;
  IF position(prior IN definition)=0 THEN RAISE EXCEPTION 'standby zero count predecessor drift'; END IF;
  definition:=replace(definition,prior,$new$item->>'endpoint_id_sha256',(item->>'workers_total')::integer,0,(item->>'observed_at')::timestamptz$new$);
  prior:=$old$item->>'signature_value',db_now)$old$;
  IF position(prior IN definition)=0 THEN RAISE EXCEPTION 'standby zero document predecessor drift'; END IF;
  definition:=replace(definition,prior,$new$item->>'signature_value',db_now,item)$new$);
  EXECUTE definition;
END;
$migration$;

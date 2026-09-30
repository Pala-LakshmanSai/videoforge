-- New qualified span runtimes reuse one finite rental. Historical rows stay protocol 1/four clips.
ALTER TABLE cloud_media_reservations ADD COLUMN span_batch_protocol integer NOT NULL DEFAULT 1
 CHECK(span_batch_protocol IN (1,2));
ALTER TABLE cloud_media_reservations DROP CONSTRAINT cloud_media_reservations_span_job_count_check;
ALTER TABLE cloud_media_reservations ADD CONSTRAINT cloud_media_reservations_span_job_count_check
 CHECK(span_job_count BETWEEN 1 AND CASE span_batch_protocol WHEN 1 THEN 4 ELSE 128 END);
ALTER TABLE cloud_media_jobs DROP CONSTRAINT cloud_media_jobs_claim_ordinal_check;
ALTER TABLE cloud_media_jobs ADD CONSTRAINT cloud_media_jobs_claim_ordinal_check CHECK(claim_ordinal BETWEEN 1 AND 128);

CREATE FUNCTION public.videoforge_guard_cloud_span_protocol() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.span_batch_protocol IS DISTINCT FROM OLD.span_batch_protocol THEN
  RAISE EXCEPTION 'cloud span protocol is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.span_batch_protocol=2 AND NOT EXISTS(SELECT 1 FROM hosted_cpu_job_attempts a
   WHERE a.id=NEW.attempt_id AND a.account_id=NEW.account_id AND a.workspace_id=NEW.workspace_id
     AND a.project_id=NEW.project_id AND a.project_revision_id=NEW.project_revision_id
     AND a.kind='SPAN_AUDIO' AND a.execution_backend='RUNPOD_POD'
     AND a.image_digest=NEW.source_sha256 AND a.execution_bundle_sha256=NEW.source_sha256) THEN
  RAISE EXCEPTION 'cloud span protocol requires exact span runtime' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_guard_cloud_span_protocol() FROM PUBLIC;
CREATE TRIGGER zz_cloud_span_protocol_guard BEFORE INSERT OR UPDATE ON cloud_media_reservations
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_guard_cloud_span_protocol();

CREATE FUNCTION public.videoforge_guard_cloud_span_ordinal() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM cloud_media_reservations r WHERE r.id=NEW.reservation_id
   AND r.account_id=NEW.account_id AND r.workspace_id=NEW.workspace_id
   AND NEW.claim_ordinal BETWEEN 1 AND CASE r.span_batch_protocol WHEN 1 THEN 4 ELSE 128 END) THEN
  RAISE EXCEPTION 'cloud span ordinal exceeds immutable protocol' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_guard_cloud_span_ordinal() FROM PUBLIC;
CREATE TRIGGER zz_cloud_span_ordinal_guard BEFORE INSERT OR UPDATE ON cloud_media_jobs
 FOR EACH ROW EXECUTE FUNCTION public.videoforge_guard_cloud_span_ordinal();

-- Preserve the reviewed claim, tenant, source, receipt, admission, disk and lost-reply guards.
DO $upgrade$
DECLARE source text; definition text; definer boolean; settings text[];
BEGIN
 SELECT p.prosrc,pg_get_functiondef(p.oid),p.prosecdef,p.proconfig INTO source,definition,definer,settings
 FROM pg_proc p WHERE p.oid='public.videoforge_claim_cloud_media_span(uuid,uuid,integer)'::regprocedure;
 IF encode(sha256(convert_to(source,'UTF8')),'hex')<>'31e629777dabee96791828b3cd9c6ebaefa19b7bbae9aa5992c5b40046d5458e'
   OR definer IS DISTINCT FROM true OR settings IS DISTINCT FROM ARRAY['search_path=public, pg_catalog'] THEN
  RAISE EXCEPTION 'cloud span stream reviewed preimage mismatch' USING ERRCODE='55000'; END IF;
 definition:=replace(definition,'executed_count NOT BETWEEN 1 AND 4',
   'executed_count NOT BETWEEN 1 AND (CASE r.span_batch_protocol WHEN 1 THEN 4 ELSE 128 END)');
 definition:=replace(definition,' -- A lost cleanup acknowledgment replays the same next member, never another claim.',
   ' IF r.span_batch_protocol=2 AND (NOT EXISTS(
   SELECT 1 FROM public.videoforge_cloud_media_reservation_authority(r.id,r.leased_attempt_id,r.fence_id) b
   WHERE b.enabled AND b.expires_at>now()) OR NOT EXISTS(
   SELECT 1 FROM generation_requests g WHERE g.account_id=r.account_id AND g.workspace_id=r.workspace_id
   AND g.project_id=r.project_id AND g.project_revision_id=r.project_revision_id AND g.state=''ACTIVE''
   AND EXISTS(SELECT 1 FROM provider_workload_leases l WHERE l.generation_request_id=g.id
   AND l.state=''ACTIVE'' AND l.expires_at>now()))) THEN RETURN NULL; END IF;
 -- A lost cleanup acknowledgment replays the same next member, never another claim.');
 definition:=replace(definition,'IF r.span_job_count>=4 THEN RETURN NULL; END IF;',
   'IF r.span_job_count>=(CASE r.span_batch_protocol WHEN 1 THEN 4 ELSE 128 END) THEN RETURN NULL; END IF;
 IF r.span_batch_protocol=2 AND r.deadline_at<=now()+interval ''30 seconds'' THEN RETURN NULL; END IF;');
 EXECUTE definition;
END;
$upgrade$;

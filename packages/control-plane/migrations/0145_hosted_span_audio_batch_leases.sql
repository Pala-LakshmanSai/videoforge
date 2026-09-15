-- Batch transport retains independent span attempts, leases, and result receipts.
ALTER TABLE public.media_worker_leases ADD COLUMN span_batch_id uuid;

CREATE FUNCTION public.videoforge_assert_media_worker_lease_group()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  attempt public.hosted_cpu_job_attempts%ROWTYPE;
BEGIN
  IF NEW.account_id IS DISTINCT FROM public.videoforge_current_account_id() THEN
    RAISE EXCEPTION 'media worker lease tenant mismatch' USING ERRCODE='42501';
  END IF;
  IF TG_OP='UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.account_id IS DISTINCT FROM OLD.account_id OR
    NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR
    NEW.device_id IS DISTINCT FROM OLD.device_id OR
    NEW.attempt_id IS DISTINCT FROM OLD.attempt_id OR
    NEW.span_batch_id IS DISTINCT FROM OLD.span_batch_id
  ) THEN
    RAISE EXCEPTION 'media worker lease group identity is immutable' USING ERRCODE='23514';
  END IF;

  -- Also serialize reuse of a batch UUID across devices before its first row exists.
  IF NEW.span_batch_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      NEW.account_id::text||':'||NEW.workspace_id::text||':'||NEW.span_batch_id::text,0));
  END IF;
  -- Serialize all singleton and batched lease changes on the same device.
  PERFORM 1 FROM public.media_worker_devices device
    WHERE device.id=NEW.device_id AND device.account_id=NEW.account_id
      AND device.workspace_id=NEW.workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'media worker device unavailable' USING ERRCODE='23503';
  END IF;
  SELECT * INTO attempt FROM public.hosted_cpu_job_attempts source
    WHERE source.id=NEW.attempt_id AND source.account_id=NEW.account_id
      AND source.workspace_id=NEW.workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'media worker attempt unavailable' USING ERRCODE='23503';
  END IF;

  IF NEW.span_batch_id IS NOT NULL THEN
    IF attempt.kind<>'SPAN_AUDIO' OR attempt.execution_backend<>'PERSONAL_WORKER' THEN
      RAISE EXCEPTION 'only personal audio spans may share a batch' USING ERRCODE='23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.media_worker_leases lease
      JOIN public.hosted_cpu_job_attempts source ON source.id=lease.attempt_id
        AND source.account_id=lease.account_id AND source.workspace_id=lease.workspace_id
      WHERE lease.account_id=NEW.account_id AND lease.workspace_id=NEW.workspace_id
        AND lease.span_batch_id=NEW.span_batch_id AND lease.id<>NEW.id
        AND (lease.device_id<>NEW.device_id OR source.project_id<>attempt.project_id
          OR source.project_revision_id<>attempt.project_revision_id OR source.kind<>'SPAN_AUDIO')
    ) OR (SELECT count(*) FROM public.media_worker_leases lease
      WHERE lease.account_id=NEW.account_id AND lease.workspace_id=NEW.workspace_id
        AND lease.span_batch_id=NEW.span_batch_id AND lease.id<>NEW.id)>=4 THEN
      RAISE EXCEPTION 'media worker span batch scope or size invalid' USING ERRCODE='23514';
    END IF;
  END IF;

  IF NEW.state IN ('CLAIMED','RUNNING','COMPLETING') AND EXISTS (
    SELECT 1 FROM public.media_worker_leases lease
    WHERE lease.account_id=NEW.account_id AND lease.workspace_id=NEW.workspace_id
      AND lease.device_id=NEW.device_id AND lease.id<>NEW.id
      AND lease.state IN ('CLAIMED','RUNNING','COMPLETING')
      AND (NEW.span_batch_id IS NULL OR lease.span_batch_id IS DISTINCT FROM NEW.span_batch_id)
  ) THEN
    RAISE EXCEPTION 'media worker device already has an active work group' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.videoforge_assert_media_worker_lease_group() FROM PUBLIC;

CREATE TRIGGER media_worker_leases_work_group_guard
  BEFORE INSERT OR UPDATE ON public.media_worker_leases
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_media_worker_lease_group();
DROP INDEX public.media_worker_leases_active_device_uq;
CREATE INDEX media_worker_leases_span_batch_idx
  ON public.media_worker_leases(account_id,workspace_id,span_batch_id)
  WHERE span_batch_id IS NOT NULL;
CREATE INDEX media_worker_leases_active_device_idx
  ON public.media_worker_leases(account_id,workspace_id,device_id)
  WHERE state IN ('CLAIMED','RUNNING','COMPLETING');

-- V2-02 independent-audit repair. Keep 0019 immutable and tighten its durable invariants additively.

ALTER TABLE artifact_receipts
  DROP CONSTRAINT artifact_receipts_receipt_sha256_key;
ALTER TABLE artifact_receipts
  ADD CONSTRAINT artifact_receipts_owned_receipt_sha256_uq
  UNIQUE (account_id, workspace_id, receipt_sha256);

CREATE OR REPLACE FUNCTION public.videoforge_artifact_reservation_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  expected_key text;
  lane_path text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['used_count', 'state', 'updated_at']::text[])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['used_count', 'state', 'updated_at']::text[]) THEN
      RAISE EXCEPTION 'artifact reservation identity and scope are immutable' USING ERRCODE = '55000';
    END IF;
    IF NEW.used_count < OLD.used_count THEN
      RAISE EXCEPTION 'artifact reservation use count cannot decrease' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  lane_path := CASE NEW.lane
    WHEN 'INPUT' THEN 'input'
    WHEN 'MAGE_IMAGE' THEN 'mage-image'
    WHEN 'SOULX_AVATAR' THEN 'soulx-avatar'
    WHEN 'RENDER' THEN 'render'
    WHEN 'PROVENANCE' THEN 'provenance'
  END;
  expected_key := 'tenant/' || NEW.account_id || '/workspace/' || NEW.workspace_id
    || '/project/' || NEW.project_id || '/revision/' || NEW.project_revision_id
    || '/lane/' || lane_path || '/job/' || NEW.job_id || '/artifact/' || NEW.artifact_id;
  IF NEW.object_key <> expected_key THEN
    RAISE EXCEPTION 'artifact object key does not match exact trusted ownership lineage' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.videoforge_artifact_receipt_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  reserved artifact_reservations%ROWTYPE;
BEGIN
  SELECT * INTO reserved FROM artifact_reservations
   WHERE account_id = COALESCE(NEW.account_id, OLD.account_id)
     AND workspace_id = COALESCE(NEW.workspace_id, OLD.workspace_id)
     AND id = COALESCE(NEW.reservation_id, OLD.reservation_id);

  IF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL
       OR (to_jsonb(NEW) - ARRAY['deleted_at', 'deletion_reason']::text[])
          IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['deleted_at', 'deletion_reason']::text[]) THEN
      RAISE EXCEPTION 'artifact receipt is append-only except one owned deletion tombstone' USING ERRCODE = '55000';
    END IF;
    IF reserved.id IS NULL OR reserved.deletion_owner_account_id <> NEW.account_id
       OR reserved.retention_class = 'LEGAL_HOLD'
       OR (reserved.retain_until IS NOT NULL AND NEW.deleted_at < reserved.retain_until) THEN
      RAISE EXCEPTION 'artifact receipt deletion violates ownership or retention' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF reserved.id IS NULL OR reserved.method <> 'PUT'
     OR reserved.object_key <> NEW.object_key
     OR reserved.content_type <> NEW.content_type
     OR reserved.content_length <> NEW.content_length
     OR reserved.checksum_sha256 <> NEW.checksum_sha256
     OR reserved.expires_at <= NEW.committed_at THEN
    RAISE EXCEPTION 'artifact receipt does not match a live exact upload reservation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

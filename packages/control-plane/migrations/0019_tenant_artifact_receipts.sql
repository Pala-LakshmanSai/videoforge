-- V2-02 tenant-private artifact reservations, scoped transfer ports, and durable receipts.
-- Provider-free: this schema stores no signed URL, bucket credential, or cloud identifier.

CREATE TABLE artifact_reservations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  asset_id uuid,
  lane text NOT NULL CHECK (lane IN ('INPUT', 'MAGE_IMAGE', 'SOULX_AVATAR', 'RENDER', 'PROVENANCE')),
  job_id text NOT NULL CHECK (job_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  artifact_id text NOT NULL CHECK (artifact_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  object_key text NOT NULL CHECK (
    object_key ~ '^tenant/[A-Za-z0-9._:-]+/workspace/[A-Za-z0-9._:-]+/project/[A-Za-z0-9._:-]+/revision/[A-Za-z0-9._:-]+/lane/(input|mage-image|soulx-avatar|render|provenance)/job/[A-Za-z0-9._:-]+/artifact/[A-Za-z0-9._:-]+$'
  ),
  method text NOT NULL CHECK (method IN ('PUT', 'GET', 'DELETE')),
  content_type text NOT NULL CHECK (content_type ~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'),
  content_length bigint NOT NULL CHECK (content_length >= 0 AND content_length <= 10737418240),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  max_uses integer NOT NULL CHECK (max_uses BETWEEN 1 AND 3),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0 AND used_count <= max_uses),
  state text NOT NULL DEFAULT 'ISSUED' CHECK (state IN ('ISSUED', 'CONSUMED', 'EXPIRED', 'REVOKED', 'COMMITTED')),
  retention_class text NOT NULL CHECK (retention_class IN ('EPHEMERAL', 'PROJECT', 'FINAL', 'LEGAL_HOLD')),
  retain_until timestamptz,
  deletion_owner_account_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (deletion_owner_account_id = account_id),
  CHECK (expires_at > created_at),
  CHECK (retain_until IS NULL OR retain_until >= created_at),
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (account_id, workspace_id, object_key, method),
  FOREIGN KEY (account_id, workspace_id) REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_id) REFERENCES projects (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_revision_id) REFERENCES project_revisions (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, asset_id) REFERENCES assets (account_id, workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX artifact_reservations_expiry_idx
  ON artifact_reservations (state, expires_at);
CREATE INDEX artifact_reservations_owned_object_idx
  ON artifact_reservations (account_id, workspace_id, object_key);

CREATE TABLE artifact_receipts (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  callback_id text NOT NULL CHECK (callback_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  object_key text NOT NULL,
  content_type text NOT NULL,
  content_length bigint NOT NULL CHECK (content_length >= 0),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  probe jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(probe) = 'object'),
  receipt_sha256 text NOT NULL CHECK (receipt_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  committed_at timestamptz NOT NULL,
  deleted_at timestamptz,
  deletion_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((deleted_at IS NULL) = (deletion_reason IS NULL)),
  UNIQUE (account_id, workspace_id, reservation_id),
  UNIQUE (account_id, workspace_id, callback_id),
  UNIQUE (receipt_sha256),
  FOREIGN KEY (account_id, workspace_id, reservation_id)
    REFERENCES artifact_reservations (account_id, workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX artifact_receipts_owned_hash_idx
  ON artifact_receipts (account_id, workspace_id, checksum_sha256);

CREATE FUNCTION public.videoforge_artifact_reservation_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  expected_prefix text;
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

  expected_prefix := 'tenant/' || NEW.account_id || '/workspace/' || NEW.workspace_id
    || '/project/' || NEW.project_id || '/revision/' || NEW.project_revision_id || '/';
  IF NEW.object_key NOT LIKE expected_prefix || '%' THEN
    RAISE EXCEPTION 'artifact object key does not match trusted ownership lineage' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER artifact_reservations_identity_guard
  BEFORE INSERT OR UPDATE ON artifact_reservations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_artifact_reservation_guard();
CREATE TRIGGER artifact_reservations_tenant_write_guard
  BEFORE INSERT OR UPDATE ON artifact_reservations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();

CREATE FUNCTION public.videoforge_artifact_receipt_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  reserved artifact_reservations%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL
       OR (to_jsonb(NEW) - ARRAY['deleted_at', 'deletion_reason']::text[])
          IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['deleted_at', 'deletion_reason']::text[]) THEN
      RAISE EXCEPTION 'artifact receipt is append-only except one owned deletion tombstone' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO reserved FROM artifact_reservations
   WHERE account_id = NEW.account_id AND workspace_id = NEW.workspace_id AND id = NEW.reservation_id;
  IF reserved.id IS NULL OR reserved.method <> 'PUT'
     OR reserved.object_key <> NEW.object_key
     OR reserved.content_type <> NEW.content_type
     OR reserved.content_length <> NEW.content_length
     OR reserved.checksum_sha256 <> NEW.checksum_sha256
     OR reserved.expires_at < NEW.committed_at THEN
    RAISE EXCEPTION 'artifact receipt does not match a live exact upload reservation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER artifact_receipts_commit_guard
  BEFORE INSERT OR UPDATE ON artifact_receipts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_artifact_receipt_guard();
CREATE TRIGGER artifact_receipts_tenant_write_guard
  BEFORE INSERT OR UPDATE ON artifact_receipts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();

ALTER TABLE artifact_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY artifact_reservations_tenant_rls ON artifact_reservations
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());

ALTER TABLE artifact_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY artifact_receipts_tenant_rls ON artifact_receipts
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());

CREATE VIEW public.videoforge_tenant_artifact_reservations WITH (security_barrier) AS
  SELECT * FROM artifact_reservations
   WHERE account_id = public.videoforge_current_account_id();
CREATE VIEW public.videoforge_tenant_artifact_receipts WITH (security_barrier) AS
  SELECT * FROM artifact_receipts
   WHERE account_id = public.videoforge_current_account_id();

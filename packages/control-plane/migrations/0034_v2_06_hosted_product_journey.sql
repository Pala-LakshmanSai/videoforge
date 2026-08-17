-- V2-06 hosted product composition. These rows make browser upload creation and final review
-- idempotent and tenant-owned without weakening the existing project, artifact, or CPU contracts.

CREATE TABLE hosted_project_create_requests (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  voiceover_asset_id uuid NOT NULL,
  upload_reservation_id uuid NOT NULL,
  upload_receipt_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('UPLOAD_PENDING', 'READY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (account_id, workspace_id, idempotency_key),
  UNIQUE (account_id, workspace_id, project_id),
  UNIQUE (account_id, workspace_id, upload_receipt_id),
  FOREIGN KEY (account_id, workspace_id) REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_id)
    REFERENCES projects (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_revision_id)
    REFERENCES project_revisions (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, voiceover_asset_id)
    REFERENCES assets (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, upload_reservation_id)
    REFERENCES artifact_reservations (account_id, workspace_id, id) ON DELETE RESTRICT,
  CHECK ((state = 'READY') = (ready_at IS NOT NULL))
);

CREATE FUNCTION videoforge_validate_hosted_project_ready()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.state = 'READY' AND NOT EXISTS (
    SELECT 1
      FROM artifact_reservations AS reservation
      JOIN artifact_receipts AS receipt
        ON receipt.account_id = reservation.account_id
       AND receipt.workspace_id = reservation.workspace_id
       AND receipt.reservation_id = reservation.id
      JOIN assets AS asset
        ON asset.account_id = reservation.account_id
       AND asset.workspace_id = reservation.workspace_id
       AND asset.id = reservation.asset_id
      JOIN project_revisions AS revision
        ON revision.account_id = reservation.account_id
       AND revision.workspace_id = reservation.workspace_id
       AND revision.id = reservation.project_revision_id
     WHERE reservation.account_id = NEW.account_id
       AND reservation.workspace_id = NEW.workspace_id
       AND reservation.id = NEW.upload_reservation_id
       AND reservation.state = 'COMMITTED'
       AND receipt.id = NEW.upload_receipt_id
       AND receipt.object_key = reservation.object_key
       AND receipt.content_length = reservation.content_length
       AND receipt.checksum_sha256 = reservation.checksum_sha256
       AND asset.id = NEW.voiceover_asset_id
       AND asset.state = 'VERIFIED'
       AND revision.id = NEW.project_revision_id
       AND revision.status = 'LOCKED'
  ) THEN
    RAISE EXCEPTION 'hosted project READY requires exact committed voiceover lineage'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER hosted_project_create_requests_tenant_account_derived
  BEFORE INSERT OR UPDATE ON hosted_project_create_requests
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_workspace_account();
CREATE TRIGGER hosted_project_create_requests_tenant_write_guard
  BEFORE INSERT OR UPDATE ON hosted_project_create_requests
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER hosted_project_create_requests_validate_ready
  BEFORE INSERT OR UPDATE ON hosted_project_create_requests
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_validate_hosted_project_ready();
ALTER TABLE hosted_project_create_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted_project_create_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_project_create_requests_tenant_rls ON hosted_project_create_requests
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());

CREATE TABLE hosted_project_reviews (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  render_attempt_id uuid NOT NULL,
  output_checksum_sha256 text NOT NULL CHECK (output_checksum_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  approved_by_user_id uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (account_id, workspace_id, project_id, render_attempt_id),
  FOREIGN KEY (account_id, workspace_id) REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, project_id)
    REFERENCES projects (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, render_attempt_id)
    REFERENCES hosted_cpu_job_attempts (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, approved_by_user_id)
    REFERENCES memberships (workspace_id, user_id) ON DELETE RESTRICT
);

CREATE FUNCTION videoforge_validate_hosted_project_review()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM hosted_cpu_job_attempts AS attempt
      JOIN hosted_cpu_upload_authorities AS authority
        ON authority.account_id = attempt.account_id
       AND authority.workspace_id = attempt.workspace_id
       AND authority.attempt_id = attempt.id
       AND authority.source = 'PRIMARY_RESULT_OUTPUT'
     WHERE attempt.account_id = NEW.account_id
       AND attempt.workspace_id = NEW.workspace_id
       AND attempt.project_id = NEW.project_id
       AND attempt.id = NEW.render_attempt_id
       AND attempt.kind = 'RENDER'
       AND attempt.state = 'SUCCEEDED'
       AND attempt.retention_deleted_at IS NULL
       AND authority.issued_at IS NOT NULL
       AND authority.issued_checksum_sha256 = NEW.output_checksum_sha256
  ) THEN
    RAISE EXCEPTION 'hosted review requires exact retained successful render output'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER hosted_project_reviews_tenant_account_derived
  BEFORE INSERT OR UPDATE ON hosted_project_reviews
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_workspace_account();
CREATE TRIGGER hosted_project_reviews_tenant_write_guard
  BEFORE INSERT OR UPDATE ON hosted_project_reviews
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER hosted_project_reviews_validate_output
  BEFORE INSERT OR UPDATE ON hosted_project_reviews
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_validate_hosted_project_review();
CREATE TRIGGER hosted_project_reviews_append_only
  BEFORE UPDATE OR DELETE ON hosted_project_reviews
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
ALTER TABLE hosted_project_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted_project_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_project_reviews_tenant_rls ON hosted_project_reviews
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());

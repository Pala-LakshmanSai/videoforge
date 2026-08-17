CREATE TABLE hosted_cpu_upload_authorities (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('PRIMARY_RESULT_OUTPUT', 'RESULT_DOCUMENT')),
  object_key text NOT NULL CHECK (
    object_key ~ '^tenant/[A-Za-z0-9._:-]+/workspace/[A-Za-z0-9._:-]+/project/[A-Za-z0-9._:-]+/revision/[A-Za-z0-9._:-]+/lane/(input|render)/job/[A-Za-z0-9._:-]+/artifact/[A-Za-z0-9._:-]+$'
  ),
  content_type text NOT NULL CHECK (
    content_type ~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
  ),
  max_bytes bigint NOT NULL CHECK (max_bytes BETWEEN 1 AND 10737418240),
  issued_content_length bigint CHECK (
    issued_content_length IS NULL OR issued_content_length BETWEEN 1 AND max_bytes
  ),
  issued_checksum_sha256 text CHECK (
    issued_checksum_sha256 IS NULL OR issued_checksum_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, workspace_id, attempt_id, source, object_key),
  FOREIGN KEY (account_id, workspace_id, attempt_id)
    REFERENCES hosted_cpu_job_attempts (account_id, workspace_id, id) ON DELETE RESTRICT,
  CHECK (
    (issued_content_length IS NULL) = (issued_checksum_sha256 IS NULL)
    AND (issued_content_length IS NULL) = (issued_at IS NULL)
  )
);

CREATE TRIGGER hosted_cpu_upload_authorities_tenant_account_derived
  BEFORE INSERT OR UPDATE ON hosted_cpu_upload_authorities
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_workspace_account();
CREATE TRIGGER hosted_cpu_upload_authorities_tenant_write_guard
  BEFORE INSERT OR UPDATE ON hosted_cpu_upload_authorities
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE hosted_cpu_upload_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted_cpu_upload_authorities FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_cpu_upload_authorities_tenant_rls ON hosted_cpu_upload_authorities
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());

CREATE FUNCTION public.videoforge_authorize_hosted_cpu_upload(
  target_attempt_id uuid,
  supplied_callback_token_sha256 text,
  supplied_source text,
  supplied_object_key text,
  supplied_content_type text,
  supplied_content_length bigint,
  supplied_checksum_sha256 text,
  observed_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  target hosted_cpu_job_attempts%ROWTYPE;
  authority hosted_cpu_upload_authorities%ROWTYPE;
  expected_prefix text;
BEGIN
  IF supplied_callback_token_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_source NOT IN ('PRIMARY_RESULT_OUTPUT', 'RESULT_DOCUMENT')
     OR supplied_content_type !~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
     OR supplied_content_length < 1
     OR supplied_checksum_sha256 !~ '^sha256:[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;

  SELECT * INTO target
    FROM hosted_cpu_job_attempts
   WHERE id = target_attempt_id
   FOR UPDATE;
  IF target.id IS NULL
     OR target.callback_token_sha256 <> supplied_callback_token_sha256
     OR target.state NOT IN ('OUTBOXED', 'SUBMITTED', 'RUNNING', 'RECONCILING')
     OR target.deadline_at <= observed_at THEN
    RETURN false;
  END IF;

  expected_prefix := 'tenant/' || target.account_id::text
    || '/workspace/' || target.workspace_id::text
    || '/project/' || target.project_id::text
    || '/revision/' || target.project_revision_id::text
    || '/lane/';
  IF supplied_object_key NOT LIKE expected_prefix || '%'
     OR supplied_object_key NOT LIKE '%/job/' || target.id::text || '/artifact/%'
     OR (
       supplied_source = 'RESULT_DOCUMENT'
       AND (
         supplied_object_key <> target.result_object_key
         OR supplied_content_type <> target.result_content_type
         OR supplied_content_length > target.result_max_bytes
       )
     ) THEN
    RETURN false;
  END IF;

  SELECT * INTO authority
    FROM hosted_cpu_upload_authorities
   WHERE attempt_id = target.id
     AND source = supplied_source
     AND object_key = supplied_object_key
   FOR UPDATE;
  IF authority.id IS NULL
     OR authority.account_id <> target.account_id
     OR authority.workspace_id <> target.workspace_id
     OR authority.content_type <> supplied_content_type
     OR supplied_content_length > authority.max_bytes
     OR (
       authority.issued_at IS NOT NULL
       AND (
         authority.issued_content_length <> supplied_content_length
         OR authority.issued_checksum_sha256 <> supplied_checksum_sha256
       )
     ) THEN
    RETURN false;
  END IF;

  PERFORM set_config('videoforge.account_id', target.account_id::text, true);
  UPDATE hosted_cpu_upload_authorities
     SET issued_content_length = supplied_content_length,
         issued_checksum_sha256 = supplied_checksum_sha256,
         issued_at = COALESCE(issued_at, observed_at)
   WHERE id = authority.id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_authorize_hosted_cpu_upload(
  uuid, text, text, text, text, bigint, text, timestamptz
) FROM PUBLIC;

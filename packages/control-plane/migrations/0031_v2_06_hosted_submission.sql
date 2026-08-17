ALTER TABLE hosted_cpu_job_attempts
  ADD COLUMN submission_idempotency_key text CHECK (
    submission_idempotency_key IS NULL
    OR submission_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$'
  );

CREATE UNIQUE INDEX hosted_cpu_job_submission_idempotency_uq
  ON hosted_cpu_job_attempts (account_id, workspace_id, submission_idempotency_key)
  WHERE submission_idempotency_key IS NOT NULL;

-- A lost HTTP response may replay the exact owned submission, but the key can never
-- be rebound to another project, revision, job kind, request, or container image.
CREATE FUNCTION public.videoforge_find_hosted_cpu_submission(
  supplied_session_token text,
  supplied_idempotency_key text,
  supplied_project_id uuid,
  supplied_project_revision_id uuid,
  supplied_kind text,
  supplied_request_sha256 text,
  supplied_image_digest text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  scope record;
  target hosted_cpu_job_attempts%ROWTYPE;
BEGIN
  SELECT * INTO scope FROM public.videoforge_hosted_session_scope(supplied_session_token);
  IF scope.account_id IS NULL
     OR supplied_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$'
     OR supplied_kind NOT IN ('ASR', 'RENDER')
     OR supplied_request_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR supplied_image_digest !~ '^sha256:[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO target
    FROM hosted_cpu_job_attempts
   WHERE account_id = scope.account_id
     AND workspace_id = scope.workspace_id
     AND submission_idempotency_key = supplied_idempotency_key;
  IF target.id IS NULL THEN RETURN NULL; END IF;
  IF target.project_id <> supplied_project_id
     OR target.project_revision_id <> supplied_project_revision_id
     OR target.kind <> supplied_kind
     OR target.request_sha256 <> supplied_request_sha256
     OR target.image_digest <> supplied_image_digest THEN
    RAISE EXCEPTION 'hosted CPU idempotency key was rebound' USING ERRCODE = '23505';
  END IF;
  RETURN target.id;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_find_hosted_cpu_submission(
  text, text, uuid, uuid, text, text, text
) FROM PUBLIC;

CREATE FUNCTION public.videoforge_hosted_cpu_cancellation_requested(
  target_attempt_id uuid,
  supplied_callback_token_sha256 text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
  SELECT CASE
    WHEN attempt.id IS NULL THEN NULL
    ELSE attempt.state IN ('CANCEL_REQUESTED', 'CANCELLED', 'EXPIRED')
  END
    FROM (SELECT 1) AS singleton
    LEFT JOIN hosted_cpu_job_attempts AS attempt
      ON attempt.id = target_attempt_id
     AND attempt.callback_token_sha256 = supplied_callback_token_sha256
     AND supplied_callback_token_sha256 ~ '^sha256:[0-9a-f]{64}$';
$$;
REVOKE ALL ON FUNCTION public.videoforge_hosted_cpu_cancellation_requested(uuid, text)
FROM PUBLIC;

CREATE FUNCTION public.videoforge_hosted_cpu_expected_primary_output(
  target_attempt_id uuid,
  supplied_callback_token_sha256 text
) RETURNS TABLE (
  object_key text,
  content_type text,
  content_length bigint,
  checksum_sha256 text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
  SELECT authority.object_key, authority.content_type, authority.issued_content_length,
         authority.issued_checksum_sha256
    FROM hosted_cpu_job_attempts AS attempt
    JOIN hosted_cpu_upload_authorities AS authority
      ON authority.account_id = attempt.account_id
     AND authority.workspace_id = attempt.workspace_id
     AND authority.attempt_id = attempt.id
   WHERE attempt.id = target_attempt_id
     AND attempt.callback_token_sha256 = supplied_callback_token_sha256
     AND supplied_callback_token_sha256 ~ '^sha256:[0-9a-f]{64}$'
     AND authority.source = 'PRIMARY_RESULT_OUTPUT'
     AND authority.issued_at IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.videoforge_hosted_cpu_expected_primary_output(uuid, text)
FROM PUBLIC;

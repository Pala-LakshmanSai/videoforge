/** A successful retained render must bind its exact primary output or result document. */
export const HOSTED_COMPLETED_RENDER_SQL = `
  attempt.kind = 'RENDER' AND attempt.state = 'SUCCEEDED'
  AND attempt.retention_deleted_at IS NULL
  AND authority.issued_at IS NOT NULL AND authority.content_type = 'video/mp4'
  AND authority.issued_content_length BETWEEN 1 AND 10737418240
  AND authority.issued_checksum_sha256 ~ '^sha256:[0-9a-f]{64}$'
  AND ((attempt.result_object_key = authority.object_key
    AND attempt.result_content_length = authority.issued_content_length
    AND attempt.result_checksum_sha256 = authority.issued_checksum_sha256)
    OR (attempt.result_object_key = result_document.object_key
    AND attempt.result_content_length = result_document.issued_content_length
    AND attempt.result_checksum_sha256 = result_document.issued_checksum_sha256))
  AND (NOT EXISTS(SELECT 1 FROM hosted_render_only_runs run WHERE run.id=attempt.id)
    OR EXISTS(SELECT 1 FROM hosted_render_only_runs run WHERE run.id=attempt.id
      AND run.account_id=attempt.account_id AND run.workspace_id=attempt.workspace_id
      AND run.state='SUCCEEDED' AND run.output_receipt_id IS NOT NULL
      AND run.final_output->>'checksumSha256'=authority.issued_checksum_sha256))`;

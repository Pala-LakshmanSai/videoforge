-- V2-04 output-binding and result-discovery repair.
-- Canonical output acceptance joins every signed item to one live tenant-private artifact commit
-- receipt. A caller-provided object list or unattached checksum can never become output authority.

ALTER TABLE serverless_output_receipts
  ADD COLUMN artifact_commit_receipt_sha256s jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT serverless_output_receipts_commit_hashes_array_ck
    CHECK (jsonb_typeof(artifact_commit_receipt_sha256s) = 'array'),
  ADD CONSTRAINT serverless_output_receipts_commit_hashes_bound_ck
    CHECK (jsonb_array_length(artifact_commit_receipt_sha256s) <= 4096);

CREATE OR REPLACE FUNCTION public.videoforge_fence_serverless_output_acceptance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_attempt serverless_attempts%ROWTYPE;
  provenance_items jsonb;
  artifact jsonb;
  artifact_count integer;
  distinct_item_count integer;
  distinct_receipt_count integer;
  exact_match_count integer;
BEGIN
  IF NEW.acceptance <> 'ACCEPTED_CANONICAL' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO current_attempt
    FROM public.serverless_attempts
   WHERE id = NEW.attempt_id
   FOR UPDATE;

  IF current_attempt.state NOT IN ('ASSIGNED', 'IN_QUEUE', 'IN_PROGRESS', 'UPLOADING', 'RECONCILING') THEN
    RAISE EXCEPTION 'serverless output acceptance is fenced by attempt state %', current_attempt.state
      USING ERRCODE = '55000';
  END IF;

  artifact_count := jsonb_array_length(NEW.artifacts);
  IF artifact_count <> current_attempt.item_count
     OR jsonb_array_length(NEW.artifact_commit_receipt_sha256s) <> current_attempt.item_count THEN
    RAISE EXCEPTION 'canonical output must contain one artifact and commit receipt per attempt item'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(DISTINCT value->>'item_id'),
         count(DISTINCT value->>'artifact_commit_receipt_sha256')
    INTO distinct_item_count, distinct_receipt_count
    FROM jsonb_array_elements(NEW.artifacts);
  IF distinct_item_count <> current_attempt.item_count
     OR distinct_receipt_count <> current_attempt.item_count THEN
    RAISE EXCEPTION 'canonical output item and commit receipt identities must be unique'
      USING ERRCODE = '23514';
  END IF;

  SELECT items INTO provenance_items
    FROM public.serverless_provenance_receipts
   WHERE account_id = NEW.account_id
     AND workspace_id = NEW.workspace_id
     AND attempt_id = NEW.attempt_id
     AND assignment_id = NEW.assignment_id
     AND receipt_sha256 = NEW.provenance_receipt_sha256;
  IF provenance_items IS NULL OR jsonb_array_length(provenance_items) <> current_attempt.item_count THEN
    RAISE EXCEPTION 'canonical output does not match one complete signed provenance receipt'
      USING ERRCODE = '23514';
  END IF;

  FOR artifact IN SELECT value FROM jsonb_array_elements(NEW.artifacts) LOOP
    IF (artifact - ARRAY[
          'item_id', 'object_key', 'content_length', 'checksum_sha256', 'probe',
          'artifact_commit_receipt_sha256'
        ]::text[]) <> '{}'::jsonb
       OR NOT (NEW.artifact_commit_receipt_sha256s ? (artifact->>'artifact_commit_receipt_sha256')) THEN
      RAISE EXCEPTION 'canonical artifact shape or commit receipt manifest is invalid'
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*) INTO exact_match_count
      FROM public.artifact_receipts AS receipt
      JOIN public.artifact_reservations AS reservation
        ON reservation.account_id = receipt.account_id
       AND reservation.workspace_id = receipt.workspace_id
       AND reservation.id = receipt.reservation_id
     WHERE receipt.account_id = NEW.account_id
       AND receipt.workspace_id = NEW.workspace_id
       AND receipt.deleted_at IS NULL
       AND receipt.receipt_sha256 = artifact->>'artifact_commit_receipt_sha256'
       AND receipt.object_key = artifact->>'object_key'
       AND receipt.content_length = (artifact->>'content_length')::bigint
       AND receipt.checksum_sha256 = artifact->>'checksum_sha256'
       AND receipt.probe = artifact->'probe'
       AND reservation.project_revision_id = NEW.project_revision_id
       AND reservation.job_id = NEW.attempt_id::text
       AND reservation.artifact_id = artifact->>'item_id'
       AND reservation.lane = CASE NEW.lane
         WHEN 'mage_image' THEN 'MAGE_IMAGE'
         WHEN 'soulx_avatar' THEN 'SOULX_AVATAR'
       END
       AND reservation.object_key = current_attempt.output_prefix || '/artifact/' || (artifact->>'item_id')
       AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(provenance_items) AS signed_item
          WHERE signed_item->>'item_id' = artifact->>'item_id'
            AND signed_item->>'state' = 'SUCCEEDED'
            AND signed_item->>'output_object_key' = artifact->>'object_key'
            AND signed_item->>'output_sha256' = artifact->>'checksum_sha256'
            AND (signed_item->>'output_bytes')::bigint = (artifact->>'content_length')::bigint
            AND signed_item->'probe' = artifact->'probe'
       );
    IF exact_match_count <> 1 THEN
      RAISE EXCEPTION 'canonical artifact is not bound to exact signed and committed facts'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

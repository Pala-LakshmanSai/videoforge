-- V2-04 independent-audit repairs.
-- An authoritative or advisory provider observation is representable only after one exact
-- provider assignment has been persisted for the same tenant and attempt.

ALTER TABLE serverless_provider_assignments
  ADD CONSTRAINT serverless_provider_assignments_attempt_identity_uq
  UNIQUE (account_id, workspace_id, attempt_id, id);

ALTER TABLE serverless_progress_events
  ALTER COLUMN assignment_id SET NOT NULL;

ALTER TABLE serverless_progress_events
  ADD CONSTRAINT serverless_progress_events_exact_assignment_fk
  FOREIGN KEY (account_id, workspace_id, attempt_id, assignment_id)
  REFERENCES serverless_provider_assignments (account_id, workspace_id, attempt_id, id)
  ON DELETE RESTRICT;

-- At the exact provider-result expiry boundary there is no future reconciliation interval. The
-- terminal audit row therefore closes at its start instant instead of inventing time past expiry.
ALTER TABLE serverless_reconciliations
  DROP CONSTRAINT serverless_reconciliations_check;

ALTER TABLE serverless_reconciliations
  ADD CONSTRAINT serverless_reconciliations_deadline_order_ck
  CHECK (deadline_at >= started_at);

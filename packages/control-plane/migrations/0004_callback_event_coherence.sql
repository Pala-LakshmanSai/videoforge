-- Bind every callback receipt to the exact attempt event and raw-payload hash it authenticated.
-- Additive PostgreSQL only; prior migration files remain immutable.

ALTER TABLE public.workflow_events
  ADD CONSTRAINT workflow_events_callback_receipt_identity_uq
  UNIQUE (workspace_id, id, task_id, attempt_id, payload_hash);

ALTER TABLE public.callback_receipts
  DROP CONSTRAINT callback_receipts_workflow_event_fk;

ALTER TABLE public.callback_receipts
  ADD CONSTRAINT callback_receipts_workflow_event_fk
  FOREIGN KEY (workspace_id, workflow_event_id, task_id, attempt_id, payload_hash)
  REFERENCES public.workflow_events (workspace_id, id, task_id, attempt_id, payload_hash)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

-- Durable callback replay protection for VF-1-05/VF-1-06.
-- Additive PostgreSQL only; 0001/0002 remain immutable.

CREATE TABLE public.callback_receipts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  task_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  workflow_event_id uuid NOT NULL,
  callback_kind text NOT NULL,
  nonce_hash text NOT NULL,
  payload_hash text NOT NULL,
  signature_key_id text NOT NULL,
  signed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT callback_receipts_workspace_id_uq UNIQUE (workspace_id, id),
  CONSTRAINT callback_receipts_nonce_uq UNIQUE (workspace_id, nonce_hash),
  CONSTRAINT callback_receipts_workflow_event_uq UNIQUE (workspace_id, workflow_event_id),
  CONSTRAINT callback_receipts_attempt_fk FOREIGN KEY (workspace_id, task_id, attempt_id)
    REFERENCES public.attempts (workspace_id, task_id, id) ON DELETE RESTRICT,
  CONSTRAINT callback_receipts_workflow_event_fk FOREIGN KEY (workspace_id, workflow_event_id)
    REFERENCES public.workflow_events (workspace_id, id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (callback_kind = btrim(callback_kind) AND length(callback_kind) BETWEEN 1 AND 80),
  CHECK (nonce_hash ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (
    signature_key_id = btrim(signature_key_id)
    AND length(signature_key_id) BETWEEN 1 AND 160
  ),
  CHECK (signed_at <= received_at AND received_at <= expires_at)
);

CREATE INDEX callback_receipts_attempt_idx
  ON public.callback_receipts (workspace_id, attempt_id, received_at);

CREATE TRIGGER callback_receipts_append_only
  BEFORE UPDATE OR DELETE ON public.callback_receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.videoforge_reject_immutable_row();

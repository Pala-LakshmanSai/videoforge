-- Durable exact-input/exact-result replay authority for repository mutations.
-- Additive PostgreSQL only; prior migration files remain immutable.

CREATE TABLE public.repository_mutation_receipts (
  workspace_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  operation text NOT NULL,
  input_hash text NOT NULL,
  result_codec text NOT NULL,
  result_payload jsonb NOT NULL,
  result_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT repository_mutation_receipts_pkey
    PRIMARY KEY (workspace_id, idempotency_key),
  CONSTRAINT repository_mutation_receipts_workspace_fk
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces (id) ON DELETE RESTRICT,
  CONSTRAINT repository_mutation_receipts_key_shape_chk CHECK (
    idempotency_key = btrim(idempotency_key)
    AND length(idempotency_key) BETWEEN 1 AND 240
  ),
  CONSTRAINT repository_mutation_receipts_operation_shape_chk
    CHECK (operation ~ '^[a-z][a-z0-9_]{0,119}$'),
  CONSTRAINT repository_mutation_receipts_input_hash_chk
    CHECK (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT repository_mutation_receipts_codec_chk
    CHECK (result_codec = 'repository-result/v1'),
  CONSTRAINT repository_mutation_receipts_payload_shape_chk
    CHECK (jsonb_typeof(result_payload) = 'object'),
  CONSTRAINT repository_mutation_receipts_result_hash_chk
    CHECK (result_hash ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX repository_mutation_receipts_operation_idx
  ON public.repository_mutation_receipts (workspace_id, operation, created_at);

CREATE TRIGGER repository_mutation_receipts_append_only
  BEFORE UPDATE OR DELETE ON public.repository_mutation_receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.videoforge_reject_immutable_row();

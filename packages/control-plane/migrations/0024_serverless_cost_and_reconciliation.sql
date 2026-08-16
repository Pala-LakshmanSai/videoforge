-- V2-04 provider-free Serverless v3 cancellation, bounded reconciliation, and cost conservation
-- (DEC_DISPATCH_001, DEC_COST_001, GATE_SERVERLESS_CONTRACT_001).
--
-- Cancellation targets one exact owned provider job ID. Endpoint-wide queue purge has no record
-- here and no ordinary code path. Cost rows keep possible duplicate compute visible instead of
-- promising that duplicate execution or billing was impossible.

CREATE TABLE serverless_cancellations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  assignment_id uuid,
  requested_by text NOT NULL CHECK (requested_by IN (
    'OWNER_ACCOUNT', 'SYSTEM_DEADLINE', 'SYSTEM_TTL_EXPIRY', 'SYSTEM_SPEND_CEILING'
  )),
  target_scope text NOT NULL CHECK (target_scope = 'EXACT_OWNED_PROVIDER_JOB_ID'),
  local_intent_committed_at timestamptz NOT NULL,
  provider_cancel_called boolean NOT NULL,
  provider_terminal_state text CHECK (provider_terminal_state IN (
    'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'
  )),
  settled_cost_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (settled_cost_usd >= 0),
  possible_unrefunded_cost_usd numeric(12, 6) NOT NULL DEFAULT 0
    CHECK (possible_unrefunded_cost_usd >= 0),
  -- Cancellation never promises that already-consumed provider compute is refunded.
  refund_promised boolean NOT NULL CHECK (NOT refund_promised),
  completed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (attempt_id),
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, attempt_id)
    REFERENCES serverless_attempts (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, assignment_id)
    REFERENCES serverless_provider_assignments (account_id, workspace_id, id) ON DELETE RESTRICT,
  CHECK ((completed_at IS NULL) = (provider_terminal_state IS NULL)),
  CHECK (completed_at IS NULL OR completed_at >= local_intent_committed_at),
  CHECK (assignment_id IS NOT NULL OR NOT provider_cancel_called)
);

CREATE TABLE serverless_reconciliations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  trigger_reason text NOT NULL CHECK (trigger_reason IN (
    'DISPATCH_ACK_UNKNOWN', 'POLL_DEADLINE', 'RESTART', 'WEBHOOK_ADVISORY',
    'RESULT_WINDOW_EXPIRY_RISK', 'OWNER_CANCELLATION'
  )),
  started_at timestamptz NOT NULL,
  deadline_at timestamptz NOT NULL,
  -- Asynchronous provider results expire; reconciliation must finish inside that window.
  provider_result_window_seconds integer NOT NULL CHECK (provider_result_window_seconds = 1800),
  outcome text NOT NULL CHECK (outcome IN (
    'UNIQUE_ASSIGNMENT_PROVED', 'NO_ASSIGNMENT_PROVED', 'TERMINAL_CONFIRMED', 'AMBIGUOUS_STOP'
  )),
  status_polls integer NOT NULL CHECK (status_polls >= 0),
  assignments_observed smallint NOT NULL CHECK (assignments_observed BETWEEN 0 AND 8),
  durable_output_present boolean NOT NULL,
  cost_events_observed integer NOT NULL CHECK (cost_events_observed >= 0),
  possible_duplicate_compute_usd numeric(12, 6) NOT NULL DEFAULT 0
    CHECK (possible_duplicate_compute_usd >= 0),
  new_dispatch_permitted boolean NOT NULL,
  queue_purge_used boolean NOT NULL CHECK (NOT queue_purge_used),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (attempt_id, sequence),
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, attempt_id)
    REFERENCES serverless_attempts (account_id, workspace_id, id) ON DELETE RESTRICT,
  CHECK (deadline_at > started_at),
  -- An ambiguous dispatch stops new provider work for that logical attempt.
  CHECK (outcome <> 'AMBIGUOUS_STOP' OR NOT new_dispatch_permitted),
  CHECK (outcome <> 'UNIQUE_ASSIGNMENT_PROVED' OR assignments_observed = 1)
);

CREATE TABLE serverless_cost_ledgers (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  owner_type text NOT NULL CHECK (owner_type IN (
    'PROJECT_REVISION', 'IMAGE_STYLE_VERSION', 'AVATAR_PROFILE_VERSION'
  )),
  owner_id uuid NOT NULL,
  ceiling_usd numeric(12, 6) NOT NULL CHECK (ceiling_usd > 0 AND ceiling_usd <= 2),
  estimated_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (estimated_usd >= 0),
  reserved_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  reported_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (reported_usd >= 0),
  possible_duplicate_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (possible_duplicate_usd >= 0),
  settled_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (settled_usd >= 0),
  refunded_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (refunded_usd >= 0),
  -- The two retained 50 GB model volumes are fixed shared infrastructure, never per-video cost.
  fixed_retained_volume_usd_excluded boolean NOT NULL CHECK (fixed_retained_volume_usd_excluded),
  updated_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (attempt_id),
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, attempt_id)
    REFERENCES serverless_attempts (account_id, workspace_id, id) ON DELETE RESTRICT,
  CHECK (reserved_usd <= ceiling_usd),
  CHECK (refunded_usd <= settled_usd + possible_duplicate_usd)
);

CREATE TABLE serverless_cost_events (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  ledger_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  kind text NOT NULL CHECK (kind IN (
    'ESTIMATE', 'RESERVATION', 'PROVIDER_REPORT', 'POSSIBLE_DUPLICATE', 'SETTLED', 'REFUND'
  )),
  amount_usd numeric(12, 6) NOT NULL CHECK (amount_usd >= 0),
  rate_source text NOT NULL CHECK (length(rate_source) BETWEEN 1 AND 400),
  rate_checked_at timestamptz NOT NULL,
  confidence text NOT NULL CHECK (confidence IN (
    'MEASURED', 'PROVIDER_REPORTED', 'ESTIMATED', 'AMBIGUOUS'
  )),
  recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (attempt_id, sequence),
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, attempt_id)
    REFERENCES serverless_attempts (account_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, ledger_id)
    REFERENCES serverless_cost_ledgers (account_id, workspace_id, id) ON DELETE RESTRICT,
  -- Ambiguous dispatch cost is never hidden behind a confident label.
  CHECK (kind <> 'POSSIBLE_DUPLICATE' OR confidence = 'AMBIGUOUS')
);

CREATE INDEX serverless_cost_events_attempt_idx
  ON serverless_cost_events (attempt_id, sequence);

CREATE FUNCTION public.videoforge_validate_serverless_cost_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  latest_sequence bigint;
BEGIN
  SELECT max(sequence) INTO latest_sequence
    FROM serverless_cost_events
   WHERE attempt_id = NEW.attempt_id;
  IF latest_sequence IS NOT NULL AND NEW.sequence <= latest_sequence THEN
    RAISE EXCEPTION 'serverless cost events must advance monotonically' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER serverless_cost_events_monotonic_sequence
  BEFORE INSERT ON serverless_cost_events
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_validate_serverless_cost_event();

CREATE TRIGGER serverless_cost_events_append_only
  BEFORE UPDATE OR DELETE ON serverless_cost_events
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER serverless_reconciliations_append_only
  BEFORE UPDATE OR DELETE ON serverless_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();

CREATE TRIGGER serverless_cancellations_tenant_account_derived
  BEFORE INSERT OR UPDATE ON serverless_cancellations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_revision_account();
CREATE TRIGGER serverless_reconciliations_tenant_account_derived
  BEFORE INSERT OR UPDATE ON serverless_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_revision_account();
CREATE TRIGGER serverless_cost_ledgers_tenant_account_derived
  BEFORE INSERT OR UPDATE ON serverless_cost_ledgers
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_revision_account();
CREATE TRIGGER serverless_cost_events_tenant_account_derived
  BEFORE INSERT OR UPDATE ON serverless_cost_events
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_derive_revision_account();

CREATE TRIGGER serverless_cancellations_tenant_write_guard
  BEFORE INSERT OR UPDATE ON serverless_cancellations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER serverless_reconciliations_tenant_write_guard
  BEFORE INSERT OR UPDATE ON serverless_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER serverless_cost_ledgers_tenant_write_guard
  BEFORE INSERT OR UPDATE ON serverless_cost_ledgers
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER serverless_cost_events_tenant_write_guard
  BEFORE INSERT OR UPDATE ON serverless_cost_events
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();

DO $tenant_rls$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'serverless_cancellations', 'serverless_reconciliations', 'serverless_cost_ledgers',
    'serverless_cost_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I
         USING (account_id = public.videoforge_current_account_id())
         WITH CHECK (account_id = public.videoforge_current_account_id())',
      target || '_tenant_rls', target
    );
    EXECUTE format(
      'CREATE VIEW public.%I WITH (security_barrier) AS
         SELECT * FROM public.%I
          WHERE account_id = public.videoforge_current_account_id()',
      'videoforge_tenant_' || target, target
    );
  END LOOP;
END
$tenant_rls$;

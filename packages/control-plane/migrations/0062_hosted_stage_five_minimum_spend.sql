-- Permit the exact bounded Stage 1-5 hosted beta cap: $0.01 context extraction plus
-- $0.04 prompt writing. The existing $2 upper bound remains unchanged.
ALTER TABLE public.project_revisions
  DROP CONSTRAINT project_revisions_maximum_cost_micro_usd_check,
  ADD CONSTRAINT project_revisions_maximum_cost_micro_usd_check
    CHECK (maximum_cost_micro_usd BETWEEN 50000 AND 2000000);

-- 0181_hosted_prompt_reservation_check.sql
--
-- The run's reservation is bounded by a CHECK constraint, not by the capability alone:
-- hosted_prompt_runs_reserved_cost_micro_usd_check pins the column to exactly 40000. Migration 0180
-- raised the reservation to 600000 (one 10-scene batch measures about USD 0.12 and a revision plans
-- three), so every prepare now fails with 23514 "new row for relation hosted_prompt_runs violates
-- check constraint" before any provider call. The bound follows the reservation, and stays a bound:
-- only the two values this product has ever reserved are accepted.

ALTER TABLE public.hosted_prompt_runs
  DROP CONSTRAINT IF EXISTS hosted_prompt_runs_reserved_cost_micro_usd_check;
ALTER TABLE public.hosted_prompt_runs
  ADD CONSTRAINT hosted_prompt_runs_reserved_cost_micro_usd_check
  CHECK (reserved_cost_micro_usd IN (40000, 600000));

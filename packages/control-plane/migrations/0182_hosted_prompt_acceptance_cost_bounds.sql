-- 0182_hosted_prompt_acceptance_cost_bounds.sql
--
-- The acceptance tables pinned provider costs to bounds that the real work exceeds:
-- hosted_prompt_batch_progress.reported_cost_micro_usd <= 40000 and
-- hosted_prompt_scene_progress.reported_cost_micro_usd <= 800. Measured 2026-09-18 on this project's
-- own 10-scene batches at the pinned model: 50088-59649 micro-USD per batch, i.e. about 5000-6000 per
-- scene. Every accepted batch therefore failed at insert with 23514, which is why stage 5 recorded no
-- scene progress even after the provider answered. Both bounds move to the shape of the work - the
-- batch bound to the run's reservation (600000) and the scene bound to a tenth of it - and stay
-- bounds, so a runaway provider cost is still refused.

ALTER TABLE public.hosted_prompt_batch_progress
  DROP CONSTRAINT IF EXISTS hosted_prompt_batch_progress_reported_cost_micro_usd_check;
ALTER TABLE public.hosted_prompt_batch_progress
  ADD CONSTRAINT hosted_prompt_batch_progress_reported_cost_micro_usd_check
  CHECK (reported_cost_micro_usd >= 0 AND reported_cost_micro_usd <= 600000);

ALTER TABLE public.hosted_prompt_scene_progress
  DROP CONSTRAINT IF EXISTS hosted_prompt_scene_progress_reported_cost_micro_usd_check;
ALTER TABLE public.hosted_prompt_scene_progress
  ADD CONSTRAINT hosted_prompt_scene_progress_reported_cost_micro_usd_check
  CHECK (reported_cost_micro_usd >= 0 AND reported_cost_micro_usd <= 60000);

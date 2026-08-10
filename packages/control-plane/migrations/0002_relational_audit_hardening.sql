-- VideoForge VF-1-01A relational audit hardening.
-- Additive correction only: preserve the committed 0001 migration and tighten its installed schema.

SET LOCAL search_path = public, pg_catalog;

-- Reconcile persisted vocabularies with the normative Avatar Hub and revision contracts.
UPDATE public.avatar_profile_versions
   SET state = 'DRAFT'
 WHERE state = 'UPLOADING';

ALTER TABLE public.avatar_profile_versions
  DROP CONSTRAINT avatar_profile_versions_state_check,
  ADD CONSTRAINT avatar_profile_versions_state_check
    CHECK (state IN ('DRAFT', 'VALIDATING', 'NEEDS_REVIEW', 'FAILED', 'READY', 'ABANDONED'));

DROP INDEX public.avatar_profile_versions_open_draft_uq;
CREATE UNIQUE INDEX avatar_profile_versions_open_draft_uq
  ON public.avatar_profile_versions (workspace_id, profile_id)
  WHERE state IN ('DRAFT', 'VALIDATING', 'NEEDS_REVIEW', 'FAILED');

-- An absent assessment is UNTESTED. Placeholder rows contain no immutable evidence and are removed.
DELETE FROM public.avatar_compatibility_assessments
 WHERE state = 'UNTESTED';

ALTER TABLE public.avatar_compatibility_assessments
  DROP CONSTRAINT avatar_compatibility_assessments_state_check,
  DROP CONSTRAINT avatar_compatibility_assessments_check,
  ADD CONSTRAINT avatar_compatibility_assessments_state_check
    CHECK (state IN ('RUNNING', 'PASSED', 'FAILED', 'STALE', 'CANCELLED')),
  ADD CONSTRAINT avatar_compatibility_assessments_evidence_state_check CHECK (
    (state = 'RUNNING' AND evidence_contract_name IS NULL AND evidence_contract_version IS NULL AND
     evidence_payload IS NULL AND evidence_hash IS NULL AND model_snapshot_hash IS NULL AND
     finished_at IS NULL)
    OR
    (state IN ('PASSED', 'FAILED', 'STALE', 'CANCELLED') AND
     evidence_contract_name IS NOT NULL AND evidence_contract_version IS NOT NULL AND
     evidence_payload IS NOT NULL AND evidence_hash IS NOT NULL AND model_snapshot_hash IS NOT NULL AND
     finished_at IS NOT NULL)
  );

ALTER TABLE public.project_revisions
  DROP CONSTRAINT project_revisions_avatar_compatibility_state_check,
  DROP CONSTRAINT project_revisions_check,
  DROP CONSTRAINT project_revisions_extra_prompt_keywords_check,
  DROP CONSTRAINT project_revisions_maximum_cost_micro_usd_check,
  ALTER COLUMN extra_prompt_keywords DROP NOT NULL,
  ALTER COLUMN extra_prompt_keywords DROP DEFAULT,
  ADD CONSTRAINT project_revisions_avatar_compatibility_state_check
    CHECK (avatar_compatibility_state IN ('UNTESTED', 'RUNNING', 'PASSED', 'FAILED', 'STALE', 'CANCELLED')),
  ADD CONSTRAINT project_revisions_avatar_compatibility_evidence_check CHECK (
    (avatar_compatibility_state IN ('UNTESTED', 'RUNNING') AND
     avatar_compatibility_assessment_id IS NULL AND avatar_compatibility_evidence_hash IS NULL)
    OR
    (avatar_compatibility_state IN ('PASSED', 'FAILED', 'STALE', 'CANCELLED') AND
     avatar_compatibility_assessment_id IS NOT NULL AND avatar_compatibility_evidence_hash IS NOT NULL)
  ),
  ADD CONSTRAINT project_revisions_extra_prompt_keywords_check CHECK (
    extra_prompt_keywords IS NULL OR length(extra_prompt_keywords) <= 500
  ),
  ADD CONSTRAINT project_revisions_applied_extra_prompt_keywords_check CHECK (
    NOT apply_extra_prompt_keywords OR
    (extra_prompt_keywords IS NOT NULL AND length(btrim(extra_prompt_keywords)) > 0)
  ),
  ADD CONSTRAINT project_revisions_maximum_cost_micro_usd_check
    CHECK (maximum_cost_micro_usd BETWEEN 100000 AND 2000000),
  ADD CONSTRAINT project_revisions_seed_check
    CHECK (seed BETWEEN 0 AND 4294967295);

ALTER TABLE public.assets
  ADD CONSTRAINT assets_project_revision_requires_project_check
    CHECK (project_revision_id IS NULL OR project_id IS NOT NULL);

-- Nullable composite foreign keys use MATCH SIMPLE, so the event discriminator itself must require
-- the complete and exclusive reference tuple for each aggregate kind.
ALTER TABLE public.workflow_events
  DROP CONSTRAINT workflow_events_check,
  DROP CONSTRAINT workflow_events_check1,
  ADD CONSTRAINT workflow_events_aggregate_shape_check CHECK (
    (aggregate_type = 'WORKFLOW' AND aggregate_id = workflow_instance_id AND
     task_id IS NULL AND attempt_id IS NULL)
    OR
    (aggregate_type = 'TASK' AND aggregate_id = task_id AND
     task_id IS NOT NULL AND attempt_id IS NULL)
    OR
    (aggregate_type = 'ATTEMPT' AND aggregate_id = attempt_id AND
     task_id IS NOT NULL AND attempt_id IS NOT NULL)
  );

-- Link every billed preset action to the same atomic task, attempt, reservation, and outbox tuple.
ALTER TABLE public.generation_tasks
  DROP CONSTRAINT generation_tasks_check,
  DROP CONSTRAINT generation_tasks_check1,
  ADD CONSTRAINT generation_tasks_owner_shape_check CHECK (
    (owner_type = 'PROJECT_REVISION' AND owner_id = project_revision_id AND
     project_revision_id IS NOT NULL AND image_style_version_id IS NULL AND
     avatar_profile_version_id IS NULL)
    OR
    (owner_type = 'IMAGE_STYLE_VERSION' AND owner_id = image_style_version_id AND
     image_style_version_id IS NOT NULL AND project_revision_id IS NULL AND
     avatar_profile_version_id IS NULL)
    OR
    (owner_type = 'AVATAR_PROFILE_VERSION' AND owner_id = avatar_profile_version_id AND
     avatar_profile_version_id IS NOT NULL AND project_revision_id IS NULL AND
     image_style_version_id IS NULL)
  ),
  ADD CONSTRAINT generation_tasks_cancellation_completion_check CHECK (
    (state <> 'CANCEL_REQUESTED' OR (cancel_requested_at IS NOT NULL AND finished_at IS NULL)) AND
    (state <> 'CANCELLED' OR (cancel_requested_at IS NOT NULL AND finished_at IS NOT NULL)) AND
    (state <> 'COMPLETE' OR finished_at IS NOT NULL)
  ),
  ADD CONSTRAINT generation_tasks_image_style_owner_link_uq
    UNIQUE (workspace_id, id, image_style_version_id),
  ADD CONSTRAINT generation_tasks_avatar_profile_owner_link_uq
    UNIQUE (workspace_id, id, avatar_profile_version_id);

ALTER TABLE public.cost_events
  ADD CONSTRAINT cost_events_execution_link_uq
    UNIQUE (workspace_id, task_id, attempt_id, id, event_type);

ALTER TABLE public.outbox
  ADD CONSTRAINT outbox_execution_link_uq
    UNIQUE (workspace_id, task_id, attempt_id, id, kind);

ALTER TABLE public.attempts
  ADD CONSTRAINT attempts_unknown_requires_reconciliation_check CHECK (
    state <> 'UNKNOWN' OR
    (finished_at IS NULL AND result_disposition = 'PENDING' AND dispatch_state = 'AMBIGUOUS')
  );

ALTER TABLE public.image_style_analysis_attempts
  ADD CONSTRAINT image_style_analysis_attempts_unknown_unresolved_check CHECK (
    state <> 'UNKNOWN' OR (finished_at IS NULL AND response_hash IS NULL)
  );

ALTER TABLE public.avatar_profile_test_attempts
  ADD CONSTRAINT avatar_profile_test_attempts_unknown_unresolved_check CHECK (
    state <> 'UNKNOWN' OR (finished_at IS NULL AND output_asset_id IS NULL)
  );

ALTER TABLE public.image_style_analysis_attempts
  ADD COLUMN task_id uuid NOT NULL,
  ADD COLUMN execution_attempt_id uuid NOT NULL,
  ADD COLUMN reservation_cost_event_id uuid NOT NULL,
  ADD COLUMN reservation_event_type text NOT NULL DEFAULT 'RESERVED'
    CHECK (reservation_event_type = 'RESERVED'),
  ADD COLUMN outbox_id uuid NOT NULL,
  ADD COLUMN outbox_kind text NOT NULL DEFAULT 'DISPATCH'
    CHECK (outbox_kind = 'DISPATCH'),
  ADD CONSTRAINT image_style_analysis_attempts_owner_task_fk
    FOREIGN KEY (workspace_id, task_id, style_version_id)
    REFERENCES public.generation_tasks (workspace_id, id, image_style_version_id) ON DELETE RESTRICT,
  ADD CONSTRAINT image_style_analysis_attempts_execution_attempt_fk
    FOREIGN KEY (workspace_id, task_id, execution_attempt_id)
    REFERENCES public.attempts (workspace_id, task_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT image_style_analysis_attempts_reservation_fk
    FOREIGN KEY (
      workspace_id, task_id, execution_attempt_id, reservation_cost_event_id, reservation_event_type
    ) REFERENCES public.cost_events (workspace_id, task_id, attempt_id, id, event_type) ON DELETE RESTRICT,
  ADD CONSTRAINT image_style_analysis_attempts_outbox_fk
    FOREIGN KEY (workspace_id, task_id, execution_attempt_id, outbox_id, outbox_kind)
    REFERENCES public.outbox (workspace_id, task_id, attempt_id, id, kind) ON DELETE RESTRICT;

ALTER TABLE public.avatar_profile_test_attempts
  ADD COLUMN task_id uuid NOT NULL,
  ADD COLUMN execution_attempt_id uuid NOT NULL,
  ADD COLUMN reservation_cost_event_id uuid NOT NULL,
  ADD COLUMN reservation_event_type text NOT NULL DEFAULT 'RESERVED'
    CHECK (reservation_event_type = 'RESERVED'),
  ADD COLUMN outbox_id uuid NOT NULL,
  ADD COLUMN outbox_kind text NOT NULL DEFAULT 'DISPATCH'
    CHECK (outbox_kind = 'DISPATCH'),
  ADD COLUMN avatar_profile_version_id uuid NOT NULL,
  ADD CONSTRAINT avatar_profile_test_attempts_execution_attempt_fk
    FOREIGN KEY (workspace_id, task_id, execution_attempt_id)
    REFERENCES public.attempts (workspace_id, task_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT avatar_profile_test_attempts_reservation_fk
    FOREIGN KEY (
      workspace_id, task_id, execution_attempt_id, reservation_cost_event_id, reservation_event_type
    ) REFERENCES public.cost_events (workspace_id, task_id, attempt_id, id, event_type) ON DELETE RESTRICT,
  ADD CONSTRAINT avatar_profile_test_attempts_outbox_fk
    FOREIGN KEY (workspace_id, task_id, execution_attempt_id, outbox_id, outbox_kind)
    REFERENCES public.outbox (workspace_id, task_id, attempt_id, id, kind) ON DELETE RESTRICT,
  ADD CONSTRAINT avatar_profile_test_attempts_assessment_version_fk
    FOREIGN KEY (workspace_id, avatar_profile_version_id, assessment_id)
    REFERENCES public.avatar_compatibility_assessments (workspace_id, avatar_profile_version_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT avatar_profile_test_attempts_owner_task_fk
    FOREIGN KEY (workspace_id, task_id, avatar_profile_version_id)
    REFERENCES public.generation_tasks (workspace_id, id, avatar_profile_version_id) ON DELETE RESTRICT;

-- Security-definer-style hardening without elevated privileges: every invariant function fixes its
-- lookup schema and also qualifies relations explicitly.
CREATE OR REPLACE FUNCTION public.videoforge_require_ready_avatar_active_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.active_version_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.avatar_profile_versions
     WHERE workspace_id = NEW.workspace_id
       AND profile_id = NEW.id
       AND id = NEW.active_version_id
       AND state = 'READY'
  ) THEN
    RAISE EXCEPTION 'avatar active version must be a READY version of the same profile'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.videoforge_require_published_style_active_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.active_version_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.image_style_versions
     WHERE workspace_id = NEW.workspace_id
       AND style_id = NEW.id
       AND id = NEW.active_version_id
       AND state = 'PUBLISHED'
  ) THEN
    RAISE EXCEPTION 'image style active version must be a PUBLISHED version of the same style'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.videoforge_validate_locked_revision_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.status <> 'LOCKED' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.avatar_profile_versions version
      JOIN public.assets runtime_asset
        ON runtime_asset.workspace_id = version.workspace_id
       AND runtime_asset.id = version.runtime_source_asset_id
     WHERE version.workspace_id = NEW.workspace_id
       AND version.profile_id = NEW.avatar_profile_id
       AND version.id = NEW.avatar_profile_version_id
       AND version.state = 'READY'
       AND version.profile_hash = NEW.avatar_profile_hash
       AND version.runtime_source_asset_id = NEW.avatar_runtime_source_asset_id
       AND version.runtime_source_binary_sha256 = NEW.avatar_runtime_source_binary_sha256
       AND version.source_preparation_profile = NEW.avatar_source_preparation_profile
       AND version.source_validation_profile = NEW.avatar_source_validation_profile
       AND runtime_asset.binary_sha256 = NEW.avatar_runtime_source_binary_sha256
       AND runtime_asset.state IN ('VERIFIED', 'ACCEPTED')
  ) THEN
    RAISE EXCEPTION 'locked revision avatar snapshot does not match the READY version and runtime asset'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.image_style_versions version
     WHERE version.workspace_id = NEW.workspace_id
       AND version.style_id = NEW.image_style_id
       AND version.id = NEW.image_style_version_id
       AND version.state = 'PUBLISHED'
       AND version.style_profile_hash = NEW.style_profile_hash
  ) THEN
    RAISE EXCEPTION 'locked revision style snapshot does not match the PUBLISHED version'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.assets voiceover
     WHERE voiceover.workspace_id = NEW.workspace_id
       AND voiceover.id = NEW.voiceover_asset_id
       AND voiceover.binary_sha256 = NEW.voiceover_binary_sha256
       AND voiceover.state IN ('VERIFIED', 'ACCEPTED')
  ) THEN
    RAISE EXCEPTION 'locked revision voiceover snapshot does not match a verified asset'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.avatar_compatibility_state IN ('PASSED', 'FAILED', 'STALE', 'CANCELLED') AND NOT EXISTS (
    SELECT 1
      FROM public.avatar_compatibility_assessments assessment
     WHERE assessment.workspace_id = NEW.workspace_id
       AND assessment.avatar_profile_version_id = NEW.avatar_profile_version_id
       AND assessment.id = NEW.avatar_compatibility_assessment_id
       AND assessment.state = NEW.avatar_compatibility_state
       AND assessment.evidence_hash = NEW.avatar_compatibility_evidence_hash
  ) THEN
    RAISE EXCEPTION 'locked revision compatibility snapshot does not match terminal evidence'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.videoforge_reject_immutable_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RAISE EXCEPTION 'immutable VideoForge provenance row cannot be changed: %', TG_TABLE_NAME
    USING ERRCODE = '23514';
END;
$function$;

CREATE TRIGGER avatar_compatibility_assessments_terminal_immutable
  BEFORE UPDATE OR DELETE ON public.avatar_compatibility_assessments
  FOR EACH ROW WHEN (OLD.state IN ('PASSED', 'FAILED', 'STALE', 'CANCELLED'))
  EXECUTE FUNCTION public.videoforge_reject_immutable_row();

-- TESTED execution profiles are pinned provenance snapshots. Retirement may only change lifecycle
-- state and timestamp; a retired snapshot is then fully immutable and cannot be deleted.
CREATE OR REPLACE FUNCTION public.videoforge_protect_execution_profile_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tested execution profile snapshots cannot be deleted'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.state = 'TESTED' AND
     NEW.state = 'RETIRED' AND
     NEW.retired_at IS NOT NULL AND
     (to_jsonb(NEW) - 'state' - 'retired_at') =
       (to_jsonb(OLD) - 'state' - 'retired_at') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'tested or retired execution profile snapshots are immutable'
    USING ERRCODE = '23514';
END;
$function$;

CREATE TRIGGER execution_profiles_tested_immutable
  BEFORE UPDATE OR DELETE ON public.execution_profiles
  FOR EACH ROW WHEN (OLD.state IN ('TESTED', 'RETIRED'))
  EXECUTE FUNCTION public.videoforge_protect_execution_profile_snapshot();

-- An attempt's selected execution profile is immutable provenance. Avatar assessment and general
-- attempt rows must also name the same tested profile before their specialized attempt can exist.
CREATE OR REPLACE FUNCTION public.videoforge_protect_execution_profile_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.execution_profile_id IS DISTINCT FROM OLD.execution_profile_id THEN
    RAISE EXCEPTION 'an assigned execution profile cannot be rewritten'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER attempts_execution_profile_immutable
  BEFORE UPDATE OF execution_profile_id ON public.attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.videoforge_protect_execution_profile_assignment();

CREATE TRIGGER avatar_compatibility_assessments_execution_profile_immutable
  BEFORE UPDATE OF execution_profile_id ON public.avatar_compatibility_assessments
  FOR EACH ROW
  EXECUTE FUNCTION public.videoforge_protect_execution_profile_assignment();

CREATE OR REPLACE FUNCTION public.videoforge_validate_avatar_test_execution_profile()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  assessment_profile_id uuid;
  attempt_profile_id uuid;
BEGIN
  SELECT execution_profile_id
    INTO assessment_profile_id
    FROM public.avatar_compatibility_assessments
   WHERE workspace_id = NEW.workspace_id
     AND avatar_profile_version_id = NEW.avatar_profile_version_id
     AND id = NEW.assessment_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT execution_profile_id
    INTO attempt_profile_id
    FROM public.attempts
   WHERE workspace_id = NEW.workspace_id
     AND task_id = NEW.task_id
     AND id = NEW.execution_attempt_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF assessment_profile_id IS DISTINCT FROM attempt_profile_id THEN
    RAISE EXCEPTION 'avatar assessment and execution attempt must use the same execution profile'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER avatar_profile_test_attempts_execution_profile_matches
  BEFORE INSERT OR UPDATE ON public.avatar_profile_test_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.videoforge_validate_avatar_test_execution_profile();

-- Validate both halves of the accepted-result relationship at transaction end so repositories may
-- update the attempt and task in either order, but can never commit a contradictory pair.
CREATE OR REPLACE FUNCTION public.videoforge_assert_task_accepted_result(
  checked_workspace_id uuid,
  checked_task_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  task_pointer uuid;
  task_state text;
  task_finished_at timestamptz;
  accepted_count integer;
  accepted_id uuid;
BEGIN
  SELECT accepted_attempt_id, state, finished_at
    INTO task_pointer, task_state, task_finished_at
    FROM public.generation_tasks
   WHERE workspace_id = checked_workspace_id
     AND id = checked_task_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*)::integer, min(id::text)::uuid
    INTO accepted_count, accepted_id
    FROM public.attempts
   WHERE workspace_id = checked_workspace_id
     AND task_id = checked_task_id
     AND result_disposition = 'ACCEPTED';

  IF accepted_count = 0 AND task_pointer IS NOT NULL THEN
    RAISE EXCEPTION 'task accepted pointer must reference its ACCEPTED attempt'
      USING ERRCODE = '23514';
  END IF;
  IF accepted_count = 0 AND task_state = 'COMPLETE' THEN
    RAISE EXCEPTION 'a COMPLETE task must point to its ACCEPTED attempt'
      USING ERRCODE = '23514';
  END IF;
  IF accepted_count = 1 AND task_pointer IS DISTINCT FROM accepted_id THEN
    RAISE EXCEPTION 'accepted attempt and task pointer must identify the same result'
      USING ERRCODE = '23514';
  END IF;
  IF accepted_count = 1 AND (task_state <> 'COMPLETE' OR task_finished_at IS NULL) THEN
    RAISE EXCEPTION 'a task with an accepted result must be COMPLETE with a finish timestamp'
      USING ERRCODE = '23514';
  END IF;
  IF accepted_count = 1 AND NOT EXISTS (
    SELECT 1
      FROM public.attempts attempt
      JOIN public.assets output_asset
        ON output_asset.workspace_id = attempt.workspace_id
       AND output_asset.id = attempt.output_asset_id
     WHERE attempt.workspace_id = checked_workspace_id
       AND attempt.task_id = checked_task_id
       AND attempt.id = accepted_id
       AND attempt.state = 'SUCCEEDED'
       AND attempt.result_disposition = 'ACCEPTED'
       AND attempt.finished_at IS NOT NULL
       AND output_asset.state IN ('VERIFIED', 'ACCEPTED')
  ) THEN
    RAISE EXCEPTION 'an accepted attempt must be finished and reference a verified output asset'
      USING ERRCODE = '23514';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.videoforge_enforce_task_accepted_result()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'generation_tasks' THEN
    IF TG_OP = 'DELETE' THEN
      PERFORM public.videoforge_assert_task_accepted_result(OLD.workspace_id, OLD.id);
    ELSE
      IF TG_OP = 'UPDATE' AND
         (OLD.workspace_id IS DISTINCT FROM NEW.workspace_id OR OLD.id IS DISTINCT FROM NEW.id) THEN
        PERFORM public.videoforge_assert_task_accepted_result(OLD.workspace_id, OLD.id);
      END IF;
      PERFORM public.videoforge_assert_task_accepted_result(NEW.workspace_id, NEW.id);
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND
     (OLD.workspace_id IS DISTINCT FROM NEW.workspace_id OR OLD.task_id IS DISTINCT FROM NEW.task_id) THEN
    PERFORM public.videoforge_assert_task_accepted_result(OLD.workspace_id, OLD.task_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.videoforge_assert_task_accepted_result(OLD.workspace_id, OLD.task_id);
  ELSE
    PERFORM public.videoforge_assert_task_accepted_result(NEW.workspace_id, NEW.task_id);
  END IF;
  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER generation_tasks_accepted_result_consistent
  AFTER INSERT OR UPDATE OR DELETE ON public.generation_tasks
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.videoforge_enforce_task_accepted_result();

CREATE CONSTRAINT TRIGGER attempts_accepted_result_consistent
  AFTER INSERT OR UPDATE OR DELETE ON public.attempts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.videoforge_enforce_task_accepted_result();

CREATE OR REPLACE FUNCTION public.videoforge_enforce_cost_event_sequence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  latest_sequence integer;
BEGIN
  IF NEW.owner_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.owner_type = 'PROJECT_REVISION' THEN
    PERFORM 1 FROM public.project_revisions
     WHERE workspace_id = NEW.workspace_id AND id = NEW.owner_id FOR UPDATE;
  ELSIF NEW.owner_type = 'IMAGE_STYLE_VERSION' THEN
    PERFORM 1 FROM public.image_style_versions
     WHERE workspace_id = NEW.workspace_id AND id = NEW.owner_id FOR UPDATE;
  ELSIF NEW.owner_type = 'AVATAR_PROFILE_VERSION' THEN
    PERFORM 1 FROM public.avatar_profile_versions
     WHERE workspace_id = NEW.workspace_id AND id = NEW.owner_id FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cost event owner does not exist in its workspace'
      USING ERRCODE = '23503';
  END IF;

  SELECT max(sequence)
    INTO latest_sequence
    FROM public.cost_events
   WHERE workspace_id = NEW.workspace_id
     AND owner_type = NEW.owner_type
     AND owner_id = NEW.owner_id;

  IF latest_sequence IS NOT NULL AND NEW.sequence <= latest_sequence THEN
    RAISE EXCEPTION 'cost event sequence must be monotonic for owner'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.videoforge_enforce_workflow_event_sequence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  latest_aggregate_sequence integer;
  latest_attempt_sequence integer;
BEGIN
  IF NEW.aggregate_type = 'WORKFLOW' THEN
    PERFORM 1 FROM public.workflow_instances
     WHERE workspace_id = NEW.workspace_id AND id = NEW.aggregate_id FOR UPDATE;
  ELSIF NEW.aggregate_type = 'TASK' THEN
    PERFORM 1 FROM public.generation_tasks
     WHERE workspace_id = NEW.workspace_id AND id = NEW.aggregate_id FOR UPDATE;
  ELSIF NEW.aggregate_type = 'ATTEMPT' THEN
    PERFORM 1 FROM public.attempts
     WHERE workspace_id = NEW.workspace_id AND id = NEW.aggregate_id FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow event aggregate does not exist in its workspace'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.attempt_id IS NOT NULL AND
     NOT (NEW.aggregate_type = 'ATTEMPT' AND NEW.aggregate_id = NEW.attempt_id) THEN
    PERFORM 1 FROM public.attempts
     WHERE workspace_id = NEW.workspace_id AND id = NEW.attempt_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'workflow event attempt does not exist in its workspace'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  SELECT max(sequence)
    INTO latest_aggregate_sequence
    FROM public.workflow_events
   WHERE workspace_id = NEW.workspace_id
     AND aggregate_type = NEW.aggregate_type
     AND aggregate_id = NEW.aggregate_id;

  IF latest_aggregate_sequence IS NOT NULL AND NEW.sequence <= latest_aggregate_sequence THEN
    RAISE EXCEPTION 'workflow event sequence must be monotonic for aggregate'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.attempt_id IS NOT NULL THEN
    SELECT max(sequence)
      INTO latest_attempt_sequence
      FROM public.workflow_events
     WHERE workspace_id = NEW.workspace_id
       AND attempt_id = NEW.attempt_id;
    IF latest_attempt_sequence IS NOT NULL AND NEW.sequence <= latest_attempt_sequence THEN
      RAISE EXCEPTION 'workflow event sequence must be monotonic for attempt'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

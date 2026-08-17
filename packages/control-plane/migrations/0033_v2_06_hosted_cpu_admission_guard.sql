-- V2-06 personal CPU stages inherit the ordinary video admission ceiling: one active project per
-- account and two active projects globally. A single project may retain more than one nonterminal
-- stage/attempt while cancellation, retry, or reconciliation converges. Serialize project admission
-- on the existing global singleton instead of mistaking attempt count for video count.

CREATE FUNCTION public.videoforge_guard_hosted_cpu_project_admission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
DECLARE
  old_active boolean := false;
  new_active boolean := false;
  same_project_active boolean;
  active_project_count integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_active := OLD.state IN (
      'PLANNED', 'OUTBOXED', 'SUBMITTED', 'RUNNING', 'RECONCILING', 'CANCEL_REQUESTED'
    );
  END IF;
  new_active := NEW.state IN (
    'PLANNED', 'OUTBOXED', 'SUBMITTED', 'RUNNING', 'RECONCILING', 'CANCEL_REQUESTED'
  );

  IF NOT new_active THEN RETURN NEW; END IF;
  IF old_active
     AND OLD.account_id = NEW.account_id
     AND OLD.project_id = NEW.project_id THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM global_generation_capacity WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'global generation capacity singleton is missing' USING ERRCODE = '55000';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM hosted_cpu_job_attempts AS attempt
     WHERE attempt.id <> NEW.id
       AND attempt.account_id = NEW.account_id
       AND attempt.project_id = NEW.project_id
       AND attempt.state IN (
         'PLANNED', 'OUTBOXED', 'SUBMITTED', 'RUNNING', 'RECONCILING', 'CANCEL_REQUESTED'
       )
  ) INTO same_project_active;
  IF same_project_active THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1
      FROM hosted_cpu_job_attempts AS attempt
     WHERE attempt.id <> NEW.id
       AND attempt.account_id = NEW.account_id
       AND attempt.project_id <> NEW.project_id
       AND attempt.state IN (
         'PLANNED', 'OUTBOXED', 'SUBMITTED', 'RUNNING', 'RECONCILING', 'CANCEL_REQUESTED'
       )
  ) THEN
    RAISE EXCEPTION 'account already has an active personal CPU project' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO active_project_count
    FROM (
      SELECT DISTINCT attempt.account_id, attempt.project_id
        FROM hosted_cpu_job_attempts AS attempt
       WHERE attempt.id <> NEW.id
         AND attempt.state IN (
           'PLANNED', 'OUTBOXED', 'SUBMITTED', 'RUNNING', 'RECONCILING', 'CANCEL_REQUESTED'
         )
    ) AS active_projects;
  IF active_project_count >= 2 THEN
    RAISE EXCEPTION 'both global personal CPU projects are occupied' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_guard_hosted_cpu_project_admission() FROM PUBLIC;

-- Alphabetical trigger order places this after tenant ownership derivation and the tenant write
-- guard, so NEW.account_id is always database-derived before project admission is evaluated.
CREATE TRIGGER hosted_cpu_job_attempts_video_admission_guard
  BEFORE INSERT OR UPDATE OF state, account_id, workspace_id, project_id
  ON hosted_cpu_job_attempts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_guard_hosted_cpu_project_admission();

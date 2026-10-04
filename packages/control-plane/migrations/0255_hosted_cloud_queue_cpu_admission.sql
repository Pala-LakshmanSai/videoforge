-- Cloud queue entries must not deadlock the current video's render continuation.
-- Preserve Local admission and all actual Cloud/provider capacity fences.

CREATE OR REPLACE FUNCTION public.videoforge_guard_hosted_cpu_project_admission() RETURNS trigger
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
  -- A queued Cloud stage owns no CPU capacity. Actual Cloud launches are fenced by
  -- cloud_media_reservations and the shared VIDEO/provider admission lease.
  IF NEW.execution_backend = 'RUNPOD_POD' AND NEW.state IN ('PLANNED','OUTBOXED') THEN
    RETURN NEW;
  END IF;
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
       AND NOT (attempt.execution_backend = 'RUNPOD_POD' AND attempt.state IN ('PLANNED','OUTBOXED'))
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
       AND NOT (attempt.execution_backend = 'RUNPOD_POD' AND attempt.state IN ('PLANNED','OUTBOXED'))
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
       AND NOT (attempt.execution_backend = 'RUNPOD_POD' AND attempt.state IN ('PLANNED','OUTBOXED'))
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


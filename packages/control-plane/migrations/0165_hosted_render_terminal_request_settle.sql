-- Settle the hosted request when its render job reaches a terminal state without output.
--
-- Cancelling the render job from the queue ("Cancel job") only flags the attempt
-- CANCEL_REQUESTED; the personal-worker recovery workflow (apps/web/worker/hosted-workflow.ts) then
-- moves it to CANCELLED once no live lease remains. Nothing settled the generation request that the
-- cancelled render was producing, so after a successful cancel the project stayed at runtime stage
-- RENDERING with its generation request still ACTIVE: the queue reported the card as IN_PROGRESS /
-- "Assembling the final video." indefinitely, and the account's one-active-video slot stayed held by
-- a request that could no longer produce anything. The only reclaim was the next dispatch attempt
-- (0147 admits only after settling), so the user saw a cancel that appeared to do nothing.
--
-- The reclaim capability already exists and is evidence-bound: 0147's
-- videoforge_settle_stranded_hosted_v209_requests only settles a request with no unexpired active
-- provider lease, a runtime that is FAILED or still RENDERING, at least one terminal RENDER job and
-- no in-flight RENDER job. Firing it from the terminal render transition makes the reclaim immediate
-- for every cause (owner cancel, deadline, replay limit) instead of waiting for the next dispatch,
-- and it stays a no-op for a request whose render work is still live.
CREATE FUNCTION public.videoforge_settle_render_terminal_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  previous_account text;
  actor_user_id uuid;
BEGIN
  SELECT request.created_by_user_id
    INTO actor_user_id
    FROM public.generation_requests AS request
    JOIN public.memberships AS membership
      ON membership.workspace_id = request.workspace_id
     AND membership.user_id = request.created_by_user_id
   WHERE request.account_id = NEW.account_id
     AND request.workspace_id = NEW.workspace_id
     AND request.project_id = NEW.project_id
     AND request.project_revision_id = NEW.project_revision_id
     AND request.state IN ('ADMITTED', 'ACTIVE', 'CANCELLING')
   ORDER BY request.created_at DESC, request.id DESC
   LIMIT 1;
  IF actor_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  previous_account := current_setting('videoforge.account_id', true);
  PERFORM set_config('videoforge.account_id', NEW.account_id::text, true);
  PERFORM public.videoforge_settle_stranded_hosted_v209_requests(
    NEW.account_id, NEW.workspace_id, actor_user_id);
  PERFORM set_config('videoforge.account_id', COALESCE(previous_account, ''), true);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_settle_render_terminal_request() FROM PUBLIC;

CREATE TRIGGER hosted_cpu_job_attempts_render_terminal_request_settle
  AFTER UPDATE OF state ON public.hosted_cpu_job_attempts
  FOR EACH ROW
  WHEN (
    NEW.kind = 'RENDER'
    AND NEW.state IS DISTINCT FROM OLD.state
    AND NEW.state IN ('FAILED', 'PERMANENT_FAILED', 'CANCELLED', 'EXPIRED', 'DEAD_LETTER')
  )
  EXECUTE FUNCTION public.videoforge_settle_render_terminal_request();

COMMENT ON FUNCTION public.videoforge_settle_render_terminal_request() IS
  'Settles the hosted generation request whose RENDER job just reached a terminal state without output, through the evidence-bound 0147 reclaim. No-op while any render work is live.';

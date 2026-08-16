-- V2-04 re-audit repairs: provider result retention begins after a terminal provider observation,
-- not at local attempt creation, and terminal/cancelling attempts cannot accept a late output.

ALTER TABLE serverless_attempts
  ADD COLUMN provider_terminal_observed_at timestamptz,
  ADD COLUMN provider_result_expires_at timestamptz,
  ADD CONSTRAINT serverless_attempts_provider_result_window_pair_ck
    CHECK ((provider_terminal_observed_at IS NULL) = (provider_result_expires_at IS NULL)),
  ADD CONSTRAINT serverless_attempts_provider_result_window_order_ck
    CHECK (
      provider_result_expires_at IS NULL
      OR provider_result_expires_at = provider_terminal_observed_at + interval '1800 seconds'
    );

-- Acceptance and cancellation serialize on the attempt row in application code. This database
-- trigger is the final fail-closed boundary if a future caller bypasses that service guard.
CREATE FUNCTION public.videoforge_fence_serverless_output_acceptance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_state text;
BEGIN
  IF NEW.acceptance <> 'ACCEPTED_CANONICAL' THEN
    RETURN NEW;
  END IF;

  SELECT state INTO current_state
    FROM public.serverless_attempts
   WHERE id = NEW.attempt_id
   FOR UPDATE;

  IF current_state NOT IN ('ASSIGNED', 'IN_QUEUE', 'IN_PROGRESS', 'UPLOADING', 'RECONCILING') THEN
    RAISE EXCEPTION 'serverless output acceptance is fenced by attempt state %', current_state
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER serverless_output_receipts_acceptance_fence
  BEFORE INSERT ON serverless_output_receipts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_fence_serverless_output_acceptance();

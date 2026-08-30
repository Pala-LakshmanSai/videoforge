-- Durable, tenant-bound dispatch guard for the private-beta DeepSeek style analyzer.
-- Every possible provider call reserves two cents before dispatch. Reservations are never reused,
-- so crashes and ambiguous provider outcomes cannot silently redispatch or exceed the $3 beta cap.

CREATE TABLE public.hosted_style_analysis_runs (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  style_version_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('RESERVED', 'SUCCEEDED', 'FAILED', 'UNKNOWN')),
  model text NOT NULL CHECK (model = 'deepseek-v4-flash-vision-exp'),
  reserved_cost_micro_usd bigint NOT NULL CHECK (reserved_cost_micro_usd = 20000),
  reported_cost_micro_usd bigint CHECK (
    reported_cost_micro_usd IS NULL OR
    (reported_cost_micro_usd >= 0 AND reported_cost_micro_usd <= reserved_cost_micro_usd)
  ),
  prompt_tokens bigint CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
  completion_tokens bigint CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
  provider_reference text,
  response_hash text CHECK (response_hash IS NULL OR response_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (account_id, workspace_id, style_version_id),
  UNIQUE (account_id, workspace_id, id),
  FOREIGN KEY (account_id, workspace_id)
    REFERENCES public.workspaces (account_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, workspace_id, style_version_id)
    REFERENCES public.image_style_versions (account_id, workspace_id, id) ON DELETE RESTRICT,
  CHECK ((state IN ('SUCCEEDED', 'FAILED')) = (finished_at IS NOT NULL)),
  CHECK (state <> 'SUCCEEDED' OR
    (reported_cost_micro_usd IS NOT NULL AND prompt_tokens IS NOT NULL AND
     completion_tokens IS NOT NULL AND response_hash IS NOT NULL))
);

ALTER TABLE public.hosted_style_analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_style_analysis_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_style_analysis_runs_tenant_rls ON public.hosted_style_analysis_runs
  USING (account_id = public.videoforge_current_account_id())
  WITH CHECK (account_id = public.videoforge_current_account_id());

CREATE FUNCTION public.videoforge_reserve_hosted_style_analysis(
  supplied_style_version_id uuid,
  supplied_request_hash text,
  supplied_run_id uuid
) RETURNS TABLE (
  run_id uuid,
  run_state text,
  dispatch_allowed boolean,
  reserved_cost_micro_usd bigint
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_account_id uuid := public.videoforge_current_account_id();
  target_workspace_id uuid;
  existing public.hosted_style_analysis_runs%ROWTYPE;
  total_reserved bigint;
BEGIN
  IF current_account_id IS NULL THEN
    RAISE EXCEPTION 'hosted style analysis principal is required' USING ERRCODE = '42501';
  END IF;
  IF supplied_request_hash !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'hosted style analysis request hash is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT version.workspace_id INTO target_workspace_id
    FROM public.image_style_versions AS version
    JOIN public.image_styles AS style
      ON style.account_id = version.account_id
     AND style.workspace_id = version.workspace_id
     AND style.id = version.style_id
    JOIN public.workspaces AS workspace
      ON workspace.account_id = version.account_id AND workspace.id = version.workspace_id
   WHERE version.account_id = current_account_id
     AND version.id = supplied_style_version_id
     AND version.scope_kind = 'WORKSPACE'
     AND version.state IN ('DRAFT', 'FAILED')
     AND style.scope_kind = 'WORKSPACE' AND style.status = 'ACTIVE'
     AND workspace.status = 'ACTIVE'
   FOR UPDATE OF version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hosted style analysis target is unavailable' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('videoforge-hosted-style-analysis-cap-v1', 0));
  SELECT * INTO existing
    FROM public.hosted_style_analysis_runs AS run
   WHERE run.account_id = current_account_id
     AND run.workspace_id = target_workspace_id
     AND run.style_version_id = supplied_style_version_id;
  IF FOUND THEN
    IF existing.id IS DISTINCT FROM supplied_run_id OR
       existing.request_hash IS DISTINCT FROM supplied_request_hash THEN
      RAISE EXCEPTION 'hosted style analysis run is already bound to another request'
        USING ERRCODE = '23505';
    END IF;
    run_id := existing.id;
    run_state := existing.state;
    dispatch_allowed := false;
    reserved_cost_micro_usd := existing.reserved_cost_micro_usd;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT COALESCE(sum(run.reserved_cost_micro_usd), 0) INTO total_reserved
    FROM public.hosted_style_analysis_runs AS run;
  IF total_reserved + 20000 > 3000000 THEN
    RAISE EXCEPTION 'private beta DeepSeek analysis cap exhausted' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.hosted_style_analysis_runs (
    id, account_id, workspace_id, style_version_id, request_hash, state, model,
    reserved_cost_micro_usd
  ) VALUES (
    supplied_run_id, current_account_id, target_workspace_id, supplied_style_version_id,
    supplied_request_hash, 'RESERVED', 'deepseek-v4-flash-vision-exp', 20000
  );
  run_id := supplied_run_id;
  run_state := 'RESERVED';
  dispatch_allowed := true;
  reserved_cost_micro_usd := 20000;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION public.videoforge_finish_hosted_style_analysis(
  supplied_run_id uuid,
  supplied_terminal_state text,
  supplied_response_hash text,
  supplied_provider_reference text,
  supplied_prompt_tokens bigint,
  supplied_completion_tokens bigint,
  supplied_reported_cost_micro_usd bigint
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_account_id uuid := public.videoforge_current_account_id();
BEGIN
  IF current_account_id IS NULL THEN
    RAISE EXCEPTION 'hosted style analysis principal is required' USING ERRCODE = '42501';
  END IF;
  IF supplied_terminal_state NOT IN ('SUCCEEDED', 'FAILED', 'UNKNOWN') THEN
    RAISE EXCEPTION 'hosted style analysis terminal state is invalid' USING ERRCODE = '22023';
  END IF;

  UPDATE public.hosted_style_analysis_runs AS run
     SET state = supplied_terminal_state,
         response_hash = supplied_response_hash,
         provider_reference = left(supplied_provider_reference, 500),
         prompt_tokens = supplied_prompt_tokens,
         completion_tokens = supplied_completion_tokens,
         reported_cost_micro_usd = supplied_reported_cost_micro_usd,
         finished_at = CASE WHEN supplied_terminal_state IN ('SUCCEEDED', 'FAILED') THEN now() ELSE NULL END
   WHERE run.id = supplied_run_id
     AND run.account_id = current_account_id
     AND run.state = 'RESERVED';
  RETURN FOUND;
END;
$$;

COMMENT ON TABLE public.hosted_style_analysis_runs IS
  'Append-once dispatch reservations and terminal receipts for bounded private-beta DeepSeek style analysis.';
REVOKE ALL ON TABLE public.hosted_style_analysis_runs FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_reserve_hosted_style_analysis(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_finish_hosted_style_analysis(uuid, text, text, text, bigint, bigint, bigint) FROM PUBLIC;

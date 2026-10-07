-- Existing jobs remain byte-for-byte compatible. Activation is a separate funded operation:
-- ALTER TABLE both job tables ALTER COLUMN image_text_qa_required SET DEFAULT true;
ALTER TABLE public.hosted_api_generation_jobs ADD COLUMN image_text_qa_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.hosted_api_image_regeneration_jobs ADD COLUMN image_text_qa_required boolean NOT NULL DEFAULT false;
CREATE TABLE public.hosted_image_text_qa_runs (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  job_id uuid NOT NULL,
  job_kind text NOT NULL CHECK(job_kind IN ('INITIAL','REGENERATION')),
  provider_task_id text NOT NULL,
  image_sha256 text NOT NULL CHECK(image_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL CHECK(state IN ('RESERVED','PASS','TEXT','UNCERTAIN')),
  model text NOT NULL DEFAULT 'google:gemini@3.1-flash-lite' CHECK(model='google:gemini@3.1-flash-lite'),
  reserved_cost_micro_usd bigint NOT NULL DEFAULT 20000 CHECK(reserved_cost_micro_usd=20000),
  reported_cost_micro_usd bigint CHECK(reported_cost_micro_usd >= 0),
  prompt_tokens bigint CHECK(prompt_tokens>=0),
  completion_tokens bigint CHECK(completion_tokens>=0),
  response_hash text CHECK(response_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(account_id,workspace_id,job_kind,job_id),
  FOREIGN KEY(account_id,workspace_id) REFERENCES public.workspaces(account_id,id),
  CHECK(state='RESERVED' OR (reported_cost_micro_usd IS NOT NULL
    AND response_hash IS NOT NULL AND finished_at IS NOT NULL)),
  CHECK(state<>'PASS' OR (prompt_tokens IS NOT NULL AND completion_tokens IS NOT NULL))
);
ALTER TABLE public.hosted_image_text_qa_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_image_text_qa_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_image_text_qa_tenant ON public.hosted_image_text_qa_runs
  USING(account_id=public.videoforge_current_account_id())
  WITH CHECK(account_id=public.videoforge_current_account_id());
REVOKE ALL ON public.hosted_image_text_qa_runs FROM PUBLIC;
GRANT SELECT ON public.hosted_image_text_qa_runs TO videoforge_v209_runtime_dc9612d6;

CREATE FUNCTION public.videoforge_claim_image_text_qa(supplied_key text,supplied_hash text,supplied_id uuid,supplied_available boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE account uuid:=public.videoforge_current_account_id(); job record; kind text;
  existing public.hosted_image_text_qa_runs%ROWTYPE;
BEGIN
  IF account IS NULL OR supplied_hash !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'image QA principal or hash invalid' USING ERRCODE='42501'; END IF;
  SELECT j.id,j.account_id,j.workspace_id,j.project_id,j.provider_task_id,j.state,j.image_text_qa_required
    INTO job FROM public.hosted_api_generation_jobs j
    WHERE j.account_id=account AND j.output_object_key=supplied_key AND j.lane='IMAGE' FOR UPDATE;
  kind:='INITIAL';
  IF NOT FOUND THEN
    SELECT j.id,j.account_id,j.workspace_id,j.project_id,j.provider_task_id,j.state,j.image_text_qa_required
      INTO job FROM public.hosted_api_image_regeneration_jobs j
      WHERE j.account_id=account AND j.output_object_key=supplied_key FOR UPDATE;
    kind:='REGENERATION';
  END IF;
  IF job.id IS NULL OR job.state NOT IN ('SUBMITTED','SUCCEEDED') OR job.provider_task_id IS NULL THEN
    RAISE EXCEPTION 'image QA source unavailable' USING ERRCODE='42501'; END IF;
  IF NOT job.image_text_qa_required THEN RETURN jsonb_build_object('state','HISTORICAL'); END IF;
  SELECT * INTO existing FROM public.hosted_image_text_qa_runs q
    WHERE q.account_id=account AND q.workspace_id=job.workspace_id AND q.job_id=job.id AND q.job_kind=kind;
  IF FOUND THEN
    IF existing.image_sha256<>supplied_hash OR existing.provider_task_id<>job.provider_task_id THEN
      RAISE EXCEPTION 'image QA output identity changed' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('id',existing.id,'state',existing.state,'dispatch',false);
  END IF;
  IF supplied_available IS DISTINCT FROM true THEN RETURN jsonb_build_object('state','BINDING_UNAVAILABLE'); END IF;
  INSERT INTO public.hosted_image_text_qa_runs(id,account_id,workspace_id,project_id,job_id,job_kind,
    provider_task_id,image_sha256,state)
  VALUES(supplied_id,account,job.workspace_id,job.project_id,job.id,kind,job.provider_task_id,supplied_hash,'RESERVED');
  RETURN jsonb_build_object('id',supplied_id,'state','RESERVED','dispatch',true);
END; $$;
CREATE FUNCTION public.videoforge_finish_image_text_qa(supplied_id uuid,supplied_hash text,
  supplied_verdict text,supplied_response_hash text,supplied_cost bigint,supplied_prompt_tokens bigint,
  supplied_completion_tokens bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE existing public.hosted_image_text_qa_runs%ROWTYPE;
BEGIN
  SELECT * INTO existing FROM public.hosted_image_text_qa_runs q WHERE q.id=supplied_id
    AND q.account_id=public.videoforge_current_account_id() AND q.image_sha256=supplied_hash FOR UPDATE;
  IF NOT FOUND OR supplied_verdict NOT IN ('PASS','TEXT','UNCERTAIN') THEN
    RAISE EXCEPTION 'image QA receipt identity invalid' USING ERRCODE='42501'; END IF;
  IF existing.state<>'RESERVED' THEN
    IF existing.state<>supplied_verdict OR existing.response_hash IS DISTINCT FROM supplied_response_hash
       OR existing.reported_cost_micro_usd IS DISTINCT FROM supplied_cost
       OR existing.prompt_tokens IS DISTINCT FROM supplied_prompt_tokens
       OR existing.completion_tokens IS DISTINCT FROM supplied_completion_tokens THEN
      RAISE EXCEPTION 'image QA receipt changed' USING ERRCODE='23505'; END IF;
    RETURN true;
  END IF;
  UPDATE public.hosted_image_text_qa_runs SET state=supplied_verdict,response_hash=supplied_response_hash,
    reported_cost_micro_usd=supplied_cost,prompt_tokens=supplied_prompt_tokens,
    completion_tokens=supplied_completion_tokens,finished_at=now() WHERE id=existing.id;
  RETURN true;
END; $$;

CREATE FUNCTION public.videoforge_guard_image_text_qa() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.image_text_qa_required AND NOT NEW.image_text_qa_required THEN
    RAISE EXCEPTION 'image QA policy cannot be weakened' USING ERRCODE='23514'; END IF;
  IF NEW.image_text_qa_required AND NEW.state='SUCCEEDED' AND
    (TG_TABLE_NAME='hosted_api_image_regeneration_jobs' OR to_jsonb(NEW)->>'lane'='IMAGE') AND NOT EXISTS(
      SELECT 1 FROM public.hosted_image_text_qa_runs q WHERE q.account_id=NEW.account_id
        AND q.workspace_id=NEW.workspace_id AND q.job_id=NEW.id
        AND q.job_kind=CASE WHEN TG_TABLE_NAME='hosted_api_generation_jobs' THEN 'INITIAL' ELSE 'REGENERATION' END
        AND q.provider_task_id=NEW.provider_task_id AND q.image_sha256=NEW.output_sha256 AND q.state='PASS') THEN
    RAISE EXCEPTION 'image text QA PASS receipt required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER hosted_api_image_text_qa BEFORE INSERT OR UPDATE ON public.hosted_api_generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_guard_image_text_qa();
CREATE TRIGGER hosted_regeneration_image_text_qa BEFORE INSERT OR UPDATE ON public.hosted_api_image_regeneration_jobs
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_guard_image_text_qa();
REVOKE ALL ON FUNCTION public.videoforge_claim_image_text_qa(text,text,uuid,boolean),
  public.videoforge_finish_image_text_qa(uuid,text,text,text,bigint,bigint,bigint),
  public.videoforge_guard_image_text_qa() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_claim_image_text_qa(text,text,uuid,boolean),
  public.videoforge_finish_image_text_qa(uuid,text,text,text,bigint,bigint,bigint)
  TO videoforge_v209_runtime_dc9612d6;

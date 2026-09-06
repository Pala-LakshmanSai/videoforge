-- V2-09 exact crash cleanup for the one ordinary hosted Chrome generation click.
-- The capability is tenant-scoped, never discovers work by time/account fallback, and never
-- creates, dispatches, promotes, or retries provider work.

DO $replace_admission_check$
DECLARE target_name text; target_count integer;
BEGIN
  SELECT count(*),min(con.conname) INTO target_count,target_name
    FROM pg_constraint con WHERE con.conrelid='public.video_runtime_states'::regclass
      AND con.contype='c'
      AND pg_get_constraintdef(con.oid) LIKE
        '%(stage = ''QUEUED''::text) = (admitted_at IS NULL)%';
  IF target_count<>1 THEN
    RAISE EXCEPTION 'exact runtime admission constraint unavailable' USING ERRCODE='55000';
  END IF;
  EXECUTE format('ALTER TABLE public.video_runtime_states DROP CONSTRAINT %I',target_name);
END
$replace_admission_check$;

ALTER TABLE public.video_runtime_states
  ADD CONSTRAINT video_runtime_states_admission_or_unadmitted_cancel_check CHECK (
    ((stage='QUEUED')=(admitted_at IS NULL))
    OR (stage='CANCELED' AND terminal_reason='SYSTEM_CANCELLED' AND admitted_at IS NULL)
  );

CREATE OR REPLACE FUNCTION public.videoforge_validate_video_runtime_state() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  admission_state text;
  admission_admitted_at timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stage <> 'QUEUED' THEN
      SELECT state, admitted_at INTO admission_state, admission_admitted_at
        FROM public.generation_requests WHERE id = NEW.generation_request_id;
      IF admission_admitted_at IS NULL OR admission_state = 'WAITING' THEN
        RAISE EXCEPTION 'video runtime work requires a durable admission' USING ERRCODE = '55000';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.account_id <> OLD.account_id OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.project_id <> OLD.project_id OR NEW.project_revision_id <> OLD.project_revision_id
     OR NEW.generation_request_id <> OLD.generation_request_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'video runtime identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'video runtime version must advance by exactly one' USING ERRCODE = '23514';
  END IF;
  IF OLD.stage IN ('COMPLETE', 'FAILED', 'CANCELED') THEN
    RAISE EXCEPTION 'video runtime % is terminal', OLD.id USING ERRCODE = '55000';
  END IF;
  IF OLD.preparation_manifest_sha256 IS NOT NULL
     AND NEW.preparation_manifest_sha256 IS DISTINCT FROM OLD.preparation_manifest_sha256 THEN
    RAISE EXCEPTION 'the durable preparation manifest is immutable' USING ERRCODE = '55000';
  END IF;
  -- The only new transition: an inert queued runtime may be cancelled with its exact waiting
  -- request. It remains unadmitted and cannot claim preparation or provider work.
  IF OLD.stage='QUEUED' AND NEW.stage='CANCELED' AND NEW.terminal_reason='SYSTEM_CANCELLED'
     AND NEW.admitted_at IS NULL AND NEW.preparation_manifest_sha256 IS NULL
     AND NEW.render_manifest_sha256 IS NULL AND NEW.final_output_sha256 IS NULL THEN
    SELECT state,admitted_at INTO admission_state,admission_admitted_at
      FROM public.generation_requests WHERE id=NEW.generation_request_id FOR UPDATE;
    IF admission_state NOT IN ('WAITING','RETRY_WAIT')
       OR admission_admitted_at IS NOT NULL THEN
      RAISE EXCEPTION 'queued runtime cancellation requires exact unadmitted request'
        USING ERRCODE='55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.stage = 'QUEUED' AND NEW.stage <> 'QUEUED' THEN
    SELECT state, admitted_at INTO admission_state, admission_admitted_at
      FROM public.generation_requests WHERE id = NEW.generation_request_id FOR UPDATE;
    IF admission_state IS NULL OR admission_admitted_at IS NULL
       OR admission_state NOT IN ('ADMITTED', 'ACTIVE', 'CANCELLING') THEN
      RAISE EXCEPTION 'video runtime work requires a durable admission, not queue state %',
        coalesce(admission_state, 'MISSING') USING ERRCODE = '55000';
    END IF;
    IF NEW.stage <> 'PREPARING' AND NEW.stage NOT IN ('FAILED', 'CANCELED') THEN
      RAISE EXCEPTION 'an admitted video runtime must enter PREPARING first' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.stage IN ('FAILED', 'CANCELED') OR NEW.stage = OLD.stage THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.stage = 'PREPARING' AND NEW.stage = 'WAITING_FOR_WORKER')
    OR (OLD.stage = 'WAITING_FOR_WORKER' AND NEW.stage = 'INITIALIZING')
    OR (OLD.stage = 'INITIALIZING' AND NEW.stage IN ('GENERATING_IMAGES', 'GENERATING_AVATAR'))
    OR (OLD.stage = 'GENERATING_IMAGES' AND NEW.stage IN ('GENERATING_AVATAR', 'RENDERING', 'WAITING_FOR_WORKER'))
    OR (OLD.stage = 'GENERATING_AVATAR' AND NEW.stage IN ('GENERATING_IMAGES', 'RENDERING', 'WAITING_FOR_WORKER'))
    OR (OLD.stage IN ('WAITING_FOR_WORKER', 'INITIALIZING') AND NEW.stage = 'RENDERING')
    OR (OLD.stage = 'RENDERING' AND NEW.stage = 'COMPLETE')
  ) THEN
    RAISE EXCEPTION 'illegal video runtime stage transition % -> %', OLD.stage, NEW.stage
      USING ERRCODE = '23514';
  END IF;
  IF NEW.stage = 'RENDERING' AND EXISTS (
    SELECT 1 FROM public.video_runtime_lane_states lane
     WHERE lane.runtime_id = NEW.id AND lane.state <> 'SUCCEEDED'
  ) THEN
    RAISE EXCEPTION 'render cannot start before every lane succeeded' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE public.hosted_v209_staged_click_reconciliations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  create_request_id uuid UNIQUE,
  claim_id text NOT NULL CHECK(claim_id ~ '^sha256:[0-9a-f]{64}$'),
  stage text NOT NULL CHECK(stage IN ('CREATE_REQUESTED','PROJECT_CREATED','GENERATION_CREATED')),
  idempotency_key text NOT NULL,
  create_request_sha256 text NOT NULL CHECK(create_request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  project_id uuid,
  project_revision_id uuid,
  generation_request_id uuid,
  action text NOT NULL CHECK(action IN (
    'REQUEST_NOT_MATERIALIZED',
    'PROJECT_WITHOUT_GENERATION_PROJECT_ARCHIVED',
    'NO_PROVIDER_REQUEST_TERMINATED_PROJECT_ARCHIVED',
    'PROVIDER_FAILURE_TERMINAL_PROJECT_ARCHIVED'
  )),
  evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE(account_id,workspace_id,id),
  UNIQUE(account_id,workspace_id,idempotency_key),
  FOREIGN KEY(account_id,workspace_id) REFERENCES public.workspaces(account_id,id),
  FOREIGN KEY(create_request_id) REFERENCES public.hosted_project_create_requests(id),
  FOREIGN KEY(account_id,workspace_id,project_id)
    REFERENCES public.projects(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,project_revision_id)
    REFERENCES public.project_revisions(account_id,workspace_id,id),
  FOREIGN KEY(account_id,workspace_id,generation_request_id)
    REFERENCES public.generation_requests(account_id,workspace_id,id),
  CHECK((action='REQUEST_NOT_MATERIALIZED')=
    (create_request_id IS NULL AND project_id IS NULL AND project_revision_id IS NULL
      AND generation_request_id IS NULL AND stage='CREATE_REQUESTED')),
  CHECK(action='REQUEST_NOT_MATERIALIZED' OR
    (create_request_id IS NOT NULL AND project_id IS NOT NULL AND project_revision_id IS NOT NULL))
);
CREATE TRIGGER hosted_v209_staged_click_reconciliations_append_only
  BEFORE UPDATE OR DELETE ON public.hosted_v209_staged_click_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_v209_staged_click_reconciliations_tenant_write_guard
  BEFORE INSERT ON public.hosted_v209_staged_click_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE public.hosted_v209_staged_click_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_v209_staged_click_reconciliations FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_v209_staged_click_reconciliations_tenant_rls
  ON public.hosted_v209_staged_click_reconciliations
  USING(account_id=public.videoforge_current_account_id())
  WITH CHECK(account_id=public.videoforge_current_account_id());

-- The create-request insert and cleanup take the same transaction-scoped lock. Cleanup persists a
-- tombstone before releasing it, so an already-issued create transaction either commits first and
-- is observed by cleanup or rolls its entire project/revision transaction back at this trigger.
CREATE FUNCTION public.videoforge_fence_hosted_v209_project_create_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE blocked public.hosted_v209_staged_click_reconciliations%ROWTYPE;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM NEW.account_id
     OR NOT EXISTS(SELECT 1 FROM public.workspaces row
       WHERE row.account_id=NEW.account_id AND row.id=NEW.workspace_id
         AND row.status='ACTIVE') THEN
    RAISE EXCEPTION 'V2-09 hosted project create guard denied' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.account_id::text||':'||NEW.workspace_id::text||':'||NEW.idempotency_key,20909));
  SELECT * INTO blocked FROM public.hosted_v209_staged_click_reconciliations row
   WHERE row.account_id=NEW.account_id AND row.workspace_id=NEW.workspace_id
     AND row.idempotency_key=NEW.idempotency_key FOR SHARE;
  IF blocked.id IS NOT NULL THEN
    IF blocked.create_request_sha256<>NEW.request_sha256 THEN
      RAISE EXCEPTION 'V2-09 hosted project create tombstone identity drift' USING ERRCODE='23505';
    END IF;
    RAISE EXCEPTION 'V2-09 hosted project create was durably cancelled' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_fence_hosted_v209_project_create_insert() FROM PUBLIC;
CREATE TRIGGER hosted_project_create_requests_v209_lifecycle_fence
  BEFORE INSERT ON public.hosted_project_create_requests FOR EACH ROW
  EXECUTE FUNCTION public.videoforge_fence_hosted_v209_project_create_insert();

CREATE FUNCTION public.videoforge_reconcile_hosted_v209_staged_click(supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE
  account_id uuid; workspace_id uuid; project_id uuid; revision_id uuid; request_id uuid;
  stage text; claim_id text; idempotency_key text; create_hash text; issued_at timestamptz;
  create_row public.hosted_project_create_requests%ROWTYPE;
  request public.generation_requests%ROWTYPE; runtime public.video_runtime_states%ROWTYPE;
  active_lease public.provider_workload_leases%ROWTYPE; capacity public.global_generation_capacity%ROWTYPE;
  cpu public.hosted_cpu_job_attempts%ROWTYPE; lane public.video_runtime_lane_states%ROWTYPE;
  request_count integer:=0; attempt_count integer:=0; assignment_count integer:=0;
  total_assignment_count integer:=0; assigned_attempt_count integer:=0;
  outbox_count integer:=0; outbox_attempt_count integer:=0; live_outbox_count integer:=0;
  terminal_outbox_count integer:=0; dead_letter_outbox_count integer:=0;
  sent_count integer:=0; active_cpu_count integer:=0; cpu_event_count integer:=0;
  queue_audit_count integer:=0; runtime_event_count integer:=0; active_lease_count integer:=0;
  released_lease_count integer:=0; terminal_attempt_count integer:=0; succeeded_attempt_count integer:=0;
  provider_active_attempt_count integer:=0; upstream_dispatching_count integer:=0;
  upstream_unknown_count integer:=0; mutation_count integer:=0; changed integer;
  upstream_work jsonb:='[]'::jsonb; action text:='UNRESOLVED'; cpu_next_state text; cpu_facts text;
  pair_phase text; project_status text;
  provider_pair_identified boolean:=false; cpu_cancel_pending boolean:=false;
  project_archived boolean:=false; replayed boolean:=false; safe_to_archive boolean:=false;
  upstream_reconciliation_pending boolean:=false; previous_account text; release_reason text;
  request_version_before integer; audit_operation text; audit_lease_id uuid;
  db_now timestamptz:=transaction_timestamp(); document jsonb; receipt_hash text;
  archive_result record;
  reconciliation_record public.hosted_v209_staged_click_reconciliations%ROWTYPE;
  reconciliation_evidence jsonb; reconciliation_changed integer:=0;
  archive_receipt_found boolean:=false; tombstone_receipt_found boolean:=false;
BEGIN
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['accountId','claimId','createRequestSha256','generationRequestId',
         'idempotencyKey','issuedAt','projectId','projectRevisionId','schemaVersion','stage',
         'workspaceId']::text[]
     OR supplied->>'schemaVersion'<>'videoforge.v2-09-staged-click-reconciliation/v1'
     OR coalesce(supplied->>'accountId','') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR coalesce(supplied->>'workspaceId','') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR coalesce(supplied->>'claimId','') !~ '^sha256:[0-9a-f]{64}$'
     OR supplied->>'stage' NOT IN ('CLAIMED','CREATE_REQUESTED','PROJECT_CREATED','GENERATION_CREATED')
     OR jsonb_typeof(supplied->'issuedAt')<>'string' THEN
    RAISE EXCEPTION 'V2-09 staged click input invalid' USING ERRCODE='23514';
  END IF;
  account_id:=(supplied->>'accountId')::uuid;
  workspace_id:=(supplied->>'workspaceId')::uuid;
  stage:=supplied->>'stage'; claim_id:=supplied->>'claimId';
  issued_at:=(supplied->>'issuedAt')::timestamptz;
  IF issued_at>db_now THEN RAISE EXCEPTION 'V2-09 staged click time invalid' USING ERRCODE='23514'; END IF;
  previous_account:=current_setting('videoforge.account_id',true);
  PERFORM set_config('videoforge.account_id',account_id::text,true);
  IF NOT EXISTS(SELECT 1 FROM public.workspaces row WHERE row.id=workspace_id
    AND row.account_id=account_id AND row.status='ACTIVE') THEN
    RAISE EXCEPTION 'V2-09 staged click tenant invalid' USING ERRCODE='42501';
  END IF;
  IF stage='CLAIMED' THEN
    IF supplied->'idempotencyKey'<>'null'::jsonb OR supplied->'createRequestSha256'<>'null'::jsonb
       OR supplied->'projectId'<>'null'::jsonb OR supplied->'projectRevisionId'<>'null'::jsonb
       OR supplied->'generationRequestId'<>'null'::jsonb THEN
      RAISE EXCEPTION 'V2-09 claim carries materialized identity' USING ERRCODE='23514';
    END IF;
    action:='CLAIM_ONLY_NO_REQUEST';
  ELSE
    IF jsonb_typeof(supplied->'idempotencyKey')<>'string'
       OR coalesce(supplied->>'idempotencyKey','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$'
       OR coalesce(supplied->>'createRequestSha256','') !~ '^sha256:[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'V2-09 staged request identity invalid' USING ERRCODE='23514';
    END IF;
    idempotency_key:=supplied->>'idempotencyKey'; create_hash:=supplied->>'createRequestSha256';
    PERFORM pg_advisory_xact_lock(hashtextextended(
      account_id::text||':'||workspace_id::text||':'||idempotency_key,20909));
    SELECT * INTO create_row FROM public.hosted_project_create_requests row
     WHERE row.account_id=account_id AND row.workspace_id=workspace_id
       AND row.idempotency_key=idempotency_key FOR UPDATE;
    IF create_row.id IS NULL THEN
      IF stage<>'CREATE_REQUESTED' OR supplied->'projectId'<>'null'::jsonb
         OR supplied->'projectRevisionId'<>'null'::jsonb
         OR supplied->'generationRequestId'<>'null'::jsonb THEN
        RAISE EXCEPTION 'V2-09 staged project disappeared' USING ERRCODE='55000';
      END IF;
      action:='REQUEST_NOT_MATERIALIZED';
      reconciliation_evidence:=jsonb_build_object(
        'schemaVersion','videoforge.v2-09-staged-click-create-tombstone-evidence/v1',
        'accountId',account_id,'workspaceId',workspace_id,'claimId',claim_id,
        'stage',stage,'idempotencyKey',idempotency_key,
        'createRequestSha256',create_hash,'createRequestId',NULL,
        'projectId',NULL,'projectRevisionId',NULL,'generationRequestId',NULL,
        'action',action);
      INSERT INTO public.hosted_v209_staged_click_reconciliations(
        id,account_id,workspace_id,create_request_id,claim_id,stage,idempotency_key,
        create_request_sha256,project_id,project_revision_id,generation_request_id,action,
        evidence_sha256,created_at)
      VALUES(md5('v209-staged-click-tombstone:'||account_id::text||':'||workspace_id::text||':'||
          idempotency_key)::uuid,account_id,workspace_id,NULL,claim_id,stage,idempotency_key,
        create_hash,NULL,NULL,NULL,action,'sha256:'||encode(sha256(convert_to(
          public.videoforge_canonical_jsonb(reconciliation_evidence),'UTF8')),'hex'),db_now)
      ON CONFLICT(id) DO NOTHING;
      GET DIAGNOSTICS reconciliation_changed=ROW_COUNT;
      mutation_count:=mutation_count+reconciliation_changed;
      SELECT * INTO reconciliation_record
        FROM public.hosted_v209_staged_click_reconciliations row
       WHERE row.account_id=account_id AND row.workspace_id=workspace_id
         AND row.idempotency_key=idempotency_key FOR SHARE;
      IF reconciliation_record.id IS NULL OR reconciliation_record.create_request_id IS NOT NULL
         OR reconciliation_record.claim_id<>claim_id OR reconciliation_record.stage<>stage
         OR reconciliation_record.create_request_sha256<>create_hash
         OR reconciliation_record.project_id IS NOT NULL
         OR reconciliation_record.project_revision_id IS NOT NULL
         OR reconciliation_record.generation_request_id IS NOT NULL
         OR reconciliation_record.action<>action
         OR reconciliation_record.evidence_sha256<>
           'sha256:'||encode(sha256(convert_to(
             public.videoforge_canonical_jsonb(reconciliation_evidence),'UTF8')),'hex') THEN
        RAISE EXCEPTION 'V2-09 staged create tombstone drift' USING ERRCODE='55000';
      END IF;
      tombstone_receipt_found:=true;
      replayed:=reconciliation_changed=0;
    ELSE
      IF create_row.request_sha256<>create_hash OR create_row.created_at<issued_at
         OR NOT EXISTS(SELECT 1 FROM public.projects row WHERE row.id=create_row.project_id
           AND row.account_id=account_id AND row.workspace_id=workspace_id
           AND row.project_kind='USER')
         OR NOT EXISTS(SELECT 1 FROM public.project_revisions row
           WHERE row.id=create_row.project_revision_id AND row.account_id=account_id
             AND row.workspace_id=workspace_id AND row.project_id=create_row.project_id) THEN
        RAISE EXCEPTION 'V2-09 staged project ownership drift' USING ERRCODE='42501';
      END IF;
      project_id:=create_row.project_id; revision_id:=create_row.project_revision_id;
      SELECT row.status INTO project_status FROM public.projects row
       WHERE row.account_id=account_id AND row.workspace_id=workspace_id AND row.id=project_id
       FOR UPDATE;
      IF project_status IS NULL THEN
        RAISE EXCEPTION 'V2-09 staged project lock disappeared' USING ERRCODE='55000';
      END IF;
      IF stage IN ('PROJECT_CREATED','GENERATION_CREATED') AND (
        coalesce(supplied->>'projectId','')<>project_id::text
        OR coalesce(supplied->>'projectRevisionId','')<>revision_id::text) THEN
        RAISE EXCEPTION 'V2-09 staged project identity drift' USING ERRCODE='42501';
      END IF;
      IF stage='CREATE_REQUESTED' AND (supplied->'projectId'<>'null'::jsonb
        OR supplied->'projectRevisionId'<>'null'::jsonb OR supplied->'generationRequestId'<>'null'::jsonb)
      THEN RAISE EXCEPTION 'V2-09 create stage carries later identity' USING ERRCODE='23514'; END IF;
      SELECT count(*),min(row.id::text)::uuid INTO request_count,request_id
        FROM public.generation_requests row
       WHERE row.account_id=account_id AND row.workspace_id=workspace_id
         AND row.project_id=project_id AND row.project_revision_id=revision_id;
      IF request_count>1 OR (stage='GENERATION_CREATED' AND
        (request_count<>1 OR coalesce(supplied->>'generationRequestId','')<>request_id::text))
        OR (stage='PROJECT_CREATED' AND supplied->'generationRequestId'<>'null'::jsonb) THEN
        RAISE EXCEPTION 'V2-09 staged generation identity drift' USING ERRCODE='42501';
      END IF;
      SELECT * INTO reconciliation_record
        FROM public.hosted_v209_staged_click_reconciliations row
       WHERE row.create_request_id=create_row.id FOR SHARE;
      IF reconciliation_record.id IS NOT NULL THEN
        IF reconciliation_record.account_id<>account_id
           OR reconciliation_record.workspace_id<>workspace_id
           OR reconciliation_record.claim_id<>claim_id
           OR reconciliation_record.stage<>stage
           OR reconciliation_record.idempotency_key<>idempotency_key
           OR reconciliation_record.create_request_sha256<>create_hash
           OR reconciliation_record.project_id<>project_id
           OR reconciliation_record.project_revision_id<>revision_id
           OR reconciliation_record.generation_request_id IS DISTINCT FROM
             (CASE WHEN stage='GENERATION_CREATED' THEN request_id ELSE NULL END) THEN
          RAISE EXCEPTION 'V2-09 staged archive replay identity drift' USING ERRCODE='55000';
        END IF;
        archive_receipt_found:=true;
      END IF;
      SELECT coalesce(jsonb_agg(item ORDER BY item->>'kind',item->>'id'),'[]'::jsonb),
        count(*) FILTER (WHERE item->>'state'='DISPATCHING'),
        count(*) FILTER (WHERE item->>'state'='UNKNOWN')
        INTO upstream_work,upstream_dispatching_count,upstream_unknown_count FROM (
        SELECT jsonb_build_object('id',row.id,'kind','VOICEOVER_CONTEXT','state',row.state,
          'providerMayHaveCharged',true) item FROM public.hosted_voiceover_contexts row
         WHERE row.account_id=account_id AND row.workspace_id=workspace_id
           AND row.project_id=project_id AND row.project_revision_id=revision_id
           AND row.state IN ('DISPATCHING','UNKNOWN')
        UNION ALL
        SELECT jsonb_build_object('id',row.id,'kind','PROMPT_RUN','state',row.state,
          'providerMayHaveCharged',true) item FROM public.hosted_prompt_runs row
         WHERE row.account_id=account_id AND row.workspace_id=workspace_id
           AND row.project_id=project_id AND row.project_revision_id=revision_id
           AND row.state IN ('DISPATCHING','UNKNOWN')) active;
      upstream_reconciliation_pending:=upstream_dispatching_count>0;
      IF upstream_reconciliation_pending THEN
        action:='UPSTREAM_RECONCILIATION_PENDING';
      ELSIF upstream_unknown_count>0 THEN
        action:='UPSTREAM_UNKNOWN_PRESERVED';
      ELSE
        IF request_count=1 THEN
          PERFORM pg_advisory_xact_lock(hashtextextended(request_id::text,43));
          SELECT * INTO request FROM public.generation_requests row WHERE row.id=request_id FOR UPDATE;
          SELECT * INTO runtime FROM public.video_runtime_states row
            WHERE row.generation_request_id=request_id FOR UPDATE;
        END IF;
        SELECT count(*) INTO attempt_count FROM public.serverless_attempts row
          WHERE row.generation_request_id=request_id;
        IF attempt_count NOT IN (0,2) THEN
          RAISE EXCEPTION 'V2-09 staged provider pair partial' USING ERRCODE='55000';
        END IF;
        IF attempt_count=2 AND (
          (SELECT count(DISTINCT row.lane) FROM public.serverless_attempts row
            WHERE row.generation_request_id=request_id)<>2
          OR (SELECT count(DISTINCT row.task_id) FROM public.serverless_attempts row
            WHERE row.generation_request_id=request_id)<>2
          OR (SELECT count(*) FROM public.serverless_attempts row
            WHERE row.generation_request_id=request_id
              AND row.lane IN ('mage_image','soulx_avatar'))<>2
          OR runtime.id IS NULL
          OR (SELECT count(*) FROM public.video_runtime_lane_states row
            WHERE row.runtime_id=runtime.id AND row.lane IN ('mage_image','soulx_avatar'))<>2
          OR (SELECT count(*) FROM public.video_runtime_lane_states row
            WHERE row.runtime_id=runtime.id)<>2) THEN
          RAISE EXCEPTION 'V2-09 staged provider pair lane cardinality drift'
            USING ERRCODE='55000';
        END IF;
        SELECT count(*),count(*) FILTER (WHERE assignment.is_current),
          count(DISTINCT assignment.attempt_id) FILTER (WHERE assignment.is_current)
          INTO total_assignment_count,assignment_count,assigned_attempt_count
          FROM public.serverless_provider_assignments assignment
          JOIN public.serverless_attempts attempt ON attempt.id=assignment.attempt_id
          WHERE attempt.generation_request_id=request_id;
        SELECT count(*),count(DISTINCT outbox.attempt_id),
          count(*) FILTER (WHERE outbox.state IN ('READY_TO_DISPATCH','LEASED','SENT',
            'DISPATCH_ACK_UNKNOWN','ASSIGNED')),
          count(*) FILTER (WHERE outbox.state='TERMINAL'),
          count(*) FILTER (WHERE outbox.state='DEAD_LETTER')
          INTO outbox_count,outbox_attempt_count,live_outbox_count,terminal_outbox_count,
            dead_letter_outbox_count
          FROM public.serverless_dispatch_outbox outbox
          JOIN public.serverless_attempts attempt ON attempt.id=outbox.attempt_id
          WHERE attempt.generation_request_id=request_id;
        IF attempt_count=2 AND (outbox_count<>2 OR outbox_attempt_count<>2
          OR total_assignment_count<>assignment_count
          OR assigned_attempt_count<>assignment_count OR assignment_count NOT BETWEEN 0 AND 2) THEN
          RAISE EXCEPTION 'V2-09 staged provider pair outbox or assignment cardinality drift'
            USING ERRCODE='55000';
        END IF;
        SELECT count(*) INTO sent_count FROM public.serverless_dispatch_outbox outbox
          JOIN public.serverless_attempts attempt ON attempt.id=outbox.attempt_id
          WHERE attempt.generation_request_id=request_id AND (outbox.send_attempt_count<>0
            OR outbox.state IN ('SENT','DISPATCH_ACK_UNKNOWN','ASSIGNED'));
        provider_pair_identified:=attempt_count=2;
        SELECT count(*) INTO provider_active_attempt_count FROM public.serverless_attempts row
          WHERE row.generation_request_id=request_id AND row.state IN ('PLANNED','OUTBOXED',
            'DISPATCHING','ASSIGNED','IN_QUEUE','IN_PROGRESS','UPLOADING','RECONCILING','CANCELLING');
        IF attempt_count=0 AND (assignment_count<>0 OR sent_count<>0) THEN
          RAISE EXCEPTION 'V2-09 staged no-provider proof invalid' USING ERRCODE='55000';
        END IF;
        FOR cpu IN SELECT * FROM public.hosted_cpu_job_attempts row
          WHERE row.account_id=account_id AND row.workspace_id=workspace_id
            AND row.project_id=project_id AND row.project_revision_id=revision_id
            AND row.state IN ('PLANNED','OUTBOXED','SUBMITTED','RUNNING','RECONCILING','CANCEL_REQUESTED')
          ORDER BY row.id FOR UPDATE
        LOOP
          cpu_next_state:=CASE
            WHEN cpu.state IN ('PLANNED','OUTBOXED') THEN 'CANCELLED'
            WHEN cpu.state='CANCEL_REQUESTED' AND NOT EXISTS(SELECT 1 FROM public.media_worker_leases lease
              WHERE lease.attempt_id=cpu.id AND lease.state IN ('CLAIMED','RUNNING','COMPLETING'))
              THEN 'CANCELLED' ELSE 'CANCEL_REQUESTED' END;
          IF cpu.state<>cpu_next_state THEN
            cpu_facts:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
              jsonb_build_object('attemptId',cpu.id,'fromState',cpu.state,
                'claimId',claim_id,'reason','V209_STAGED_CLICK_FAILURE','toState',cpu_next_state,
                'schemaVersion','videoforge.v2-09-staged-click-cpu-cancel/v1')),'UTF8')),'hex');
            UPDATE public.hosted_cpu_job_attempts SET state=cpu_next_state,
              submitted_at=coalesce(submitted_at,db_now),cancellation_requested_at=db_now,
              terminal_at=CASE WHEN cpu_next_state='CANCELLED' THEN db_now ELSE terminal_at END,
              retain_until=CASE WHEN cpu_next_state='CANCELLED'
                THEN greatest(deadline_at,db_now+interval '30 minutes') ELSE retain_until END,
              poll_after=db_now,version=version+1,updated_at=db_now WHERE id=cpu.id AND state=cpu.state;
            GET DIAGNOSTICS changed=ROW_COUNT; mutation_count:=mutation_count+changed;
            INSERT INTO public.hosted_cpu_job_events(id,account_id,workspace_id,attempt_id,sequence,
              kind,facts_sha256,occurred_at) SELECT
              md5('v209-staged-click:'||cpu.id::text||':'||cpu_next_state)::uuid,
              cpu.account_id,cpu.workspace_id,cpu.id,coalesce(max(event.sequence),0)+1,
              cpu_next_state,cpu_facts,db_now FROM public.hosted_cpu_job_events event
              WHERE event.account_id=cpu.account_id AND event.workspace_id=cpu.workspace_id
                AND event.attempt_id=cpu.id ON CONFLICT(id) DO NOTHING;
            IF NOT EXISTS(SELECT 1 FROM public.hosted_cpu_job_events event
              WHERE event.id=md5('v209-staged-click:'||cpu.id::text||':'||cpu_next_state)::uuid
                AND event.account_id=cpu.account_id AND event.workspace_id=cpu.workspace_id
                AND event.attempt_id=cpu.id AND event.kind=cpu_next_state
                AND event.facts_sha256=cpu_facts) THEN
              RAISE EXCEPTION 'V2-09 staged CPU event drift' USING ERRCODE='55000';
            END IF;
          END IF;
        END LOOP;
        SELECT count(*) INTO active_cpu_count FROM public.hosted_cpu_job_attempts row
          WHERE row.account_id=account_id AND row.workspace_id=workspace_id
            AND row.project_id=project_id AND row.project_revision_id=revision_id
            AND row.state IN ('PLANNED','OUTBOXED','SUBMITTED','RUNNING','RECONCILING','CANCEL_REQUESTED');
        SELECT count(*) INTO cpu_event_count FROM public.hosted_cpu_job_events event
          JOIN public.hosted_cpu_job_attempts cpu ON cpu.id=event.attempt_id
          WHERE cpu.account_id=account_id AND cpu.workspace_id=workspace_id
            AND cpu.project_id=project_id AND cpu.project_revision_id=revision_id
            AND event.id IN (md5('v209-staged-click:'||cpu.id::text||':CANCEL_REQUESTED')::uuid,
              md5('v209-staged-click:'||cpu.id::text||':CANCELLED')::uuid);
        cpu_cancel_pending:=active_cpu_count>0;
        IF request_count=1 AND request.state IN ('ADMITTED','ACTIVE')
           AND (cpu_cancel_pending OR provider_pair_identified) THEN
          request_version_before:=request.version;
          UPDATE public.generation_requests SET state='CANCELLING',version=version+1,updated_at=db_now
            WHERE id=request.id AND version=request.version;
          GET DIAGNOSTICS changed=ROW_COUNT; mutation_count:=mutation_count+changed;
          SELECT * INTO capacity FROM public.global_generation_capacity WHERE singleton FOR SHARE;
          INSERT INTO public.generation_queue_audits(id,account_id,workspace_id,actor_user_id,
            operation,request_kind,request_id,lease_id,request_version_before,request_version_after,
            video_cursor_before,video_cursor_after,preview_cursor_before,preview_cursor_after,detail,
            occurred_at) VALUES(md5('v209-staged-click-cancel:'||request.id::text)::uuid,
            request.account_id,request.workspace_id,request.created_by_user_id,'CANCEL_ACTIVE','VIDEO',
            request.id,NULL,request_version_before,request_version_before+1,capacity.video_fair_cursor,
            capacity.video_fair_cursor,capacity.preview_fair_cursor,capacity.preview_fair_cursor,
            jsonb_build_object('claimId',claim_id,'reason','V209_STAGED_CLICK_FAILURE'),db_now)
            ON CONFLICT(id) DO NOTHING;
          GET DIAGNOSTICS changed=ROW_COUNT; mutation_count:=mutation_count+changed;
          IF NOT EXISTS(SELECT 1 FROM public.generation_queue_audits audit
            WHERE audit.id=md5('v209-staged-click-cancel:'||request.id::text)::uuid
              AND audit.account_id=request.account_id AND audit.workspace_id=request.workspace_id
              AND audit.actor_user_id=request.created_by_user_id AND audit.operation='CANCEL_ACTIVE'
              AND audit.request_kind='VIDEO' AND audit.request_id=request.id AND audit.lease_id IS NULL
              AND audit.request_version_before=request_version_before
              AND audit.request_version_after=request_version_before+1
              AND audit.video_cursor_before=capacity.video_fair_cursor
              AND audit.video_cursor_after=capacity.video_fair_cursor
              AND audit.preview_cursor_before=capacity.preview_fair_cursor
              AND audit.preview_cursor_after=capacity.preview_fair_cursor
              AND audit.detail=jsonb_build_object('claimId',claim_id,
                'reason','V209_STAGED_CLICK_FAILURE')) THEN
            RAISE EXCEPTION 'V2-09 staged active cancellation audit drift' USING ERRCODE='55000';
          END IF;
          SELECT * INTO request FROM public.generation_requests row WHERE row.id=request_id;
        END IF;
        IF cpu_cancel_pending THEN
          action:='CPU_CANCEL_PENDING';
        ELSIF provider_pair_identified THEN
          SELECT row.phase INTO pair_phase FROM public.hosted_pair_runtime_states row
            WHERE row.generation_request_id=request_id FOR UPDATE;
          SELECT count(*) INTO active_lease_count FROM public.provider_workload_leases row
            WHERE row.generation_request_id=request_id AND row.state='ACTIVE';
          SELECT count(*),count(*) FILTER (WHERE row.state='SUCCEEDED')
            INTO terminal_attempt_count,succeeded_attempt_count
            FROM public.serverless_attempts row WHERE row.generation_request_id=request_id
              AND row.state IN ('SUCCEEDED','PERMANENT_FAILED','CANCELLED');
          IF request_count=1 AND request.state='SUCCEEDED' THEN
            IF terminal_attempt_count<>2 OR succeeded_attempt_count<>2 OR runtime.stage<>'COMPLETE'
               OR pair_phase<>'SETTLED' OR active_lease_count<>0 OR assignment_count<>2
               OR live_outbox_count<>0 OR terminal_outbox_count<>2 OR dead_letter_outbox_count<>0
               OR EXISTS(SELECT 1 FROM public.serverless_dispatch_outbox outbox
                 JOIN public.serverless_attempts attempt ON attempt.id=outbox.attempt_id
                 WHERE attempt.generation_request_id=request_id
                   AND (outbox.state<>'TERMINAL' OR outbox.send_attempt_count<>1))
               OR (SELECT count(*) FROM public.video_runtime_lane_states row
                 WHERE row.runtime_id=runtime.id AND row.state='SUCCEEDED'
                   AND row.current_attempt_id IS NULL)<>2 THEN
              RAISE EXCEPTION 'V2-09 succeeded request provider pair drift' USING ERRCODE='55000';
            END IF;
            action:='PROVIDER_SUCCESS_PRESERVED';
          ELSIF request_count=1 AND request.state IN ('FAILED','CANCELLED') THEN
            IF terminal_attempt_count<>2 OR provider_active_attempt_count<>0
               OR runtime.stage NOT IN ('FAILED','CANCELED') OR pair_phase<>'SETTLED'
               OR active_lease_count<>0 OR live_outbox_count<>0
               OR terminal_outbox_count+dead_letter_outbox_count<>2
               OR terminal_outbox_count<>assignment_count
               OR dead_letter_outbox_count<>2-assignment_count
               OR EXISTS(SELECT 1 FROM public.serverless_dispatch_outbox outbox
                 JOIN public.serverless_attempts attempt ON attempt.id=outbox.attempt_id
                 WHERE attempt.generation_request_id=request_id
                   AND ((outbox.state='TERMINAL' AND outbox.send_attempt_count<>1)
                     OR (outbox.state='DEAD_LETTER' AND outbox.send_attempt_count<>0)))
               OR EXISTS(SELECT 1 FROM public.video_runtime_lane_states row
                 WHERE row.runtime_id=runtime.id
                   AND (row.state NOT IN ('FAILED','CANCELED') OR row.current_attempt_id IS NOT NULL)) THEN
              RAISE EXCEPTION 'V2-09 failed request provider pair archive drift'
                USING ERRCODE='55000';
            END IF;
            safe_to_archive:=true;
            action:='PROVIDER_FAILURE_TERMINAL';
          ELSE
            action:='PROVIDER_PAIR_IDENTIFIED';
          END IF;
        ELSE
          IF request_count=1 THEN
            IF request.state='SUCCEEDED' THEN
              RAISE EXCEPTION 'V2-09 no-provider request cannot be succeeded' USING ERRCODE='55000';
            END IF;
            SELECT * INTO active_lease FROM public.provider_workload_leases row
              WHERE row.generation_request_id=request.id AND row.state='ACTIVE' FOR UPDATE;
            SELECT count(*) INTO active_lease_count FROM public.provider_workload_leases row
              WHERE row.generation_request_id=request.id AND row.state='ACTIVE';
            IF request.state IN ('WAITING','RETRY_WAIT') AND (
              runtime.id IS NULL OR runtime.stage<>'QUEUED' OR runtime.admitted_at IS NOT NULL
              OR runtime.preparation_manifest_sha256 IS NOT NULL OR runtime.render_manifest_sha256 IS NOT NULL
              OR runtime.final_output_sha256 IS NOT NULL OR active_lease_count<>0
              OR (SELECT count(*) FROM public.video_runtime_lane_states row
                WHERE row.runtime_id=runtime.id)<>2
              OR EXISTS(SELECT 1 FROM public.video_runtime_lane_states row
                WHERE row.runtime_id=runtime.id AND (row.state<>'BLOCKED_ON_PREPARATION'
                  OR row.items_manifest_sha256 IS NOT NULL OR row.planned_item_count<>0
                  OR row.accepted_item_count<>0 OR row.attempt_ordinal<>0
                  OR row.current_attempt_id IS NOT NULL))
              OR EXISTS(SELECT 1 FROM public.video_runtime_accepted_units row
                WHERE row.runtime_id=runtime.id)
              OR EXISTS(SELECT 1 FROM public.hosted_cpu_job_attempts row
                WHERE row.account_id=account_id AND row.workspace_id=workspace_id
                  AND row.project_id=project_id AND row.project_revision_id=revision_id)
              OR EXISTS(SELECT 1 FROM public.generation_tasks task
                WHERE task.workspace_id=workspace_id AND task.project_revision_id=revision_id)
              OR EXISTS(SELECT 1 FROM public.serverless_cost_events event
                JOIN public.serverless_attempts attempt ON attempt.id=event.attempt_id
                WHERE attempt.generation_request_id=request.id)) THEN
              RAISE EXCEPTION 'V2-09 staged waiting runtime is not pristine' USING ERRCODE='55000';
            END IF;
            IF request.state IN ('ADMITTED','ACTIVE','CANCELLING') AND active_lease_count<>1 THEN
              RAISE EXCEPTION 'V2-09 staged exact active lease missing' USING ERRCODE='55000';
            END IF;
            IF request.state IN ('WAITING','RETRY_WAIT','ADMITTED','ACTIVE','CANCELLING')
               OR (request.state IN ('FAILED','CANCELLED') AND runtime.stage NOT IN ('FAILED','CANCELED')) THEN
              IF runtime.id IS NULL THEN RAISE EXCEPTION 'V2-09 staged runtime missing' USING ERRCODE='55000'; END IF;
              FOR lane IN SELECT * FROM public.video_runtime_lane_states row
                WHERE row.runtime_id=runtime.id ORDER BY row.lane FOR UPDATE
              LOOP
                IF lane.state NOT IN ('SUCCEEDED','FAILED','CANCELED') THEN
                  UPDATE public.video_runtime_lane_states SET state='CANCELED',current_attempt_id=NULL,
                    version=version+1,updated_at=db_now WHERE id=lane.id AND version=lane.version;
                  GET DIAGNOSTICS changed=ROW_COUNT; mutation_count:=mutation_count+changed;
                  INSERT INTO public.video_runtime_events(id,account_id,workspace_id,runtime_id,
                    project_revision_id,lane,from_state,to_state,reason,detail,occurred_at)
                  VALUES(md5('v209-staged-click-lane:'||lane.id::text)::uuid,lane.account_id,
                      lane.workspace_id,lane.runtime_id,lane.project_revision_id,lane.lane,lane.state,
                      'CANCELED','V209_STAGED_CLICK_FAILURE',jsonb_build_object('claimId',claim_id),db_now)
                    ON CONFLICT(id) DO NOTHING;
                  IF NOT EXISTS(SELECT 1 FROM public.video_runtime_events event
                    WHERE event.id=md5('v209-staged-click-lane:'||lane.id::text)::uuid
                      AND event.account_id=lane.account_id AND event.workspace_id=lane.workspace_id
                      AND event.runtime_id=lane.runtime_id AND event.project_revision_id=lane.project_revision_id
                      AND event.lane=lane.lane AND event.from_state=lane.state
                      AND event.to_state='CANCELED' AND event.reason='V209_STAGED_CLICK_FAILURE'
                      AND event.detail=jsonb_build_object('claimId',claim_id)) THEN
                    RAISE EXCEPTION 'V2-09 staged lane event drift' USING ERRCODE='55000';
                  END IF;
                END IF;
              END LOOP;
              IF runtime.stage NOT IN ('FAILED','CANCELED') THEN
                UPDATE public.video_runtime_states SET stage='CANCELED',terminal_reason='SYSTEM_CANCELLED',
                  terminal_at=db_now,version=version+1,updated_at=db_now
                  WHERE id=runtime.id AND version=runtime.version;
                GET DIAGNOSTICS changed=ROW_COUNT; mutation_count:=mutation_count+changed;
                INSERT INTO public.video_runtime_events(id,account_id,workspace_id,runtime_id,
                  project_revision_id,lane,from_state,to_state,reason,detail,occurred_at)
                  VALUES(md5('v209-staged-click-runtime:'||runtime.id::text)::uuid,runtime.account_id,
                    runtime.workspace_id,runtime.id,runtime.project_revision_id,NULL,runtime.stage,
                    'CANCELED','V209_STAGED_CLICK_FAILURE',jsonb_build_object('claimId',claim_id),db_now)
                    ON CONFLICT(id) DO NOTHING;
                IF NOT EXISTS(SELECT 1 FROM public.video_runtime_events event
                  WHERE event.id=md5('v209-staged-click-runtime:'||runtime.id::text)::uuid
                    AND event.account_id=runtime.account_id AND event.workspace_id=runtime.workspace_id
                    AND event.runtime_id=runtime.id AND event.project_revision_id=runtime.project_revision_id
                    AND event.lane IS NULL AND event.from_state=runtime.stage
                    AND event.to_state='CANCELED' AND event.reason='V209_STAGED_CLICK_FAILURE'
                    AND event.detail=jsonb_build_object('claimId',claim_id)) THEN
                  RAISE EXCEPTION 'V2-09 staged runtime event drift' USING ERRCODE='55000';
                END IF;
              END IF;
              UPDATE public.generation_tasks task SET state='CANCELLED',cancel_requested_at=db_now,
                finished_at=db_now,version=task.version+1,updated_at=db_now
                WHERE task.workspace_id=workspace_id AND task.project_revision_id=revision_id
                  AND task.state NOT IN ('FAILED','CANCELLED','COMPLETE');
              GET DIAGNOSTICS changed=ROW_COUNT; mutation_count:=mutation_count+changed;
              IF active_lease_count=1 THEN
                UPDATE public.provider_workload_leases SET state='RELEASED',released_at=db_now,
                  release_reason='V209_STAGED_CLICK_NO_PROVIDER_FAILURE',version=version+1,
                  heartbeat_at=db_now,expires_at=greatest(expires_at,db_now+interval '1 second')
                  WHERE id=active_lease.id AND state='ACTIVE';
                GET DIAGNOSTICS changed=ROW_COUNT; mutation_count:=mutation_count+changed;
                release_reason:='V209_STAGED_CLICK_NO_PROVIDER_FAILURE';
              END IF;
              IF request.state NOT IN ('FAILED','CANCELLED') THEN
                request_version_before:=request.version;
                UPDATE public.generation_requests SET state='CANCELLED',terminal_at=db_now,
                  version=version+1,updated_at=db_now WHERE id=request.id AND version=request.version;
                GET DIAGNOSTICS changed=ROW_COUNT; mutation_count:=mutation_count+changed;
                SELECT * INTO capacity FROM public.global_generation_capacity WHERE singleton FOR SHARE;
                audit_operation:=CASE WHEN request.state IN ('WAITING','RETRY_WAIT')
                  THEN 'CANCEL_WAITING' ELSE 'TERMINAL_RELEASE' END;
                audit_lease_id:=CASE WHEN active_lease_count=1 THEN active_lease.id ELSE NULL END;
                INSERT INTO public.generation_queue_audits(id,account_id,workspace_id,actor_user_id,
                  operation,request_kind,request_id,lease_id,request_version_before,
                  request_version_after,video_cursor_before,video_cursor_after,preview_cursor_before,
                  preview_cursor_after,detail,occurred_at)
                  VALUES(md5('v209-staged-click-terminal:'||request.id::text)::uuid,request.account_id,
                    request.workspace_id,request.created_by_user_id,audit_operation,'VIDEO',request.id,
                    audit_lease_id,request_version_before,request_version_before+1,
                    capacity.video_fair_cursor,capacity.video_fair_cursor,capacity.preview_fair_cursor,
                    capacity.preview_fair_cursor,jsonb_build_object('claimId',claim_id,
                      'reason','V209_STAGED_CLICK_NO_PROVIDER_FAILURE'),db_now)
                  ON CONFLICT(id) DO NOTHING;
                GET DIAGNOSTICS changed=ROW_COUNT; mutation_count:=mutation_count+changed;
                IF NOT EXISTS(SELECT 1 FROM public.generation_queue_audits audit
                  WHERE audit.id=md5('v209-staged-click-terminal:'||request.id::text)::uuid
                    AND audit.account_id=request.account_id AND audit.workspace_id=request.workspace_id
                    AND audit.operation=audit_operation AND audit.request_kind='VIDEO'
                    AND audit.request_id=request.id AND audit.lease_id IS NOT DISTINCT FROM audit_lease_id
                    AND audit.request_version_before=request_version_before
                    AND audit.request_version_after=request_version_before+1
                    AND audit.video_cursor_before=capacity.video_fair_cursor
                    AND audit.video_cursor_after=capacity.video_fair_cursor
                    AND audit.preview_cursor_before=capacity.preview_fair_cursor
                    AND audit.preview_cursor_after=capacity.preview_fair_cursor
                    AND audit.detail=jsonb_build_object('claimId',claim_id,
                      'reason','V209_STAGED_CLICK_NO_PROVIDER_FAILURE')) THEN
                  RAISE EXCEPTION 'V2-09 staged terminal audit drift' USING ERRCODE='55000';
                END IF;
              ELSE
                IF request.state<>'CANCELLED' OR runtime.stage<>'CANCELED'
                   OR runtime.terminal_reason<>'SYSTEM_CANCELLED'
                   OR (SELECT count(*) FROM public.video_runtime_lane_states row
                     WHERE row.runtime_id=runtime.id)<>2
                   OR EXISTS(SELECT 1 FROM public.video_runtime_lane_states row
                     WHERE row.runtime_id=runtime.id AND row.state<>'CANCELED')
                   OR NOT EXISTS(SELECT 1 FROM public.generation_queue_audits audit
                     WHERE audit.id=md5('v209-staged-click-terminal:'||request.id::text)::uuid
                       AND audit.account_id=request.account_id
                       AND audit.workspace_id=request.workspace_id
                       AND audit.actor_user_id=request.created_by_user_id
                       AND audit.request_kind='VIDEO' AND audit.request_id=request.id
                       AND audit.request_version_before=request.version-1
                       AND audit.request_version_after=request.version
                       AND audit.video_cursor_before=audit.video_cursor_after
                       AND audit.preview_cursor_before=audit.preview_cursor_after
                       AND audit.detail=jsonb_build_object('claimId',claim_id,
                         'reason','V209_STAGED_CLICK_NO_PROVIDER_FAILURE')
                       AND ((audit.operation='CANCEL_WAITING' AND audit.lease_id IS NULL)
                         OR (audit.operation='TERMINAL_RELEASE' AND EXISTS(
                           SELECT 1 FROM public.provider_workload_leases lease
                            WHERE lease.id=audit.lease_id AND lease.generation_request_id=request.id
                              AND lease.state='RELEASED'
                              AND lease.release_reason='V209_STAGED_CLICK_NO_PROVIDER_FAILURE'))))
                   OR NOT EXISTS(SELECT 1 FROM public.video_runtime_events event
                     WHERE event.id=md5('v209-staged-click-runtime:'||runtime.id::text)::uuid
                       AND event.account_id=runtime.account_id
                       AND event.workspace_id=runtime.workspace_id
                       AND event.runtime_id=runtime.id
                       AND event.project_revision_id=runtime.project_revision_id
                       AND event.lane IS NULL AND event.to_state='CANCELED'
                       AND event.reason='V209_STAGED_CLICK_FAILURE'
                       AND event.detail=jsonb_build_object('claimId',claim_id))
                   OR (SELECT count(*) FROM public.video_runtime_lane_states current_lane
                     JOIN public.video_runtime_events event
                       ON event.id=md5('v209-staged-click-lane:'||current_lane.id::text)::uuid
                      AND event.account_id=current_lane.account_id
                      AND event.workspace_id=current_lane.workspace_id
                      AND event.runtime_id=current_lane.runtime_id
                      AND event.project_revision_id=current_lane.project_revision_id
                      AND event.lane=current_lane.lane AND event.to_state='CANCELED'
                      AND event.reason='V209_STAGED_CLICK_FAILURE'
                      AND event.detail=jsonb_build_object('claimId',claim_id)
                     WHERE current_lane.runtime_id=runtime.id)<>2
                   OR EXISTS(SELECT 1 FROM public.hosted_cpu_job_attempts current_cpu
                     WHERE current_cpu.account_id=account_id AND current_cpu.workspace_id=workspace_id
                       AND current_cpu.project_id=project_id
                       AND current_cpu.project_revision_id=revision_id
                       AND current_cpu.state='CANCELLED'
                       AND NOT EXISTS(SELECT 1 FROM public.hosted_cpu_job_events event
                         WHERE event.id=md5('v209-staged-click:'||current_cpu.id::text||':CANCELLED')::uuid
                           AND event.account_id=current_cpu.account_id
                           AND event.workspace_id=current_cpu.workspace_id
                           AND event.attempt_id=current_cpu.id AND event.kind='CANCELLED')) THEN
                  RAISE EXCEPTION 'V2-09 staged terminal replay drift' USING ERRCODE='55000';
                END IF;
                replayed:=true;
              END IF;
            ELSE
              IF request.state<>'CANCELLED' OR runtime.stage<>'CANCELED'
                 OR runtime.terminal_reason<>'SYSTEM_CANCELLED'
                 OR (SELECT count(*) FROM public.video_runtime_lane_states row
                   WHERE row.runtime_id=runtime.id)<>2
                 OR EXISTS(SELECT 1 FROM public.video_runtime_lane_states row
                   WHERE row.runtime_id=runtime.id AND row.state<>'CANCELED')
                 OR NOT EXISTS(SELECT 1 FROM public.generation_queue_audits audit
                   WHERE audit.id=md5('v209-staged-click-terminal:'||request.id::text)::uuid
                     AND audit.account_id=request.account_id
                     AND audit.workspace_id=request.workspace_id
                     AND audit.actor_user_id=request.created_by_user_id
                     AND audit.request_kind='VIDEO' AND audit.request_id=request.id
                     AND audit.request_version_before=request.version-1
                     AND audit.request_version_after=request.version
                     AND audit.video_cursor_before=audit.video_cursor_after
                     AND audit.preview_cursor_before=audit.preview_cursor_after
                     AND audit.detail=jsonb_build_object('claimId',claim_id,
                       'reason','V209_STAGED_CLICK_NO_PROVIDER_FAILURE')
                     AND ((audit.operation='CANCEL_WAITING' AND audit.lease_id IS NULL)
                       OR (audit.operation='TERMINAL_RELEASE' AND EXISTS(
                         SELECT 1 FROM public.provider_workload_leases lease
                          WHERE lease.id=audit.lease_id AND lease.generation_request_id=request.id
                            AND lease.state='RELEASED'
                            AND lease.release_reason='V209_STAGED_CLICK_NO_PROVIDER_FAILURE'))))
                 OR NOT EXISTS(SELECT 1 FROM public.video_runtime_events event
                   WHERE event.id=md5('v209-staged-click-runtime:'||runtime.id::text)::uuid
                     AND event.account_id=runtime.account_id
                     AND event.workspace_id=runtime.workspace_id
                     AND event.runtime_id=runtime.id
                     AND event.project_revision_id=runtime.project_revision_id
                     AND event.lane IS NULL AND event.to_state='CANCELED'
                     AND event.reason='V209_STAGED_CLICK_FAILURE'
                     AND event.detail=jsonb_build_object('claimId',claim_id))
                 OR (SELECT count(*) FROM public.video_runtime_lane_states current_lane
                   JOIN public.video_runtime_events event
                     ON event.id=md5('v209-staged-click-lane:'||current_lane.id::text)::uuid
                    AND event.account_id=current_lane.account_id
                    AND event.workspace_id=current_lane.workspace_id
                    AND event.runtime_id=current_lane.runtime_id
                    AND event.project_revision_id=current_lane.project_revision_id
                    AND event.lane=current_lane.lane AND event.to_state='CANCELED'
                    AND event.reason='V209_STAGED_CLICK_FAILURE'
                    AND event.detail=jsonb_build_object('claimId',claim_id)
                   WHERE current_lane.runtime_id=runtime.id)<>2
                 OR EXISTS(SELECT 1 FROM public.hosted_cpu_job_attempts current_cpu
                   WHERE current_cpu.account_id=account_id AND current_cpu.workspace_id=workspace_id
                     AND current_cpu.project_id=project_id
                     AND current_cpu.project_revision_id=revision_id
                     AND current_cpu.state='CANCELLED'
                     AND NOT EXISTS(SELECT 1 FROM public.hosted_cpu_job_events event
                       WHERE event.id=md5('v209-staged-click:'||current_cpu.id::text||':CANCELLED')::uuid
                         AND event.account_id=current_cpu.account_id
                         AND event.workspace_id=current_cpu.workspace_id
                         AND event.attempt_id=current_cpu.id AND event.kind='CANCELLED')) THEN
                RAISE EXCEPTION 'V2-09 staged terminal replay drift' USING ERRCODE='55000';
              END IF;
              replayed:=true;
            END IF;
            SELECT * INTO request FROM public.generation_requests row WHERE row.id=request_id;
            SELECT * INTO runtime FROM public.video_runtime_states row
              WHERE row.generation_request_id=request_id;
            action:='NO_PROVIDER_REQUEST_TERMINATED';
          ELSE action:='PROJECT_WITHOUT_GENERATION';
          END IF;
          IF NOT EXISTS(SELECT 1 FROM public.hosted_cpu_job_attempts row
              WHERE row.account_id=account_id AND row.workspace_id=workspace_id
                AND row.project_id=project_id AND row.project_revision_id=revision_id
                AND row.state IN ('PLANNED','OUTBOXED','SUBMITTED','RUNNING','RECONCILING','CANCEL_REQUESTED'))
             AND (request_count=0 OR request.state IN ('FAILED','CANCELLED'))
             AND (NOT provider_pair_identified OR safe_to_archive) THEN
            SELECT * INTO archive_result FROM public.videoforge_archive_hosted_project(
              account_id,workspace_id,project_id);
            project_archived:=(SELECT status='ARCHIVED' FROM public.projects row WHERE row.id=project_id);
            IF archive_result.project_id IS DISTINCT FROM project_id
               OR archive_result.state<>'ARCHIVED'
               OR archive_result.retained_attempt_count<>(SELECT count(*) FROM public.hosted_cpu_job_attempts row
                 WHERE row.account_id=account_id AND row.workspace_id=workspace_id
                   AND row.project_id=project_id)
               OR NOT project_archived THEN
              RAISE EXCEPTION 'V2-09 staged archive failed' USING ERRCODE='55000';
            END IF;
            IF action='UNRESOLVED' THEN
              RAISE EXCEPTION 'V2-09 staged action unresolved' USING ERRCODE='55000';
            END IF;
            action:=action||'_PROJECT_ARCHIVED';
            reconciliation_evidence:=jsonb_build_object(
              'schemaVersion','videoforge.v2-09-staged-click-archive-evidence/v1',
              'accountId',account_id,'workspaceId',workspace_id,'claimId',claim_id,
              'stage',stage,'idempotencyKey',idempotency_key,
              'createRequestSha256',create_hash,'createRequestId',create_row.id,
              'projectId',project_id,'projectRevisionId',revision_id,
              'generationRequestId',CASE WHEN stage='GENERATION_CREATED' THEN request_id ELSE NULL END,
              'action',action);
            INSERT INTO public.hosted_v209_staged_click_reconciliations(
              id,account_id,workspace_id,create_request_id,claim_id,stage,idempotency_key,
              create_request_sha256,project_id,project_revision_id,generation_request_id,action,
              evidence_sha256,created_at)
            VALUES(md5('v209-staged-click-reconciliation:'||create_row.id::text)::uuid,
              account_id,workspace_id,create_row.id,claim_id,stage,idempotency_key,create_hash,
              project_id,revision_id,CASE WHEN stage='GENERATION_CREATED' THEN request_id ELSE NULL END,
              action,'sha256:'||encode(sha256(convert_to(
                public.videoforge_canonical_jsonb(reconciliation_evidence),'UTF8')),'hex'),db_now)
            ON CONFLICT(id) DO NOTHING;
            GET DIAGNOSTICS reconciliation_changed=ROW_COUNT;
            mutation_count:=mutation_count+reconciliation_changed;
            SELECT * INTO reconciliation_record
              FROM public.hosted_v209_staged_click_reconciliations row
             WHERE row.id=md5('v209-staged-click-reconciliation:'||create_row.id::text)::uuid;
            IF reconciliation_record.account_id<>account_id
               OR reconciliation_record.workspace_id<>workspace_id
               OR reconciliation_record.create_request_id<>create_row.id
               OR reconciliation_record.claim_id<>claim_id
               OR reconciliation_record.stage<>stage
               OR reconciliation_record.idempotency_key<>idempotency_key
               OR reconciliation_record.create_request_sha256<>create_hash
               OR reconciliation_record.project_id<>project_id
               OR reconciliation_record.project_revision_id<>revision_id
               OR reconciliation_record.generation_request_id IS DISTINCT FROM
                 (CASE WHEN stage='GENERATION_CREATED' THEN request_id ELSE NULL END)
               OR reconciliation_record.action<>action
               OR reconciliation_record.evidence_sha256<>
                 'sha256:'||encode(sha256(convert_to(
                   public.videoforge_canonical_jsonb(reconciliation_evidence),'UTF8')),'hex') THEN
              RAISE EXCEPTION 'V2-09 staged archive receipt drift' USING ERRCODE='55000';
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;
  IF archive_receipt_found THEN
    project_archived:=coalesce((SELECT row.status='ARCHIVED' FROM public.projects row
      WHERE row.account_id=account_id AND row.workspace_id=workspace_id AND row.id=project_id),false);
    reconciliation_evidence:=jsonb_build_object(
      'schemaVersion','videoforge.v2-09-staged-click-archive-evidence/v1',
      'accountId',account_id,'workspaceId',workspace_id,'claimId',claim_id,
      'stage',stage,'idempotencyKey',idempotency_key,
      'createRequestSha256',create_hash,'createRequestId',create_row.id,
      'projectId',project_id,'projectRevisionId',revision_id,
      'generationRequestId',CASE WHEN stage='GENERATION_CREATED' THEN request_id ELSE NULL END,
      'action',action);
    IF mutation_count<>0 OR NOT project_archived
       OR reconciliation_record.action<>action
       OR reconciliation_record.evidence_sha256<>
         'sha256:'||encode(sha256(convert_to(
           public.videoforge_canonical_jsonb(reconciliation_evidence),'UTF8')),'hex') THEN
      RAISE EXCEPTION 'V2-09 staged archive replay projection drift' USING ERRCODE='55000';
    END IF;
    replayed:=true;
  END IF;
  IF request_id IS NOT NULL THEN
    SELECT count(*) INTO active_lease_count FROM public.provider_workload_leases row
      WHERE row.generation_request_id=request_id AND row.state='ACTIVE';
    SELECT count(*) INTO released_lease_count FROM public.provider_workload_leases row
      WHERE row.generation_request_id=request_id AND row.state='RELEASED';
    SELECT * INTO request FROM public.generation_requests row WHERE row.id=request_id;
    SELECT * INTO runtime FROM public.video_runtime_states row WHERE row.generation_request_id=request_id;
    SELECT count(*) INTO terminal_attempt_count FROM public.serverless_attempts row
      WHERE row.generation_request_id=request_id AND row.state IN ('SUCCEEDED','PERMANENT_FAILED','CANCELLED');
    SELECT row.release_reason INTO release_reason FROM public.provider_workload_leases row
      WHERE row.generation_request_id=request_id AND row.state='RELEASED'
      ORDER BY row.released_at DESC,row.id DESC LIMIT 1;
    SELECT count(*) INTO queue_audit_count FROM public.generation_queue_audits row
      WHERE row.request_id=request_id AND row.id IN (
        md5('v209-staged-click-cancel:'||request_id::text)::uuid,
        md5('v209-staged-click-terminal:'||request_id::text)::uuid);
    SELECT count(*) INTO runtime_event_count FROM public.video_runtime_events row
      WHERE row.runtime_id=runtime.id AND row.id=md5('v209-staged-click-runtime:'||runtime.id::text)::uuid;
  END IF;
  replayed:=replayed OR (mutation_count=0 AND request_id IS NOT NULL
    AND action NOT IN ('CLAIM_ONLY_NO_REQUEST','REQUEST_NOT_MATERIALIZED'));
  IF action='UNRESOLVED' THEN
    RAISE EXCEPTION 'V2-09 staged action unresolved' USING ERRCODE='55000';
  END IF;
  document:=jsonb_build_object(
    'schemaVersion','videoforge.v2-09-staged-click-reconciliation-result/v2','stage',stage,
    'action',action,'requestMaterialized',project_id IS NOT NULL,'projectId',project_id,
    'projectRevisionId',revision_id,'generationRequestId',request_id,
    'generationAttemptCount',attempt_count,'terminalGenerationAttemptCount',terminal_attempt_count,
    'providerAssignmentCount',assignment_count,'providerSentOrUnknownCount',sent_count,
    'generationRequestState',request.state,'runtimeStage',runtime.stage,
    'pairPhase',pair_phase,
    'activeLeaseCount',active_lease_count,'releasedLeaseCount',released_lease_count,
    'activeCpuWorkCount',active_cpu_count,'activeUpstreamWork',upstream_work,
    'providerMayHaveCharged',jsonb_array_length(upstream_work)>0 OR assignment_count>0 OR sent_count>0,
    'upstreamReconciliationPending',upstream_reconciliation_pending,
    'upstreamDispatchingCount',upstream_dispatching_count,'upstreamUnknownCount',upstream_unknown_count,
    'providerActiveAttemptCount',provider_active_attempt_count,
    'providerPairIdentified',provider_pair_identified,'cpuCancelPending',cpu_cancel_pending,
    'queueAuditCount',queue_audit_count,'runtimeEventCount',runtime_event_count,
    'cpuEventCount',cpu_event_count,'releaseReason',release_reason,'safeToArchive',safe_to_archive,
    'projectState',CASE WHEN project_id IS NULL THEN NULL ELSE
      (SELECT status FROM public.projects row WHERE row.id=project_id) END,
    'projectArchived',project_archived,'replayed',replayed,'reconciledAt',db_now);
  receipt_hash:='sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(document),'UTF8')),'hex');
  document:=document||jsonb_build_object('receiptSha256',receipt_hash);
  PERFORM set_config('videoforge.account_id',coalesce(previous_account,''),true);
  RETURN document;
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_reconcile_hosted_v209_staged_click(jsonb) FROM PUBLIC;

-- Advance the production activation loaders to the exact current ledger. The V2 loader's prior
-- verifier remains owner-private and performs the immutable activation/deployment checks; this
-- wrapper replaces only its stale ledger snapshot and recomputes the gate hash over the new bytes.

CREATE OR REPLACE FUNCTION public.videoforge_load_hosted_pair_activation_v2(uuid,uuid,uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE snapshot jsonb;
BEGIN
  snapshot:=public.videoforge_load_hosted_pair_activation($1,$2,$3);
  RETURN jsonb_set(snapshot,'{migrationLedger}',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'version',m.version,'sha256',m.sha256) ORDER BY m.version) FROM public.videoforge_schema_migrations m
    WHERE m.version BETWEEN 37 AND 84),'[]'::jsonb));
END;
$$;

ALTER FUNCTION public.videoforge_load_hosted_gpu_activation_v2()
  RENAME TO videoforge_load_hosted_gpu_activation_v2_head0081;
REVOKE ALL ON FUNCTION public.videoforge_load_hosted_gpu_activation_v2_head0081() FROM PUBLIC;

DO $revoke_stale_loader_acl$
DECLARE recipient record;
BEGIN
  FOR recipient IN
    SELECT role.rolname
      FROM pg_proc procedure
      CROSS JOIN LATERAL aclexplode(coalesce(
        procedure.proacl,acldefault('f',procedure.proowner))) privilege
      JOIN pg_roles role ON role.oid=privilege.grantee
     WHERE procedure.oid='public.videoforge_load_hosted_gpu_activation_v2_head0081()'::regprocedure
       AND privilege.privilege_type='EXECUTE' AND privilege.grantee<>procedure.proowner
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.videoforge_load_hosted_gpu_activation_v2_head0081() FROM %I',
      recipient.rolname);
  END LOOP;
END;
$revoke_stale_loader_acl$;

CREATE FUNCTION public.videoforge_load_hosted_gpu_activation_v2() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE snapshot jsonb; ledger jsonb; gate jsonb; verification jsonb; gate_hash text;
BEGIN
  snapshot:=public.videoforge_load_hosted_gpu_activation_v2_head0081();
  SELECT coalesce(jsonb_agg(jsonb_build_object('version',m.version,'sha256',m.sha256)
    ORDER BY m.version),'[]'::jsonb) INTO ledger FROM public.videoforge_schema_migrations m
    WHERE m.version BETWEEN 37 AND 84;
  gate:=jsonb_set(snapshot#>'{verification,gate}','{migrationLedger}',ledger);
  gate_hash:='sha256:'||encode(sha256(convert_to(
    public.videoforge_canonical_jsonb(gate),'UTF8')),'hex');
  verification:=jsonb_set(snapshot->'verification','{gate}',gate);
  verification:=jsonb_set(verification,'{activationSnapshotSha256}',to_jsonb(gate_hash));
  RETURN jsonb_set(snapshot,'{verification}',verification);
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_load_hosted_pair_activation_v2(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_load_hosted_gpu_activation_v2() FROM PUBLIC;

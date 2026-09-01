-- Accept the original Runware result after a context dispatch became UNKNOWN. This is a
-- reconciliation-only capability: it consumes the existing claim and reservation and never creates
-- a task, attempt, outbox row, reservation, or provider dispatch.

CREATE FUNCTION public.videoforge_reconcile_unknown_hosted_voiceover_context(
  supplied jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
#variable_conflict use_variable
DECLARE
  account_id uuid:=(supplied->>'account_id')::uuid;
  workspace_id uuid:=(supplied->>'workspace_id')::uuid;
  user_id uuid:=(supplied->>'user_id')::uuid;
  project_id uuid:=(supplied->>'project_id')::uuid;
  revision_id uuid:=(supplied->>'revision_id')::uuid;
  context_id uuid:=(supplied->>'context_id')::uuid;
  output_asset_id uuid:=(supplied->>'output_asset_id')::uuid;
  transcript_hash text:=supplied->>'transcript_hash';
  request_hash text:=supplied->>'request_hash';
  response_bytes text:=supplied->>'response_bytes';
  response_hash text:=supplied->>'response_hash';
  context_bytes text:=supplied->>'context_bytes';
  context_hash text:=supplied->>'context_hash';
  reported bigint:=(supplied->>'reported_cost_micro_usd')::bigint;
  target public.hosted_voiceover_contexts%ROWTYPE;
  execution_attempt public.attempts%ROWTYPE;
  task public.generation_tasks%ROWTYPE;
  reservation public.cost_events%ROWTYPE;
  now_at timestamptz:=clock_timestamp();
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM account_id
     OR NOT EXISTS (SELECT 1 FROM public.memberships membership
       WHERE membership.account_id=account_id AND membership.workspace_id=workspace_id
         AND membership.user_id=user_id AND membership.status='ACTIVE')
     OR transcript_hash !~ '^sha256:[0-9a-f]{64}$'
     OR request_hash !~ '^sha256:[0-9a-f]{64}$'
     OR response_hash !~ '^sha256:[0-9a-f]{64}$'
     OR context_hash !~ '^sha256:[0-9a-f]{64}$'
     OR response_bytes IS NULL OR context_bytes IS NULL
     OR reported IS NULL THEN
    RAISE EXCEPTION 'hosted voiceover context reconciliation authority is invalid'
      USING ERRCODE='42501';
  END IF;

  SELECT * INTO target FROM public.hosted_voiceover_contexts context
   WHERE context.id=context_id FOR UPDATE;
  IF target.id IS NULL
     OR target.account_id IS DISTINCT FROM account_id
     OR target.workspace_id IS DISTINCT FROM workspace_id
     OR target.project_id IS DISTINCT FROM project_id
     OR target.project_revision_id IS DISTINCT FROM revision_id
     OR target.transcript_hash IS DISTINCT FROM transcript_hash
     OR target.request_hash IS DISTINCT FROM request_hash
     OR reported NOT BETWEEN 0 AND target.reserved_cost_micro_usd
     OR context_hash IS DISTINCT FROM
       'sha256:'||encode(digest(convert_to(context_bytes,'UTF8'),'sha256'),'hex')
     OR response_hash IS DISTINCT FROM
       'sha256:'||encode(digest(convert_to(response_bytes,'UTF8'),'sha256'),'hex')
     OR jsonb_typeof(context_bytes::jsonb)<>'object' THEN
    RAISE EXCEPTION 'hosted voiceover context reconciliation result is invalid'
      USING ERRCODE='23514';
  END IF;

  SELECT * INTO execution_attempt FROM public.attempts attempt
   WHERE attempt.account_id=target.account_id AND attempt.workspace_id=target.workspace_id
     AND attempt.task_id=target.task_id AND attempt.id=target.attempt_id FOR UPDATE;
  SELECT * INTO task FROM public.generation_tasks generation_task
   WHERE generation_task.account_id=target.account_id
     AND generation_task.workspace_id=target.workspace_id
     AND generation_task.id=target.task_id FOR UPDATE;
  SELECT * INTO reservation FROM public.cost_events event
   WHERE event.account_id=target.account_id AND event.workspace_id=target.workspace_id
     AND event.owner_type='PROJECT_REVISION' AND event.owner_id=target.project_revision_id
     AND event.task_id=target.task_id AND event.attempt_id=target.attempt_id
     AND event.sequence=target.reservation_cost_sequence FOR SHARE;

  -- Exact successful replay is read-only and returns the already accepted durable identity.
  IF target.state='SUCCEEDED' THEN
    IF target.provider_may_have_charged OR target.problem_code IS NOT NULL
       OR target.context_hash IS DISTINCT FROM context_hash
       OR target.response_hash IS DISTINCT FROM response_hash
       OR target.context_document IS DISTINCT FROM context_bytes::jsonb
       OR target.reported_cost_micro_usd IS DISTINCT FROM reported
       OR execution_attempt.state<>'SUCCEEDED'
       OR execution_attempt.dispatch_state<>'RECONCILED'
       OR execution_attempt.result_disposition<>'ACCEPTED'
       OR execution_attempt.output_asset_id IS DISTINCT FROM output_asset_id
       OR task.state<>'COMPLETE' OR task.accepted_attempt_id IS DISTINCT FROM target.attempt_id
       OR reservation.id IS NULL OR reservation.event_type<>'RESERVED'
       OR reservation.amount_micro_usd<>target.reserved_cost_micro_usd
       OR NOT EXISTS (SELECT 1 FROM public.assets asset
         WHERE asset.account_id=target.account_id AND asset.workspace_id=target.workspace_id
           AND asset.id=output_asset_id AND asset.project_id=target.project_id
           AND asset.project_revision_id=target.project_revision_id
           AND asset.kind='CANONICAL_DOCUMENT' AND asset.state='ACCEPTED'
           AND asset.canonical_contract_name='voiceover-story-context'
           AND asset.canonical_contract_version='v1'
           AND asset.canonical_document_sha256=context_hash)
       OR NOT EXISTS (SELECT 1 FROM public.cost_events event
         WHERE event.account_id=target.account_id AND event.workspace_id=target.workspace_id
           AND event.task_id=target.task_id AND event.attempt_id=target.attempt_id
           AND event.sequence=target.reservation_cost_sequence+1
           AND event.event_type='REPORTED' AND event.amount_micro_usd=reported)
       OR NOT EXISTS (SELECT 1 FROM public.cost_events event
         WHERE event.account_id=target.account_id AND event.workspace_id=target.workspace_id
           AND event.task_id=target.task_id AND event.attempt_id=target.attempt_id
           AND event.sequence=target.reservation_cost_sequence+2
           AND event.event_type='SETTLED' AND event.amount_micro_usd=reported)
       OR (SELECT count(*) FROM public.cost_events event
         WHERE event.account_id=target.account_id AND event.workspace_id=target.workspace_id
           AND event.task_id=target.task_id AND event.attempt_id=target.attempt_id)<>3 THEN
      RAISE EXCEPTION 'hosted voiceover context reconciliation replay drifted'
        USING ERRCODE='23514';
    END IF;
    RETURN jsonb_build_object('reconciled',false,'replayed',true,'context_id',target.id,
      'task_id',target.task_id,'attempt_id',target.attempt_id,'output_asset_id',output_asset_id);
  END IF;

  IF target.state<>'UNKNOWN' OR NOT target.provider_may_have_charged
     OR target.problem_code IS NULL OR target.finished_at IS NULL
     OR execution_attempt.id IS NULL OR execution_attempt.state<>'UNKNOWN'
     OR execution_attempt.dispatch_state<>'AMBIGUOUS'
     OR execution_attempt.result_disposition<>'PENDING'
     OR execution_attempt.output_asset_id IS NOT NULL OR execution_attempt.finished_at IS NOT NULL
     OR task.id IS NULL OR task.state<>'FAILED' OR task.accepted_attempt_id IS NOT NULL
     OR reservation.id IS NULL OR reservation.event_type<>'RESERVED'
     OR reservation.amount_micro_usd<>target.reserved_cost_micro_usd
     OR EXISTS (SELECT 1 FROM public.cost_events event
       WHERE event.account_id=target.account_id AND event.workspace_id=target.workspace_id
         AND event.owner_type='PROJECT_REVISION' AND event.owner_id=target.project_revision_id
         AND event.sequence IN (
           target.reservation_cost_sequence+1,
           target.reservation_cost_sequence+2
         )) THEN
    RAISE EXCEPTION 'hosted voiceover context is not reconcilable'
      USING ERRCODE='23514';
  END IF;

  INSERT INTO public.assets(id,account_id,workspace_id,project_id,project_revision_id,kind,state,
    canonical_contract_name,canonical_contract_version,canonical_document_sha256,content_type,
    byte_size,metadata,verified_at,created_at)
  VALUES(output_asset_id,target.account_id,target.workspace_id,target.project_id,
    target.project_revision_id,'CANONICAL_DOCUMENT','ACCEPTED','voiceover-story-context','v1',
    context_hash,'application/json',octet_length(context_bytes),
    jsonb_build_object('source','hosted-voiceover-context-reconciliation',
      'original_request_hash',target.request_hash),now_at,now_at);
  INSERT INTO public.cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,attempt_id,
    sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at,created_at)
  VALUES(gen_random_uuid(),target.account_id,target.workspace_id,'PROJECT_REVISION',
    target.project_revision_id,target.task_id,target.attempt_id,
    target.reservation_cost_sequence+1,'REPORTED',reported,
    'hosted-voiceover-context:'||target.project_revision_id||':reported',
    jsonb_build_object('context_hash',context_hash,'reconciled',true),now_at,now_at),
    (gen_random_uuid(),target.account_id,target.workspace_id,'PROJECT_REVISION',
    target.project_revision_id,target.task_id,target.attempt_id,
    target.reservation_cost_sequence+2,'SETTLED',reported,
    'hosted-voiceover-context:'||target.project_revision_id||':settled',
    jsonb_build_object('context_hash',context_hash,'reconciled',true),now_at,now_at);
  UPDATE public.attempts SET state='SUCCEEDED',dispatch_state='RECONCILED',
    output_asset_id=output_asset_id,result_disposition='ACCEPTED',problem_code=NULL,
    finished_at=now_at WHERE workspace_id=target.workspace_id
    AND task_id=target.task_id AND id=target.attempt_id;
  UPDATE public.generation_tasks SET state='COMPLETE',accepted_attempt_id=target.attempt_id,
    version=version+1,finished_at=now_at,updated_at=now_at
    WHERE workspace_id=target.workspace_id AND id=target.task_id;
  UPDATE public.hosted_voiceover_contexts SET state='SUCCEEDED',
    context_document=context_bytes::jsonb,context_hash=context_hash,response_hash=response_hash,
    reported_cost_micro_usd=reported,problem_code=NULL,provider_may_have_charged=false,
    finished_at=now_at WHERE id=target.id;

  RETURN jsonb_build_object('reconciled',true,'replayed',false,'context_id',target.id,
    'task_id',target.task_id,'attempt_id',target.attempt_id,'output_asset_id',output_asset_id);
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_reconcile_unknown_hosted_voiceover_context(jsonb)
FROM PUBLIC;

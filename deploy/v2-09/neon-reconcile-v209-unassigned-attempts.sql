\set ON_ERROR_STOP on

-- Owner-only atomic recovery for one exact V2-09 pair that provably never crossed /run.
-- Existing RESERVATION events remain immutable; sequence 2 closes each ledger at USD 0.
BEGIN;
CREATE TEMP TABLE pg_temp.v209_unassigned_input ON COMMIT DROP AS
WITH supplied AS (
  SELECT convert_from(decode(:'payload_base64','base64'),'UTF8')::jsonb value
)
SELECT (value->>'accountId')::uuid account_id,(value->>'workspaceId')::uuid workspace_id,
  (value->>'issuedAt')::timestamptz issued_at,
  CASE WHEN value->>'generationRequestId' IS NULL THEN NULL
    ELSE (value->>'generationRequestId')::uuid END generation_request_id,
  ARRAY(SELECT jsonb_array_elements_text(value->'deploymentIds') ORDER BY 1)::uuid[] deployment_ids
FROM supplied WHERE jsonb_typeof(value)='object'
  AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(value) key)
    = ARRAY['accountId','deploymentIds','generationRequestId','issuedAt','schemaVersion','workspaceId']::text[]
  AND value->>'schemaVersion'='videoforge.v2-09-reconcile-unassigned-attempts/v1'
  AND jsonb_typeof(value->'deploymentIds')='array' AND jsonb_array_length(value->'deploymentIds')=2;
CREATE TEMP TABLE pg_temp.v209_unassigned_result(document jsonb NOT NULL) ON COMMIT DROP;

DO $cleanup$
DECLARE
  i pg_temp.v209_unassigned_input%ROWTYPE; request_id uuid; target_runtime_id uuid;
  candidate_count integer; request_count integer; active_count integer; released_count integer;
  fresh_count integer; replay_count integer; changed_count integer;
  db_now timestamptz:=transaction_timestamp();
BEGIN
  SELECT * INTO i FROM pg_temp.v209_unassigned_input;
  IF NOT FOUND OR (SELECT count(*) FROM pg_temp.v209_unassigned_input)<>1
     OR i.account_id IS NULL OR i.workspace_id IS NULL OR i.issued_at IS NULL OR i.issued_at>db_now
     OR cardinality(i.deployment_ids)<>2 OR i.deployment_ids[1]=i.deployment_ids[2] THEN
    RAISE EXCEPTION 'V2-09 unassigned cleanup input invalid' USING ERRCODE='23514';
  END IF;
  SELECT count(*),count(DISTINCT a.generation_request_id),
    (array_agg(DISTINCT a.generation_request_id))[1]
    INTO candidate_count,request_count,request_id FROM public.serverless_attempts a
   WHERE a.account_id=i.account_id AND a.workspace_id=i.workspace_id
     AND a.deployment_id=ANY(i.deployment_ids) AND a.created_at>=i.issued_at
     AND (i.generation_request_id IS NULL OR a.generation_request_id=i.generation_request_id);
  IF candidate_count=0 THEN
    INSERT INTO pg_temp.v209_unassigned_result VALUES(jsonb_build_object(
      'schemaVersion','videoforge.v2-09-unassigned-reconciliation-result/v2',
      'reconciledPairCount',0,'cancelledAttemptCount',0,'deadLetterOutboxCount',0,
      'failedTaskCount',0,'failedLaneCount',0,'releasedLeaseCount',0,'activeLeaseCount',0,
      'providerAssignmentCount',0,'sentOrUnknownOutboxCount',0,
      'zeroCostSettlementCount',0,'nonzeroCostSettlementCount',0,
      'generationRequestState',NULL,'runtimeStage',NULL,'pairPhase',NULL,'reconciledAt',db_now));
    RETURN;
  END IF;
  IF candidate_count<>2 OR request_count<>1
     OR (i.generation_request_id IS NOT NULL AND request_id<>i.generation_request_id) THEN
    RAISE EXCEPTION 'V2-09 cleanup requires one exact two-lane generation pair' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(request_id::text,43));
  PERFORM set_config('videoforge.account_id',i.account_id::text,true);
  PERFORM 1 FROM public.generation_requests r WHERE r.account_id=i.account_id
    AND r.workspace_id=i.workspace_id AND r.id=request_id FOR UPDATE;
  SELECT r.id INTO target_runtime_id FROM public.video_runtime_states r WHERE r.account_id=i.account_id
    AND r.workspace_id=i.workspace_id AND r.generation_request_id=request_id FOR UPDATE;
  PERFORM 1 FROM public.hosted_pair_runtime_states p WHERE p.account_id=i.account_id
    AND p.workspace_id=i.workspace_id AND p.generation_request_id=request_id FOR UPDATE;
  PERFORM 1 FROM public.provider_workload_leases l WHERE l.account_id=i.account_id
    AND l.workspace_id=i.workspace_id AND l.generation_request_id=request_id FOR UPDATE;
  PERFORM 1 FROM public.serverless_attempts a WHERE a.generation_request_id=request_id FOR UPDATE;
  PERFORM 1 FROM public.serverless_dispatch_outbox o JOIN public.serverless_attempts a ON a.id=o.attempt_id
    WHERE a.generation_request_id=request_id FOR UPDATE OF o;
  PERFORM 1 FROM public.serverless_cost_ledgers l JOIN public.serverless_attempts a ON a.id=l.attempt_id
    WHERE a.generation_request_id=request_id FOR UPDATE OF l;
  PERFORM 1 FROM public.video_runtime_lane_states l WHERE l.runtime_id=target_runtime_id FOR UPDATE;
  PERFORM 1 FROM public.generation_tasks t JOIN public.serverless_attempts a ON a.task_id=t.id
    WHERE a.generation_request_id=request_id FOR UPDATE OF t;

  SELECT count(*) FILTER(WHERE state IN ('PLANNED','OUTBOXED')),
    count(*) FILTER(WHERE state='CANCELLED') INTO fresh_count,replay_count
    FROM public.serverless_attempts WHERE generation_request_id=request_id;
  SELECT count(*) FILTER(WHERE state='ACTIVE'),count(*) FILTER(WHERE state='RELEASED'
    AND release_reason='V209_UNASSIGNED_NO_SEND_FAILURE') INTO active_count,released_count
    FROM public.provider_workload_leases WHERE generation_request_id=request_id;
  IF target_runtime_id IS NULL
     OR (SELECT array_agg(lane ORDER BY lane) FROM public.serverless_attempts
       WHERE generation_request_id=request_id) IS DISTINCT FROM ARRAY['mage_image','soulx_avatar']::text[]
     OR (SELECT array_agg(deployment_id ORDER BY deployment_id) FROM public.serverless_attempts
       WHERE generation_request_id=request_id) IS DISTINCT FROM i.deployment_ids
     OR (SELECT count(DISTINCT task_id) FROM public.serverless_attempts
       WHERE generation_request_id=request_id)<>2
     OR (SELECT count(*) FROM public.video_runtime_lane_states l WHERE l.runtime_id=target_runtime_id)<>2
     OR (SELECT array_agg(l.lane ORDER BY l.lane) FROM public.video_runtime_lane_states l
       WHERE l.runtime_id=target_runtime_id)
       IS DISTINCT FROM ARRAY['mage_image','soulx_avatar']::text[]
     OR (SELECT count(*) FROM public.serverless_cost_ledgers l JOIN public.serverless_attempts a
       ON a.id=l.attempt_id WHERE a.generation_request_id=request_id)<>2
     OR EXISTS(SELECT 1 FROM public.serverless_provider_assignments p JOIN public.serverless_attempts a
       ON a.id=p.attempt_id WHERE a.generation_request_id=request_id)
     OR EXISTS(SELECT 1 FROM public.serverless_dispatch_outbox o JOIN public.serverless_attempts a
       ON a.id=o.attempt_id WHERE a.generation_request_id=request_id
       AND (o.send_attempt_count<>0 OR o.state IN ('SENT','DISPATCH_ACK_UNKNOWN','ASSIGNED')))
     OR EXISTS(SELECT 1 FROM public.serverless_cost_events e JOIN public.serverless_attempts a
       ON a.id=e.attempt_id WHERE a.generation_request_id=request_id AND NOT
       ((e.sequence=1 AND e.kind='RESERVATION') OR
        (e.sequence=2 AND e.kind='SETTLED' AND e.amount_usd=0)))
     OR EXISTS(SELECT 1 FROM public.serverless_cost_ledgers l JOIN public.serverless_attempts a
       ON a.id=l.attempt_id WHERE a.generation_request_id=request_id AND
       (l.reported_usd<>0 OR l.possible_duplicate_usd<>0 OR l.settled_usd<>0 OR l.refunded_usd<>0)) THEN
    RAISE EXCEPTION 'V2-09 unassigned pair ownership or no-send proof invalid' USING ERRCODE='23514';
  END IF;

  IF fresh_count=2 AND replay_count=0 THEN
    IF active_count<>1 OR released_count<>0
       OR (SELECT state FROM public.generation_requests WHERE id=request_id)
          NOT IN ('ADMITTED','ACTIVE','CANCELLING')
       OR (SELECT stage FROM public.video_runtime_states WHERE id=target_runtime_id)
          IN ('COMPLETE','FAILED','CANCELED')
       OR EXISTS(SELECT 1 FROM public.hosted_pair_runtime_states WHERE generation_request_id=request_id)
       OR EXISTS(SELECT 1 FROM public.serverless_cost_events e JOIN public.serverless_attempts a
          ON a.id=e.attempt_id WHERE a.generation_request_id=request_id AND e.kind='SETTLED') THEN
      RAISE EXCEPTION 'V2-09 unassigned pair is not cleanup eligible' USING ERRCODE='55000';
    END IF;
    UPDATE public.serverless_dispatch_outbox o SET state='DEAD_LETTER',lease_id=NULL,
      lease_holder_sha256=NULL,leased_at=NULL,lease_expires_at=NULL,version=o.version+1,updated_at=db_now
      WHERE o.attempt_id IN (SELECT id FROM public.serverless_attempts WHERE generation_request_id=request_id)
        AND o.state NOT IN ('TERMINAL','DEAD_LETTER');
    UPDATE public.serverless_attempts SET state='CANCELLED',terminal_at=db_now,
      version=version+1,updated_at=db_now WHERE generation_request_id=request_id
      AND state IN ('PLANNED','OUTBOXED');
    UPDATE public.generation_tasks t SET state='FAILED',finished_at=db_now,
      version=t.version+1,updated_at=db_now WHERE t.id IN
      (SELECT task_id FROM public.serverless_attempts WHERE generation_request_id=request_id)
      AND t.state NOT IN ('FAILED','CANCELLED','COMPLETE');
    UPDATE public.video_runtime_lane_states SET state='FAILED',current_attempt_id=NULL,
      version=version+1,updated_at=db_now
      WHERE video_runtime_lane_states.runtime_id=target_runtime_id
      AND state NOT IN ('SUCCEEDED','FAILED','CANCELED');
    UPDATE public.video_runtime_states SET stage='FAILED',terminal_reason='LANE_PERMANENT_FAILURE',
      terminal_at=db_now,version=version+1,updated_at=db_now WHERE id=target_runtime_id;
    UPDATE public.generation_requests SET state='FAILED',terminal_at=db_now,
      version=version+1,updated_at=db_now WHERE id=request_id;
    UPDATE public.provider_workload_leases SET state='RELEASED',released_at=db_now,
      release_reason='V209_UNASSIGNED_NO_SEND_FAILURE',version=version+1,heartbeat_at=db_now,
      expires_at=greatest(expires_at,db_now+interval '1 second') WHERE generation_request_id=request_id
      AND state='ACTIVE';
    GET DIAGNOSTICS changed_count=ROW_COUNT;
    IF changed_count<>1 THEN RAISE EXCEPTION 'V2-09 cleanup exact lease release failed' USING ERRCODE='55000'; END IF;
    INSERT INTO public.hosted_pair_runtime_states(generation_request_id,account_id,workspace_id,
      phase,created_at,updated_at) VALUES(request_id,i.account_id,i.workspace_id,'SETTLED',db_now,db_now);
    INSERT INTO public.serverless_cost_events(id,account_id,workspace_id,project_revision_id,attempt_id,
      ledger_id,sequence,kind,amount_usd,rate_source,rate_checked_at,confidence,recorded_at)
    SELECT md5('v209-unassigned-zero-settlement:'||a.id::text)::uuid,a.account_id,a.workspace_id,
      a.project_revision_id,a.id,l.id,2,'SETTLED',0,'V2-09 unassigned no-send reconciliation',
      db_now,'MEASURED',db_now FROM public.serverless_attempts a
      JOIN public.serverless_cost_ledgers l ON l.attempt_id=a.id WHERE a.generation_request_id=request_id;
    UPDATE public.serverless_cost_ledgers l SET settled_usd=0,version=l.version+1,updated_at=db_now
      WHERE l.attempt_id IN (SELECT id FROM public.serverless_attempts WHERE generation_request_id=request_id);
  ELSIF NOT (fresh_count=0 AND replay_count=2 AND active_count=0 AND released_count=1
    AND (SELECT state FROM public.generation_requests WHERE id=request_id)='FAILED'
    AND (SELECT stage FROM public.video_runtime_states WHERE id=target_runtime_id)='FAILED'
    AND (SELECT phase FROM public.hosted_pair_runtime_states WHERE generation_request_id=request_id)='SETTLED') THEN
    RAISE EXCEPTION 'V2-09 unassigned reconciliation state is partial or ambiguous' USING ERRCODE='55000';
  END IF;

  INSERT INTO pg_temp.v209_unassigned_result
  SELECT jsonb_build_object('schemaVersion','videoforge.v2-09-unassigned-reconciliation-result/v2',
    'reconciledPairCount',1,
    'cancelledAttemptCount',(SELECT count(*) FROM public.serverless_attempts
      WHERE generation_request_id=request_id AND state='CANCELLED'),
    'deadLetterOutboxCount',(SELECT count(*) FROM public.serverless_dispatch_outbox o
      JOIN public.serverless_attempts a ON a.id=o.attempt_id WHERE a.generation_request_id=request_id
      AND o.state='DEAD_LETTER'),
    'failedTaskCount',(SELECT count(*) FROM public.generation_tasks t JOIN public.serverless_attempts a
      ON a.task_id=t.id WHERE a.generation_request_id=request_id AND t.state='FAILED'),
    'failedLaneCount',(SELECT count(*) FROM public.video_runtime_lane_states l
      WHERE l.runtime_id=target_runtime_id AND l.state='FAILED'),
    'releasedLeaseCount',(SELECT count(*) FROM public.provider_workload_leases
      WHERE generation_request_id=request_id AND state='RELEASED'
        AND release_reason='V209_UNASSIGNED_NO_SEND_FAILURE'),
    'activeLeaseCount',(SELECT count(*) FROM public.provider_workload_leases
      WHERE generation_request_id=request_id AND state='ACTIVE'),
    'providerAssignmentCount',(SELECT count(*) FROM public.serverless_provider_assignments p
      JOIN public.serverless_attempts a ON a.id=p.attempt_id WHERE a.generation_request_id=request_id),
    'sentOrUnknownOutboxCount',(SELECT count(*) FROM public.serverless_dispatch_outbox o
      JOIN public.serverless_attempts a ON a.id=o.attempt_id WHERE a.generation_request_id=request_id
      AND (o.send_attempt_count<>0 OR o.state IN ('SENT','DISPATCH_ACK_UNKNOWN','ASSIGNED'))),
    'zeroCostSettlementCount',(SELECT count(*) FROM public.serverless_cost_events e
      JOIN public.serverless_attempts a ON a.id=e.attempt_id WHERE a.generation_request_id=request_id
      AND e.kind='SETTLED' AND e.amount_usd=0),
    'nonzeroCostSettlementCount',(SELECT count(*) FROM public.serverless_cost_events e
      JOIN public.serverless_attempts a ON a.id=e.attempt_id WHERE a.generation_request_id=request_id
      AND e.kind='SETTLED' AND e.amount_usd<>0),
    'generationRequestState',(SELECT state FROM public.generation_requests WHERE id=request_id),
    'runtimeStage',(SELECT stage FROM public.video_runtime_states WHERE id=target_runtime_id),
    'pairPhase',(SELECT phase FROM public.hosted_pair_runtime_states
      WHERE generation_request_id=request_id),'reconciledAt',db_now)
  WHERE (SELECT count(*) FROM public.serverless_attempts WHERE generation_request_id=request_id
      AND state='CANCELLED')=2
    AND (SELECT count(*) FROM public.video_runtime_lane_states l
      WHERE l.runtime_id=target_runtime_id AND l.state='FAILED')=2
    AND NOT EXISTS(SELECT 1 FROM public.provider_workload_leases WHERE generation_request_id=request_id
      AND state='ACTIVE')
    AND (SELECT count(*) FROM public.provider_workload_leases WHERE generation_request_id=request_id
      AND state='RELEASED' AND release_reason='V209_UNASSIGNED_NO_SEND_FAILURE')=1
    AND (SELECT count(DISTINCT a.task_id) FROM public.serverless_attempts a
      JOIN public.generation_tasks t ON t.id=a.task_id WHERE a.generation_request_id=request_id
      AND t.state IN ('FAILED','CANCELLED','COMPLETE'))=2
    AND NOT EXISTS(SELECT 1 FROM public.serverless_dispatch_outbox o
      JOIN public.serverless_attempts a ON a.id=o.attempt_id WHERE a.generation_request_id=request_id
      AND o.state NOT IN ('TERMINAL','DEAD_LETTER'))
    AND (SELECT count(*) FROM public.serverless_cost_events e JOIN public.serverless_attempts a
      ON a.id=e.attempt_id WHERE a.generation_request_id=request_id AND e.kind='SETTLED'
      AND e.amount_usd=0)=2
    AND NOT EXISTS(SELECT 1 FROM public.serverless_cost_events e JOIN public.serverless_attempts a
      ON a.id=e.attempt_id WHERE a.generation_request_id=request_id AND e.kind='SETTLED'
      AND e.amount_usd<>0);
  IF NOT FOUND THEN RAISE EXCEPTION 'V2-09 unassigned terminal postcondition failed' USING ERRCODE='55000'; END IF;
END
$cleanup$;
SELECT document FROM pg_temp.v209_unassigned_result;
COMMIT;

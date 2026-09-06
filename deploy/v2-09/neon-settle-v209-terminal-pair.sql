\set ON_ERROR_STOP on

-- Owner-only terminal settlement for an exact V2-09 pair with one or two assigned provider jobs.
-- A missing lane fact is accepted only when PostgreSQL proves that lane was never sent.  This is
-- failure cleanup: at least one lane must be non-COMPLETED or never sent.
BEGIN;
CREATE TEMP TABLE pg_temp.v209_terminal_input ON COMMIT DROP AS
SELECT convert_from(decode(:'payload_base64','base64'),'UTF8')::jsonb document;
CREATE TEMP TABLE pg_temp.v209_terminal_result(document jsonb NOT NULL) ON COMMIT DROP;
DO $settle$
#variable_conflict use_variable
DECLARE
  supplied jsonb; facts jsonb; zeros jsonb; guard jsonb; fact jsonb; zero_fact jsonb; attempt record;
  account_id uuid; workspace_id uuid; request_id uuid; target_runtime_id uuid;
  db_now timestamptz:=transaction_timestamp(); assignment_count integer; fact_count integer;
  active_count integer; changed_count integer; terminal_count integer:=0; zero_count integer:=0;
  total_cost numeric:=0; exact_cost numeric:=0; conservative_liability numeric:=0;
  provider_state text; provider_job_id text; already_settled boolean:=false;
  settled_cost numeric; final_billing bigint; admission public.hosted_v209_short_admissions%ROWTYPE;
  billing_observed_at timestamptz; execution_time_ms bigint; sealed_rate_source text;
  sealed_rate_checked_at timestamptz; cost_basis text; evidence_rate_source text;
  evidence_confidence text;
BEGIN
  SELECT document INTO supplied FROM pg_temp.v209_terminal_input;
  IF jsonb_typeof(supplied)<>'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['accountId','costGuard','generationRequestId','schemaVersion',
         'terminalFacts','workspaceId','zeroWorkerFacts']::text[]
     OR supplied->>'schemaVersion'<>'videoforge.v2-09-terminal-pair-settlement/v1'
     OR jsonb_typeof(supplied->'terminalFacts')<>'array'
     OR jsonb_array_length(supplied->'terminalFacts') NOT BETWEEN 1 AND 2
     OR jsonb_typeof(supplied->'zeroWorkerFacts')<>'array'
     OR jsonb_array_length(supplied->'zeroWorkerFacts')<>2
     OR jsonb_typeof(supplied->'costGuard')<>'object' THEN
    RAISE EXCEPTION 'V2-09 terminal settlement input invalid' USING ERRCODE='23514';
  END IF;
  account_id:=(supplied->>'accountId')::uuid; workspace_id:=(supplied->>'workspaceId')::uuid;
  request_id:=(supplied->>'generationRequestId')::uuid; facts:=supplied->'terminalFacts';
  zeros:=supplied->'zeroWorkerFacts'; guard:=supplied->'costGuard';
  PERFORM pg_advisory_xact_lock(hashtextextended(request_id::text,43));
  PERFORM set_config('videoforge.account_id',account_id::text,true);
  PERFORM 1 FROM public.generation_requests r WHERE r.account_id=account_id
    AND r.workspace_id=workspace_id AND r.id=request_id FOR UPDATE;
  SELECT id INTO target_runtime_id FROM public.video_runtime_states r WHERE r.account_id=account_id
    AND r.workspace_id=workspace_id AND r.generation_request_id=request_id FOR UPDATE;
  PERFORM 1 FROM public.hosted_pair_runtime_states p WHERE p.account_id=account_id
    AND p.workspace_id=workspace_id AND p.generation_request_id=request_id FOR UPDATE;
  PERFORM 1 FROM public.provider_workload_leases l WHERE l.account_id=account_id
    AND l.workspace_id=workspace_id AND l.generation_request_id=request_id FOR UPDATE;
  PERFORM 1 FROM public.serverless_attempts a WHERE a.account_id=account_id
    AND a.workspace_id=workspace_id AND a.generation_request_id=request_id FOR UPDATE;
  PERFORM 1 FROM public.serverless_dispatch_outbox o JOIN public.serverless_attempts a ON a.id=o.attempt_id
    WHERE a.generation_request_id=request_id FOR UPDATE OF o;
  PERFORM 1 FROM public.serverless_cost_ledgers l JOIN public.serverless_attempts a ON a.id=l.attempt_id
    WHERE a.generation_request_id=request_id FOR UPDATE OF l;
  PERFORM 1 FROM public.video_runtime_lane_states l WHERE l.runtime_id=target_runtime_id FOR UPDATE;
  SELECT count(*) INTO assignment_count FROM public.serverless_provider_assignments p
    JOIN public.serverless_attempts a ON a.id=p.attempt_id
    WHERE a.generation_request_id=request_id AND p.is_current;
  fact_count:=jsonb_array_length(facts);
  SELECT * INTO admission FROM public.hosted_v209_short_admissions a WHERE a.account_id=account_id
    AND a.workspace_id=workspace_id AND a.generation_request_id=request_id FOR SHARE;
  final_billing:=(guard->>'finalCumulativeEndpointBillingMicroUsd')::bigint;
  billing_observed_at:=(guard->>'providerObservedAt')::timestamptz;
  SELECT count(*) INTO active_count FROM public.provider_workload_leases
    WHERE generation_request_id=request_id AND state='ACTIVE';
  already_settled:=active_count=0
    AND (SELECT state FROM public.generation_requests WHERE id=request_id)='FAILED'
    AND (SELECT stage FROM public.video_runtime_states WHERE id=target_runtime_id)='FAILED'
    AND (SELECT phase FROM public.hosted_pair_runtime_states WHERE generation_request_id=request_id)='SETTLED';
  IF target_runtime_id IS NULL OR assignment_count<>fact_count
     OR (SELECT count(*) FROM public.serverless_attempts WHERE generation_request_id=request_id)<>2
     OR (SELECT array_agg(lane ORDER BY lane) FROM public.serverless_attempts
       WHERE generation_request_id=request_id) IS DISTINCT FROM ARRAY['mage_image','soulx_avatar']::text[]
     OR (SELECT count(*) FROM public.serverless_cost_ledgers l JOIN public.serverless_attempts a
       ON a.id=l.attempt_id WHERE a.generation_request_id=request_id)<>2
     OR (SELECT count(*) FROM public.serverless_provider_assignments p
       JOIN public.serverless_attempts a ON a.id=p.attempt_id
       WHERE a.generation_request_id=request_id)<>fact_count
     OR active_count<>(CASE WHEN already_settled THEN 0 ELSE 1 END)
     OR admission.generation_request_id IS NULL
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(guard) key)
       IS DISTINCT FROM ARRAY['finalCumulativeEndpointBillingMicroUsd','providerObservedAt',
         'schemaVersion']::text[]
     OR guard->>'schemaVersion'<>'videoforge-v2-09-settlement-cost-guard/v1'
     OR billing_observed_at>db_now
     OR (NOT already_settled AND billing_observed_at<db_now-interval '5 minutes')
     OR final_billing<admission.billing_baseline_micro_usd OR final_billing>17500000
     OR (SELECT count(DISTINCT value->>'lane') FROM jsonb_array_elements(facts))<>fact_count
     OR (SELECT count(DISTINCT task_id) FROM public.serverless_attempts
       WHERE generation_request_id=request_id)<>2
     OR (SELECT array_agg(lane ORDER BY lane) FROM public.video_runtime_lane_states
       WHERE runtime_id=target_runtime_id) IS DISTINCT FROM ARRAY['mage_image','soulx_avatar']::text[]
     OR (SELECT array_agg(value->>'lane' ORDER BY value->>'lane') FROM jsonb_array_elements(zeros))
       IS DISTINCT FROM ARRAY['mage_image','soulx_avatar']::text[] THEN
    RAISE EXCEPTION 'V2-09 terminal pair ownership or cost guard invalid' USING ERRCODE='23514';
  END IF;

  FOR attempt IN SELECT a.*,o.state outbox_state,o.send_attempt_count,l.id ledger_id,l.ceiling_usd,
      l.reported_usd,l.settled_usd,p.rate_source sealed_rate_source,
      p.rate_checked_at sealed_rate_checked_at
    FROM public.serverless_attempts a LEFT JOIN public.serverless_dispatch_outbox o ON o.attempt_id=a.id
    JOIN public.serverless_cost_ledgers l ON l.attempt_id=a.id
    LEFT JOIN public.serverless_predispatch_authorities p ON p.attempt_id=a.id
    WHERE a.generation_request_id=request_id ORDER BY a.lane LOOP
    execution_time_ms:=NULL; cost_basis:=NULL; evidence_rate_source:=NULL;
    evidence_confidence:=NULL;
    SELECT value INTO fact FROM jsonb_array_elements(facts) value WHERE value->>'lane'=attempt.lane;
    IF fact IS NULL THEN
      IF EXISTS(SELECT 1 FROM public.serverless_provider_assignments p WHERE p.attempt_id=attempt.id)
         OR (NOT already_settled AND attempt.state NOT IN ('PLANNED','OUTBOXED'))
         OR (already_settled AND attempt.state NOT IN ('PERMANENT_FAILED','CANCELLED'))
         OR coalesce(attempt.send_attempt_count,0)<>0
         OR (NOT already_settled AND attempt.outbox_state IS NOT NULL
           AND attempt.outbox_state NOT IN ('READY_TO_DISPATCH','LEASED'))
         OR (already_settled AND attempt.outbox_state IS NOT NULL
           AND attempt.outbox_state<>'DEAD_LETTER') THEN
        RAISE EXCEPTION 'V2-09 missing lane is not proven never-sent' USING ERRCODE='23514';
      END IF;
      provider_state:='ABSENT'; provider_job_id:=NULL; settled_cost:=0; zero_count:=zero_count+1;
    ELSE
      IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(fact) key)
          IS DISTINCT FROM ARRAY['costBasis','executionTimeMs','lane','observedAt','proofSha256',
            'providerJobId','providerState','rateCheckedAt','rateSource','settledCostUsd']::text[]
         OR jsonb_typeof(fact->'costBasis')<>'string'
         OR fact->>'costBasis' NOT IN ('exact_execution','conservative_reservation')
         OR jsonb_typeof(fact->'settledCostUsd')<>'number'
         OR (fact->>'costBasis'='exact_execution'
           AND jsonb_typeof(fact->'executionTimeMs')<>'number')
         OR (fact->>'costBasis'='conservative_reservation'
           AND fact->'executionTimeMs'<>'null'::jsonb)
         OR fact->>'providerState' NOT IN ('COMPLETED','FAILED','CANCELLED','TIMED_OUT')
         OR (fact->>'observedAt')::timestamptz>db_now
         OR (NOT already_settled AND (fact->>'observedAt')::timestamptz<db_now-interval '5 minutes')
         OR billing_observed_at<(fact->>'observedAt')::timestamptz
         OR (fact->>'rateCheckedAt')::timestamptz>db_now
         OR fact->>'rateSource' IS DISTINCT FROM attempt.sealed_rate_source
         OR attempt.sealed_rate_source<>'V2-09_APPROVED_MAX_USD_1.116_GPU_HOUR'
         OR (fact->>'rateCheckedAt')::timestamptz IS DISTINCT FROM attempt.sealed_rate_checked_at
         OR fact->>'proofSha256' !~ '^sha256:[0-9a-f]{64}$'
         OR fact->>'proofSha256'<>'sha256:'||encode(sha256(convert_to(
           public.videoforge_canonical_jsonb(fact-'proofSha256'),'UTF8')),'hex')
         OR (NOT already_settled AND attempt.outbox_state<>'ASSIGNED')
         OR (already_settled AND attempt.outbox_state<>'TERMINAL')
         OR attempt.send_attempt_count<>1
         OR NOT EXISTS(SELECT 1 FROM public.serverless_provider_assignments p
            WHERE p.attempt_id=attempt.id AND p.is_current
              AND p.provider_job_id=fact->>'providerJobId') THEN
        RAISE EXCEPTION 'V2-09 assigned terminal fact binding invalid' USING ERRCODE='23514';
      END IF;
      provider_state:=fact->>'providerState'; provider_job_id:=fact->>'providerJobId';
      settled_cost:=(fact->>'settledCostUsd')::numeric;
      cost_basis:=fact->>'costBasis';
      execution_time_ms:=CASE WHEN cost_basis='exact_execution'
        THEN (fact->>'executionTimeMs')::bigint ELSE NULL END;
      sealed_rate_source:=attempt.sealed_rate_source;
      sealed_rate_checked_at:=attempt.sealed_rate_checked_at;
      IF settled_cost IS NULL OR settled_cost<0 OR settled_cost>attempt.ceiling_usd
         OR (cost_basis='exact_execution' AND (execution_time_ms IS NULL
           OR (fact->>'executionTimeMs')::numeric<>trunc((fact->>'executionTimeMs')::numeric)
           OR execution_time_ms<0
           OR settled_cost<>ceil(execution_time_ms::numeric*1.116/3600000*1000000)/1000000
           OR (settled_cost=0 AND execution_time_ms<>0)))
         OR (cost_basis='conservative_reservation'
           AND (execution_time_ms IS NOT NULL OR settled_cost<>attempt.ceiling_usd
             OR settled_cost=0)) THEN
        RAISE EXCEPTION 'V2-09 assigned terminal cost invalid' USING ERRCODE='22003';
      END IF;
      evidence_rate_source:=sealed_rate_source||';costBasis='||cost_basis||
        ';executionTimeMs='||coalesce(execution_time_ms::text,'null');
      evidence_confidence:=CASE cost_basis WHEN 'exact_execution'
        THEN 'PROVIDER_REPORTED' ELSE 'ESTIMATED' END;
      IF EXISTS(SELECT 1 FROM public.hosted_pair_cleanup_observations c
        WHERE c.attempt_id=attempt.id AND (c.account_id<>account_id OR c.workspace_id<>workspace_id
          OR c.generation_request_id<>request_id OR c.lane<>attempt.lane
          OR c.deployment_id<>attempt.deployment_id
          OR c.dispatch_token_sha256<>attempt.dispatch_token_sha256
          OR c.provider_job_id IS DISTINCT FROM provider_job_id
          OR c.provider_state<>provider_state OR c.provider_proof_sha256<>fact->>'proofSha256'
          OR c.observed_at<>(fact->>'observedAt')::timestamptz)) THEN
        RAISE EXCEPTION 'V2-09 durable provider evidence drift' USING ERRCODE='23505';
      END IF;
      INSERT INTO public.hosted_pair_cleanup_observations(id,account_id,workspace_id,
        generation_request_id,attempt_id,lane,deployment_id,dispatch_token_sha256,provider_job_id,
        provider_state,provider_proof_sha256,observed_at,created_at)
      VALUES(md5('v209-terminal-cleanup-observation:'||attempt.id::text)::uuid,account_id,workspace_id,
        request_id,attempt.id,attempt.lane,attempt.deployment_id,attempt.dispatch_token_sha256,
        provider_job_id,provider_state,fact->>'proofSha256',(fact->>'observedAt')::timestamptz,db_now)
      ON CONFLICT(attempt_id,provider_proof_sha256) DO NOTHING;
      IF (SELECT count(*) FROM public.hosted_pair_cleanup_observations c
          WHERE c.attempt_id=attempt.id)<>1 OR NOT EXISTS(
        SELECT 1 FROM public.hosted_pair_cleanup_observations c WHERE c.attempt_id=attempt.id
          AND c.provider_job_id=provider_job_id AND c.provider_state=provider_state
          AND c.provider_proof_sha256=fact->>'proofSha256'
          AND c.observed_at=(fact->>'observedAt')::timestamptz) THEN
        RAISE EXCEPTION 'V2-09 durable provider evidence cardinality invalid' USING ERRCODE='23505';
      END IF;
      IF provider_state<>'COMPLETED' THEN terminal_count:=terminal_count+1; END IF;
    END IF;
    total_cost:=total_cost+settled_cost;
    IF cost_basis='exact_execution' THEN exact_cost:=exact_cost+settled_cost;
    ELSIF cost_basis='conservative_reservation' THEN
      conservative_liability:=conservative_liability+settled_cost;
    END IF;
    IF fact IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.serverless_cost_events
      WHERE attempt_id=attempt.id AND kind='PROVIDER_REPORT') THEN
      INSERT INTO public.serverless_cost_events(id,account_id,workspace_id,project_revision_id,attempt_id,
        ledger_id,sequence,kind,amount_usd,rate_source,rate_checked_at,confidence,recorded_at)
      VALUES(md5('v209-terminal-provider-report:'||attempt.id::text)::uuid,account_id,workspace_id,
        attempt.project_revision_id,attempt.id,attempt.ledger_id,
        (SELECT coalesce(max(sequence),0)+1 FROM public.serverless_cost_events
          WHERE attempt_id=attempt.id),'PROVIDER_REPORT',settled_cost,evidence_rate_source,
        sealed_rate_checked_at,evidence_confidence,(fact->>'observedAt')::timestamptz);
      UPDATE public.serverless_cost_ledgers SET reported_usd=settled_cost,version=version+1,
        updated_at=db_now WHERE id=attempt.ledger_id;
    ELSIF fact IS NOT NULL AND ((SELECT count(*) FROM public.serverless_cost_events
      WHERE attempt_id=attempt.id AND kind='PROVIDER_REPORT' AND amount_usd=settled_cost
        AND rate_source=evidence_rate_source AND rate_checked_at=sealed_rate_checked_at
        AND confidence=evidence_confidence)<>1
      OR attempt.reported_usd<>settled_cost) THEN
      RAISE EXCEPTION 'V2-09 provider cost evidence drift' USING ERRCODE='23505';
    END IF;
    IF EXISTS(SELECT 1 FROM public.serverless_cost_events WHERE attempt_id=attempt.id AND kind='SETTLED') THEN
      IF (SELECT count(*) FROM public.serverless_cost_events WHERE attempt_id=attempt.id AND kind='SETTLED'
          AND amount_usd=settled_cost AND rate_source=coalesce(evidence_rate_source,
            'V2-09 never-sent zero settlement'))<>1 OR attempt.settled_usd<>settled_cost THEN
        RAISE EXCEPTION 'V2-09 terminal settlement replay drift' USING ERRCODE='23505';
      END IF;
    ELSE
      INSERT INTO public.serverless_cost_events(id,account_id,workspace_id,project_revision_id,attempt_id,
        ledger_id,sequence,kind,amount_usd,rate_source,rate_checked_at,confidence,recorded_at)
      VALUES(md5('v209-terminal-settlement:'||attempt.id::text)::uuid,account_id,workspace_id,
        attempt.project_revision_id,attempt.id,attempt.ledger_id,
        (SELECT coalesce(max(sequence),0)+1 FROM public.serverless_cost_events
          WHERE attempt_id=attempt.id),'SETTLED',settled_cost,
        coalesce(evidence_rate_source,'V2-09 never-sent zero settlement'),
        coalesce((fact->>'rateCheckedAt')::timestamptz,db_now),
        CASE WHEN fact IS NULL THEN 'MEASURED' ELSE evidence_confidence END,db_now);
      UPDATE public.serverless_cost_ledgers SET settled_usd=settled_cost,version=version+1,
        updated_at=db_now WHERE id=attempt.ledger_id;
    END IF;
  END LOOP;
  IF terminal_count+zero_count<1
     OR round(conservative_liability*1000000)::bigint>admission.phase_cap_micro_usd
     OR round(total_cost*1000000)::bigint>admission.phase_cap_micro_usd
     OR greatest(final_billing-admission.billing_baseline_micro_usd,
       round(total_cost*1000000)::bigint)>admission.phase_cap_micro_usd
     OR final_billing<admission.billing_baseline_micro_usd+round(exact_cost*1000000)::bigint THEN
    RAISE EXCEPTION 'V2-09 failure settlement cap or terminal condition invalid' USING ERRCODE='23514';
  END IF;

  -- The owner bridge supplies source-bound provider inventory facts.  No signing key is created or
  -- exposed here.  Bind both zero reads to the exact endpoint hashes already sealed in PostgreSQL.
  FOR zero_fact IN SELECT value FROM jsonb_array_elements(zeros) value LOOP
    IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(zero_fact) key)
        IS DISTINCT FROM ARRAY['endpointIdSha256','lane','observedAt','proofSha256','queuedJobs',
          'workersTotal']::text[]
       OR zero_fact->>'lane' NOT IN ('mage_image','soulx_avatar')
       OR (zero_fact->>'workersTotal')::integer<>0 OR (zero_fact->>'queuedJobs')::integer<>0
       OR (zero_fact->>'observedAt')::timestamptz>db_now
       OR (NOT already_settled AND (zero_fact->>'observedAt')::timestamptz<db_now-interval '2 minutes')
       OR billing_observed_at<(zero_fact->>'observedAt')::timestamptz
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(facts) f WHERE f->>'lane'=zero_fact->>'lane'
         AND (zero_fact->>'observedAt')::timestamptz<(f->>'observedAt')::timestamptz)
       OR zero_fact->>'proofSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR zero_fact->>'proofSha256'<>'sha256:'||encode(sha256(convert_to(
         public.videoforge_canonical_jsonb(zero_fact-'proofSha256'),'UTF8')),'hex')
       OR NOT EXISTS(SELECT 1 FROM public.serverless_attempts a
         JOIN public.serverless_predispatch_authorities p ON p.attempt_id=a.id
         WHERE a.generation_request_id=request_id AND a.lane=zero_fact->>'lane'
           AND p.endpoint_id_sha256=zero_fact->>'endpointIdSha256') THEN
      RAISE EXCEPTION 'V2-09 terminal zero-worker fact invalid' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF NOT already_settled THEN
  UPDATE public.hosted_pair_runtime_states SET phase='CLEANUP_ONLY',
    cleanup_reason='V209_TERMINAL_PAIR_FAILURE',version=version+1,updated_at=db_now
    WHERE generation_request_id=request_id AND phase NOT IN ('CLEANUP_ONLY','SETTLED');
  UPDATE public.serverless_dispatch_outbox o SET state=CASE WHEN EXISTS(
      SELECT 1 FROM public.serverless_provider_assignments p WHERE p.attempt_id=o.attempt_id)
      THEN 'TERMINAL' ELSE 'DEAD_LETTER' END,lease_id=NULL,lease_holder_sha256=NULL,
    leased_at=NULL,lease_expires_at=NULL,version=o.version+1,updated_at=db_now
    WHERE o.attempt_id IN (SELECT id FROM public.serverless_attempts WHERE generation_request_id=request_id)
      AND o.state NOT IN ('TERMINAL','DEAD_LETTER');
  UPDATE public.serverless_attempts a SET state=CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(facts) f
      WHERE f->>'lane'=a.lane AND f->>'providerState'='CANCELLED') THEN 'CANCELLED' ELSE 'PERMANENT_FAILED' END,
    terminal_at=db_now,version=version+1,updated_at=db_now WHERE a.generation_request_id=request_id
      AND a.state NOT IN ('SUCCEEDED','PERMANENT_FAILED','CANCELLED');
  UPDATE public.generation_tasks t SET state='FAILED',finished_at=db_now,version=t.version+1,
    updated_at=db_now WHERE t.id IN (SELECT task_id FROM public.serverless_attempts
      WHERE generation_request_id=request_id) AND t.state NOT IN ('FAILED','CANCELLED','COMPLETE');
  UPDATE public.video_runtime_lane_states SET state='FAILED',current_attempt_id=NULL,
    version=version+1,updated_at=db_now
    WHERE video_runtime_lane_states.runtime_id=target_runtime_id
      AND state NOT IN ('SUCCEEDED','FAILED','CANCELED');
  UPDATE public.video_runtime_states SET stage='FAILED',terminal_reason='LANE_PERMANENT_FAILURE',
    terminal_at=db_now,version=version+1,updated_at=db_now WHERE id=target_runtime_id
      AND stage NOT IN ('COMPLETE','FAILED','CANCELED');
  UPDATE public.generation_requests SET state='FAILED',terminal_at=db_now,version=version+1,
    updated_at=db_now WHERE id=request_id AND state IN ('ADMITTED','ACTIVE','CANCELLING');
  UPDATE public.provider_workload_leases SET state='RELEASED',released_at=db_now,
    release_reason='V209_TERMINAL_PAIR_FAILURE',version=version+1,heartbeat_at=db_now,
    expires_at=greatest(expires_at,db_now+interval '1 second') WHERE generation_request_id=request_id
    AND state='ACTIVE';
  GET DIAGNOSTICS changed_count=ROW_COUNT;
  IF changed_count<>1 THEN RAISE EXCEPTION 'V2-09 terminal exact lease release failed' USING ERRCODE='55000'; END IF;
  UPDATE public.hosted_pair_runtime_states SET phase='SETTLED',cleanup_reason=NULL,
    version=version+1,updated_at=db_now WHERE generation_request_id=request_id;
  END IF;

  INSERT INTO pg_temp.v209_terminal_result SELECT jsonb_build_object(
    'schemaVersion','videoforge.v2-09-terminal-pair-settlement-result/v1',
    'exactPairTerminalCount',(SELECT count(*) FROM public.serverless_attempts
      WHERE generation_request_id=request_id AND state IN ('PERMANENT_FAILED','CANCELLED')),
    'activeLeaseCount',(SELECT count(*) FROM public.provider_workload_leases
      WHERE generation_request_id=request_id AND state='ACTIVE'),
    'releasedLeaseCount',(SELECT count(*) FROM public.provider_workload_leases
      WHERE generation_request_id=request_id AND state='RELEASED'
        AND release_reason='V209_TERMINAL_PAIR_FAILURE'),
    'terminalTaskCount',(SELECT count(*) FROM public.generation_tasks t
      JOIN public.serverless_attempts a ON a.task_id=t.id WHERE a.generation_request_id=request_id
        AND t.state IN ('FAILED','CANCELLED','COMPLETE')),
    'terminalOutboxCount',(SELECT count(*) FROM public.serverless_dispatch_outbox o
      JOIN public.serverless_attempts a ON a.id=o.attempt_id WHERE a.generation_request_id=request_id
        AND o.state IN ('TERMINAL','DEAD_LETTER')),
    'assignmentCount',(SELECT count(*) FROM public.serverless_provider_assignments p
      JOIN public.serverless_attempts a ON a.id=p.attempt_id
      WHERE a.generation_request_id=request_id AND p.is_current),
    'providerTerminalEvidenceCount',(SELECT count(*) FROM public.hosted_pair_cleanup_observations c
      JOIN public.serverless_attempts a ON a.id=c.attempt_id
      WHERE a.generation_request_id=request_id),
    'settledEventCount',(SELECT count(*) FROM public.serverless_cost_events e
      JOIN public.serverless_attempts a ON a.id=e.attempt_id
      WHERE a.generation_request_id=request_id AND e.kind='SETTLED'),
    'zeroWorkerProofCount',jsonb_array_length(zeros),
    'zeroCostSettlementCount',(SELECT count(*) FROM public.serverless_cost_events e
      JOIN public.serverless_attempts a ON a.id=e.attempt_id
      WHERE a.generation_request_id=request_id AND e.kind='SETTLED' AND e.amount_usd=0),
    'nonzeroCostSettlementCount',(SELECT count(*) FROM public.serverless_cost_events e
      JOIN public.serverless_attempts a ON a.id=e.attempt_id
      WHERE a.generation_request_id=request_id AND e.kind='SETTLED' AND e.amount_usd<>0),
    'totalSettledCostUsd',(SELECT coalesce(sum(l.settled_usd),0)
      FROM public.serverless_cost_ledgers l JOIN public.serverless_attempts a ON a.id=l.attempt_id
      WHERE a.generation_request_id=request_id),
    'exactItemizedCostUsd',(SELECT coalesce(sum(e.amount_usd),0)
      FROM public.serverless_cost_events e JOIN public.serverless_attempts a ON a.id=e.attempt_id
      WHERE a.generation_request_id=request_id AND e.kind='PROVIDER_REPORT'
        AND position(';costBasis=exact_execution;' in e.rate_source)>0),
    'conservativeLiabilityUsd',(SELECT coalesce(sum(e.amount_usd),0)
      FROM public.serverless_cost_events e JOIN public.serverless_attempts a ON a.id=e.attempt_id
      WHERE a.generation_request_id=request_id AND e.kind='PROVIDER_REPORT'
        AND position(';costBasis=conservative_reservation;' in e.rate_source)>0),
    'generationRequestState',(SELECT state FROM public.generation_requests WHERE id=request_id),
    'runtimeStage',(SELECT stage FROM public.video_runtime_states WHERE id=target_runtime_id),
    'failedLaneCount',(SELECT count(*) FROM public.video_runtime_lane_states
      WHERE runtime_id=target_runtime_id AND state='FAILED'),
    'pairPhase',(SELECT phase FROM public.hosted_pair_runtime_states
      WHERE generation_request_id=request_id),'reconciledAt',db_now)
  WHERE (SELECT count(*) FROM public.serverless_attempts WHERE generation_request_id=request_id
      AND state IN ('PERMANENT_FAILED','CANCELLED'))=2
    AND NOT EXISTS(SELECT 1 FROM public.provider_workload_leases WHERE generation_request_id=request_id
      AND state='ACTIVE')
    AND (SELECT count(*) FROM public.serverless_cost_events e JOIN public.serverless_attempts a
      ON a.id=e.attempt_id WHERE a.generation_request_id=request_id AND e.kind='SETTLED')=2
    AND (SELECT count(*) FROM public.hosted_pair_cleanup_observations c
      JOIN public.serverless_attempts a ON a.id=c.attempt_id
      WHERE a.generation_request_id=request_id)=assignment_count
    AND (SELECT count(DISTINCT a.task_id) FROM public.serverless_attempts a
      JOIN public.generation_tasks t ON t.id=a.task_id WHERE a.generation_request_id=request_id
        AND t.state IN ('FAILED','CANCELLED','COMPLETE'))=2
    AND NOT EXISTS(SELECT 1 FROM public.serverless_dispatch_outbox o
      JOIN public.serverless_attempts a ON a.id=o.attempt_id WHERE a.generation_request_id=request_id
        AND o.state NOT IN ('TERMINAL','DEAD_LETTER'))
    AND (SELECT array_agg(lane ORDER BY lane) FROM public.video_runtime_lane_states
      WHERE runtime_id=target_runtime_id AND state='FAILED')
      =ARRAY['mage_image','soulx_avatar']::text[]
    AND (SELECT count(*) FROM public.provider_workload_leases WHERE generation_request_id=request_id
      AND state='RELEASED' AND release_reason='V209_TERMINAL_PAIR_FAILURE')=1
    AND (SELECT state FROM public.generation_requests WHERE id=request_id)='FAILED'
    AND (SELECT stage FROM public.video_runtime_states WHERE id=target_runtime_id)='FAILED'
    AND (SELECT phase FROM public.hosted_pair_runtime_states WHERE generation_request_id=request_id)='SETTLED';
  IF NOT FOUND THEN RAISE EXCEPTION 'V2-09 terminal pair postcondition failed' USING ERRCODE='55000'; END IF;
END
$settle$;
SELECT document FROM pg_temp.v209_terminal_result;
COMMIT;

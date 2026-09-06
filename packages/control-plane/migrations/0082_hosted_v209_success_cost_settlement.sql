-- Persist the exact two-lane RunPod cost only after an external terminal inventory read has
-- returned an execution time for each already-successful V2-09 assignment.  This function does
-- not dispatch, poll, promote, release, or otherwise mutate provider work.

CREATE FUNCTION public.videoforge_settle_hosted_v209_success_costs(
  supplied_account_id uuid, supplied_workspace_id uuid,
  supplied_generation_request_id uuid, supplied_terminal_facts jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
#variable_conflict use_variable
DECLARE
  db_now timestamptz:=transaction_timestamp();
  target_request public.generation_requests%ROWTYPE;
  admission public.hosted_v209_short_admissions%ROWTYPE;
  attempt record; fact jsonb; unsigned_fact jsonb;
  lane_receipts jsonb:='[]'::jsonb;
  fact_count integer; existing_report_count integer; existing_settled_count integer;
  execution_time_ms bigint; cost_micro_usd bigint; total_micro_usd bigint:=0;
  evidence_rate_source text; provider_report_id uuid; settled_event_id uuid;
  replayed boolean:=true; project_revision_id uuid;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR jsonb_typeof(supplied_terminal_facts) IS DISTINCT FROM 'array'
     OR jsonb_array_length(supplied_terminal_facts)<>2
     OR (SELECT array_agg(value->>'lane' ORDER BY value->>'lane')
           FROM jsonb_array_elements(supplied_terminal_facts) value)
          IS DISTINCT FROM ARRAY['mage_image','soulx_avatar']::text[] THEN
    RAISE EXCEPTION 'hosted V2-09 success cost input invalid' USING ERRCODE='42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_generation_request_id::text,82));
  SELECT * INTO target_request FROM public.generation_requests request
   WHERE request.account_id=supplied_account_id
     AND request.workspace_id=supplied_workspace_id
     AND request.id=supplied_generation_request_id
   FOR SHARE;
  SELECT * INTO admission FROM public.hosted_v209_short_admissions row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.generation_request_id=supplied_generation_request_id
   FOR SHARE;
  project_revision_id:=target_request.project_revision_id;

  PERFORM 1 FROM public.serverless_attempts row
   WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
     AND row.generation_request_id=supplied_generation_request_id
   ORDER BY row.lane FOR UPDATE;
  PERFORM 1 FROM public.serverless_cost_ledgers ledger
   JOIN public.serverless_attempts row ON row.id=ledger.attempt_id
   WHERE row.generation_request_id=supplied_generation_request_id
   ORDER BY row.lane FOR UPDATE OF ledger;
  PERFORM 1 FROM public.serverless_cost_events event
   JOIN public.serverless_attempts row ON row.id=event.attempt_id
   WHERE row.generation_request_id=supplied_generation_request_id
   ORDER BY row.lane,event.sequence FOR SHARE OF event;

  IF target_request.id IS NULL OR admission.generation_request_id IS NULL
     OR target_request.state NOT IN ('ACTIVE','SUCCEEDED')
     OR (target_request.state='ACTIVE' AND target_request.terminal_at IS NOT NULL)
     OR (target_request.state='SUCCEEDED' AND target_request.terminal_at IS NULL)
     OR admission.phase_cap_micro_usd<>2000000 OR admission.combined_cap_micro_usd<>17500000
     OR NOT admission.no_redispatch
     OR (SELECT phase FROM public.hosted_pair_runtime_states pair
          WHERE pair.account_id=supplied_account_id AND pair.workspace_id=supplied_workspace_id
            AND pair.generation_request_id=supplied_generation_request_id)<>'SETTLED'
     OR (SELECT stage FROM public.video_runtime_states runtime
          WHERE runtime.account_id=supplied_account_id AND runtime.workspace_id=supplied_workspace_id
            AND runtime.generation_request_id=supplied_generation_request_id)
          NOT IN ('RENDERING','COMPLETE')
     OR (SELECT count(*) FROM public.provider_workload_leases lease
          WHERE lease.account_id=supplied_account_id AND lease.workspace_id=supplied_workspace_id
            AND lease.generation_request_id=supplied_generation_request_id
            AND lease.state='ACTIVE')<>0
     OR (SELECT count(*) FROM public.provider_workload_leases lease
          WHERE lease.account_id=supplied_account_id AND lease.workspace_id=supplied_workspace_id
            AND lease.generation_request_id=supplied_generation_request_id
            AND lease.state='RELEASED' AND lease.release_reason='HOSTED_PAIR_OUTPUTS_ACCEPTED')<>1
     OR (SELECT count(*) FROM public.serverless_attempts row
          WHERE row.account_id=supplied_account_id AND row.workspace_id=supplied_workspace_id
            AND row.generation_request_id=supplied_generation_request_id
            AND row.project_revision_id=project_revision_id AND row.state='SUCCEEDED'
            AND row.terminal_at IS NOT NULL)<>2
     OR (SELECT count(*) FROM public.serverless_provider_assignments assignment
          JOIN public.serverless_attempts row ON row.id=assignment.attempt_id
          WHERE row.generation_request_id=supplied_generation_request_id)<>2
     OR (SELECT array_agg(row.lane ORDER BY row.lane) FROM public.serverless_attempts row
          WHERE row.generation_request_id=supplied_generation_request_id)
          IS DISTINCT FROM ARRAY['mage_image','soulx_avatar']::text[]
     OR (SELECT count(*) FROM public.video_runtime_lane_states lane
          JOIN public.video_runtime_states runtime ON runtime.id=lane.runtime_id
          WHERE runtime.generation_request_id=supplied_generation_request_id
            AND lane.state='SUCCEEDED')<>2 THEN
    RAISE EXCEPTION 'hosted V2-09 successful pair is not cost-settlement eligible'
      USING ERRCODE='55000';
  END IF;

  fact_count:=jsonb_array_length(supplied_terminal_facts);
  FOR attempt IN
    SELECT row.*,assignment.provider_job_id,assignment.provider_job_id_sha256,
      authority.rate_source sealed_rate_source,authority.rate_checked_at sealed_rate_checked_at,
      authority.reservation_usd,authority.spend_ceiling_usd,authority.deployment_id authority_deployment_id,
      authority.endpoint_id_sha256 authority_endpoint_id_sha256,
      authority.region authority_region,authority.gpu_allowlist authority_gpu_allowlist,
      ledger.id ledger_id,ledger.ceiling_usd,ledger.reserved_usd,ledger.reported_usd,ledger.settled_usd,
      ledger.possible_duplicate_usd,row.possible_duplicate_executions,
      outbox.state outbox_state,outbox.send_attempt_count
    FROM public.serverless_attempts row
    JOIN public.serverless_provider_assignments assignment
      ON assignment.attempt_id=row.id AND assignment.is_current
    JOIN public.serverless_predispatch_authorities authority ON authority.attempt_id=row.id
    JOIN public.serverless_cost_ledgers ledger ON ledger.attempt_id=row.id
    JOIN public.serverless_dispatch_outbox outbox ON outbox.attempt_id=row.id
    WHERE row.generation_request_id=supplied_generation_request_id
    ORDER BY row.lane
  LOOP
    SELECT value INTO fact FROM jsonb_array_elements(supplied_terminal_facts) value
     WHERE value->>'lane'=attempt.lane;
    SELECT count(*) INTO existing_report_count FROM public.serverless_cost_events event
     WHERE event.attempt_id=attempt.id AND event.kind='PROVIDER_REPORT';
    SELECT count(*) INTO existing_settled_count FROM public.serverless_cost_events event
     WHERE event.attempt_id=attempt.id AND event.kind='SETTLED';
    IF fact IS NULL
       OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(fact) key)
          IS DISTINCT FROM ARRAY['executionTimeMs','lane','observedAt','proofSha256',
            'providerJobId','providerJobIdSha256','providerState','rateCheckedAt','rateSource']::text[]
       OR jsonb_typeof(fact->'executionTimeMs') IS DISTINCT FROM 'number'
       OR (fact->>'executionTimeMs')::numeric<>trunc((fact->>'executionTimeMs')::numeric)
       OR fact->>'providerState'<>'COMPLETED'
       OR fact->>'providerJobId' IS DISTINCT FROM attempt.provider_job_id
       OR fact->>'providerJobIdSha256' IS DISTINCT FROM attempt.provider_job_id_sha256
       OR fact->>'providerJobIdSha256'<>'sha256:'||encode(sha256(convert_to(
            fact->>'providerJobId','UTF8')),'hex')
       OR fact->>'rateSource' IS DISTINCT FROM attempt.sealed_rate_source
       OR attempt.sealed_rate_source<>'V2-09_APPROVED_MAX_USD_1.116_GPU_HOUR'
       OR (fact->>'rateCheckedAt')::timestamptz IS DISTINCT FROM attempt.sealed_rate_checked_at
       OR (fact->>'observedAt')::timestamptz>db_now
       OR (existing_report_count=0 AND existing_settled_count=0
         AND (fact->>'observedAt')::timestamptz<db_now-interval '5 minutes')
       OR fact->>'proofSha256' !~ '^sha256:[0-9a-f]{64}$'
       OR fact->>'proofSha256'<>'sha256:'||encode(sha256(convert_to(
            public.videoforge_canonical_jsonb(fact-'proofSha256'),'UTF8')),'hex')
       OR attempt.outbox_state<>'TERMINAL' OR attempt.send_attempt_count<>1
       OR attempt.authority_deployment_id<>attempt.deployment_id
       OR attempt.authority_region<>'EU-RO-1'
       OR attempt.authority_gpu_allowlist<>ARRAY['NVIDIA GeForce RTX 4090']::text[]
       OR attempt.reservation_usd<>attempt.reserved_usd
       OR attempt.spend_ceiling_usd<>attempt.ceiling_usd
       OR attempt.possible_duplicate_usd<>0 OR attempt.possible_duplicate_executions<>0
       OR NOT EXISTS(SELECT 1 FROM public.hosted_pair_cleanup_observations observation
          WHERE observation.account_id=supplied_account_id
            AND observation.workspace_id=supplied_workspace_id
            AND observation.generation_request_id=supplied_generation_request_id
            AND observation.attempt_id=attempt.id AND observation.lane=attempt.lane
            AND observation.deployment_id=attempt.deployment_id
            AND observation.dispatch_token_sha256=attempt.dispatch_token_sha256
            AND observation.provider_job_id=attempt.provider_job_id
            AND observation.provider_state='COMPLETED') THEN
      RAISE EXCEPTION 'hosted V2-09 success cost fact binding invalid' USING ERRCODE='23514';
    END IF;

    execution_time_ms:=(fact->>'executionTimeMs')::bigint;
    cost_micro_usd:=ceil(execution_time_ms::numeric*1.116*1000000/3600000)::bigint;
    IF execution_time_ms<0 OR cost_micro_usd<0
       OR cost_micro_usd>round(attempt.ceiling_usd*1000000)::bigint THEN
      RAISE EXCEPTION 'hosted V2-09 exact execution cost exceeds sealed ceiling'
        USING ERRCODE='22003';
    END IF;
    total_micro_usd:=total_micro_usd+cost_micro_usd;
    evidence_rate_source:=attempt.sealed_rate_source||';providerState=COMPLETED' ||
      ';providerProofSha256='||(fact->>'proofSha256')||
      ';providerJobIdSha256='||attempt.provider_job_id_sha256||
      ';costBasis=exact_execution;executionTimeMs='||execution_time_ms::text;
    IF length(evidence_rate_source)>400 THEN
      RAISE EXCEPTION 'hosted V2-09 success rate evidence exceeds durable limit'
        USING ERRCODE='22001';
    END IF;
    provider_report_id:=md5('hosted-v209-success-provider-report:'||attempt.id::text)::uuid;
    settled_event_id:=md5('hosted-v209-success-settled:'||attempt.id::text)::uuid;
    IF existing_report_count=0 AND existing_settled_count=0 THEN
      IF (SELECT count(*) FROM public.serverless_cost_events event
           WHERE event.attempt_id=attempt.id AND event.sequence=1 AND event.kind='RESERVATION'
             AND event.amount_usd=attempt.reservation_usd
             AND event.rate_source=attempt.sealed_rate_source
             AND event.rate_checked_at=attempt.sealed_rate_checked_at)<>1
         OR attempt.reported_usd<>0 OR attempt.settled_usd<>0 THEN
        RAISE EXCEPTION 'hosted V2-09 success cost ledger prestate invalid' USING ERRCODE='55000';
      END IF;
      INSERT INTO public.serverless_cost_events(id,account_id,workspace_id,project_revision_id,
        attempt_id,ledger_id,sequence,kind,amount_usd,rate_source,rate_checked_at,confidence,recorded_at)
      VALUES(provider_report_id,supplied_account_id,supplied_workspace_id,project_revision_id,
        attempt.id,attempt.ledger_id,2,'PROVIDER_REPORT',cost_micro_usd::numeric/1000000,
        evidence_rate_source,attempt.sealed_rate_checked_at,'PROVIDER_REPORTED',
        (fact->>'observedAt')::timestamptz);
      INSERT INTO public.serverless_cost_events(id,account_id,workspace_id,project_revision_id,
        attempt_id,ledger_id,sequence,kind,amount_usd,rate_source,rate_checked_at,confidence,recorded_at)
      VALUES(settled_event_id,supplied_account_id,supplied_workspace_id,project_revision_id,
        attempt.id,attempt.ledger_id,3,'SETTLED',cost_micro_usd::numeric/1000000,
        evidence_rate_source,attempt.sealed_rate_checked_at,'MEASURED',db_now);
      UPDATE public.serverless_cost_ledgers SET reported_usd=cost_micro_usd::numeric/1000000,
        settled_usd=cost_micro_usd::numeric/1000000,updated_at=db_now,version=version+1
       WHERE id=attempt.ledger_id;
      replayed:=false;
    ELSIF existing_report_count<>1 OR existing_settled_count<>1
       OR (SELECT count(*) FROM public.serverless_cost_events event
            WHERE event.id=provider_report_id AND event.attempt_id=attempt.id
              AND event.ledger_id=attempt.ledger_id AND event.sequence=2
              AND event.kind='PROVIDER_REPORT'
              AND event.amount_usd=cost_micro_usd::numeric/1000000
              AND event.rate_source=evidence_rate_source
              AND event.rate_checked_at=attempt.sealed_rate_checked_at
              AND event.confidence='PROVIDER_REPORTED'
              AND event.recorded_at=(fact->>'observedAt')::timestamptz)<>1
       OR (SELECT count(*) FROM public.serverless_cost_events event
            WHERE event.id=settled_event_id AND event.attempt_id=attempt.id
              AND event.ledger_id=attempt.ledger_id AND event.sequence=3
              AND event.kind='SETTLED' AND event.amount_usd=cost_micro_usd::numeric/1000000
              AND event.rate_source=evidence_rate_source
              AND event.rate_checked_at=attempt.sealed_rate_checked_at
              AND event.confidence='MEASURED')<>1
       OR attempt.reported_usd<>cost_micro_usd::numeric/1000000
       OR attempt.settled_usd<>cost_micro_usd::numeric/1000000 THEN
      RAISE EXCEPTION 'hosted V2-09 success cost replay drift' USING ERRCODE='23505';
    END IF;

    lane_receipts:=lane_receipts||jsonb_build_array(jsonb_build_object(
      'lane',attempt.lane,'attemptId',attempt.id,
      'providerJobIdSha256',attempt.provider_job_id_sha256,
      'providerProofSha256',fact->>'proofSha256','executionTimeMs',execution_time_ms,
      'costMicroUsd',cost_micro_usd,'rateSource',attempt.sealed_rate_source,
      'rateCheckedAt',to_char(attempt.sealed_rate_checked_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'providerReportEventId',provider_report_id,'settledEventId',settled_event_id));
  END LOOP;

  IF fact_count<>2 OR jsonb_array_length(lane_receipts)<>2
     OR total_micro_usd>admission.phase_cap_micro_usd
     OR admission.billing_baseline_micro_usd+total_micro_usd>admission.combined_cap_micro_usd
     OR (SELECT count(*) FROM public.serverless_cost_events event
          JOIN public.serverless_attempts row ON row.id=event.attempt_id
          WHERE row.generation_request_id=supplied_generation_request_id
            AND event.kind='PROVIDER_REPORT')<>2
     OR (SELECT count(*) FROM public.serverless_cost_events event
          JOIN public.serverless_attempts row ON row.id=event.attempt_id
          WHERE row.generation_request_id=supplied_generation_request_id
            AND event.kind='SETTLED')<>2
     OR (SELECT round(sum(ledger.settled_usd)*1000000)::bigint
          FROM public.serverless_cost_ledgers ledger
          JOIN public.serverless_attempts row ON row.id=ledger.attempt_id
          WHERE row.generation_request_id=supplied_generation_request_id)<>total_micro_usd THEN
    RAISE EXCEPTION 'hosted V2-09 success cost postcondition invalid' USING ERRCODE='23514';
  END IF;

  RETURN jsonb_build_object(
    'schemaVersion','videoforge.hosted-v209-success-cost-settlement/v1',
    'generationRequestId',supplied_generation_request_id,
    'projectRevisionId',project_revision_id,
    'genericProjectRevisionNetCostIncluded',false,
    'exactGpuCostMicroUsd',total_micro_usd,
    'conservativeGpuLiabilityMicroUsd',0,
    'lanes',lane_receipts,'replayed',replayed,
    'settledAt',to_char(db_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_settle_hosted_v209_success_costs(
  uuid,uuid,uuid,jsonb) FROM PUBLIC;

-- Narrow tenant-bound projection for the generic project-revision ledger. The reconciler receives
-- EXECUTE on this function, never SELECT on cost_events.
CREATE FUNCTION public.videoforge_read_hosted_v209_project_revision_net_cost(
  supplied_account_id uuid, supplied_workspace_id uuid, supplied_project_revision_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE net_micro_usd bigint;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR NOT EXISTS(SELECT 1 FROM public.project_revisions revision
       WHERE revision.account_id=supplied_account_id
         AND revision.workspace_id=supplied_workspace_id
         AND revision.id=supplied_project_revision_id) THEN
    RAISE EXCEPTION 'hosted V2-09 project revision cost scope invalid' USING ERRCODE='42501';
  END IF;
  SELECT coalesce(sum(CASE event.event_type
      WHEN 'SETTLED' THEN event.amount_micro_usd
      WHEN 'REFUNDED' THEN -event.amount_micro_usd
      ELSE 0 END),0)::bigint
    INTO net_micro_usd
    FROM public.cost_events event
   WHERE event.workspace_id=supplied_workspace_id
     AND event.owner_type='PROJECT_REVISION'
     AND event.owner_id=supplied_project_revision_id;
  IF net_micro_usd<0 OR net_micro_usd>2000000 THEN
    RAISE EXCEPTION 'hosted V2-09 project revision net cost outside phase cap'
      USING ERRCODE='22003';
  END IF;
  RETURN jsonb_build_object(
    'schemaVersion','videoforge.v2-09-e2e-cost-readback/v1',
    'projectRevisionId',supplied_project_revision_id,
    'genericProjectRevisionNetCostMicroUsd',net_micro_usd);
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_read_hosted_v209_project_revision_net_cost(
  uuid,uuid,uuid) FROM PUBLIC;

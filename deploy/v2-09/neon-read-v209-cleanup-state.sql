\set ON_ERROR_STOP on

WITH supplied AS (
  SELECT convert_from(decode(:'payload_base64','base64'),'UTF8')::jsonb AS value
), input AS (
  SELECT
    (value->>'accountId')::uuid AS account_id,
    (value->>'workspaceId')::uuid AS workspace_id,
    (value->>'issuedAt')::timestamptz AS issued_at,
    CASE WHEN value->>'generationRequestId' IS NULL THEN NULL
      ELSE (value->>'generationRequestId')::uuid END AS generation_request_id,
    ARRAY(SELECT jsonb_array_elements_text(value->'deploymentIds'))::uuid[] AS deployment_ids
  FROM supplied
  WHERE jsonb_typeof(value)='object'
    AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(value) key)
      = ARRAY['accountId','deploymentIds','generationRequestId','issuedAt','schemaVersion','workspaceId']::text[]
    AND value->>'schemaVersion'='videoforge.v2-09-cleanup-state-request/v1'
    AND jsonb_array_length(value->'deploymentIds')=2
), deployments AS (
  SELECT d.* FROM public.serverless_endpoint_deployments d JOIN input i ON d.id=ANY(i.deployment_ids)
), attempts AS (
  SELECT a.*,p.provider_job_id,p.provider_job_id_sha256,
    l.ceiling_usd::numeric AS ceiling_usd,
    coalesce(l.settled_usd,0)::numeric AS settled_usd,
    coalesce(l.possible_duplicate_usd,0)::numeric AS possible_duplicate_usd,
    q.rate_source AS sealed_rate_source,q.rate_checked_at AS sealed_rate_checked_at,
    c.provider_state AS cleanup_provider_state,
    c.provider_proof_sha256 AS cleanup_provider_proof_sha256,
    c.observed_at AS cleanup_provider_observed_at,
    report.amount_usd AS terminal_cost_usd,
    report.rate_source AS terminal_cost_rate_source,
    report.rate_checked_at AS terminal_cost_rate_checked_at,
    report.confidence AS terminal_cost_confidence,
    (SELECT e.provider_status FROM public.serverless_progress_events e
      WHERE e.attempt_id=a.id ORDER BY e.sequence DESC LIMIT 1) AS latest_provider_status
  FROM public.serverless_attempts a
  JOIN input i ON a.account_id=i.account_id AND a.workspace_id=i.workspace_id
    AND a.deployment_id=ANY(i.deployment_ids) AND a.created_at>=i.issued_at
    AND (i.generation_request_id IS NULL OR a.generation_request_id=i.generation_request_id)
  LEFT JOIN public.serverless_provider_assignments p ON p.attempt_id=a.id AND p.is_current
  LEFT JOIN public.serverless_cost_ledgers l ON l.attempt_id=a.id
  LEFT JOIN public.serverless_predispatch_authorities q ON q.attempt_id=a.id
  LEFT JOIN public.hosted_pair_cleanup_observations c ON c.attempt_id=a.id
  LEFT JOIN public.serverless_cost_events report ON report.attempt_id=a.id
    AND report.kind='PROVIDER_REPORT'
), validated AS (
  SELECT
    (SELECT count(*) FROM input) AS input_count,
    (SELECT count(*) FROM deployments) AS deployment_count,
    (SELECT count(*) FROM attempts) AS attempt_count,
    (SELECT count(DISTINCT lane) FROM attempts) AS attempt_lane_count,
    (SELECT count(DISTINCT generation_request_id) FROM attempts) AS request_count
)
SELECT CASE WHEN input_count<>1 OR deployment_count>2 OR attempt_count>2
    OR attempt_count<>attempt_lane_count
    OR attempt_count NOT IN (0,2)
    OR (attempt_count=2 AND request_count<>1) THEN
  jsonb_build_object('schemaVersion','videoforge.v2-09-cleanup-state-invalid/v1')
ELSE jsonb_build_object(
  'schemaVersion','videoforge.v2-09-cleanup-state-result/v1',
  'generationRequestId',(SELECT CASE WHEN count(*)=0 THEN NULL
    ELSE min(generation_request_id::text)::uuid END FROM attempts),
  'generationRequestState',(SELECT state FROM public.generation_requests
    WHERE id=(SELECT min(generation_request_id::text)::uuid FROM attempts)),
  'runtimeStage',(SELECT stage FROM public.video_runtime_states
    WHERE generation_request_id=(SELECT min(generation_request_id::text)::uuid FROM attempts)),
  'pairPhase',(SELECT phase FROM public.hosted_pair_runtime_states
    WHERE generation_request_id=(SELECT min(generation_request_id::text)::uuid FROM attempts)),
  'activeLeaseCount',(SELECT count(*) FROM public.provider_workload_leases
    WHERE generation_request_id=(SELECT min(generation_request_id::text)::uuid FROM attempts)
      AND state='ACTIVE'),
  'releasedLeaseCount',(SELECT count(*) FROM public.provider_workload_leases
    WHERE generation_request_id=(SELECT min(generation_request_id::text)::uuid FROM attempts)
      AND state='RELEASED'),
  'assignmentCount',(SELECT count(*) FROM public.serverless_provider_assignments p
    JOIN attempts a ON a.id=p.attempt_id WHERE p.is_current),
  'providerTerminalEvidenceCount',(SELECT count(*) FROM public.hosted_pair_cleanup_observations c
    JOIN attempts a ON a.id=c.attempt_id),
  'sentOrUnknownOutboxCount',(SELECT count(*) FROM public.serverless_dispatch_outbox o
    JOIN attempts a ON a.id=o.attempt_id
    WHERE o.state IN ('SENT','DISPATCH_ACK_UNKNOWN')),
  'exactPairTerminalCount',(SELECT count(*) FROM attempts
    WHERE state IN ('PERMANENT_FAILED','CANCELLED')),
  'terminalTaskCount',(SELECT count(DISTINCT t.id) FROM public.generation_tasks t
    JOIN attempts a ON a.task_id=t.id WHERE t.state IN ('FAILED','CANCELLED','COMPLETE')),
  'terminalOutboxCount',(SELECT count(*) FROM public.serverless_dispatch_outbox o
    JOIN attempts a ON a.id=o.attempt_id WHERE o.state IN ('TERMINAL','DEAD_LETTER')),
  'failedLaneCount',(SELECT count(*) FROM public.video_runtime_lane_states l
    JOIN public.video_runtime_states r ON r.id=l.runtime_id
    WHERE r.generation_request_id=(SELECT min(generation_request_id::text)::uuid FROM attempts)
      AND l.state='FAILED'),
  'settledEventCount',(SELECT count(*) FROM public.serverless_cost_events e
    JOIN attempts a ON a.id=e.attempt_id WHERE e.kind='SETTLED'),
  'zeroCostSettlementCount',(SELECT count(*) FROM public.serverless_cost_events e
    JOIN attempts a ON a.id=e.attempt_id WHERE e.kind='SETTLED' AND e.amount_usd=0),
  'nonzeroCostSettlementCount',(SELECT count(*) FROM public.serverless_cost_events e
    JOIN attempts a ON a.id=e.attempt_id WHERE e.kind='SETTLED' AND e.amount_usd<>0),
  'totalSettledCostUsd',(SELECT coalesce(sum(e.amount_usd),0) FROM public.serverless_cost_events e
    JOIN attempts a ON a.id=e.attempt_id WHERE e.kind='SETTLED'),
  'exactItemizedCostUsd',(SELECT coalesce(sum(e.amount_usd),0) FROM public.serverless_cost_events e
    JOIN attempts a ON a.id=e.attempt_id WHERE e.kind='PROVIDER_REPORT'
      AND position(';costBasis=exact_execution;' in e.rate_source)>0),
  'conservativeLiabilityUsd',(SELECT coalesce(sum(e.amount_usd),0)
    FROM public.serverless_cost_events e JOIN attempts a ON a.id=e.attempt_id
    WHERE e.kind='PROVIDER_REPORT'
      AND position(';costBasis=conservative_reservation;' in e.rate_source)>0),
  'deployments',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'deploymentId',d.id,'lane',CASE d.lane WHEN 'mage_image' THEN 'mage' ELSE 'soulx' END,
    'endpointId',d.provider_endpoint_id,'endpointIdSha256',d.endpoint_id_sha256,
    'templateId',d.provider_template_id,
    'templateIdSha256',substring(d.endpoint_profile_id from '^template:(sha256:[0-9a-f]{64})$'),
    'deploymentSha256',d.endpoint_config_sha256,'imageSha256',d.worker_image_digest,
    'volumeIdSha256',d.volume_id_sha256,'volumeManifestSha256',d.volume_manifest_sha256,
    'active',d.is_active
  ) ORDER BY d.lane),'[]'::jsonb) FROM deployments d),
  'jobs',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'lane',CASE a.lane WHEN 'mage_image' THEN 'mage' ELSE 'soulx' END,
    'jobId',a.provider_job_id,'jobIdSha256',a.provider_job_id_sha256,
    'status',coalesce(a.cleanup_provider_state,a.latest_provider_status,CASE a.state
      WHEN 'SUCCEEDED' THEN 'COMPLETED' WHEN 'PERMANENT_FAILED' THEN 'FAILED'
      WHEN 'CANCELLED' THEN 'CANCELLED' ELSE NULL END),
    'ceilingUsd',a.ceiling_usd,
    'rateSource',a.sealed_rate_source,'rateCheckedAt',a.sealed_rate_checked_at,
    'terminalProofSha256',a.cleanup_provider_proof_sha256,
    'terminalObservedAt',a.cleanup_provider_observed_at,
    'terminalCostBasis',substring(a.terminal_cost_rate_source
      from ';costBasis=([^;]+);executionTimeMs='),
    'terminalExecutionTimeMs',CASE substring(a.terminal_cost_rate_source
      from ';executionTimeMs=([^;]+)$') WHEN 'null' THEN NULL
      ELSE substring(a.terminal_cost_rate_source from ';executionTimeMs=([0-9]+)$')::bigint END,
    'terminalCostUsd',a.terminal_cost_usd,
    'terminalRateCheckedAt',a.terminal_cost_rate_checked_at,
    'terminalCostConfidence',a.terminal_cost_confidence,
    'costUsd',a.settled_usd,'duplicateCostUsd',a.possible_duplicate_usd,
    'possibleDuplicateExecutions',a.possible_duplicate_executions,
    'outputPrefix',a.output_prefix
  ) ORDER BY a.lane),'[]'::jsonb) FROM attempts a),
  'readAt',transaction_timestamp()
) END
FROM validated;

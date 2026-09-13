-- Match the parsed submission hashed by the CPU scheduling boundary.
CREATE FUNCTION public.videoforge_hosted_cpu_submission_request_sha256(payload jsonb)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=public,pg_catalog AS $$
  SELECT 'sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(
    jsonb_build_object('idempotencyKey',payload->>'idempotency_key',
      'projectId',payload->>'project_id','projectRevisionId',payload->>'project_revision_id',
      'kind',payload->>'kind','inputDocument',payload->'input_document',
      'objects',(SELECT jsonb_agg(jsonb_build_object('receiptId',item->>'artifact_receipt_id',
        'uri',item->>'uri') ORDER BY ordinal)
        FROM jsonb_array_elements(payload->'objects') WITH ORDINALITY AS objects(item,ordinal)))
  ),'UTF8')),'hex');
$$;
REVOKE ALL ON FUNCTION public.videoforge_hosted_cpu_submission_request_sha256(jsonb) FROM PUBLIC;

DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.videoforge_read_v209_render_terminal_candidate(uuid,uuid,uuid)'::regprocedure) INTO definition;
  IF strpos(definition,$old$AND row.kind='RENDER'),$old$)=0 THEN
    RAISE EXCEPTION 'render candidate retry preimage drifted';
  END IF;
  definition:=replace(definition,$old$AND row.kind='RENDER'),$old$,
    $new$AND row.kind='RENDER' AND row.state NOT IN ('FAILED','CANCELLED')),
    'acceptedLaneCount',(SELECT count(DISTINCT a.lane)
      FROM public.hosted_serverless_output_barrier_completions b
      JOIN public.serverless_attempts a ON a.id=b.attempt_id
      WHERE a.account_id=attempt.account_id AND a.workspace_id=attempt.workspace_id
        AND a.generation_request_id=runtime.generation_request_id AND a.state='SUCCEEDED'),$new$);
  EXECUTE definition;

  SELECT pg_get_functiondef('public.videoforge_finalize_v209_render_terminal(jsonb)'::regprocedure) INTO definition;
  IF strpos(definition,'plan.payload_sha256<>attempt.request_sha256')=0
    OR strpos(definition,$old$AND row.kind='RENDER')<>1$old$)=0
    OR strpos(definition,$old$lease.release_reason<>'HOSTED_PAIR_OUTPUTS_ACCEPTED'$old$)=0 THEN
    RAISE EXCEPTION 'render finalizer retry preimage drifted';
  END IF;
  definition:=replace(definition,'plan.payload_sha256<>attempt.request_sha256',
    'public.videoforge_hosted_cpu_submission_request_sha256(plan.payload)<>attempt.request_sha256');
  definition:=replace(definition,$old$AND row.kind='RENDER')<>1$old$,
    $new$AND row.kind='RENDER' AND row.state NOT IN ('FAILED','CANCELLED'))<>1$new$);
  definition:=replace(definition,$old$lease.release_reason<>'HOSTED_PAIR_OUTPUTS_ACCEPTED'$old$,
    $new$(lease.release_reason<>'HOSTED_PAIR_OUTPUTS_ACCEPTED' AND NOT (
      lease.release_reason='HOSTED_PAIR_PROVIDER_TERMINAL' AND
      (SELECT count(DISTINCT a.lane) FROM public.hosted_serverless_output_barrier_completions b
       JOIN public.serverless_attempts a ON a.id=b.attempt_id
       WHERE a.account_id=account_id AND a.workspace_id=workspace_id
         AND a.generation_request_id=request.id AND a.state='SUCCEEDED')=2))$new$);
  EXECUTE definition;
END;
$migration$;

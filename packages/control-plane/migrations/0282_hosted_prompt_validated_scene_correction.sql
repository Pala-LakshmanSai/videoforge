-- Bind one bounded v31 correction to original immutable output and exact failed input subset.
-- Atomic batch acceptance, tenant CAS, one automatic replacement, and cost guards are unchanged.
CREATE FUNCTION public.videoforge_hosted_prompt_scene_correction_matches(
  original_payload jsonb, replacement_payload jsonb, supplied_response_hash text,
  supplied_run_id uuid, supplied_claim_id uuid, supplied_provider_task_uuid text,
  supplied_request_hash text, supplied_known_cost_micro_usd bigint
) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=public,pg_catalog AS $$
DECLARE correction jsonb; failed jsonb; expected_scenes jsonb; source_output jsonb;
  receipt jsonb; source_text text; parsed_text text; closing integer; original_ids jsonb; source_ids jsonb;
BEGIN
  correction:=replacement_payload->'correction';
  failed:=correction->'failed_scene_ids';
  IF jsonb_typeof(correction) IS DISTINCT FROM 'object'
     OR correction-'source_response_sha256'-'source_output_text'-'failed_scene_ids'-'failures'<>'{}'::jsonb
     OR correction->>'source_response_sha256' IS DISTINCT FROM supplied_response_hash
     OR jsonb_typeof(correction->'source_output_text') IS DISTINCT FROM 'string'
     OR jsonb_typeof(failed) IS DISTINCT FROM 'array' OR jsonb_array_length(failed)=0
     OR jsonb_typeof(correction->'failures') IS DISTINCT FROM 'array'
     OR jsonb_array_length(correction->'failures')=0
     OR jsonb_typeof(original_payload->'scenes') IS DISTINCT FROM 'array'
     OR original_payload-'attempt_index'-'scenes' IS DISTINCT FROM
        replacement_payload-'attempt_index'-'scenes'-'correction'
     OR original_payload ? 'correction' THEN RETURN false; END IF;
  source_text:=correction->>'source_output_text';
  IF 'sha256:'||encode(digest(convert_to(source_text,'UTF8'),'sha256'),'hex')
      IS DISTINCT FROM supplied_response_hash THEN RETURN false; END IF;
  -- Match the shared JSON-fence parser while preserving the original bytes/hash above.
  parsed_text:=btrim(source_text);
  IF left(parsed_text,3)='```' THEN
    parsed_text:=substring(parsed_text FROM 4);
    parsed_text:=regexp_replace(parsed_text,E'^(json|JSON)\\s*\\n','');
    closing:=strpos(reverse(parsed_text),'```');
    IF closing>0 THEN parsed_text:=btrim(left(parsed_text,length(parsed_text)-closing-2)); END IF;
  END IF;
  source_output:=parsed_text::jsonb;
  IF source_output->>'batch_id' IS DISTINCT FROM original_payload->>'batch_id'
     OR jsonb_typeof(source_output->'scenes') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  SELECT jsonb_agg(scene->'scene_id' ORDER BY scene->>'scene_id') INTO original_ids
    FROM jsonb_array_elements(original_payload->'scenes') WITH ORDINALITY AS rows(scene,ordinal);
  SELECT jsonb_agg(scene->'scene_id' ORDER BY scene->>'scene_id') INTO source_ids
    FROM jsonb_array_elements(source_output->'scenes') WITH ORDINALITY AS rows(scene,ordinal);
  IF original_ids IS DISTINCT FROM source_ids THEN RETURN false; END IF;
  SELECT jsonb_agg(scene ORDER BY ordinal) INTO expected_scenes
    FROM jsonb_array_elements(original_payload->'scenes') WITH ORDINALITY AS rows(scene,ordinal)
   WHERE failed @> jsonb_build_array(scene->'scene_id');
  IF expected_scenes IS DISTINCT FROM replacement_payload->'scenes' THEN RETURN false; END IF;
  SELECT jsonb_agg(scene->'scene_id' ORDER BY ordinal) INTO source_ids
    FROM jsonb_array_elements(expected_scenes) WITH ORDINALITY AS rows(scene,ordinal);
  IF failed IS DISTINCT FROM source_ids OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(correction->'failures') failure
     WHERE jsonb_typeof(failure) IS DISTINCT FROM 'object'
       OR failure-'scene_id'-'field'-'reason'<>'{}'::jsonb
       OR NOT (failed @> jsonb_build_array(failure->'scene_id'))
       OR coalesce(failure->>'field','') NOT IN ('literal_subject','action','environment','scene')
       OR coalesce(failure->>'reason','') NOT IN ('hard_conflict','required_fact_invalid','explicit_negation_conflict','global_topic_substitution','depiction_transfer')
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(failed) id
     WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(correction->'failures') failure
       WHERE failure->'scene_id'=id)
  ) THEN RETURN false; END IF;
  SELECT r.result_payload INTO receipt FROM public.repository_mutation_receipts r
    JOIN public.hosted_prompt_runs run ON run.workspace_id=r.workspace_id
   WHERE run.id=supplied_run_id AND run.account_id=public.videoforge_current_account_id()
     AND r.operation='hosted_prompt_response' AND r.input_hash=supplied_request_hash
     AND r.idempotency_key='hosted-prompt-response:'||supplied_provider_task_uuid;
  IF receipt IS NULL OR (
    receipt->>'run_id' IS DISTINCT FROM supplied_run_id::text
    OR receipt->>'claim_id' IS DISTINCT FROM supplied_claim_id::text
    OR receipt->>'provider_task_uuid' IS DISTINCT FROM supplied_provider_task_uuid
    OR receipt->>'request_hash' IS DISTINCT FROM supplied_request_hash
    OR receipt#>>'{result,outputText}' IS DISTINCT FROM source_text
    OR receipt#>>'{result,status}' IS DISTINCT FROM 'succeeded'
    OR receipt#>>'{result,finishReason}' IS DISTINCT FROM 'stop'
    OR ceil((receipt#>>'{result,costUsd}')::numeric*1000000) IS DISTINCT FROM supplied_known_cost_micro_usd::numeric
  ) THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN others THEN RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_hosted_prompt_scene_correction_matches(jsonb,jsonb,text,uuid,uuid,text,text,bigint) FROM PUBLIC;

DO $$
DECLARE definition text; old_text text; new_text text;
BEGIN
  definition:=pg_get_functiondef('public.videoforge_replace_invalid_hosted_prompt_batch(uuid,integer,text,text,bigint,text,text)'::regprocedure);
  old_text:=$old$original_payload-'attempt_index' IS DISTINCT FROM replacement_payload-'attempt_index'$old$;
  new_text:=$new$(original_payload-'attempt_index' IS DISTINCT FROM replacement_payload-'attempt_index' AND NOT (
       original#>>'{0,deliveryMethod}'='async' AND original#>>'{0,outputFormat}'='JSON'
       AND jsonb_typeof(original#>'{0,jsonSchema}')='object'
       AND public.videoforge_hosted_prompt_scene_correction_matches(
         original_payload,replacement_payload,supplied_response_hash,run.id,claim_row.id,
         claim_row.provider_task_uuid,claim_row.request_hash,supplied_known_cost_micro_usd)))$new$;
  IF position(old_text IN definition)=0 THEN RAISE EXCEPTION 'prompt correction payload comparison drifted'; END IF;
  EXECUTE replace(definition,old_text,new_text);
END;
$$;

-- Durable provider-inert lane batches for the hosted canonical timing bridge. PostgreSQL rechecks
-- the exact bridge, request, active lease, inert runtime/lane state, and sealed deployment snapshot
-- before appending both batches atomically. Approval, fresh independent qualification, paid claim,
-- predispatch, envelope signing, and transport remain separate disabled activation gates.

CREATE TABLE public.hosted_lane_batches (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  generation_request_id uuid NOT NULL,
  generation_plan_sha256 text NOT NULL CHECK (generation_plan_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  deployment_id uuid NOT NULL,
  lane text NOT NULL CHECK (lane IN ('mage_image','soulx_avatar')),
  dispatch_task_id uuid NOT NULL,
  batch_ordinal smallint NOT NULL CHECK (batch_ordinal IN (1,2)),
  item_count integer NOT NULL CHECK (item_count BETWEEN 1 AND 4096),
  items_manifest_sha256 text NOT NULL CHECK (items_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  input_manifest_sha256 text NOT NULL CHECK (input_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  reservation_manifest_sha256 text NOT NULL CHECK (reservation_manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  request_body_sha256 text NOT NULL CHECK (request_body_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  envelope_sha256 text NOT NULL CHECK (envelope_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  output_prefix text NOT NULL CHECK (output_prefix ~ '^tenant/[A-Za-z0-9._:/-]+$'),
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND payload->>'schema_version' = 'videoforge-hosted-lane-batch/v1'
  ),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (account_id, workspace_id, id),
  UNIQUE (account_id, workspace_id, generation_request_id, lane),
  UNIQUE (account_id, workspace_id, generation_request_id, dispatch_task_id),
  FOREIGN KEY (account_id,workspace_id) REFERENCES public.workspaces(account_id,id),
  FOREIGN KEY (account_id,workspace_id,project_id) REFERENCES public.projects(account_id,workspace_id,id),
  FOREIGN KEY (account_id,workspace_id,project_revision_id) REFERENCES public.project_revisions(account_id,workspace_id,id),
  FOREIGN KEY (account_id,workspace_id,generation_request_id) REFERENCES public.generation_requests(account_id,workspace_id,id),
  FOREIGN KEY (deployment_id,lane) REFERENCES public.serverless_endpoint_deployments(id,lane),
  FOREIGN KEY (workspace_id,dispatch_task_id) REFERENCES public.generation_tasks(workspace_id,id),
  CHECK (item_count = jsonb_array_length(payload->'items'))
);

CREATE TABLE public.hosted_lane_batch_items (
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  item_ordinal integer NOT NULL CHECK (item_ordinal BETWEEN 1 AND 4096),
  generation_task_id uuid NOT NULL,
  input_reservation_id uuid NOT NULL,
  output_reservation_id uuid NOT NULL,
  task_key text NOT NULL CHECK (length(task_key) BETWEEN 1 AND 240),
  timeline_segment_id uuid NOT NULL,
  item_id text NOT NULL CHECK (length(item_id) BETWEEN 1 AND 240),
  artifact_input jsonb NOT NULL CHECK (jsonb_typeof(artifact_input) = 'object'),
  output_reservation jsonb NOT NULL CHECK (jsonb_typeof(output_reservation) = 'object'),
  PRIMARY KEY (batch_id,item_ordinal),
  UNIQUE (batch_id,generation_task_id),
  UNIQUE (batch_id,item_id),
  UNIQUE (batch_id,input_reservation_id),
  UNIQUE (batch_id,output_reservation_id),
  FOREIGN KEY (account_id,workspace_id,batch_id)
    REFERENCES public.hosted_lane_batches(account_id,workspace_id,id),
  FOREIGN KEY (workspace_id,generation_task_id)
    REFERENCES public.generation_tasks(workspace_id,id)
);

CREATE TRIGGER hosted_lane_batches_append_only BEFORE UPDATE OR DELETE ON public.hosted_lane_batches
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_lane_batch_items_append_only BEFORE UPDATE OR DELETE ON public.hosted_lane_batch_items
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_vnext_append_only();
CREATE TRIGGER hosted_lane_batches_tenant_write_guard BEFORE INSERT ON public.hosted_lane_batches
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
CREATE TRIGGER hosted_lane_batch_items_tenant_write_guard BEFORE INSERT ON public.hosted_lane_batch_items
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
ALTER TABLE public.hosted_lane_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_lane_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_lane_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_lane_batch_items FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_lane_batches_tenant_rls ON public.hosted_lane_batches
  USING (account_id=public.videoforge_current_account_id())
  WITH CHECK (account_id=public.videoforge_current_account_id());
CREATE POLICY hosted_lane_batch_items_tenant_rls ON public.hosted_lane_batch_items
  USING (account_id=public.videoforge_current_account_id())
  WITH CHECK (account_id=public.videoforge_current_account_id());

CREATE FUNCTION public.videoforge_hosted_dispatch_uuid(
  supplied_kind text, supplied_generation_request_id uuid, supplied_task_id uuid,
  supplied_attempt_ordinal integer
) RETURNS uuid LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=public,pg_catalog AS $$
DECLARE
  digest text;
BEGIN
  IF supplied_kind NOT IN ('attempt','authority','outbox') OR supplied_attempt_ordinal NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'hosted dispatch uuid input invalid' USING ERRCODE='22023';
  END IF;
  digest := encode(sha256(convert_to('hosted-serverless-'||supplied_kind||':'||
    supplied_generation_request_id::text||':'||supplied_task_id::text||':'||
    supplied_attempt_ordinal::text,'UTF8')),'hex');
  digest := substring(digest,1,12)||'5'||substring(digest,14,3)||'8'||substring(digest,18,15);
  RETURN (substring(digest,1,8)||'-'||substring(digest,9,4)||'-'||substring(digest,13,4)||'-'||
          substring(digest,17,4)||'-'||substring(digest,21,12))::uuid;
END;
$$;

CREATE FUNCTION public.videoforge_materialize_hosted_lane_batches(
  supplied_account_id uuid,
  supplied_workspace_id uuid,
  supplied_project_id uuid,
  supplied_project_revision_id uuid,
  supplied_generation_request_id uuid,
  supplied_generation_plan_sha256 text,
  supplied_batches jsonb
) RETURNS TABLE (replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_catalog AS $$
DECLARE
  bridge public.hosted_canonical_timing_bridges%ROWTYPE;
  request public.generation_requests%ROWTYPE;
  revision public.project_revisions%ROWTYPE;
  active_lease public.provider_workload_leases%ROWTYPE;
  runtime_parent public.video_runtime_states%ROWTYPE;
  mage_runtime_lane public.video_runtime_lane_states%ROWTYPE;
  soulx_runtime_lane public.video_runtime_lane_states%ROWTYPE;
  batch jsonb;
  item jsonb;
  existing public.hosted_lane_batches%ROWTYPE;
  deployment public.serverless_endpoint_deployments%ROWTYPE;
  expected_tasks jsonb;
  supplied_tasks jsonb;
  expected_item_manifest jsonb;
  expected_input_manifest jsonb;
  expected_reservation_manifest jsonb;
  expected_reservation_ids jsonb;
  lane_name text;
  existing_count integer;
  expected_attempt_id uuid;
  runtime_lane public.video_runtime_lane_states%ROWTYPE;
  db_now timestamptz := transaction_timestamp();
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR supplied_generation_plan_sha256 !~ '^sha256:[0-9a-f]{64}$'
     OR jsonb_typeof(supplied_batches) <> 'array' OR jsonb_array_length(supplied_batches) <> 2
     OR supplied_batches->0->>'lane' <> 'mage_image'
     OR supplied_batches->1->>'lane' <> 'soulx_avatar'
     OR EXISTS (
       SELECT 1 FROM (
         SELECT count(*) AS total,count(DISTINCT reservation_id) AS distinct_total
           FROM jsonb_array_elements(supplied_batches) lane_batch
           CROSS JOIN LATERAL jsonb_array_elements(lane_batch->'items') entry
           CROSS JOIN LATERAL (VALUES (entry->>'input_reservation_id'),
                                      (entry->>'output_reservation_id')) ids(reservation_id)
       ) reservation_counts WHERE total<>distinct_total
     ) THEN
    RAISE EXCEPTION 'hosted lane batch input is invalid' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(supplied_generation_request_id::text,41));

  SELECT * INTO bridge FROM public.hosted_canonical_timing_bridges
   WHERE account_id=supplied_account_id AND workspace_id=supplied_workspace_id
     AND project_id=supplied_project_id AND project_revision_id=supplied_project_revision_id
     AND generation_plan_sha256=supplied_generation_plan_sha256 FOR SHARE;
  SELECT * INTO request FROM public.generation_requests
   WHERE account_id=supplied_account_id AND workspace_id=supplied_workspace_id
     AND id=supplied_generation_request_id FOR SHARE;
  SELECT * INTO revision FROM public.project_revisions
   WHERE account_id=supplied_account_id AND workspace_id=supplied_workspace_id
     AND project_id=supplied_project_id AND id=supplied_project_revision_id FOR SHARE;
  SELECT * INTO active_lease FROM public.provider_workload_leases lease
   WHERE lease.account_id=supplied_account_id AND lease.workspace_id=supplied_workspace_id
     AND lease.generation_request_id=supplied_generation_request_id
     AND lease.request_kind='VIDEO' AND lease.state='ACTIVE' FOR SHARE;
  SELECT * INTO runtime_parent FROM public.video_runtime_states runtime
   WHERE runtime.account_id=supplied_account_id AND runtime.workspace_id=supplied_workspace_id
     AND runtime.generation_request_id=supplied_generation_request_id FOR SHARE;
  SELECT * INTO mage_runtime_lane FROM public.video_runtime_lane_states lane
   WHERE lane.account_id=supplied_account_id AND lane.workspace_id=supplied_workspace_id
     AND lane.runtime_id=runtime_parent.id AND lane.lane='mage_image' FOR SHARE;
  SELECT * INTO soulx_runtime_lane FROM public.video_runtime_lane_states lane
   WHERE lane.account_id=supplied_account_id AND lane.workspace_id=supplied_workspace_id
     AND lane.runtime_id=runtime_parent.id AND lane.lane='soulx_avatar' FOR SHARE;
  IF bridge.hosted_asr_attempt_id IS NULL OR request.id IS NULL
     OR request.project_id<>supplied_project_id OR request.project_revision_id<>supplied_project_revision_id
     OR request.state<>'ACTIVE' OR request.terminal_at IS NOT NULL
     OR revision.id IS NULL OR revision.status<>'LOCKED'
     OR active_lease.id IS NULL OR active_lease.released_at IS NOT NULL OR active_lease.expires_at<=db_now
     OR runtime_parent.id IS NULL OR runtime_parent.project_id<>supplied_project_id
     OR runtime_parent.project_revision_id<>supplied_project_revision_id
     OR runtime_parent.stage<>'WAITING_FOR_WORKER' OR runtime_parent.terminal_at IS NOT NULL
     OR mage_runtime_lane.id IS NULL OR mage_runtime_lane.state<>'MANIFEST_DURABLE'
     OR mage_runtime_lane.current_attempt_id IS NOT NULL
     OR soulx_runtime_lane.id IS NULL OR soulx_runtime_lane.state<>'MANIFEST_DURABLE'
     OR soulx_runtime_lane.current_attempt_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.serverless_attempts attempt
          WHERE attempt.account_id=supplied_account_id AND attempt.workspace_id=supplied_workspace_id
            AND attempt.generation_request_id=supplied_generation_request_id
            AND attempt.state NOT IN ('SUCCEEDED','PERMANENT_FAILED','CANCELLED')) THEN
    RAISE EXCEPTION 'hosted lane batches require current bridge, admission, and inert runtime'
      USING ERRCODE='23514';
  END IF;

  SELECT count(*) INTO existing_count FROM public.hosted_lane_batches b
   WHERE b.account_id=supplied_account_id AND b.workspace_id=supplied_workspace_id
     AND b.generation_request_id=supplied_generation_request_id;
  IF existing_count=1 THEN
    RAISE EXCEPTION 'hosted lane batch partial replay is forbidden' USING ERRCODE='23505';
  ELSIF existing_count=2 THEN
    IF (SELECT jsonb_agg(b.payload ORDER BY b.batch_ordinal) FROM public.hosted_lane_batches b
         WHERE b.account_id=supplied_account_id AND b.workspace_id=supplied_workspace_id
           AND b.generation_request_id=supplied_generation_request_id) IS DISTINCT FROM supplied_batches THEN
      RAISE EXCEPTION 'hosted lane batch idempotency conflict' USING ERRCODE='23505';
    END IF;
    RETURN QUERY SELECT true;
    RETURN;
  END IF;

  FOR batch IN SELECT value FROM jsonb_array_elements(supplied_batches) LOOP
    lane_name := batch->>'lane';
    IF lane_name='mage_image' THEN
      runtime_lane := mage_runtime_lane;
    ELSE
      runtime_lane := soulx_runtime_lane;
    END IF;
    expected_attempt_id := public.videoforge_hosted_dispatch_uuid('attempt',
      supplied_generation_request_id,(batch->>'dispatch_task_id')::uuid,runtime_lane.attempt_ordinal+1);
    IF batch->>'schema_version'<>'videoforge-hosted-lane-batch/v1'
       OR batch->>'id' !~ '^[0-9a-f-]{36}$' OR batch->>'dispatch_task_id' !~ '^[0-9a-f-]{36}$'
       OR batch->>'generation_plan_sha256'<>supplied_generation_plan_sha256
       OR (batch->>'batch_ordinal')::int <> (CASE lane_name WHEN 'mage_image' THEN 1 ELSE 2 END)
       OR (batch->>'attempt_ordinal')::int<>runtime_lane.attempt_ordinal+1
       OR runtime_lane.items_manifest_sha256<>batch->>'items_manifest_sha256'
       OR runtime_lane.planned_item_count<>jsonb_array_length(batch->'items')
       OR batch->>'items_manifest_sha256' !~ '^sha256:[0-9a-f]{64}$'
       OR batch->>'input_manifest_sha256' !~ '^sha256:[0-9a-f]{64}$'
       OR batch->>'reservation_manifest_sha256' !~ '^sha256:[0-9a-f]{64}$'
       OR batch->>'request_body_sha256' !~ '^sha256:[0-9a-f]{64}$'
       OR batch->>'envelope_sha256' !~ '^sha256:[0-9a-f]{64}$'
       OR (batch->>'max_input_bytes')::bigint<1 OR (batch->>'max_output_bytes')::bigint<1
       OR (batch->>'spend_ceiling_usd')::numeric<=0 OR (batch->>'spend_ceiling_usd')::numeric>2
       OR (batch->>'reservation_usd')::numeric<0
       OR (batch->>'reservation_usd')::numeric>(batch->>'spend_ceiling_usd')::numeric
       OR length(batch->>'rate_source')<1
       OR (batch->>'rate_checked_at')::timestamptz>db_now
       OR (batch->>'authority_expires_at')::timestamptz<=db_now
       OR batch->>'output_prefix' <>
         ('tenant/'||supplied_account_id::text||'/workspace/'||supplied_workspace_id::text||
          '/project/'||supplied_project_id::text||'/revision/'||supplied_project_revision_id::text||
          '/lane/'||(CASE lane_name WHEN 'mage_image' THEN 'mage-image' ELSE 'soulx-avatar' END)||
          '/job/'||expected_attempt_id::text)
       OR jsonb_typeof(batch->'items')<>'array' OR jsonb_array_length(batch->'items')<1
       OR jsonb_typeof(batch->'request_body')<>'object' OR jsonb_typeof(batch->'envelope')<>'object'
       OR batch->'envelope'->'tenant'->>'account_id'<>supplied_account_id::text
       OR batch->'envelope'->'tenant'->>'workspace_id'<>supplied_workspace_id::text
       OR batch->'envelope'->'work'->>'project_revision_id'<>supplied_project_revision_id::text
       OR batch->'envelope'->'work'->>'generation_request_id'<>supplied_generation_request_id::text
       OR batch->'envelope'->'work'->>'task_id'<>batch->>'dispatch_task_id'
       OR batch->'envelope'->'work'->>'attempt_id'<>expected_attempt_id::text
       OR batch->'envelope'->'work'->>'lane'<>lane_name
       OR batch->'envelope'->'work'->>'items_manifest_sha256'<>batch->>'items_manifest_sha256'
       OR (batch->'envelope'->'work'->>'item_count')::int<>jsonb_array_length(batch->'items')
       OR batch->'envelope'->'artifacts'->>'input_manifest_sha256'<>batch->>'input_manifest_sha256'
       OR batch->'envelope'->'artifacts'->>'output_prefix'<>batch->>'output_prefix'
       OR batch->'envelope'->'artifacts'->>'plan_manifest_sha256'<>supplied_generation_plan_sha256
       OR jsonb_typeof(batch->'envelope'->'artifacts'->'transfer_port_reservation_ids')<>'array'
       OR jsonb_array_length(batch->'envelope'->'artifacts'->'transfer_port_reservation_ids')<1
       OR ('sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(batch->'request_body'),'UTF8')),'hex'))
          <>batch->>'request_body_sha256'
       OR ('sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(batch->'envelope'),'UTF8')),'hex'))
          <>batch->>'envelope_sha256' THEN
      RAISE EXCEPTION 'hosted lane batch manifest is invalid' USING ERRCODE='23514';
    END IF;

    SELECT * INTO deployment FROM public.serverless_endpoint_deployments d
     WHERE d.id=(batch->>'deployment_id')::uuid AND d.lane=lane_name FOR SHARE;
    IF deployment.id IS NULL OR NOT deployment.is_active
       OR batch->>'deployment_snapshot_sha256'<>public.videoforge_hosted_deployment_snapshot_sha256(deployment.id) THEN
      RAISE EXCEPTION 'hosted lane batch deployment is not the exact active sealed snapshot'
        USING ERRCODE='23514';
    END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'task_id', manifest->>'id','task_key',manifest->>'task_key',
             'timeline_segment_id',manifest->>'timeline_segment_id') ORDER BY manifest->>'task_key'),'[]'::jsonb)
      INTO expected_tasks FROM jsonb_array_elements(bridge.task_manifest) manifest
     WHERE manifest->>'lane'=CASE lane_name WHEN 'mage_image' THEN 'IMAGE' ELSE 'AVATAR' END;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'task_id', value->>'task_id','task_key',value->>'task_key',
             'timeline_segment_id',value->>'timeline_segment_id') ORDER BY ordinal),'[]'::jsonb)
      INTO supplied_tasks FROM jsonb_array_elements(batch->'items') WITH ORDINALITY AS entry(value,ordinal);
    IF supplied_tasks IS DISTINCT FROM expected_tasks THEN
      RAISE EXCEPTION 'hosted lane batch items conflict with canonical task order or lineage'
        USING ERRCODE='23514';
    END IF;
    SELECT
      (SELECT jsonb_agg(jsonb_build_object('item_id',value->>'item_id','task_id',value->>'task_id',
               'task_key',value->>'task_key','timeline_segment_id',value->>'timeline_segment_id') ORDER BY ordinal)
         FROM jsonb_array_elements(batch->'items') WITH ORDINALITY e(value,ordinal)),
      (SELECT jsonb_agg(value->'artifact_input' ORDER BY ordinal)
         FROM jsonb_array_elements(batch->'items') WITH ORDINALITY e(value,ordinal)),
      (SELECT jsonb_agg(jsonb_build_object('input_reservation_id',value->>'input_reservation_id',
               'output_reservation_id',value->>'output_reservation_id',
               'artifact_input',value->'artifact_input','output_reservation',value->'output_reservation') ORDER BY ordinal)
         FROM jsonb_array_elements(batch->'items') WITH ORDINALITY e(value,ordinal)),
      (SELECT jsonb_agg(reservation_id ORDER BY ordinal,reservation_order)
         FROM jsonb_array_elements(batch->'items') WITH ORDINALITY entry(value,ordinal)
         CROSS JOIN LATERAL (VALUES (value->>'input_reservation_id',1),
                                    (value->>'output_reservation_id',2)) reservation(reservation_id,reservation_order))
      INTO expected_item_manifest,expected_input_manifest,expected_reservation_manifest,expected_reservation_ids;
    IF batch->>'items_manifest_sha256' <>
         ('sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(expected_item_manifest),'UTF8')),'hex'))
       OR batch->>'input_manifest_sha256' <>
         ('sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(expected_input_manifest),'UTF8')),'hex'))
       OR batch->>'reservation_manifest_sha256' <>
         ('sha256:'||encode(sha256(convert_to(public.videoforge_canonical_jsonb(expected_reservation_manifest),'UTF8')),'hex'))
       OR batch->'envelope'->'artifacts'->'transfer_port_reservation_ids' IS DISTINCT FROM expected_reservation_ids THEN
      RAISE EXCEPTION 'hosted lane batch canonical item or reservation manifest drift'
        USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(batch->'items') WITH ORDINALITY e(value,ordinal)
      WHERE (value->>'item_ordinal')::int<>ordinal OR value->>'item_id'<>value->>'task_id'
        OR length(value->>'item_id')>160 OR jsonb_typeof(value->'artifact_input')<>'object'
        OR jsonb_typeof(value->'output_reservation')<>'object'
        OR value->>'input_reservation_id' !~ '^[0-9a-f-]{36}$'
        OR value->>'output_reservation_id' !~ '^[0-9a-f-]{36}$'
        OR value->>'input_reservation_id'=value->>'output_reservation_id'
        OR value->'artifact_input'->>'reservation_id'<>value->>'input_reservation_id'
        OR value->'output_reservation'->>'reservation_id'<>value->>'output_reservation_id'
        OR value->'output_reservation'->>'object_prefix'<>batch->>'output_prefix') THEN
      RAISE EXCEPTION 'hosted lane batch reservation or ordinal is invalid' USING ERRCODE='23514';
    END IF;

    SELECT * INTO existing FROM public.hosted_lane_batches
     WHERE account_id=supplied_account_id AND workspace_id=supplied_workspace_id
       AND generation_request_id=supplied_generation_request_id AND lane=lane_name FOR UPDATE;
    IF existing.id IS NOT NULL THEN
      IF existing.id::text<>batch->>'id' OR existing.payload IS DISTINCT FROM batch THEN
        RAISE EXCEPTION 'hosted lane batch idempotency conflict' USING ERRCODE='23505';
      END IF;
      CONTINUE;
    END IF;

    INSERT INTO public.generation_tasks(id,account_id,workspace_id,owner_type,owner_id,
      project_revision_id,task_key,lane,state,required,depends_on,created_at,updated_at)
    VALUES ((batch->>'dispatch_task_id')::uuid,supplied_account_id,supplied_workspace_id,
      'PROJECT_REVISION',supplied_project_revision_id,supplied_project_revision_id,
      'hosted-lane-batch:'||lane_name||':'||substring(supplied_generation_plan_sha256 from 8 for 16),
      CASE lane_name WHEN 'mage_image' THEN 'IMAGE' ELSE 'AVATAR' END,'READY',true,
      (SELECT jsonb_agg(value->>'task_id' ORDER BY ordinal)
         FROM jsonb_array_elements(batch->'items') WITH ORDINALITY AS e(value,ordinal)),db_now,db_now);
    INSERT INTO public.hosted_lane_batches(id,account_id,workspace_id,project_id,project_revision_id,
      generation_request_id,generation_plan_sha256,deployment_id,lane,dispatch_task_id,
      batch_ordinal,item_count,items_manifest_sha256,input_manifest_sha256,request_body_sha256,
      reservation_manifest_sha256,envelope_sha256,output_prefix,payload,created_at)
    VALUES ((batch->>'id')::uuid,supplied_account_id,supplied_workspace_id,supplied_project_id,
      supplied_project_revision_id,supplied_generation_request_id,supplied_generation_plan_sha256,
      deployment.id,lane_name,(batch->>'dispatch_task_id')::uuid,
      (batch->>'batch_ordinal')::smallint,jsonb_array_length(batch->'items'),
      batch->>'items_manifest_sha256',batch->>'input_manifest_sha256',batch->>'request_body_sha256',
      batch->>'reservation_manifest_sha256',batch->>'envelope_sha256',batch->>'output_prefix',batch,db_now);
    FOR item IN SELECT value FROM jsonb_array_elements(batch->'items') WITH ORDINALITY ORDER BY ordinality LOOP
      INSERT INTO public.hosted_lane_batch_items(account_id,workspace_id,batch_id,item_ordinal,
        generation_task_id,input_reservation_id,output_reservation_id,task_key,timeline_segment_id,
        item_id,artifact_input,output_reservation)
      VALUES (supplied_account_id,supplied_workspace_id,(batch->>'id')::uuid,
        (item->>'item_ordinal')::int,(item->>'task_id')::uuid,
        (item->>'input_reservation_id')::uuid,(item->>'output_reservation_id')::uuid,item->>'task_key',
        (item->>'timeline_segment_id')::uuid,item->>'item_id',item->'artifact_input',item->'output_reservation');
    END LOOP;
  END LOOP;
  RETURN QUERY SELECT false;
END;
$$;

-- Existing transport history is preserved. New and changed hosted attempts must reference the
-- exact tenant-owned dispatch task of their immutable lane batch.
CREATE FUNCTION public.videoforge_validate_hosted_attempt_batch_lineage() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.hosted_canonical_timing_bridges bridge
     WHERE bridge.account_id=NEW.account_id AND bridge.workspace_id=NEW.workspace_id
       AND bridge.project_revision_id=NEW.project_revision_id
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.hosted_lane_batches b
     JOIN public.generation_tasks t ON t.workspace_id=b.workspace_id AND t.id=b.dispatch_task_id
    WHERE b.account_id=NEW.account_id AND b.workspace_id=NEW.workspace_id
      AND b.project_id=NEW.project_id AND b.project_revision_id=NEW.project_revision_id
      AND b.generation_request_id=NEW.generation_request_id AND b.dispatch_task_id=NEW.task_id
      AND b.lane=NEW.lane
      AND t.account_id=NEW.account_id
      AND t.lane=CASE NEW.lane WHEN 'mage_image' THEN 'IMAGE' ELSE 'AVATAR' END
  ) THEN
    RAISE EXCEPTION 'hosted serverless attempt lacks exact lane-batch task lineage'
      USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER serverless_attempts_hosted_batch_lineage
  BEFORE INSERT OR UPDATE OF account_id,workspace_id,project_id,project_revision_id,
    generation_request_id,task_id,lane ON public.serverless_attempts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_validate_hosted_attempt_batch_lineage();

REVOKE ALL ON TABLE public.hosted_lane_batches FROM PUBLIC;
REVOKE ALL ON TABLE public.hosted_lane_batch_items FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_hosted_dispatch_uuid(text,uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_materialize_hosted_lane_batches(uuid,uuid,uuid,uuid,uuid,text,jsonb) FROM PUBLIC;

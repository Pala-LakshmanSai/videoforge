-- Fresh ordinary videos: duration-derived finite quote, funded lane deadlines, no replay.
-- Existing candidates and historical short qualification admissions keep their original rules.
CREATE FUNCTION public.videoforge_ordinary_video_budget(total_frames bigint)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=public,pg_catalog AS $$
DECLARE duration_ms bigint; cap_micro bigint; primary_micro bigint; total_seconds bigint; mage_seconds bigint;
BEGIN
  IF total_frames<1 OR total_frames>108000 THEN
    RAISE EXCEPTION 'ORDINARY_VIDEO_DURATION_OUT_OF_RANGE' USING ERRCODE='23514';
  END IF;
  duration_ms:=ceil(total_frames::numeric*1000/30)::bigint;
  cap_micro:=2000000+ceil(greatest(0,duration_ms-1200000)::numeric*3000000/2400000/10000)::bigint*10000;
  primary_micro:=(cap_micro-512000)/2;
  total_seconds:=floor(primary_micro::numeric*3600/1116000)::bigint;
  mage_seconds:=total_seconds/4;
  RETURN jsonb_build_object('budgetVersion','ordinary-video-budget/v1','durationMs',duration_ms,
    'hardVariableCostCeilingMicroUsd',cap_micro,'primaryExecutionForecastMicroUsd',primary_micro,
    'possibleDuplicateLiabilityMicroUsd',primary_micro,'settlementReserveMicroUsd',512000,
    'maximumFlexRateMicroUsdPerGpuHour',1116000,'totalGpuTimeoutSeconds',total_seconds,'mageImageTimeoutSeconds',least(total_seconds,3000),
    'soulxAvatarTimeoutSeconds',least(total_seconds,6600),'noRedispatch',true);
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_ordinary_video_budget(bigint) FROM PUBLIC;

-- Fail on predecessor drift rather than partially changing an authority constructor.
CREATE FUNCTION pg_temp.vf_budget_replace(source text, needle text, replacement text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF position(needle IN source)=0 THEN RAISE EXCEPTION 'ordinary budget predecessor drift: %',left(needle,100); END IF;
  RETURN replace(source,needle,replacement);
END;
$$;

DO $migration$
DECLARE definition text;
BEGIN
  definition:=pg_get_functiondef('public.videoforge_materialize_hosted_v209_ordinary_dispatch(uuid,uuid,uuid,uuid)'::regprocedure);
  definition:=pg_temp.vf_budget_replace(definition,$old$expires_at timestamptz; materialized_replay boolean; attempt_count integer;$old$,$new$expires_at timestamptz; materialized_replay boolean; attempt_count integer; budget jsonb; budget_cap numeric; lane_seconds integer;$new$);
  definition:=pg_temp.vf_budget_replace(definition,$old$  SELECT jsonb_agg(jsonb_build_object('task_id'$old$,$new$  budget:=public.videoforge_ordinary_video_budget(plan.total_frames);
  budget_cap:=(budget->>'hardVariableCostCeilingMicroUsd')::numeric/1000000;
  UPDATE public.provider_workload_leases SET
    expires_at=greatest(expires_at,db_now+make_interval(secs=>greatest(3600,(budget->>'soulxAvatarTimeoutSeconds')::integer+600))),
    heartbeat_at=db_now,version=version+1
    WHERE id=lease.id AND state='ACTIVE' AND released_at IS NULL RETURNING * INTO lease;
  SELECT jsonb_agg(jsonb_build_object('task_id'$new$);
  definition:=pg_temp.vf_budget_replace(definition,$old$'execution_timeout_seconds',deployment.execution_timeout_seconds,$old$,$new$'execution_timeout_seconds',CASE lane_name WHEN 'mage_image' THEN (budget->>'mageImageTimeoutSeconds')::integer ELSE (budget->>'soulxAvatarTimeoutSeconds')::integer END,$new$);
  definition:=pg_temp.vf_budget_replace(definition,$old$'max_output_bytes',2147483648,'spend_ceiling_usd',1,'reservation_usd',0.744,$old$,$new$'max_output_bytes',2147483648,'spend_ceiling_usd',budget_cap,'reservation_usd',(budget->>'primaryExecutionForecastMicroUsd')::numeric/1000000,$new$);
  definition:=pg_temp.vf_budget_replace(definition,$old$'resources',lane_binding->'resources','capUsd',2,$old$,$new$'resources',lane_binding->'resources','capUsd',budget_cap,$new$);
  definition:=pg_temp.vf_budget_replace(definition,$old$'laneBindings',lane_bindings,'totalCapUsd',2,$old$,$new$'laneBindings',lane_bindings,'totalCapUsd',budget_cap,$new$);
  definition:=pg_temp.vf_budget_replace(definition,$old$'approvalId',approval_id,'approvalSha256',approval_sha,'totalCapUsd',2,$old$,$new$'approvalId',approval_id,'approvalSha256',approval_sha,'totalCapUsd',budget_cap,'budgetVersion','ordinary-video-budget/v1',$new$);
  definition:=pg_temp.vf_budget_replace(definition,$old$lease.id,lane_bindings,2,expires_at,$old$,$new$lease.id,lane_bindings,budget_cap,expires_at,$new$);
  definition:=pg_temp.vf_budget_replace(definition,$old$expires_at:=least(db_now+interval '1 hour',lease.expires_at);$old$,$new$expires_at:=least(db_now+make_interval(secs=>greatest(3600,(budget->>'soulxAvatarTimeoutSeconds')::integer+600)),lease.expires_at);$new$);
  definition:=pg_temp.vf_budget_replace(definition,$old$  IF expires_at<=db_now+interval '30 minutes' THEN$old$,$new$  IF expires_at<db_now+make_interval(secs=>greatest(3600,(budget->>'soulxAvatarTimeoutSeconds')::integer+600)) THEN$new$);
  EXECUTE definition;
END;
$migration$;

DO $migration$
DECLARE definition text;
BEGIN
  definition:=pg_get_functiondef('public.videoforge_v209_ordinary_pair_legacy_0081(uuid,uuid,uuid,uuid,jsonb)'::regprocedure);
  definition:=pg_temp.vf_budget_replace(definition,$old$admission_hash text; claim_id uuid; pair jsonb; lane_bindings jsonb;$old$,$new$admission_hash text; claim_id uuid; pair jsonb; lane_bindings jsonb; budget jsonb; budget_cap_micro bigint; primary_micro bigint; cancel_seconds integer;$new$);
  definition:=pg_temp.vf_budget_replace(definition,$old$  admission_hash:='sha256:'$old$,$new$  IF candidate.candidate_document->>'budgetVersion'='ordinary-video-budget/v1' THEN
    budget:=public.videoforge_ordinary_video_budget((candidate.candidate_document#>>'{renderPlan,totalFrames}')::bigint);
  END IF;
  budget_cap_micro:=coalesce((budget->>'hardVariableCostCeilingMicroUsd')::bigint,2000000);
  primary_micro:=coalesce((budget->>'primaryExecutionForecastMicroUsd')::bigint,744000);
  cancel_seconds:=coalesce((budget->>'soulxAvatarTimeoutSeconds')::integer,1200);
  admission_hash:='sha256:'$new$);
  definition:=pg_temp.vf_budget_replace(definition,$old$::integer<>744000$old$,$new$::integer<>primary_micro$new$);
  definition:=pg_temp.vf_budget_replace(definition,$old$::integer<>2000000$old$,$new$::integer<>budget_cap_micro$new$);
  definition:=pg_temp.vf_budget_replace(definition,$old$::bigint+2000000>17500000$old$,$new$::bigint+budget_cap_micro>17500000$new$);
  definition:=pg_temp.vf_budget_replace(definition,$old$(supplied_admission->>'databaseNow')::timestamptz+interval '20 minutes'$old$,$new$(supplied_admission->>'databaseNow')::timestamptz+make_interval(secs=>cancel_seconds)$new$);
  definition:=pg_temp.vf_budget_replace(definition,$old$(supplied_admission->>'databaseNow')::timestamptz+interval '30 minutes'$old$,$new$(supplied_admission->>'databaseNow')::timestamptz+make_interval(secs=>cancel_seconds+600)$new$);
  definition:=pg_temp.vf_budget_replace(definition,$old$  IF reservation_total<>1.488 OR$old$,$new$  IF reservation_total<>(primary_micro*2)::numeric/1000000 OR$new$);
  definition:=pg_temp.vf_budget_replace(definition,$old$request.id,candidate.generation_plan_sha256,candidate.lease_id,lane_bindings,2,$old$,$new$request.id,candidate.generation_plan_sha256,candidate.lease_id,lane_bindings,budget_cap_micro::numeric/1000000,$new$);
  definition:=pg_temp.vf_budget_replace(definition,$old$candidate.generation_plan_sha256,candidate.work_manifest_sha256,2000000,17500000,$old$,$new$candidate.generation_plan_sha256,candidate.work_manifest_sha256,budget_cap_micro,17500000,$new$);
  definition:=pg_temp.vf_budget_replace(definition,$old$'total_cap_usd',2,'committed_at'$old$,$new$'total_cap_usd',budget_cap_micro::numeric/1000000,'committed_at'$new$);
  definition:=pg_temp.vf_budget_replace(definition,$old$  IF EXISTS(SELECT 1 FROM public.serverless_attempts a WHERE a.account_id=supplied_account_id$old$,$new$  IF budget IS NOT NULL AND (supplied_admission->'cost' - 'combinedCompletionCapMicroUsd') IS DISTINCT FROM budget THEN
    RAISE EXCEPTION 'ordinary duration budget drifted' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.serverless_attempts a WHERE a.account_id=supplied_account_id$new$);
  EXECUTE definition;
  definition:=pg_get_functiondef('public.videoforge_v209_ordinary_commit_lane_legacy_0081(uuid,uuid,uuid,text,uuid,text,jsonb,text)'::regprocedure);
  definition:=pg_temp.vf_budget_replace(definition,$old$'total_cap_usd',2,'committed_at'$old$,
    $new$'total_cap_usd',(candidate.candidate_document->>'totalCapUsd')::numeric,'committed_at'$new$);
  EXECUTE definition;
END;
$migration$;

-- Historical short admissions retain their exact original cap and schedule.
DO $migration$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN SELECT conname,pg_get_constraintdef(oid) definition
    FROM pg_constraint WHERE conrelid='public.hosted_v209_short_admissions'::regclass AND contype='c'
  LOOP
    IF position('phase_cap_micro_usd' IN constraint_row.definition)>0 OR
       position('cancel_at' IN constraint_row.definition)>0 OR position('stop_at' IN constraint_row.definition)>0 THEN
      EXECUTE format('ALTER TABLE public.hosted_v209_short_admissions DROP CONSTRAINT %I',constraint_row.conname);
    END IF;
  END LOOP;
END;
$migration$;
ALTER TABLE public.hosted_v209_short_admissions ADD CONSTRAINT hosted_admission_funded_budget CHECK ((
  CASE WHEN admission_document#>>'{cost,budgetVersion}'='ordinary-video-budget/v1' THEN
    phase_cap_micro_usd BETWEEN 2000000 AND 5000000 AND
    phase_cap_micro_usd=(admission_document#>>'{cost,hardVariableCostCeilingMicroUsd}')::bigint AND
    cancel_at=database_observed_at+make_interval(secs=>(admission_document#>>'{cost,soulxAvatarTimeoutSeconds}')::integer) AND
    stop_at=cancel_at+interval '10 minutes'
  ELSE phase_cap_micro_usd=2000000 AND cancel_at=database_observed_at+interval '20 minutes' AND
    stop_at=database_observed_at+interval '30 minutes' END
) IS TRUE);

CREATE FUNCTION public.videoforge_hosted_pair_funded_deadlines(supplied_account_id uuid,supplied_workspace_id uuid,supplied_generation_request_id uuid)
RETURNS TABLE(lane text,funded_deadline_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN
    RAISE EXCEPTION 'tenant mismatch' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  WITH charged AS (
    SELECT attempt.lane,admission.database_observed_at AS anchor,
      (admission.admission_document#>>'{cost,totalGpuTimeoutSeconds}')::integer AS pool_seconds,
      CASE attempt.lane WHEN 'mage_image' THEN (admission.admission_document#>>'{cost,mageImageTimeoutSeconds}')::integer
      ELSE (admission.admission_document#>>'{cost,soulxAvatarTimeoutSeconds}')::integer END AS hard_seconds,
      greatest(0,extract(epoch FROM least(transaction_timestamp(),coalesce(attempt.provider_terminal_observed_at,CASE WHEN attempt.state IN ('SUCCEEDED','PERMANENT_FAILED','CANCELLED') THEN attempt.updated_at ELSE transaction_timestamp() END))-admission.database_observed_at)) AS charged_seconds,
      (attempt.provider_terminal_observed_at IS NOT NULL OR attempt.state IN ('SUCCEEDED','PERMANENT_FAILED','CANCELLED')) AS terminal
    FROM public.hosted_v209_short_admissions admission JOIN public.serverless_attempts attempt
      ON attempt.account_id=admission.account_id AND attempt.workspace_id=admission.workspace_id
      AND attempt.generation_request_id=admission.generation_request_id
    WHERE admission.account_id=supplied_account_id AND admission.workspace_id=supplied_workspace_id
      AND admission.generation_request_id=supplied_generation_request_id
      AND admission.admission_document#>>'{cost,budgetVersion}'='ordinary-video-budget/v1'
      AND attempt.lane IN ('mage_image','soulx_avatar')
  )
  SELECT current_lane.lane,current_lane.anchor+make_interval(secs=>least(current_lane.hard_seconds,
    CASE WHEN other_lane.terminal THEN greatest(0,current_lane.pool_seconds-other_lane.charged_seconds)
      ELSE current_lane.pool_seconds/2.0 END)::double precision)
    FROM charged current_lane JOIN charged other_lane ON other_lane.lane<>current_lane.lane;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_hosted_pair_funded_deadlines(uuid,uuid,uuid) FROM PUBLIC;
-- This projection exposes only the same tenant-owned pair as the existing inspection capability.
DO $migration$
DECLARE principal record;
BEGIN
  FOR principal IN SELECT DISTINCT role.rolname FROM pg_proc procedure
    CROSS JOIN LATERAL aclexplode(procedure.proacl) privilege
    JOIN pg_roles role ON role.oid=privilege.grantee
    WHERE procedure.oid='public.videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid)'::regprocedure
      AND privilege.privilege_type='EXECUTE'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.videoforge_hosted_pair_funded_deadlines(uuid,uuid,uuid) TO %I',principal.rolname);
  END LOOP;
END;
$migration$;

-- Worker signature TTL is separate from funded cancellation; old signatures remain untouched.
DO $migration$
DECLARE definition text; signature text; budget_ttl text;
BEGIN
  budget_ttl:=$expression$CASE supplied_lane WHEN 'mage_image' THEN 3600 ELSE greatest(3600,
    (public.videoforge_ordinary_video_budget((candidate.candidate_document#>>'{renderPlan,totalFrames}')::bigint)->>'soulxAvatarTimeoutSeconds')::integer+600) END$expression$;
  FOREACH signature IN ARRAY ARRAY[
    'public.videoforge_v209_ordinary_load_lane_legacy_0081(uuid,uuid,uuid,text)',
    'public.videoforge_v209_ordinary_commit_lane_legacy_0081(uuid,uuid,uuid,text,uuid,text,jsonb,text)'
  ] LOOP
    definition:=pg_get_functiondef(signature::regprocedure);
    definition:=pg_temp.vf_budget_replace(definition,$old$lane_expires_at:=target.deadline_at;$old$,
      'lane_expires_at:=CASE WHEN candidate.candidate_document->>''budgetVersion''=''ordinary-video-budget/v1'' THEN target.attempt_created_at+make_interval(secs=>'||budget_ttl||') ELSE target.deadline_at END;');
    IF position('_load_lane_' IN signature)>0 THEN
      definition:=pg_temp.vf_budget_replace(definition,
        $old$(supplied_lane='soulx_avatar' AND target.request_ttl_seconds<>3600)$old$,
        $new$(supplied_lane='soulx_avatar' AND CASE WHEN candidate.candidate_document->>'budgetVersion'='ordinary-video-budget/v1' THEN target.request_ttl_seconds<extract(epoch FROM lane_expires_at-target.attempt_created_at) ELSE target.request_ttl_seconds<>3600 END)$new$);
      definition:=pg_temp.vf_budget_replace(definition,
        $old$RETURN jsonb_build_object('schemaVersion','videoforge.hosted-v209-ordinary-lane-materialization/v1',$old$,
        $new$RETURN CASE WHEN candidate.candidate_document->>'budgetVersion'='ordinary-video-budget/v1' THEN
          jsonb_build_object('budgetVersion','ordinary-video-budget/v1','durationMs',
            ceil((candidate.candidate_document#>>'{renderPlan,totalFrames}')::numeric*1000/30)::bigint)
          ELSE '{}'::jsonb END || jsonb_build_object('schemaVersion','videoforge.hosted-v209-ordinary-lane-materialization/v1',$new$);
    ELSE
      definition:=pg_temp.vf_budget_replace(definition,
        $old$(supplied_lane='soulx_avatar' AND deployment.request_ttl_seconds<>3600)$old$,
        $new$(supplied_lane='soulx_avatar' AND CASE WHEN candidate.candidate_document->>'budgetVersion'='ordinary-video-budget/v1' THEN deployment.request_ttl_seconds<extract(epoch FROM lane_expires_at-target.attempt_created_at) ELSE deployment.request_ttl_seconds<>3600 END)$new$);
    END IF;
    EXECUTE definition;
  END LOOP;
END;
$migration$;

-- Keep the durable render manifest identity on the admitted video runtime.
-- The manifest row and runtime row must agree before render terminalization.
CREATE FUNCTION public.videoforge_pin_hosted_v209_render_manifest_runtime(
  supplied_account_id uuid,
  supplied_workspace_id uuid,
  supplied_project_revision_id uuid,
  supplied_generation_request_id uuid,
  supplied_manifest_sha256 text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE
  runtime public.video_runtime_states%ROWTYPE;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id THEN
    RAISE EXCEPTION 'hosted V2-09 render manifest runtime scope invalid' USING ERRCODE='42501';
  END IF;
  IF supplied_project_revision_id IS NULL
    OR supplied_generation_request_id IS NULL
    OR supplied_manifest_sha256 IS NULL
    OR supplied_manifest_sha256 !~ '^sha256:[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'hosted V2-09 render manifest runtime pin invalid' USING ERRCODE='23514';
  END IF;

  SELECT * INTO runtime
  FROM public.video_runtime_states
  WHERE account_id=supplied_account_id
    AND workspace_id=supplied_workspace_id
    AND project_revision_id=supplied_project_revision_id
    AND generation_request_id=supplied_generation_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hosted V2-09 render manifest runtime binding missing' USING ERRCODE='23503';
  END IF;

  IF runtime.render_manifest_sha256 IS NOT NULL THEN
    IF runtime.render_manifest_sha256<>supplied_manifest_sha256 THEN
      RAISE EXCEPTION 'hosted V2-09 render manifest runtime pin conflict' USING ERRCODE='23505';
    END IF;
    RETURN;
  END IF;
  IF runtime.stage IN ('COMPLETE','FAILED','CANCELED') THEN
    RAISE EXCEPTION 'hosted V2-09 render manifest runtime is terminal without a pin' USING ERRCODE='55000';
  END IF;

  UPDATE public.video_runtime_states
  SET render_manifest_sha256=supplied_manifest_sha256,
      version=version+1,
      updated_at=transaction_timestamp()
  WHERE account_id=supplied_account_id
    AND workspace_id=supplied_workspace_id
    AND project_revision_id=supplied_project_revision_id
    AND generation_request_id=supplied_generation_request_id
    AND render_manifest_sha256 IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hosted V2-09 render manifest runtime pin update failed' USING ERRCODE='55000';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.videoforge_pin_hosted_v209_render_manifest_runtime(uuid,uuid,uuid,uuid,text) FROM PUBLIC;

-- Repair rows created before the runtime pin was added. Scope every match by
-- tenant, project, revision, and generation request before changing a digest.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.hosted_v209_ordinary_resolved_render_manifests AS manifest
    JOIN public.video_runtime_states AS runtime
      ON runtime.account_id=manifest.account_id
     AND runtime.workspace_id=manifest.workspace_id
     AND runtime.project_id=manifest.project_id
     AND runtime.project_revision_id=manifest.project_revision_id
     AND runtime.generation_request_id=manifest.generation_request_id
    WHERE runtime.render_manifest_sha256 IS NOT NULL
      AND runtime.render_manifest_sha256<>manifest.manifest_sha256
  ) THEN
    RAISE EXCEPTION 'hosted V2-09 render manifest runtime pin conflict' USING ERRCODE='23505';
  END IF;

  UPDATE public.video_runtime_states AS runtime
  SET render_manifest_sha256=manifest.manifest_sha256,
      version=runtime.version+1,
      updated_at=transaction_timestamp()
  FROM public.hosted_v209_ordinary_resolved_render_manifests AS manifest
  WHERE runtime.account_id=manifest.account_id
    AND runtime.workspace_id=manifest.workspace_id
    AND runtime.project_id=manifest.project_id
    AND runtime.project_revision_id=manifest.project_revision_id
    AND runtime.generation_request_id=manifest.generation_request_id
    AND runtime.render_manifest_sha256 IS NULL
    AND runtime.stage NOT IN ('COMPLETE','FAILED','CANCELED');
END;
$migration$;

-- Pin both the first commit and an exact replay. The helper is deliberately
-- called after the manifest row is durable, so a pin failure rolls back both.
DO $migration$
DECLARE
  definition text;
  return_needle text := $needle$RETURN jsonb_build_object('schemaVersion','videoforge.hosted-v209-resolved-render-manifest/v1',$needle$;
  replay_prefix text := $replay$PERFORM public.videoforge_pin_hosted_v209_render_manifest_runtime(existing.account_id,existing.workspace_id,existing.project_revision_id,existing.generation_request_id,existing.manifest_sha256);
$replay$;
  commit_prefix text := $commit$PERFORM public.videoforge_pin_hosted_v209_render_manifest_runtime(supplied_account_id,supplied_workspace_id,(ready#>>'{revision,snapshot,id}')::uuid,supplied_generation_request_id,supplied_manifest_sha256);
$commit$;
  replay_at integer;
  commit_at integer;
  commit_relative_at integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.videoforge_commit_hosted_v209_resolved_render_manifest(uuid,uuid,uuid,jsonb,text,text,bigint)'::regprocedure
  ) INTO definition;
  replay_at:=strpos(definition,return_needle);
  IF replay_at=0 OR strpos(substring(definition from replay_at),$replayed$'replayed',true$replayed$)=0 THEN
    RAISE EXCEPTION 'hosted V2-09 render manifest runtime pin preimage drifted' USING ERRCODE='23514';
  END IF;
  commit_relative_at:=strpos(substring(definition from replay_at+length(return_needle)),return_needle);
  IF commit_relative_at=0 OR strpos(substring(definition from replay_at+commit_relative_at),$replayed$'replayed',false$replayed$)=0 THEN
    RAISE EXCEPTION 'hosted V2-09 render manifest runtime pin preimage drifted' USING ERRCODE='23514';
  END IF;
  commit_at:=replay_at+length(return_needle)+commit_relative_at-1;
  definition:=overlay(definition placing replay_prefix from replay_at for 0);
  commit_at:=commit_at+length(replay_prefix);
  definition:=overlay(definition placing commit_prefix from commit_at for 0);
  EXECUTE definition;
END;
$migration$;

REVOKE ALL ON FUNCTION public.videoforge_commit_hosted_v209_resolved_render_manifest(uuid,uuid,uuid,jsonb,text,text,bigint) FROM PUBLIC;

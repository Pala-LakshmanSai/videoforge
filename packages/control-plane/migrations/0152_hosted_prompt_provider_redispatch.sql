-- Bounded redispatch for hosted image-prompt writing whose provider gave no accepted prompt set.
--
-- Observed in production: a transient Runware 5xx during prompt writing settled the run as
-- state=UNKNOWN / problem_code=HOSTED_PROMPT_EXECUTION_UNKNOWN with provider_may_have_charged=true
-- and no durable accepted prompt set. Every later `POST /prompts` answered 409
-- HOSTED_PROMPT_EXECUTION_ALREADY_CLAIMED, so the revision could never advance past stage 5 --
-- the same stranding the voiceover-context path had before 0150/0151.
--
-- This migration only widens the plan payload so the route can apply a bounded, evidence-gated
-- redispatch: the latest run for the revision (including its provider problem code, whether it may
-- have charged, whether it ever produced a durable accepted set, and how many attempts the revision
-- has already spent). No state is rewritten and no budget is enforced here; the route keeps the
-- reservation semantics and the spend guard.
--
-- The previous revision of this function selected `state` with a bare scalar subquery, which raises
-- `more than one row returned by a subquery used as an expression` as soon as a revision owns more
-- than one run. That is unreachable today (only one run per revision exists) but becomes reachable
-- the moment a redispatch is granted, so each lookup is now ordered and limited to the newest run.

CREATE OR REPLACE FUNCTION public.videoforge_load_hosted_prompt_plan(supplied_account_id uuid, supplied_workspace_id uuid, supplied_user_id uuid, supplied_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM supplied_account_id
     OR NOT EXISTS (
       SELECT 1 FROM public.memberships membership
        WHERE membership.account_id=supplied_account_id
          AND membership.workspace_id=supplied_workspace_id
          AND membership.user_id=supplied_user_id AND membership.status='ACTIVE'
     ) THEN
    RAISE EXCEPTION 'hosted prompt plan scope is invalid' USING ERRCODE='42501';
  END IF;
  WITH latest_revision AS (
    SELECT revision.*
      FROM public.projects project
      JOIN public.project_revisions revision
        ON revision.account_id=project.account_id AND revision.workspace_id=project.workspace_id
       AND revision.project_id=project.id
     WHERE project.account_id=supplied_account_id AND project.workspace_id=supplied_workspace_id
       AND project.id=supplied_project_id AND project.status='ACTIVE'
       AND project.project_kind='USER'
     ORDER BY revision.revision_number DESC, revision.id DESC
     LIMIT 1
  ), selected AS (
    SELECT revision.id revision_id,revision.title,revision.status revision_state,
           revision.image_style_version_id,revision.style_profile_hash revision_style_hash,
           revision.extra_prompt_keywords,revision.apply_extra_prompt_keywords,
           (revision.revision_config_payload->>'spend_cap_usd')::numeric spend_cap_usd,
           head.current_timeline_plan_id timeline_id,plan.canonical_document_hash timeline_hash,
           style.state style_state,style.style_profile_hash,style.profile_payload
      FROM latest_revision revision
      JOIN public.revision_timing_heads head
        ON head.account_id=revision.account_id AND head.workspace_id=revision.workspace_id
       AND head.project_revision_id=revision.id
      JOIN public.timeline_plans plan
        ON plan.account_id=head.account_id AND plan.workspace_id=head.workspace_id
       AND plan.project_revision_id=head.project_revision_id
       AND plan.id=head.current_timeline_plan_id
      JOIN public.image_style_versions style
        ON style.account_id=revision.account_id AND style.workspace_id=revision.workspace_id
       AND style.id=revision.image_style_version_id
      JOIN public.hosted_voiceover_contexts context
        ON context.account_id=revision.account_id AND context.workspace_id=revision.workspace_id
       AND context.project_revision_id=revision.id AND context.state='SUCCEEDED'
     ORDER BY plan.plan_sequence DESC
     LIMIT 1
  ), ordered_segments AS (
    SELECT segment.*,lag(segment.narration) OVER(ORDER BY segment.segment_index) prior_narration,
           lead(segment.narration) OVER(ORDER BY segment.segment_index) next_narration
      FROM public.timeline_segments segment JOIN selected
        ON segment.account_id=supplied_account_id AND segment.workspace_id=supplied_workspace_id
       AND segment.project_revision_id=selected.revision_id
       AND segment.timeline_plan_id=selected.timeline_id
  )
  SELECT jsonb_build_object(
    'workspace_id',supplied_workspace_id,'project_id',supplied_project_id,
    'revision_id',selected.revision_id,'project_title',selected.title,
    'revision_state',selected.revision_state,'timeline_id',selected.timeline_id,
    'timeline_hash',selected.timeline_hash,
    'image_style_version_id',selected.image_style_version_id,
    'revision_style_hash',selected.revision_style_hash,
    'style_state',selected.style_state,'style_profile_hash',selected.style_profile_hash,
    'profile_payload',selected.profile_payload,
    'story_context',(SELECT context.context_document::text FROM public.hosted_voiceover_contexts context
      WHERE context.account_id=supplied_account_id AND context.workspace_id=supplied_workspace_id
        AND context.project_revision_id=selected.revision_id AND context.state='SUCCEEDED'),
    'extra_prompt_keywords',selected.extra_prompt_keywords,
    'apply_extra_prompt_keywords',selected.apply_extra_prompt_keywords,
    'spend_cap_usd',selected.spend_cap_usd,
    'existing_run_state',(SELECT run.state FROM public.hosted_prompt_runs run
      WHERE run.account_id=supplied_account_id AND run.workspace_id=supplied_workspace_id
        AND run.project_revision_id=selected.revision_id
      ORDER BY run.created_at DESC LIMIT 1),
    'existing_run_problem_code',(SELECT run.problem_code FROM public.hosted_prompt_runs run
      WHERE run.account_id=supplied_account_id AND run.workspace_id=supplied_workspace_id
        AND run.project_revision_id=selected.revision_id
      ORDER BY run.created_at DESC LIMIT 1),
    'existing_run_provider_may_have_charged',(SELECT run.provider_may_have_charged FROM public.hosted_prompt_runs run
      WHERE run.account_id=supplied_account_id AND run.workspace_id=supplied_workspace_id
        AND run.project_revision_id=selected.revision_id
      ORDER BY run.created_at DESC LIMIT 1),
    'existing_run_has_accepted_set',(SELECT run.acceptance_fingerprint_hash IS NOT NULL FROM public.hosted_prompt_runs run
      WHERE run.account_id=supplied_account_id AND run.workspace_id=supplied_workspace_id
        AND run.project_revision_id=selected.revision_id
      ORDER BY run.created_at DESC LIMIT 1),
    'existing_run_count',(SELECT count(*) FROM public.hosted_prompt_runs run
      WHERE run.account_id=supplied_account_id AND run.workspace_id=supplied_workspace_id
        AND run.project_revision_id=selected.revision_id),
    'all_segments',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'scene_id',segment_key,'segment_index',segment_index,'phrase',narration)
      ORDER BY segment_index) FROM ordered_segments),'[]'::jsonb),
    'scenes',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'scene_id',segment_key,'phrase',narration,'prior_context',prior_narration,
      'next_context',next_narration,'in_image_shot_role',in_image_shot_role,
      'layout',CASE timeline_composition WHEN 'IMAGE_FULL' THEN 'IMAGE_FULL'
                ELSE 'SPLIT_RIGHT_IMAGE' END) ORDER BY segment_index)
      FROM ordered_segments WHERE timeline_composition IN ('IMAGE_FULL','AVATAR_SPLIT_IMAGE')),'[]'::jsonb)
  ) INTO result FROM selected;
  RETURN result;
END;
$function$;

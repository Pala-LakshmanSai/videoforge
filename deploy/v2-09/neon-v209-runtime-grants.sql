-- Rebuild the fresh hosted login's exact V2-09 table and function capabilities.
-- Established tenant RLS remains enforced; no V2-10+ capability is granted.

\set ON_ERROR_STOP on
\if :{?runtime_role}
\else
SELECT 1/0;
\endif

BEGIN;
SET search_path=public,pg_catalog;
SELECT pg_advisory_xact_lock(1448494662,9);

SELECT (count(*)=1 AND bool_and(rolcanlogin AND NOT rolsuper AND NOT rolcreaterole
  AND NOT rolcreatedb AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls
  AND rolconfig IS NULL)) AS runtime_role_valid
FROM pg_roles WHERE rolname=:'runtime_role'
\gset
\if :runtime_role_valid
\else
ROLLBACK;
SELECT 1/0;
\endif

GRANT USAGE ON SCHEMA public TO :"runtime_role";
REVOKE CREATE ON SCHEMA public FROM :"runtime_role";
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM :"runtime_role";

-- Fresh per-authority LOGIN NOINHERIT roles have no inherited V2-06 table ACLs.
-- Recreate only the established hosted table matrix; RLS and tenant triggers still apply.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"runtime_role";
CREATE TEMP TABLE v209_runtime_table_allowlist(table_name text, privilege text,
  PRIMARY KEY(table_name,privilege)) ON COMMIT DROP;
INSERT INTO v209_runtime_table_allowlist(table_name,privilege) VALUES
  ('artifact_receipts','INSERT'),
  ('artifact_receipts','SELECT'),
  ('artifact_reservations','INSERT'),
  ('artifact_reservations','SELECT'),
  ('artifact_reservations','UPDATE'),
  ('assets','INSERT'),
  ('assets','SELECT'),
  ('assets','UPDATE'),
  ('avatar_profile_assets','INSERT'),
  ('avatar_profile_assets','SELECT'),
  ('avatar_profile_versions','INSERT'),
  ('avatar_profile_versions','SELECT'),
  ('avatar_profile_versions','UPDATE'),
  ('avatar_profiles','INSERT'),
  ('avatar_profiles','SELECT'),
  ('avatar_profiles','UPDATE'),
  ('cost_events','SELECT'),
  ('generation_requests','SELECT'),
  ('generation_tasks','SELECT'),
  ('hosted_auth_accounts','DELETE'),
  ('hosted_auth_accounts','INSERT'),
  ('hosted_auth_accounts','SELECT'),
  ('hosted_auth_accounts','UPDATE'),
  ('hosted_auth_sessions','DELETE'),
  ('hosted_auth_sessions','INSERT'),
  ('hosted_auth_sessions','SELECT'),
  ('hosted_auth_sessions','UPDATE'),
  ('hosted_auth_users','DELETE'),
  ('hosted_auth_users','INSERT'),
  ('hosted_auth_users','SELECT'),
  ('hosted_auth_users','UPDATE'),
  ('hosted_auth_verifications','DELETE'),
  ('hosted_auth_verifications','INSERT'),
  ('hosted_auth_verifications','SELECT'),
  ('hosted_auth_verifications','UPDATE'),
  ('hosted_cpu_job_attempts','INSERT'),
  ('hosted_cpu_job_attempts','SELECT'),
  ('hosted_cpu_job_attempts','UPDATE'),
  ('hosted_cpu_job_events','INSERT'),
  ('hosted_cpu_job_events','SELECT'),
  ('hosted_cpu_upload_authorities','INSERT'),
  ('hosted_cpu_upload_authorities','SELECT'),
  ('hosted_cpu_upload_authorities','UPDATE'),
  ('hosted_pair_zero_worker_observations','SELECT'),
  ('hosted_project_create_requests','INSERT'),
  ('hosted_project_create_requests','SELECT'),
  ('hosted_project_create_requests','UPDATE'),
  ('hosted_project_reviews','INSERT'),
  ('hosted_project_reviews','SELECT'),
  ('hosted_prompt_batch_progress','SELECT'),
  ('hosted_prompt_runs','SELECT'),
  ('hosted_prompt_scene_progress','SELECT'),
  ('hosted_render_plans','SELECT'),
  ('hosted_voiceover_contexts','SELECT'),
  ('image_style_references','INSERT'),
  ('image_style_references','SELECT'),
  ('image_style_versions','INSERT'),
  ('image_style_versions','SELECT'),
  ('image_style_versions','UPDATE'),
  ('image_styles','INSERT'),
  ('image_styles','SELECT'),
  ('image_styles','UPDATE'),
  ('media_worker_devices','INSERT'),
  ('media_worker_devices','SELECT'),
  ('media_worker_devices','UPDATE'),
  ('media_worker_enrollments','INSERT'),
  ('media_worker_enrollments','SELECT'),
  ('media_worker_enrollments','UPDATE'),
  ('media_worker_events','INSERT'),
  ('media_worker_events','SELECT'),
  ('media_worker_input_objects','INSERT'),
  ('media_worker_input_objects','SELECT'),
  ('media_worker_leases','INSERT'),
  ('media_worker_leases','SELECT'),
  ('media_worker_leases','UPDATE'),
  ('project_revisions','INSERT'),
  ('project_revisions','SELECT'),
  ('project_revisions','UPDATE'),
  ('projects','INSERT'),
  ('projects','SELECT'),
  ('projects','UPDATE'),
  ('prompt_executions','SELECT'),
  ('prompt_scene_results','SELECT'),
  ('revision_timing_heads','SELECT'),
  ('serverless_attempts','SELECT'),
  ('serverless_cost_ledgers','SELECT'),
  ('serverless_output_receipts','SELECT'),
  ('serverless_progress_events','SELECT'),
  ('timeline_plans','SELECT'),
  ('timeline_segments','SELECT'),
  ('video_runtime_lane_states','SELECT'),
  ('video_runtime_states','SELECT'),
  ('workspaces','SELECT');
SELECT format('GRANT %s ON TABLE public.%I TO %I;',privilege,table_name,:'runtime_role')
FROM v209_runtime_table_allowlist ORDER BY table_name,privilege
\gexec

CREATE TEMP TABLE v209_runtime_function_allowlist(signature text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO v209_runtime_function_allowlist(signature) VALUES
  ('videoforge_admit_hosted_v209_generation(uuid,uuid,uuid,uuid)'),
  ('videoforge_append_hosted_canonical_timing(uuid,uuid,uuid,uuid,uuid,uuid,jsonb)'),
  ('videoforge_append_hosted_render_plan(uuid,uuid,uuid,uuid,text,jsonb,text)'),
  ('videoforge_archive_hosted_preset(uuid,uuid,text,uuid)'),
  ('videoforge_archive_hosted_project(uuid,uuid,uuid)'),
  ('videoforge_authorize_hosted_cpu_upload(uuid,text,text,text,text,bigint,text,timestamp with time zone)'),
  ('videoforge_begin_hosted_pair_send(uuid,uuid,uuid,text,uuid,text)'),
  ('videoforge_begin_hosted_v209_ordinary_send(uuid,uuid,uuid,text,uuid,text,text)'),
  ('videoforge_commit_hosted_atomic_pair_predispatch(uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,numeric,timestamp with time zone,jsonb,jsonb)'),
  ('videoforge_commit_hosted_v209_ordinary_lane_materialization(uuid,uuid,uuid,text,uuid,text,jsonb,text)'),
  ('videoforge_commit_hosted_v209_ordinary_pair(uuid,uuid,uuid,uuid,jsonb)'),
  ('videoforge_complete_hosted_prompt_run(jsonb)'),
  ('videoforge_complete_hosted_voiceover_context(jsonb)'),
  ('videoforge_consume_hosted_rate_limit(text,text)'),
  ('videoforge_current_account_id()'),
  ('videoforge_due_hosted_cpu_retention(integer)'),
  ('videoforge_fail_hosted_prompt_run(uuid,text,text,boolean,bigint)'),
  ('videoforge_fail_hosted_voiceover_context(uuid,text,text,boolean)'),
  ('videoforge_finalize_hosted_v209_span_audio(uuid,uuid,uuid,jsonb)'),
  ('videoforge_finish_hosted_cpu_retention(uuid,text)'),
  ('videoforge_finish_hosted_pair_send(uuid,uuid,uuid,text,text,text,uuid,text)'),
  ('videoforge_finish_hosted_style_analysis(uuid,text,text,text,bigint,bigint,bigint)'),
  ('videoforge_hosted_cpu_expected_primary_output(uuid,text)'),
  ('videoforge_hosted_session_scope(text)'),
  ('videoforge_has_hosted_v209_ordinary_candidate(uuid,uuid,uuid)'),
  ('videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid)'),
  ('videoforge_load_hosted_gpu_activation_v1()'),
  ('videoforge_load_hosted_gpu_activation_v2()'),
  ('videoforge_load_hosted_pair_activation(uuid,uuid,uuid)'),
  ('videoforge_load_hosted_pair_activation_v2(uuid,uuid,uuid)'),
  ('videoforge_load_hosted_prompt_plan(uuid,uuid,uuid,uuid)'),
  ('videoforge_load_hosted_v209_ordinary_lane_materialization(uuid,uuid,uuid,text)'),
  ('videoforge_resume_hosted_v209_ordinary_lane_materialization(uuid,uuid,uuid,text)'),
  ('videoforge_materialize_hosted_lane_batches(uuid,uuid,uuid,uuid,uuid,text,jsonb)'),
  ('videoforge_materialize_hosted_v209_ordinary_dispatch(uuid,uuid,uuid,uuid)'),
  ('videoforge_materialize_hosted_v209_span_audio_jobs(uuid,uuid,uuid,uuid)'),
  ('videoforge_materialize_hosted_v209_system_avatar_reference(uuid,uuid,uuid,uuid)'),
  ('videoforge_media_worker_device_scope(text)'),
  ('videoforge_media_worker_enrollment_consume(uuid,text)'),
  ('videoforge_media_worker_enrollment_poll(uuid,text,timestamp with time zone)'),
  ('videoforge_prepare_hosted_pair_send(uuid,uuid,uuid)'),
  ('videoforge_prepare_hosted_prompt_run(jsonb)'),
  ('videoforge_prepare_hosted_voiceover_context(jsonb)'),
  ('videoforge_read_system_avatar_version_assets(uuid)'),
  ('videoforge_reconcile_stale_hosted_prompt_dispatches(uuid)'),
  ('videoforge_reconcile_unknown_hosted_voiceover_context(jsonb)'),
  ('videoforge_record_hosted_prompt_batch(uuid,jsonb)'),
  ('videoforge_record_hosted_prompt_scene(uuid,jsonb)'),
  ('videoforge_recover_hosted_atomic_pair_tokens(uuid,uuid,uuid)'),
  ('videoforge_redeem_hosted_invite(text,text)'),
  ('videoforge_renew_hosted_v209_ordinary_candidate(uuid,uuid,uuid,uuid,uuid,uuid,integer,integer,text,uuid,uuid)'),
  ('videoforge_reserve_hosted_style_analysis(uuid,text,uuid)');

SELECT format('GRANT EXECUTE ON FUNCTION public.%s TO %I;',signature,:'runtime_role')
FROM v209_runtime_function_allowlist ORDER BY signature
\gexec

SELECT (
  NOT EXISTS (
    SELECT 1 FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) AS capability(privilege)
    WHERE namespace.nspname='public' AND relation.relkind IN ('r','p','v','m','f')
      AND has_table_privilege(:'runtime_role',relation.oid,capability.privilege)
          <> EXISTS (SELECT 1 FROM v209_runtime_table_allowlist allowed
            WHERE allowed.table_name=relation.relname AND allowed.privilege=capability.privilege)
  )
  AND NOT EXISTS (SELECT 1 FROM v209_runtime_table_allowlist allowed
    WHERE NOT has_table_privilege(:'runtime_role',('public.'||quote_ident(allowed.table_name))::regclass,allowed.privilege))
  AND has_schema_privilege(:'runtime_role','public','USAGE')
  AND NOT has_schema_privilege(:'runtime_role','public','CREATE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
    WHERE namespace.nspname='public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend dependency JOIN pg_extension extension
          ON extension.oid=dependency.refobjid
        WHERE dependency.classid='pg_proc'::regclass AND dependency.objid=procedure.oid
          AND dependency.deptype='e'
      )
      AND has_function_privilege(:'runtime_role',procedure.oid,'EXECUTE')
      AND procedure.oid::regprocedure::text NOT IN
        (SELECT signature FROM v209_runtime_function_allowlist)
  )
  AND NOT EXISTS (
    SELECT signature FROM v209_runtime_function_allowlist
    WHERE NOT has_function_privilege(:'runtime_role',('public.'||signature)::regprocedure,'EXECUTE')
  )
  -- PostgreSQL 16+ records one creator-admin membership with INHERIT/SET disabled when a
  -- CREATEROLE login creates this NOINHERIT role. It is cleanup authority, not effective access.
  AND NOT EXISTS (
    SELECT 1 FROM pg_auth_members membership
    JOIN pg_roles member_role ON member_role.oid=membership.member
    JOIN pg_roles granted_role ON granted_role.oid=membership.roleid
    WHERE (member_role.rolname=:'runtime_role' OR granted_role.rolname=:'runtime_role')
      AND NOT (
        granted_role.rolname=:'runtime_role'
        AND member_role.rolname=current_user
        AND membership.admin_option
        AND NOT membership.inherit_option
        AND NOT membership.set_option
      )
  )
  AND 1 >= (
    SELECT count(*) FROM pg_auth_members membership
    JOIN pg_roles member_role ON member_role.oid=membership.member
    JOIN pg_roles granted_role ON granted_role.oid=membership.roleid
    WHERE member_role.rolname=:'runtime_role' OR granted_role.rolname=:'runtime_role'
  )
) AS v209_runtime_acl_exact
\gset
\if :v209_runtime_acl_exact
COMMIT;
\else
ROLLBACK;
SELECT 1/0;
\endif

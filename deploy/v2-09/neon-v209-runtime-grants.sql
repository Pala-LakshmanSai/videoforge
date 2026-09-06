-- Rebuild the hosted login's function capabilities at the V2-09 boundary only. The established
-- table grants from the deployed V2-06/V2-08 application remain unchanged; no V2-10+ function is
-- executable after this transaction.

\if :{?runtime_role}
\else
\quit 1
\endif

\set ON_ERROR_STOP on
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
\quit 1
\endif

GRANT USAGE ON SCHEMA public TO :"runtime_role";
REVOKE CREATE ON SCHEMA public FROM :"runtime_role";
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM :"runtime_role";

CREATE TEMP TABLE v209_runtime_function_allowlist(signature text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO v209_runtime_function_allowlist(signature) VALUES
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
  ('videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid)'),
  ('videoforge_load_hosted_gpu_activation_v1()'),
  ('videoforge_load_hosted_gpu_activation_v2()'),
  ('videoforge_load_hosted_pair_activation(uuid,uuid,uuid)'),
  ('videoforge_load_hosted_pair_activation_v2(uuid,uuid,uuid)'),
  ('videoforge_load_hosted_prompt_plan(uuid,uuid,uuid,uuid)'),
  ('videoforge_load_hosted_v209_ordinary_lane_materialization(uuid,uuid,uuid,text)'),
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
  ('videoforge_reserve_hosted_style_analysis(uuid,text,uuid)');

SELECT format('GRANT EXECUTE ON FUNCTION public.%s TO %I;',signature,:'runtime_role')
FROM v209_runtime_function_allowlist ORDER BY signature
\gexec

SELECT (
  has_schema_privilege(:'runtime_role','public','USAGE')
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
) AS v209_runtime_acl_exact
\gset
\if :v209_runtime_acl_exact
COMMIT;
\else
ROLLBACK;
\quit 1
\endif

-- Apply only with the migration owner after migrations 0037-0045 have an exact manifest ledger.
-- Both login roles are pre-created, unprivileged, NOINHERIT roles. Credentials are provisioned
-- separately and must never be passed through this file.
--   psql --variable=runtime_role=... --variable=reconciler_role=... --file=...

\if :{?runtime_role}
\else
\quit
\endif
\if :{?reconciler_role}
\else
\quit
\endif

\set ON_ERROR_STOP on
BEGIN;
SET search_path = public, pg_catalog;

SELECT (:'runtime_role'<>:'reconciler_role' AND count(*)=2
  AND bool_and(rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolinherit
    AND NOT rolreplication AND NOT rolbypassrls)) AS pair_roles_valid
FROM pg_roles WHERE rolname IN (:'runtime_role',:'reconciler_role')
\gset
\if :pair_roles_valid
\else
ROLLBACK;
\quit
\endif

REVOKE EXECUTE ON FUNCTION public.videoforge_settle_hosted_pair_cleanup(uuid,uuid,uuid,jsonb)
FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.videoforge_settle_hosted_pair_cleanup(uuid,uuid,uuid,jsonb)
FROM :"runtime_role";
REVOKE EXECUTE ON FUNCTION public.videoforge_record_hosted_pair_zero_worker(uuid,uuid,uuid,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.videoforge_settle_hosted_pair_cleanup_v2(uuid,uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.videoforge_load_hosted_v209_settlement_guard(uuid,uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.videoforge_complete_v209_terminal_acceptance(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.videoforge_load_v209_terminal_output_projection(uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.videoforge_load_v212_terminal_output_projection(uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.videoforge_load_v209_terminal_output_projection(uuid,uuid,uuid,text)
FROM :"runtime_role";

REVOKE EXECUTE ON FUNCTION public.videoforge_load_v212_terminal_output_projection(uuid,text,text)
FROM :"runtime_role";

GRANT USAGE ON SCHEMA public TO :"reconciler_role";
REVOKE CREATE ON SCHEMA public FROM :"reconciler_role";
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"reconciler_role";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM :"reconciler_role";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM :"reconciler_role";

GRANT USAGE ON SCHEMA public TO :"runtime_role";
REVOKE CREATE ON SCHEMA public FROM :"runtime_role";
GRANT EXECUTE ON FUNCTION
  public.videoforge_claim_v213_resolved_render_manifest_read(jsonb),
  public.videoforge_claim_v213_acceptance_workflow(jsonb),
  public.videoforge_read_v213_acceptance_workflow(jsonb),
  public.videoforge_request_v213_acceptance_workflow_cleanup(jsonb),
  public.videoforge_request_v213_acceptance_operator_evidence(jsonb),
  public.videoforge_prepare_v213_acceptance_technical_capture(jsonb),
  public.videoforge_prepare_v213_v211_policy_action(jsonb),
  public.videoforge_prepare_v213_v211_scenario_step(jsonb),
  public.videoforge_cancel_v213_v211_promoted_probe(jsonb),
  public.videoforge_authorize_v213_v211_restore(jsonb),
  public.videoforge_ingest_v213_acceptance_operator_evidence(jsonb)
TO :"runtime_role";

GRANT EXECUTE ON FUNCTION public.videoforge_current_account_id()
TO :"reconciler_role";
GRANT EXECUTE ON FUNCTION public.videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid)
TO :"reconciler_role";
GRANT EXECUTE ON FUNCTION public.videoforge_settle_hosted_pair_cleanup_v2(uuid,uuid,uuid,jsonb,jsonb,jsonb)
TO :"reconciler_role";
GRANT EXECUTE ON FUNCTION public.videoforge_load_hosted_v209_settlement_guard(uuid,uuid,uuid)
TO :"reconciler_role";
GRANT EXECUTE ON FUNCTION public.videoforge_complete_v209_terminal_acceptance(jsonb)
TO :"reconciler_role";
GRANT EXECUTE ON FUNCTION public.videoforge_load_v209_terminal_output_projection(uuid,uuid,uuid,text)
TO :"reconciler_role";
GRANT EXECUTE ON FUNCTION public.videoforge_load_v212_terminal_output_projection(uuid,text,text)
TO :"reconciler_role";
GRANT EXECUTE ON FUNCTION public.videoforge_record_v213_acceptance_technical_capture(jsonb),
  public.videoforge_record_v213_v211_policy_action(jsonb),
  public.videoforge_record_v213_v211_scenario_step(jsonb),
  public.videoforge_record_v213_v211_promoted_probe_reconciliation(jsonb),
  public.videoforge_record_v213_acceptance_zero_worker_read(jsonb),
  public.videoforge_finalize_v213_acceptance_workflow(jsonb)
TO :"reconciler_role";

SELECT
  (NOT has_function_privilege('PUBLIC',
    'public.videoforge_settle_hosted_pair_cleanup(uuid,uuid,uuid,jsonb)','EXECUTE'))
  AND (NOT has_function_privilege(:'runtime_role',
    'public.videoforge_settle_hosted_pair_cleanup(uuid,uuid,uuid,jsonb)','EXECUTE'))
  AND (NOT has_function_privilege(:'reconciler_role',
    'public.videoforge_settle_hosted_pair_cleanup(uuid,uuid,uuid,jsonb)','EXECUTE'))
  AND (NOT has_function_privilege(:'reconciler_role',
    'public.videoforge_record_hosted_pair_zero_worker(uuid,uuid,uuid,jsonb)','EXECUTE'))
  AND has_function_privilege(:'reconciler_role',
    'public.videoforge_settle_hosted_pair_cleanup_v2(uuid,uuid,uuid,jsonb,jsonb,jsonb)','EXECUTE')
  AND has_function_privilege(:'reconciler_role',
    'public.videoforge_load_hosted_v209_settlement_guard(uuid,uuid,uuid)','EXECUTE')
  AND has_function_privilege(:'reconciler_role',
    'public.videoforge_complete_v209_terminal_acceptance(jsonb)','EXECUTE')
  AND has_function_privilege(:'reconciler_role',
    'public.videoforge_load_v209_terminal_output_projection(uuid,uuid,uuid,text)','EXECUTE')
  AND has_function_privilege(:'reconciler_role',
    'public.videoforge_load_v212_terminal_output_projection(uuid,text,text)','EXECUTE')
  AND has_function_privilege(:'reconciler_role',
    'public.videoforge_record_v213_acceptance_technical_capture(jsonb)','EXECUTE')
  AND has_function_privilege(:'reconciler_role',
    'public.videoforge_record_v213_v211_policy_action(jsonb)','EXECUTE')
  AND has_function_privilege(:'reconciler_role',
    'public.videoforge_record_v213_v211_scenario_step(jsonb)','EXECUTE')
  AND has_function_privilege(:'reconciler_role',
    'public.videoforge_record_v213_v211_promoted_probe_reconciliation(jsonb)','EXECUTE')
  AND has_function_privilege(:'reconciler_role',
    'public.videoforge_record_v213_acceptance_zero_worker_read(jsonb)','EXECUTE')
  AND has_function_privilege(:'reconciler_role',
    'public.videoforge_finalize_v213_acceptance_workflow(jsonb)','EXECUTE')
  AND has_function_privilege(:'runtime_role',
    'public.videoforge_claim_v213_resolved_render_manifest_read(jsonb)','EXECUTE')
  AND has_function_privilege(:'runtime_role',
    'public.videoforge_claim_v213_acceptance_workflow(jsonb)','EXECUTE')
  AND has_function_privilege(:'runtime_role',
    'public.videoforge_read_v213_acceptance_workflow(jsonb)','EXECUTE')
  AND has_function_privilege(:'runtime_role',
    'public.videoforge_prepare_v213_acceptance_technical_capture(jsonb)','EXECUTE')
  AND has_function_privilege(:'runtime_role',
    'public.videoforge_prepare_v213_v211_policy_action(jsonb)','EXECUTE')
  AND has_function_privilege(:'runtime_role',
    'public.videoforge_prepare_v213_v211_scenario_step(jsonb)','EXECUTE')
  AND has_function_privilege(:'runtime_role',
    'public.videoforge_cancel_v213_v211_promoted_probe(jsonb)','EXECUTE')
  AND has_function_privilege(:'runtime_role',
    'public.videoforge_authorize_v213_v211_restore(jsonb)','EXECUTE')
  AND has_function_privilege(:'runtime_role',
    'public.videoforge_ingest_v213_acceptance_operator_evidence(jsonb)','EXECUTE')
  AND (NOT has_table_privilege(:'reconciler_role','public.serverless_attempts','SELECT'))
  AND (NOT has_table_privilege(:'reconciler_role','public.provider_workload_leases','UPDATE'))
  AS pair_acl_exact
\gset
\if :pair_acl_exact
COMMIT;
\else
ROLLBACK;
\quit
\endif

-- Apply with the migration owner after the current committed migration ledger. The runtime and
-- reconciler login roles must already exist and remain distinct, unprivileged NOINHERIT roles.
-- This file grants only the V2-09 ordinary-pair reconciliation capabilities used by the hosted
-- production composition. It grants no table or sequence access and no V2-10+ capability.
--   psql --variable=runtime_role=... --variable=reconciler_role=... \
--     --file=deploy/v2-09/neon-pair-reconciler-grants.sql

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
SELECT pg_advisory_xact_lock(1448494662,9);

SELECT (:'runtime_role'<>:'reconciler_role' AND count(*)=2
  AND bool_and(rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
    AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls AND rolconfig IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM (
      SELECT datdba AS owner_oid FROM pg_database
      UNION ALL SELECT extowner FROM pg_extension
      UNION ALL SELECT relowner FROM pg_class
      UNION ALL SELECT nspowner FROM pg_namespace
      UNION ALL SELECT proowner FROM pg_proc
      UNION ALL SELECT typowner FROM pg_type
      UNION ALL SELECT fdwowner FROM pg_foreign_data_wrapper
      UNION ALL SELECT srvowner FROM pg_foreign_server
      UNION ALL SELECT evtowner FROM pg_event_trigger
      UNION ALL SELECT spcowner FROM pg_tablespace
      UNION ALL SELECT pubowner FROM pg_publication
      UNION ALL SELECT subowner FROM pg_subscription
      UNION ALL SELECT lomowner FROM pg_largeobject_metadata
      UNION ALL SELECT collowner FROM pg_collation
      UNION ALL SELECT cfgowner FROM pg_ts_config
      UNION ALL SELECT dictowner FROM pg_ts_dict
    ) owned
    JOIN pg_roles owner_role ON owner_role.oid=owned.owner_oid
    WHERE owner_role.rolname IN (:'runtime_role',:'reconciler_role')
  ))
  AS reconciliation_roles_valid
FROM pg_roles
WHERE rolname IN (:'runtime_role',:'reconciler_role')
\gset
\if :reconciliation_roles_valid
\else
ROLLBACK;
\quit
\endif

GRANT USAGE ON SCHEMA public TO :"reconciler_role";
REVOKE CREATE ON SCHEMA public FROM :"reconciler_role";
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"reconciler_role";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM :"reconciler_role";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM :"reconciler_role";

REVOKE EXECUTE ON FUNCTION
  public.videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid),
  public.videoforge_settle_hosted_pair_cleanup_v2(uuid,uuid,uuid,jsonb,jsonb,jsonb),
  public.videoforge_load_hosted_v209_settlement_guard(uuid,uuid,uuid),
  public.videoforge_complete_v209_terminal_acceptance(jsonb),
  public.videoforge_load_v209_terminal_output_projection(uuid,uuid,uuid,text),
  public.videoforge_read_hosted_v209_terminal_lineage(uuid,uuid,uuid,text,text),
  public.videoforge_accept_hosted_v209_terminal_output(
    uuid,uuid,uuid,text,text,text,jsonb,jsonb,timestamptz
  ),
  public.videoforge_read_hosted_v209_ready_render_inputs(uuid,uuid,uuid),
  public.videoforge_commit_hosted_v209_resolved_render_manifest(
    uuid,uuid,uuid,jsonb,text,text,bigint
  )
FROM :"runtime_role";

GRANT EXECUTE ON FUNCTION
  public.videoforge_current_account_id(),
  public.videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid),
  public.videoforge_settle_hosted_pair_cleanup_v2(uuid,uuid,uuid,jsonb,jsonb,jsonb),
  public.videoforge_load_hosted_v209_settlement_guard(uuid,uuid,uuid),
  public.videoforge_complete_v209_terminal_acceptance(jsonb),
  public.videoforge_load_v209_terminal_output_projection(uuid,uuid,uuid,text),
  public.videoforge_read_hosted_v209_terminal_lineage(uuid,uuid,uuid,text,text),
  public.videoforge_accept_hosted_v209_terminal_output(
    uuid,uuid,uuid,text,text,text,jsonb,jsonb,timestamptz
  ),
  public.videoforge_read_hosted_v209_ready_render_inputs(uuid,uuid,uuid),
  public.videoforge_commit_hosted_v209_resolved_render_manifest(
    uuid,uuid,uuid,jsonb,text,text,bigint
  )
TO :"reconciler_role";

SELECT (
  has_schema_privilege(:'reconciler_role','public','USAGE')
  AND NOT has_schema_privilege(:'reconciler_role','public','CREATE')
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE grantee=:'reconciler_role' AND table_schema='public'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.role_usage_grants
    WHERE grantee=:'reconciler_role' AND object_schema='public'
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_auth_members membership
    JOIN pg_roles member_role ON member_role.oid=membership.member
    JOIN pg_roles granted_role ON granted_role.oid=membership.roleid
    WHERE member_role.rolname=:'reconciler_role' OR granted_role.rolname=:'reconciler_role'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
    WHERE namespace.nspname='public'
      AND has_function_privilege(:'reconciler_role',procedure.oid,'EXECUTE')
      AND procedure.oid::regprocedure::text<>ALL(ARRAY[
        'videoforge_current_account_id()',
        'videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid)',
        'videoforge_settle_hosted_pair_cleanup_v2(uuid,uuid,uuid,jsonb,jsonb,jsonb)',
        'videoforge_load_hosted_v209_settlement_guard(uuid,uuid,uuid)',
        'videoforge_complete_v209_terminal_acceptance(jsonb)',
        'videoforge_load_v209_terminal_output_projection(uuid,uuid,uuid,text)',
        'videoforge_read_hosted_v209_terminal_lineage(uuid,uuid,uuid,text,text)',
        'videoforge_accept_hosted_v209_terminal_output(uuid,uuid,uuid,text,text,text,jsonb,jsonb,timestamp with time zone)',
        'videoforge_read_hosted_v209_ready_render_inputs(uuid,uuid,uuid)',
        'videoforge_commit_hosted_v209_resolved_render_manifest(uuid,uuid,uuid,jsonb,text,text,bigint)'
      ]::text[])
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend dependency
        JOIN pg_extension extension ON extension.oid=dependency.refobjid
        WHERE dependency.classid='pg_proc'::regclass AND dependency.objid=procedure.oid
          AND dependency.deptype='e'
      )
  )
  AND NOT has_function_privilege(:'runtime_role',
    'public.videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege(:'runtime_role',
    'public.videoforge_settle_hosted_pair_cleanup_v2(uuid,uuid,uuid,jsonb,jsonb,jsonb)','EXECUTE')
  AND NOT has_function_privilege(:'runtime_role',
    'public.videoforge_load_hosted_v209_settlement_guard(uuid,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege(:'runtime_role',
    'public.videoforge_complete_v209_terminal_acceptance(jsonb)','EXECUTE')
  AND NOT has_function_privilege(:'runtime_role',
    'public.videoforge_load_v209_terminal_output_projection(uuid,uuid,uuid,text)','EXECUTE')
  AND NOT has_function_privilege(:'runtime_role',
    'public.videoforge_read_hosted_v209_terminal_lineage(uuid,uuid,uuid,text,text)','EXECUTE')
  AND NOT has_function_privilege(:'runtime_role',
    'public.videoforge_accept_hosted_v209_terminal_output(uuid,uuid,uuid,text,text,text,jsonb,jsonb,timestamp with time zone)','EXECUTE')
  AND NOT has_function_privilege(:'runtime_role',
    'public.videoforge_read_hosted_v209_ready_render_inputs(uuid,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege(:'runtime_role',
    'public.videoforge_commit_hosted_v209_resolved_render_manifest(uuid,uuid,uuid,jsonb,text,text,bigint)','EXECUTE')
) AS v209_reconciler_acl_exact
\gset
\if :v209_reconciler_acl_exact
COMMIT;
\else
ROLLBACK;
\quit
\endif

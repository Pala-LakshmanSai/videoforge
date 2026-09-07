-- Apply with the migration owner after migration 0074. The three login roles must already exist.
-- This grants only the operator capabilities needed to import and immediately load the exact
-- frozen V2-07/V2-08 qualification binding and to re-read the V2-09 completion baseline. It grants
-- no direct table access and invokes none of the functions.
--   psql --variable=operator_role=... --variable=runtime_role=... \
--     --variable=reconciler_role=... --file=deploy/v2-09/neon-qualified-activation-operator-grants.sql

\set ON_ERROR_STOP on
\if :{?operator_role}
\else
SELECT 1/0;
\endif
\if :{?runtime_role}
\else
SELECT 1/0;
\endif
\if :{?reconciler_role}
\else
SELECT 1/0;
\endif

BEGIN;
SET search_path = public, pg_catalog;
SELECT pg_advisory_xact_lock(1448494662,9);

SELECT (:'operator_role'<>:'runtime_role' AND :'operator_role'<>:'reconciler_role'
  AND :'runtime_role'<>:'reconciler_role' AND count(*)=3
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
    WHERE owner_role.rolname=:'operator_role'
  ))
  AS activation_roles_valid
FROM pg_roles
WHERE rolname IN (:'operator_role',:'runtime_role',:'reconciler_role')
\gset
\if :activation_roles_valid
\else
ROLLBACK;
SELECT 1/0;
\endif

REVOKE EXECUTE ON FUNCTION public.videoforge_import_hosted_v209_qualified_activation(jsonb)
FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.videoforge_load_hosted_gpu_activation_v2()
FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.videoforge_read_hosted_v209_completion_baseline(uuid,uuid,bigint)
FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.videoforge_import_hosted_v209_qualified_activation(jsonb)
FROM :"runtime_role";
REVOKE EXECUTE ON FUNCTION public.videoforge_import_hosted_v209_qualified_activation(jsonb)
FROM :"reconciler_role";
REVOKE EXECUTE ON FUNCTION public.videoforge_load_hosted_gpu_activation_v2()
FROM :"reconciler_role";
REVOKE EXECUTE ON FUNCTION public.videoforge_read_hosted_v209_completion_baseline(uuid,uuid,bigint)
FROM :"runtime_role";
REVOKE EXECUTE ON FUNCTION public.videoforge_import_hosted_v209_qualified_activation(jsonb)
FROM :"operator_role";
REVOKE EXECUTE ON FUNCTION public.videoforge_load_hosted_gpu_activation_v2()
FROM :"operator_role";
GRANT USAGE ON SCHEMA public TO :"operator_role";
REVOKE CREATE ON SCHEMA public FROM :"operator_role";
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"operator_role";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM :"operator_role";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM :"operator_role";
GRANT EXECUTE ON FUNCTION public.videoforge_import_hosted_v209_qualified_activation(jsonb)
TO :"operator_role";
GRANT EXECUTE ON FUNCTION public.videoforge_load_hosted_gpu_activation_v2()
TO :"operator_role", :"runtime_role";
GRANT EXECUTE ON FUNCTION public.videoforge_read_hosted_v209_completion_baseline(uuid,uuid,bigint)
TO :"operator_role";

SELECT (
  has_function_privilege(:'operator_role',
    'public.videoforge_import_hosted_v209_qualified_activation(jsonb)','EXECUTE')
  AND has_function_privilege(:'operator_role',
    'public.videoforge_load_hosted_gpu_activation_v2()','EXECUTE')
  AND NOT has_function_privilege(:'runtime_role',
    'public.videoforge_import_hosted_v209_qualified_activation(jsonb)','EXECUTE')
  AND NOT has_function_privilege(:'reconciler_role',
    'public.videoforge_import_hosted_v209_qualified_activation(jsonb)','EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc public_procedure
    CROSS JOIN LATERAL aclexplode(
      COALESCE(public_procedure.proacl,acldefault('f',public_procedure.proowner))
    ) public_acl
    WHERE public_procedure.oid=
      'public.videoforge_import_hosted_v209_qualified_activation(jsonb)'::regprocedure
      AND public_acl.grantee=0 AND public_acl.privilege_type='EXECUTE'
  )
  AND has_function_privilege(:'runtime_role',
    'public.videoforge_load_hosted_gpu_activation_v2()','EXECUTE')
  AND NOT has_function_privilege(:'reconciler_role',
    'public.videoforge_load_hosted_gpu_activation_v2()','EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc public_procedure
    CROSS JOIN LATERAL aclexplode(
      COALESCE(public_procedure.proacl,acldefault('f',public_procedure.proowner))
    ) public_acl
    WHERE public_procedure.oid=
      'public.videoforge_load_hosted_gpu_activation_v2()'::regprocedure
      AND public_acl.grantee=0 AND public_acl.privilege_type='EXECUTE'
  )
  AND has_function_privilege(:'operator_role',
    'public.videoforge_read_hosted_v209_completion_baseline(uuid,uuid,bigint)','EXECUTE')
  AND NOT has_function_privilege(:'runtime_role',
    'public.videoforge_read_hosted_v209_completion_baseline(uuid,uuid,bigint)','EXECUTE')
  AND NOT has_function_privilege(:'reconciler_role',
    'public.videoforge_read_hosted_v209_completion_baseline(uuid,uuid,bigint)','EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc public_procedure
    CROSS JOIN LATERAL aclexplode(
      COALESCE(public_procedure.proacl,acldefault('f',public_procedure.proowner))
    ) public_acl
    WHERE public_procedure.oid=
      'public.videoforge_read_hosted_v209_completion_baseline(uuid,uuid,bigint)'::regprocedure
      AND public_acl.grantee=0 AND public_acl.privilege_type='EXECUTE'
  )
  AND has_schema_privilege(:'operator_role','public','USAGE')
  AND NOT has_schema_privilege(:'operator_role','public','CREATE')
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE grantee=:'operator_role' AND table_schema='public'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.role_usage_grants
    WHERE grantee=:'operator_role' AND object_schema='public'
  )
  -- PostgreSQL 16+ records one creator-admin membership with INHERIT/SET disabled when a
  -- CREATEROLE login creates this NOINHERIT role. It is cleanup authority, not effective access.
  AND NOT EXISTS (
    SELECT 1 FROM pg_auth_members membership
    JOIN pg_roles member_role ON member_role.oid=membership.member
    JOIN pg_roles granted_role ON granted_role.oid=membership.roleid
    WHERE (member_role.rolname=:'operator_role' OR granted_role.rolname=:'operator_role')
      AND NOT (
        granted_role.rolname=:'operator_role'
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
    WHERE member_role.rolname=:'operator_role' OR granted_role.rolname=:'operator_role'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
    WHERE namespace.nspname='public'
      AND has_function_privilege(:'operator_role',procedure.oid,'EXECUTE')
      AND procedure.oid::regprocedure::text<>ALL(ARRAY[
        'videoforge_import_hosted_v209_qualified_activation(jsonb)',
        'videoforge_load_hosted_gpu_activation_v2()',
        'videoforge_read_hosted_v209_completion_baseline(uuid,uuid,bigint)'
      ]::text[])
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend dependency
        JOIN pg_extension extension ON extension.oid=dependency.refobjid
        WHERE dependency.classid='pg_proc'::regclass AND dependency.objid=procedure.oid
          AND dependency.deptype='e'
      )
  )
) AS activation_import_acl_exact
\gset
\if :activation_import_acl_exact
COMMIT;
\else
ROLLBACK;
SELECT 1/0;
\endif

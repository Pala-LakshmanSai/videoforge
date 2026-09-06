-- Apply with the migration owner after migration 0074. The three login roles must already exist.
-- This grants one operator-only capability to import the exact frozen V2-07/V2-08 qualification
-- binding. It grants no table access and does not invoke the import function.
--   psql --variable=operator_role=... --variable=runtime_role=... \
--     --variable=reconciler_role=... --file=deploy/v2-09/neon-qualified-activation-operator-grants.sql

\if :{?operator_role}
\else
\quit
\endif
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

SELECT (:'operator_role'<>:'runtime_role' AND :'operator_role'<>:'reconciler_role'
  AND :'runtime_role'<>:'reconciler_role' AND count(*)=3
  AND bool_and(rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
    AND NOT rolinherit AND NOT rolreplication AND NOT rolbypassrls AND rolconfig IS NULL))
  AS activation_roles_valid
FROM pg_roles
WHERE rolname IN (:'operator_role',:'runtime_role',:'reconciler_role')
\gset
\if :activation_roles_valid
\else
ROLLBACK;
\quit
\endif

REVOKE EXECUTE ON FUNCTION public.videoforge_import_hosted_v209_qualified_activation(jsonb)
FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.videoforge_import_hosted_v209_qualified_activation(jsonb)
FROM :"runtime_role";
REVOKE EXECUTE ON FUNCTION public.videoforge_import_hosted_v209_qualified_activation(jsonb)
FROM :"reconciler_role";
REVOKE EXECUTE ON FUNCTION public.videoforge_import_hosted_v209_qualified_activation(jsonb)
FROM :"operator_role";
GRANT USAGE ON SCHEMA public TO :"operator_role";
REVOKE CREATE ON SCHEMA public FROM :"operator_role";
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"operator_role";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM :"operator_role";
GRANT EXECUTE ON FUNCTION public.videoforge_import_hosted_v209_qualified_activation(jsonb)
TO :"operator_role";

SELECT (
  has_function_privilege(:'operator_role',
    'public.videoforge_import_hosted_v209_qualified_activation(jsonb)','EXECUTE')
  AND NOT has_function_privilege(:'runtime_role',
    'public.videoforge_import_hosted_v209_qualified_activation(jsonb)','EXECUTE')
  AND NOT has_function_privilege(:'reconciler_role',
    'public.videoforge_import_hosted_v209_qualified_activation(jsonb)','EXECUTE')
  AND NOT has_function_privilege('PUBLIC',
    'public.videoforge_import_hosted_v209_qualified_activation(jsonb)','EXECUTE')
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
  AND NOT EXISTS (
    SELECT 1 FROM pg_auth_members membership
    JOIN pg_roles member_role ON member_role.oid=membership.member
    JOIN pg_roles granted_role ON granted_role.oid=membership.roleid
    WHERE member_role.rolname=:'operator_role' OR granted_role.rolname=:'operator_role'
  )
) AS activation_import_acl_exact
\gset
\if :activation_import_acl_exact
COMMIT;
\else
ROLLBACK;
\quit
\endif

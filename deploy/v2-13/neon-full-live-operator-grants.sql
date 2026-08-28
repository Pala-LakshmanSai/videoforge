-- Apply with the migration owner. This role may load only exact consumed V2-13 bridge calls and
-- record owner-authorized activation documents; it receives no direct table privileges.
\if :{?operator_role}
\else
\quit
\endif
\set ON_ERROR_STOP on
\getenv operator_password V2_13_OPERATOR_PASSWORD
BEGIN;
SET search_path = public, pg_catalog;
SELECT pg_advisory_xact_lock(1448494662,1);
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'operator_role',
  :'operator_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=:'operator_role')
  AND NULLIF(:'operator_password','') IS NOT NULL
\gexec
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=:'operator_role') AS operator_role_present
\gset
\if :operator_role_present
\else
ROLLBACK;
\quit
\endif
GRANT USAGE ON SCHEMA public TO :"operator_role";
REVOKE CREATE ON SCHEMA public FROM :"operator_role";
-- Remove the ambient PUBLIC capabilities before granting the operator's exact function set.
-- PostgreSQL's NULL ACL means the default ACL, so the readback below checks both forms.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"operator_role";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM :"operator_role";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM :"operator_role";
GRANT EXECUTE ON FUNCTION public.videoforge_load_v213_bridge_acceptance_call(jsonb)
TO :"operator_role";
GRANT EXECUTE ON FUNCTION public.videoforge_record_v213_stage_authority(uuid,jsonb),
  public.videoforge_record_hosted_full_live_authority(uuid,jsonb),
  public.videoforge_promote_hosted_full_live(uuid,uuid,jsonb),
  public.videoforge_record_v213_cloudflare_activation(uuid,jsonb),
  public.videoforge_record_v213_cloudflare_rollback(uuid,jsonb),
  public.videoforge_claim_v213_stage_authority(jsonb),
  public.videoforge_complete_v213_stage_authority(text,text,jsonb),
  public.videoforge_load_v213_stage_handoff(uuid,text,text),
  public.videoforge_load_v213_cleanup_scope(uuid),
  public.videoforge_claim_v213_operation(jsonb),
  public.videoforge_transition_v213_operation(jsonb),
  public.videoforge_claim_v213_bridge_command(jsonb),
  public.videoforge_transition_v213_bridge_command(jsonb),
  public.videoforge_record_v213_receipt_verification_key(text,text),
  public.videoforge_publish_v213_qualified_deployments(jsonb),
  public.videoforge_record_v213_workflow_start_authority(uuid,uuid,text,timestamptz),
  public.videoforge_record_v213_acceptance_authority(jsonb),
  public.videoforge_record_v213_static_release_descriptor(jsonb),
  public.videoforge_prepare_v213_jit_operation(jsonb),
  public.videoforge_project_v213_jit_operation(jsonb),
  public.videoforge_persist_v213_jit_materialization(jsonb),
  public.videoforge_read_v213_jit_materialization(jsonb),
  public.videoforge_verify_v213_jit_artifact(jsonb),
  public.videoforge_record_v213_signed_evidence(jsonb),
  public.videoforge_load_v213_signed_evidence(jsonb),
  public.videoforge_v213_short_pilot_repository(jsonb),
  public.videoforge_v213_production_length_repository(jsonb),
  public.videoforge_record_v213_operation_receipt(jsonb),
  public.videoforge_read_v213_operation_receipt(jsonb),
  public.videoforge_read_v213_operator_evidence(jsonb),
  public.videoforge_materialize_v213_release_facts(jsonb),
  public.videoforge_read_v213_release_fact_materialization(jsonb),
  public.videoforge_project_v213_release_chrome(jsonb),
  public.videoforge_persist_v213_release_chrome(jsonb),
  public.videoforge_read_v213_release_chrome(jsonb),
  public.videoforge_project_v213_release_certification(jsonb),
  public.videoforge_persist_v213_release_certification(jsonb),
  public.videoforge_read_v213_release_certification(jsonb)
  ,public.videoforge_claim_v213_qualification_materialization(jsonb)
  ,public.videoforge_persist_v213_qualification_materialization(jsonb)
  ,public.videoforge_read_v213_qualification_materialization(jsonb)
TO :"operator_role";
WITH target AS (
  SELECT oid FROM pg_roles WHERE rolname=:'operator_role'
),
effective_functions AS (
  SELECT p.oid,
    p.proname||'('||(
      SELECT COALESCE(string_agg(
        CASE format_type(a.type_oid,NULL)
          WHEN 'timestamp with time zone' THEN 'timestamptz'
          ELSE format_type(a.type_oid,NULL)
        END,
        ',' ORDER BY a.ordinality
      ),'')
      FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS a(type_oid,ordinality)
    )||')' AS signature
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  CROSS JOIN target t
  WHERE n.nspname='public' AND has_function_privilege(t.oid,p.oid,'EXECUTE')
),
public_functions AS (
  SELECT 1
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
  WHERE n.nspname='public' AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
),
public_default_functions AS (
  SELECT 1
  FROM pg_default_acl d
  CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
  WHERE d.defaclobjtype='f' AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
),
expected_functions(oid,signature) AS (VALUES
  ('public.videoforge_claim_v213_bridge_command(jsonb)'::regprocedure::oid,'videoforge_claim_v213_bridge_command(jsonb)'),
  ('public.videoforge_claim_v213_operation(jsonb)'::regprocedure::oid,'videoforge_claim_v213_operation(jsonb)'),
  ('public.videoforge_claim_v213_stage_authority(jsonb)'::regprocedure::oid,'videoforge_claim_v213_stage_authority(jsonb)'),
  ('public.videoforge_complete_v213_stage_authority(text,text,jsonb)'::regprocedure::oid,'videoforge_complete_v213_stage_authority(text,text,jsonb)'),
  ('public.videoforge_load_v213_bridge_acceptance_call(jsonb)'::regprocedure::oid,'videoforge_load_v213_bridge_acceptance_call(jsonb)'),
  ('public.videoforge_load_v213_cleanup_scope(uuid)'::regprocedure::oid,'videoforge_load_v213_cleanup_scope(uuid)'),
  ('public.videoforge_load_v213_stage_handoff(uuid,text,text)'::regprocedure::oid,'videoforge_load_v213_stage_handoff(uuid,text,text)'),
  ('public.videoforge_promote_hosted_full_live(uuid,uuid,jsonb)'::regprocedure::oid,'videoforge_promote_hosted_full_live(uuid,uuid,jsonb)'),
  ('public.videoforge_publish_v213_qualified_deployments(jsonb)'::regprocedure::oid,'videoforge_publish_v213_qualified_deployments(jsonb)'),
  ('public.videoforge_record_hosted_full_live_authority(uuid,jsonb)'::regprocedure::oid,'videoforge_record_hosted_full_live_authority(uuid,jsonb)'),
  ('public.videoforge_record_v213_cloudflare_activation(uuid,jsonb)'::regprocedure::oid,'videoforge_record_v213_cloudflare_activation(uuid,jsonb)'),
  ('public.videoforge_record_v213_cloudflare_rollback(uuid,jsonb)'::regprocedure::oid,'videoforge_record_v213_cloudflare_rollback(uuid,jsonb)'),
  ('public.videoforge_record_v213_receipt_verification_key(text,text)'::regprocedure::oid,'videoforge_record_v213_receipt_verification_key(text,text)'),
  ('public.videoforge_record_v213_stage_authority(uuid,jsonb)'::regprocedure::oid,'videoforge_record_v213_stage_authority(uuid,jsonb)'),
  ('public.videoforge_record_v213_workflow_start_authority(uuid,uuid,text,timestamptz)'::regprocedure::oid,'videoforge_record_v213_workflow_start_authority(uuid,uuid,text,timestamptz)'),
  ('public.videoforge_record_v213_acceptance_authority(jsonb)'::regprocedure::oid,'videoforge_record_v213_acceptance_authority(jsonb)'),
  ('public.videoforge_record_v213_static_release_descriptor(jsonb)'::regprocedure::oid,'videoforge_record_v213_static_release_descriptor(jsonb)'),
  ('public.videoforge_prepare_v213_jit_operation(jsonb)'::regprocedure::oid,'videoforge_prepare_v213_jit_operation(jsonb)'),
  ('public.videoforge_project_v213_jit_operation(jsonb)'::regprocedure::oid,'videoforge_project_v213_jit_operation(jsonb)'),
  ('public.videoforge_persist_v213_jit_materialization(jsonb)'::regprocedure::oid,'videoforge_persist_v213_jit_materialization(jsonb)'),
  ('public.videoforge_read_v213_jit_materialization(jsonb)'::regprocedure::oid,'videoforge_read_v213_jit_materialization(jsonb)'),
  ('public.videoforge_verify_v213_jit_artifact(jsonb)'::regprocedure::oid,'videoforge_verify_v213_jit_artifact(jsonb)'),
  ('public.videoforge_record_v213_signed_evidence(jsonb)'::regprocedure::oid,'videoforge_record_v213_signed_evidence(jsonb)'),
  ('public.videoforge_load_v213_signed_evidence(jsonb)'::regprocedure::oid,'videoforge_load_v213_signed_evidence(jsonb)'),
  ('public.videoforge_v213_short_pilot_repository(jsonb)'::regprocedure::oid,'videoforge_v213_short_pilot_repository(jsonb)'),
  ('public.videoforge_v213_production_length_repository(jsonb)'::regprocedure::oid,'videoforge_v213_production_length_repository(jsonb)'),
  ('public.videoforge_record_v213_operation_receipt(jsonb)'::regprocedure::oid,'videoforge_record_v213_operation_receipt(jsonb)'),
  ('public.videoforge_read_v213_operation_receipt(jsonb)'::regprocedure::oid,'videoforge_read_v213_operation_receipt(jsonb)'),
  ('public.videoforge_read_v213_operator_evidence(jsonb)'::regprocedure::oid,'videoforge_read_v213_operator_evidence(jsonb)'),
  ('public.videoforge_materialize_v213_release_facts(jsonb)'::regprocedure::oid,'videoforge_materialize_v213_release_facts(jsonb)'),
  ('public.videoforge_read_v213_release_fact_materialization(jsonb)'::regprocedure::oid,'videoforge_read_v213_release_fact_materialization(jsonb)'),
  ('public.videoforge_project_v213_release_chrome(jsonb)'::regprocedure::oid,'videoforge_project_v213_release_chrome(jsonb)'),
  ('public.videoforge_persist_v213_release_chrome(jsonb)'::regprocedure::oid,'videoforge_persist_v213_release_chrome(jsonb)'),
  ('public.videoforge_read_v213_release_chrome(jsonb)'::regprocedure::oid,'videoforge_read_v213_release_chrome(jsonb)'),
  ('public.videoforge_project_v213_release_certification(jsonb)'::regprocedure::oid,'videoforge_project_v213_release_certification(jsonb)'),
  ('public.videoforge_persist_v213_release_certification(jsonb)'::regprocedure::oid,'videoforge_persist_v213_release_certification(jsonb)'),
  ('public.videoforge_read_v213_release_certification(jsonb)'::regprocedure::oid,'videoforge_read_v213_release_certification(jsonb)'),
  ('public.videoforge_claim_v213_qualification_materialization(jsonb)'::regprocedure::oid,'videoforge_claim_v213_qualification_materialization(jsonb)'),
  ('public.videoforge_persist_v213_qualification_materialization(jsonb)'::regprocedure::oid,'videoforge_persist_v213_qualification_materialization(jsonb)'),
  ('public.videoforge_read_v213_qualification_materialization(jsonb)'::regprocedure::oid,'videoforge_read_v213_qualification_materialization(jsonb)'),
  ('public.videoforge_transition_v213_bridge_command(jsonb)'::regprocedure::oid,'videoforge_transition_v213_bridge_command(jsonb)'),
  ('public.videoforge_transition_v213_operation(jsonb)'::regprocedure::oid,'videoforge_transition_v213_operation(jsonb)')
),
role_acl AS (
  SELECT r.oid,
    r.rolcanlogin, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolinherit,
    r.rolreplication, r.rolbypassrls, r.rolconfig,
    (SELECT count(*) FROM pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid) AS memberships,
    (SELECT count(*) FROM (
      SELECT 1 FROM pg_database d WHERE d.datdba=r.oid
      UNION ALL SELECT 1 FROM pg_extension e WHERE e.extowner=r.oid
      UNION ALL SELECT 1 FROM pg_class c WHERE c.relowner=r.oid
      UNION ALL SELECT 1 FROM pg_namespace n WHERE n.nspowner=r.oid
      UNION ALL SELECT 1 FROM pg_proc p WHERE p.proowner=r.oid
      UNION ALL SELECT 1 FROM pg_type t WHERE t.typowner=r.oid
      UNION ALL SELECT 1 FROM pg_foreign_data_wrapper f WHERE f.fdwowner=r.oid
      UNION ALL SELECT 1 FROM pg_foreign_server s WHERE s.srvowner=r.oid
      UNION ALL SELECT 1 FROM pg_event_trigger e WHERE e.evtowner=r.oid
      UNION ALL SELECT 1 FROM pg_tablespace t WHERE t.spcowner=r.oid
      UNION ALL SELECT 1 FROM pg_publication p WHERE p.pubowner=r.oid
      UNION ALL SELECT 1 FROM pg_subscription s WHERE s.subowner=r.oid
      UNION ALL SELECT 1 FROM pg_largeobject_metadata l WHERE l.lomowner=r.oid
      UNION ALL SELECT 1 FROM pg_collation c WHERE c.collowner=r.oid
      UNION ALL SELECT 1 FROM pg_ts_dict d WHERE d.dictowner=r.oid
      UNION ALL SELECT 1 FROM pg_ts_config c WHERE c.cfgowner=r.oid
    ) owned) AS ownership,
    (SELECT count(*) FROM pg_extension e WHERE e.extowner=r.oid) AS extension_ownership,
    (SELECT count(*) FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) acl WHERE acl.grantee=r.oid) AS database_acl,
    (SELECT count(*) FROM pg_database d WHERE has_database_privilege(r.oid,d.oid,'CREATE')) AS effective_database_dangerous_acl,
    (SELECT COALESCE(array_agg(n.nspname||':'||acl.privilege_type ORDER BY n.nspname||':'||acl.privilege_type),'{}'::text[]) FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) acl WHERE acl.grantee=r.oid) AS schema_acl,
    (SELECT count(*) FROM pg_namespace n WHERE has_schema_privilege(r.oid,n.oid,'CREATE')) AS effective_schema_dangerous_acl,
    (SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl WHERE acl.grantee=r.oid) AS table_acl,
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND (has_table_privilege(r.oid,c.oid,'SELECT') OR has_table_privilege(r.oid,c.oid,'INSERT') OR has_table_privilege(r.oid,c.oid,'UPDATE') OR has_table_privilege(r.oid,c.oid,'DELETE') OR has_table_privilege(r.oid,c.oid,'TRUNCATE') OR has_table_privilege(r.oid,c.oid,'REFERENCES') OR has_table_privilege(r.oid,c.oid,'TRIGGER'))) AS effective_table_acl,
    (SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('S',c.relowner))) acl WHERE c.relkind='S' AND acl.grantee=r.oid) AS sequence_acl,
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND (has_sequence_privilege(r.oid,c.oid,'USAGE') OR has_sequence_privilege(r.oid,c.oid,'SELECT') OR has_sequence_privilege(r.oid,c.oid,'UPDATE'))) AS effective_sequence_acl,
    (SELECT count(*) FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) acl WHERE acl.grantee=r.oid) AS default_acl
  FROM pg_roles r
  JOIN target t ON t.oid=r.oid
)
SELECT
  role_acl.rolcanlogin AND NOT role_acl.rolsuper AND NOT role_acl.rolcreaterole AND NOT role_acl.rolcreatedb
  AND NOT role_acl.rolinherit AND NOT role_acl.rolreplication AND NOT role_acl.rolbypassrls AND role_acl.rolconfig IS NULL
  AND role_acl.memberships=0 AND role_acl.ownership=0 AND role_acl.extension_ownership=0
  AND role_acl.database_acl=0 AND role_acl.effective_database_dangerous_acl=0
  AND role_acl.schema_acl=ARRAY['public:USAGE']::text[] AND role_acl.effective_schema_dangerous_acl=0
  AND role_acl.table_acl=0 AND role_acl.effective_table_acl=0
  AND role_acl.sequence_acl=0 AND role_acl.effective_sequence_acl=0 AND role_acl.default_acl=0
  AND (SELECT COALESCE(array_agg(oid ORDER BY oid),'{}'::oid[]) FROM effective_functions)=
      (SELECT array_agg(oid ORDER BY oid) FROM expected_functions)
  AND NOT EXISTS (SELECT 1 FROM effective_functions WHERE oid NOT IN (SELECT oid FROM expected_functions))
  AND NOT EXISTS (SELECT 1 FROM public_functions)
  AND NOT EXISTS (SELECT 1 FROM public_default_functions)
  AND EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgcrypto' AND extnamespace='public'::regnamespace)
  AS operator_acl_exact
FROM role_acl
\gset
\if :operator_acl_exact
COMMIT;
\else
ROLLBACK;
\quit
\endif

-- Apply with the migration owner. This role may load only exact consumed V2-13 bridge calls and
-- record owner-authorized activation documents; it receives no direct table privileges.
\if :{?operator_role}
\else
\quit
\endif
\set ON_ERROR_STOP on
BEGIN;
SET search_path = public, pg_catalog;
GRANT USAGE ON SCHEMA public TO :"operator_role";
REVOKE CREATE ON SCHEMA public FROM :"operator_role";
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
  public.videoforge_publish_v213_qualified_deployments(jsonb)
TO :"operator_role";
SELECT has_function_privilege(:'operator_role',
  'public.videoforge_load_v213_bridge_acceptance_call(jsonb)','EXECUTE')
  AND has_function_privilege(:'operator_role',
    'public.videoforge_load_v213_stage_handoff(uuid,text,text)','EXECUTE')
  AND has_function_privilege(:'operator_role',
    'public.videoforge_load_v213_cleanup_scope(uuid)','EXECUTE')
  AND has_function_privilege(:'operator_role',
    'public.videoforge_publish_v213_qualified_deployments(jsonb)','EXECUTE')
  AND has_function_privilege(:'operator_role',
    'public.videoforge_record_hosted_full_live_authority(uuid,jsonb)','EXECUTE')
  AND has_function_privilege(:'operator_role',
    'public.videoforge_promote_hosted_full_live(uuid,uuid,jsonb)','EXECUTE')
  AND has_function_privilege(:'operator_role',
    'public.videoforge_record_v213_cloudflare_activation(uuid,jsonb)','EXECUTE')
  AND has_function_privilege(:'operator_role',
    'public.videoforge_record_v213_cloudflare_rollback(uuid,jsonb)','EXECUTE')
  AND NOT has_table_privilege(:'operator_role','public.hosted_full_live_acceptance_authorities','SELECT')
  AND NOT has_table_privilege(:'operator_role','public.hosted_full_live_stage_handoff_escrow','SELECT')
  AS operator_acl_exact
\gset
\if :operator_acl_exact
COMMIT;
\else
ROLLBACK;
\quit
\endif

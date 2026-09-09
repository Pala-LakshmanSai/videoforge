-- Permit a later immutable Cloudflare version/config to reuse the same still-valid
-- renewed qualification pair through an already verified rebind. The refresh row
-- remains the root of trust and identical source/config/version triples remain unique.

DO $migration$
DECLARE
  definition text;
  old_refresh_guard constant text := 'OR prior_refresh.refresh_id IS NULL';
  new_refresh_guard constant text :=
    'OR (prior_refresh.refresh_id IS NULL AND NOT EXISTS(' ||
    'SELECT 1 FROM public.hosted_v209_qualification_activation_refreshes root_refresh ' ||
    'JOIN public.hosted_v209_qualified_activations root_activation ' ||
    'ON root_activation.id=root_refresh.activation_id ' ||
    'WHERE prior.evidence_document->>''schemaVersion''=' ||
    '''videoforge.hosted-v209-renewed-activation-rebind/v1'' ' ||
    'AND root_activation.mage_qualification_id=prior.mage_qualification_id ' ||
    'AND root_activation.soulx_qualification_id=prior.soulx_qualification_id))';
  old_source_guard constant text := 'OR prior.source_commit=supplied->>''sourceCommit''';
  new_source_guard constant text :=
    'OR (prior.source_commit=supplied->>''sourceCommit'' ' ||
    'AND prior.deployed_config_sha256=supplied->>''deployedConfigSha256'' ' ||
    'AND prior.cloudflare_version_id_sha256=supplied->>''cloudflareVersionIdSha256'')';
BEGIN
  definition:=pg_get_functiondef(
    'public.videoforge_rebind_hosted_v209_renewed_activation(jsonb)'::regprocedure
  );
  IF position(old_refresh_guard IN definition)=0
     OR position(old_source_guard IN definition)=0
     OR position(new_refresh_guard IN definition)>0
     OR position(new_source_guard IN definition)>0 THEN
    RAISE EXCEPTION 'hosted V2-09 activation rebind chain preimage drifted'
      USING ERRCODE='23514';
  END IF;
  definition:=replace(definition,old_refresh_guard,new_refresh_guard);
  definition:=replace(definition,old_source_guard,new_source_guard);
  EXECUTE definition;
END;
$migration$;

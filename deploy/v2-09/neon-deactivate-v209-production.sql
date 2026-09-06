\set ON_ERROR_STOP on

BEGIN;
WITH supplied AS (
  SELECT convert_from(decode(:'payload_base64','base64'),'UTF8')::jsonb AS value
), input AS (
  SELECT ARRAY(SELECT jsonb_array_elements_text(value->'deploymentIds'))::uuid[] AS deployment_ids
  FROM supplied WHERE jsonb_typeof(value)='object'
    AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(value) key)
      = ARRAY['deploymentIds','schemaVersion']::text[]
    AND value->>'schemaVersion'='videoforge.v2-09-deactivate-production/v1'
    AND jsonb_array_length(value->'deploymentIds') BETWEEN 1 AND 2
), locked AS (
  SELECT d.id FROM public.serverless_endpoint_deployments d JOIN input i ON d.id=ANY(i.deployment_ids)
  FOR UPDATE
), updated AS (
  UPDATE public.serverless_endpoint_deployments d SET is_active=false
  WHERE d.id IN (SELECT id FROM locked) AND d.is_active RETURNING d.id
)
SELECT jsonb_build_object(
  'schemaVersion','videoforge.v2-09-deactivate-production-result/v1',
  'matchedCount',(SELECT count(*) FROM locked),
  'deactivatedCount',(SELECT count(*) FROM updated),
  'allInactive',(SELECT count(*)=cardinality(i.deployment_ids) AND bool_and(NOT d.is_active)
    FROM input i JOIN public.serverless_endpoint_deployments d ON d.id=ANY(i.deployment_ids))
);
COMMIT;

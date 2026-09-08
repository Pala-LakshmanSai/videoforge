\set ON_ERROR_STOP on

BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '15s';
CREATE TEMP TABLE v209_deactivate_input(payload jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO v209_deactivate_input(payload)
VALUES(convert_from(decode(:'payload_base64','base64'),'UTF8')::jsonb);
CREATE TEMP TABLE v209_deactivate_result(
  deployment_ids uuid[] NOT NULL,
  matched_count integer NOT NULL,
  deactivated_count integer NOT NULL
) ON COMMIT DROP;

DO $v209$
DECLARE
  supplied jsonb;
  ids uuid[];
  matched integer;
  deactivated integer;
BEGIN
  SELECT payload INTO supplied FROM v209_deactivate_input;
  IF jsonb_typeof(supplied) IS DISTINCT FROM 'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(supplied) key)
       IS DISTINCT FROM ARRAY['deploymentIds','schemaVersion']::text[]
     OR supplied->>'schemaVersion' IS DISTINCT FROM 'videoforge.v2-09-deactivate-production/v1'
     OR jsonb_typeof(supplied->'deploymentIds') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'V209 deactivation input invalid' USING ERRCODE='23514';
  END IF;
  IF jsonb_array_length(supplied->'deploymentIds') NOT BETWEEN 1 AND 2
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(supplied->'deploymentIds') item
       WHERE jsonb_typeof(item) IS DISTINCT FROM 'string'
         OR item #>> '{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'V209 deactivation IDs invalid' USING ERRCODE='23514';
  END IF;
  SELECT array_agg(value::uuid) INTO ids
    FROM jsonb_array_elements_text(supplied->'deploymentIds');
  IF (SELECT count(DISTINCT id) FROM unnest(ids) id) <> cardinality(ids) THEN
    RAISE EXCEPTION 'V209 deactivation IDs duplicated' USING ERRCODE='23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('videoforge:v209:production-pair',209));
  PERFORM d.id FROM public.serverless_endpoint_deployments d
    WHERE d.id=ANY(ids) ORDER BY d.id FOR UPDATE;
  GET DIAGNOSTICS matched = ROW_COUNT;
  IF matched <> cardinality(ids) THEN
    RAISE EXCEPTION 'V209 deactivation matched count invalid' USING ERRCODE='23514';
  END IF;
  UPDATE public.serverless_endpoint_deployments SET is_active=false
    WHERE id=ANY(ids) AND is_active;
  GET DIAGNOSTICS deactivated = ROW_COUNT;
  INSERT INTO v209_deactivate_result VALUES(ids,matched,deactivated);
END $v209$;

-- A separate statement observes this transaction's updates; a modifying CTE's
-- sibling table scan would still see the pre-update snapshot.
SELECT jsonb_build_object(
  'schemaVersion','videoforge.v2-09-deactivate-production-result/v1',
  'matchedCount',r.matched_count,
  'deactivatedCount',r.deactivated_count,
  'allInactive',(SELECT count(*)=cardinality(r.deployment_ids)
    AND coalesce(bool_and(NOT d.is_active),false)
    FROM public.serverless_endpoint_deployments d WHERE d.id=ANY(r.deployment_ids))
) FROM v209_deactivate_result r;
COMMIT;

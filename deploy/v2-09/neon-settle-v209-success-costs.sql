\set ON_ERROR_STOP on

BEGIN;
CREATE TEMP TABLE pg_temp.v209_success_cost_input ON COMMIT DROP AS
WITH supplied AS (
  SELECT convert_from(decode(:'payload_base64','base64'),'UTF8')::jsonb AS value
), validated AS (
  SELECT value,
    (value->>'accountId')::uuid AS account_id,
    (value->>'workspaceId')::uuid AS workspace_id,
    (value->>'generationRequestId')::uuid AS generation_request_id,
    value->'terminalFacts' AS terminal_facts
  FROM supplied
  WHERE jsonb_typeof(value)='object'
    AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(value) key)
      = ARRAY['accountId','generationRequestId','schemaVersion','terminalFacts','workspaceId']::text[]
    AND value->>'schemaVersion'='videoforge.v2-09-success-cost-settlement/v1'
    AND jsonb_typeof(value->'terminalFacts')='array'
    AND jsonb_array_length(value->'terminalFacts')=2
)
SELECT account_id,workspace_id,generation_request_id,terminal_facts FROM validated;

DO $$
DECLARE target_account_id uuid;
BEGIN
  IF (SELECT count(*) FROM pg_temp.v209_success_cost_input)<>1 THEN
    RAISE EXCEPTION 'V2-09 success cost input invalid' USING ERRCODE='23514';
  END IF;
  SELECT account_id INTO target_account_id FROM pg_temp.v209_success_cost_input;
  PERFORM set_config('videoforge.account_id',target_account_id::text,true);
END;
$$;

SELECT public.videoforge_settle_hosted_v209_success_costs(
  input.account_id,input.workspace_id,input.generation_request_id,input.terminal_facts)
FROM pg_temp.v209_success_cost_input input;
COMMIT;

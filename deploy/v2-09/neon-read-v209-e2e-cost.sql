\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE pg_temp.v209_generic_cost_input ON COMMIT DROP AS
WITH supplied AS (
  SELECT convert_from(decode(:'payload_base64','base64'),'UTF8')::jsonb AS value
), scoped AS (
  SELECT (value->>'accountId')::uuid AS account_id,
    (value->>'workspaceId')::uuid AS workspace_id,
    (value->>'projectRevisionId')::uuid AS revision_id
  FROM supplied
  WHERE jsonb_typeof(value)='object'
    AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(value) key)
      = ARRAY['accountId','projectRevisionId','workspaceId']::text[]
)
SELECT account_id,workspace_id,revision_id FROM scoped;

DO $$
DECLARE target_account_id uuid;
BEGIN
  IF (SELECT count(*) FROM pg_temp.v209_generic_cost_input)<>1 THEN
    RAISE EXCEPTION 'V2-09 generic cost input invalid' USING ERRCODE='23514';
  END IF;
  SELECT account_id INTO target_account_id FROM pg_temp.v209_generic_cost_input;
  PERFORM set_config('videoforge.account_id',target_account_id::text,true);
END;
$$;

SELECT public.videoforge_read_hosted_v209_project_revision_net_cost(
  account_id,workspace_id,revision_id) FROM pg_temp.v209_generic_cost_input;
COMMIT;

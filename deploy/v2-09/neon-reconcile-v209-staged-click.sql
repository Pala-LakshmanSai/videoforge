\set ON_ERROR_STOP on

WITH supplied AS (
  SELECT convert_from(decode(:'payload_base64','base64'),'UTF8')::jsonb AS value
)
SELECT public.videoforge_reconcile_hosted_v209_staged_click(value) FROM supplied;

\set ON_ERROR_STOP on

BEGIN;
CREATE TEMP TABLE v209_activation_import_result(value jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO v209_activation_import_result(value)
SELECT public.videoforge_import_hosted_v209_qualified_activation(
  convert_from(decode(:'payload_base64','base64'),'UTF8')::jsonb
);
SELECT jsonb_build_object(
  'imported',(SELECT value FROM v209_activation_import_result),
  'loaded',public.videoforge_load_hosted_gpu_activation_v2()
);
COMMIT;

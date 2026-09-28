-- Additive sampled filesystem telemetry. Old runtimes and accepted receipts stay compatible.
ALTER TABLE public.cloud_media_jobs ADD COLUMN disk_metrics jsonb;
ALTER TABLE public.cloud_media_jobs ADD CONSTRAINT cloud_media_disk_metrics_valid CHECK (
 disk_metrics IS NULL OR (
  jsonb_typeof(disk_metrics)='object'
  AND disk_metrics ?& ARRAY['filesystem_total_bytes','initial_used_bytes','peak_used_bytes','min_free_bytes','sample_count']
  AND disk_metrics - ARRAY['filesystem_total_bytes','initial_used_bytes','peak_used_bytes','min_free_bytes','sample_count']='{}'::jsonb
  AND (disk_metrics->>'filesystem_total_bytes') ~ '^[0-9]+$'
  AND (disk_metrics->>'initial_used_bytes') ~ '^[0-9]+$'
  AND (disk_metrics->>'peak_used_bytes') ~ '^[0-9]+$'
  AND (disk_metrics->>'min_free_bytes') ~ '^[0-9]+$'
  AND (disk_metrics->>'sample_count') ~ '^[0-9]+$'
  AND (disk_metrics->>'filesystem_total_bytes')::numeric BETWEEN 1 AND 9007199254740991
  AND (disk_metrics->>'sample_count')::numeric BETWEEN 1 AND 9007199254740991
  AND (disk_metrics->>'initial_used_bytes')::numeric <= (disk_metrics->>'peak_used_bytes')::numeric
  AND (disk_metrics->>'peak_used_bytes')::numeric <= (disk_metrics->>'filesystem_total_bytes')::numeric
  AND (disk_metrics->>'min_free_bytes')::numeric <= (disk_metrics->>'filesystem_total_bytes')::numeric
  AND jsonb_typeof(disk_metrics->'filesystem_total_bytes')='number'
  AND jsonb_typeof(disk_metrics->'initial_used_bytes')='number'
  AND jsonb_typeof(disk_metrics->'peak_used_bytes')='number'
  AND jsonb_typeof(disk_metrics->'min_free_bytes')='number'
  AND jsonb_typeof(disk_metrics->'sample_count')='number'
 ));
GRANT UPDATE(disk_metrics) ON public.cloud_media_jobs TO videoforge_v209_runtime_dc9612d6;

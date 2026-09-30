-- Optional CPU fallback uses the existing tenant, admission, budget and launch fences.
-- Existing GPU placements remain unchanged; no authority or paid work is created.
ALTER TABLE cloud_media_reservations ADD COLUMN cpu_placement jsonb;
ALTER TABLE cloud_media_reservations ADD CONSTRAINT cloud_media_cpu_placement_valid CHECK (
  cpu_placement IS NULL OR (
    gpu IS NULL AND jsonb_typeof(cpu_placement)='object'
    AND cpu_placement->>'id' ~ '^[A-Za-z0-9_-]{1,80}$'
    AND jsonb_typeof(cpu_placement->'vcpuCount')='number'
    AND (cpu_placement->>'vcpuCount')::numeric IN (16,32)
    AND jsonb_typeof(cpu_placement->'memory')='number'
    AND (cpu_placement->>'memory')::numeric BETWEEN 64 AND 1024
    AND jsonb_typeof(cpu_placement->'dataCenterIds')='array'
    AND jsonb_array_length(cpu_placement->'dataCenterIds') BETWEEN 1 AND 100
    AND NOT jsonb_path_exists(cpu_placement,'$.dataCenterIds[*] ? (@.type() != "string")')
    AND cpu_placement ?& ARRAY['id','vcpuCount','memory','dataCenterIds']
  ) IS TRUE
);
CREATE FUNCTION public.videoforge_guard_cloud_cpu_placement() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
  IF NEW.cpu_placement IS DISTINCT FROM OLD.cpu_placement
    AND NOT (OLD.state='WAITING_CAPACITY' AND NEW.state='CREATING' AND NEW.launch_outcome='UNKNOWN') THEN
    RAISE EXCEPTION 'CPU placement can change only at a fresh create fence' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.videoforge_guard_cloud_cpu_placement() FROM PUBLIC;
CREATE TRIGGER cloud_cpu_placement_guard BEFORE UPDATE ON cloud_media_reservations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_guard_cloud_cpu_placement();

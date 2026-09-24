-- The API generation Workflow uses the reconciler connection for render handoff.
-- Keep this grant limited to its existing tenant-scoped ready-input reader.
GRANT EXECUTE ON FUNCTION public.videoforge_read_hosted_v209_ready_render_inputs(uuid,uuid,uuid)
  TO videoforge_v209_reconciler_dc9612d6;

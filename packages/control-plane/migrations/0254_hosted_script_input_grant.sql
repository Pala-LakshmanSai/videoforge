-- Preserve the original script alongside the generated audio revision.
-- Existing forced account RLS, composite tenant FKs, and tenant-write trigger remain authoritative.
-- No read, update, delete, or cross-tenant privilege is added.
GRANT INSERT ON public.project_inputs TO videoforge_v209_runtime_dc9612d6;

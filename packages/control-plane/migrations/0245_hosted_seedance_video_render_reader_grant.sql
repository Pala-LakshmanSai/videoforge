-- The Workflow's render handoff uses the existing reconciler connection (0192).
-- 0240 renamed the prior reader, retaining its ACL on that old OID, and created
-- a new public entrypoint without the reconciler grant. Restore only that reader;
-- private video helpers and operator-only recovery remain inaccessible directly.
GRANT EXECUTE ON FUNCTION public.videoforge_read_hosted_v209_ready_render_inputs(uuid,uuid,uuid)
 TO videoforge_v209_reconciler_dc9612d6;

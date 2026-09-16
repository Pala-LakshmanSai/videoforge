-- 0162_hosted_continuation_tenant_scoped_sweeps.sql
--
-- The durable stage-continuation driver ran its due-projects sweep and its pair-observer guard as the
-- runtime role, whose tables are all RLS-forced on videoforge_current_account_id(). A cross-tenant
-- SELECT with no tenant context sees zero rows, so the driver reported `dispatched: 0` every minute
-- and never advanced a project: on 2026-09-16 a project sat with ASR SUCCEEDED, no context row and no
-- error for twenty minutes while the driver ran. The sweep now queries each admitted account inside
-- its own tenant transaction, which needs an accounts accessor plus the read surface it touches.
--
-- The accounts table itself carries no RLS, so the admitted-account list is exposed through a
-- SECURITY DEFINER accessor that returns only ids instead of granting table access.

CREATE OR REPLACE FUNCTION public.videoforge_admitted_hosted_account_ids()
RETURNS TABLE(account_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT account.id FROM public.accounts account
   WHERE account.status='ACTIVE'
   ORDER BY account.created_at;
$function$;

REVOKE ALL ON FUNCTION public.videoforge_admitted_hosted_account_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_admitted_hosted_account_ids()
  TO videoforge_v209_runtime_dc9612d6;

-- Both tables are RLS-forced on the tenant policy, so the grants stay account-scoped at runtime.
GRANT SELECT ON TABLE public.memberships TO videoforge_v209_runtime_dc9612d6;
GRANT SELECT ON TABLE public.hosted_pair_runtime_states TO videoforge_v209_runtime_dc9612d6;

-- The sweep heartbeat and its retention trim are service-owned; the insert failed silently without
-- the grant, which is why the heartbeat table stayed empty while the driver ran every minute.
GRANT SELECT, INSERT ON TABLE public.hosted_continuation_heartbeats TO videoforge_v209_runtime_dc9612d6;

CREATE OR REPLACE FUNCTION public.videoforge_trim_hosted_continuation_heartbeats()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  removed integer;
BEGIN
  WITH doomed AS (
    SELECT id FROM public.hosted_continuation_heartbeats
     ORDER BY recorded_at DESC
     OFFSET 500
  )
  DELETE FROM public.hosted_continuation_heartbeats heartbeat
   USING doomed
   WHERE heartbeat.id = doomed.id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$function$;

REVOKE ALL ON FUNCTION public.videoforge_trim_hosted_continuation_heartbeats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_trim_hosted_continuation_heartbeats()
  TO videoforge_v209_runtime_dc9612d6;

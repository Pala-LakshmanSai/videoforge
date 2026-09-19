-- Brings the three tenant tables that missed the tenant hardening into line with the other 56.
--
-- 0018 installed the tenant write guard by iterating every table that already had an account_id
-- column, so tables created later inherit it only when their own migration opts in. Three did not:
--
--   hosted_image_regeneration_requests             (0129) named its policy _owner, no guard trigger
--   hosted_v209_ordinary_dispatch_candidate_renewals (0095-0098) no guard trigger
--   hosted_v209_outboxed_horizon_recoveries         (0111) RLS off entirely, no policy, no guard
--
-- The gap is invisible to the application - the SECURITY DEFINER functions that write these tables
-- already scope by videoforge_current_account_id(), and the two that have RLS carry the matching
-- WITH CHECK - but it leaves the tables unprotected against a direct owner-path write and out of the
-- committed schema inventory, which is what packages/control-plane/tests/schema-inventory.test.mjs
-- asserts.
--
-- Idempotent: each step is skipped when the object it creates already exists, and the
-- image-regeneration policy is renamed rather than recreated so its qual is preserved exactly.

DO $tenant_hardening$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'hosted_image_regeneration_requests',
    'hosted_v209_ordinary_dispatch_candidate_renewals',
    'hosted_v209_outboxed_horizon_recoveries'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', target);

    IF EXISTS (
      SELECT 1 FROM pg_policy policy
        JOIN pg_class relation ON relation.oid=policy.polrelid
        JOIN pg_namespace space ON space.oid=relation.relnamespace
       WHERE space.nspname='public' AND relation.relname=target
         AND policy.polname=left(target||'_owner',63)
    ) THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I RENAME TO %I',
        left(target||'_owner',63), target, left(target||'_tenant_rls',63)
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policy policy
        JOIN pg_class relation ON relation.oid=policy.polrelid
        JOIN pg_namespace space ON space.oid=relation.relnamespace
       WHERE space.nspname='public' AND relation.relname=target
         AND policy.polname=left(target||'_tenant_rls',63)
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I
           USING (account_id = public.videoforge_current_account_id())
           WITH CHECK (account_id = public.videoforge_current_account_id())',
        left(target||'_tenant_rls',63), target
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger trigger
        JOIN pg_class relation ON relation.oid=trigger.tgrelid
        JOIN pg_namespace space ON space.oid=relation.relnamespace
       WHERE space.nspname='public' AND relation.relname=target
         AND NOT trigger.tgisinternal
         AND trigger.tgname=left(target||'_tenant_write_guard',63)
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write()',
        left(target||'_tenant_write_guard',63), target
      );
    END IF;

    RAISE NOTICE 'tenant hardening ensured on %', target;
  END LOOP;
END
$tenant_hardening$;

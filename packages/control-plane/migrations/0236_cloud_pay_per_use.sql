-- Ordinary Cloud videos use ongoing account access. Historical finite approvals stay intact.
-- This migration grants no account access and changes no existing authority or launch record.
ALTER TABLE public.cloud_media_budget_authorities ADD COLUMN ongoing_pay_per_use boolean NOT NULL DEFAULT false;
ALTER TABLE public.cloud_media_budget_authorities ALTER COLUMN total_cap_usd DROP NOT NULL;
ALTER TABLE public.cloud_media_budget_authorities ALTER COLUMN max_reservation_usd DROP NOT NULL;
ALTER TABLE public.cloud_media_budget_authorities ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE public.cloud_media_budget_authorities ADD CHECK(debited_usd>=0 AND (total_cap_usd IS NULL OR debited_usd<=total_cap_usd));
ALTER TABLE public.cloud_media_budget_authorities ADD CONSTRAINT cloud_media_access_shape CHECK(
 (NOT ongoing_pay_per_use AND total_cap_usd IS NOT NULL AND max_reservation_usd IS NOT NULL AND expires_at IS NOT NULL)
 OR (ongoing_pay_per_use AND total_cap_usd IS NULL AND max_reservation_usd IS NULL AND expires_at IS NULL
     AND max_reservations IS NULL AND allow_new_cloud_projects));

CREATE OR REPLACE FUNCTION public.videoforge_cloud_media_new_project_ready(authority_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.cloud_media_budget_authorities b WHERE b.id=$1
  AND b.allow_new_cloud_projects AND b.enabled AND (b.expires_at IS NULL OR b.expires_at>now())
  AND public.videoforge_current_account_id()=ANY(b.allowed_account_ids)
  AND (b.ongoing_pay_per_use OR (b.max_reservations IS NOT NULL
   AND b.debited_usd+b.max_reservation_usd<=b.total_cap_usd
   AND (SELECT count(*) FROM public.cloud_media_reservations r WHERE r.budget_authority_id=b.id)<b.max_reservations)))
  AND NOT EXISTS(SELECT 1 FROM public.cloud_media_reservations r
   WHERE r.account_id=public.videoforge_current_account_id() AND r.state IN ('AMBIGUOUS','STOPPING')
    AND r.cleanup_verified_at IS NULL);
$$;

DO $migration$
DECLARE definition text; marker text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_cloud_media_authority_project_allowed(uuid,uuid,uuid,uuid)'::regprocedure) INTO definition;
 marker:='b.max_reservations IS NOT NULL AND EXISTS';
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'pay-per-use project scope preimage mismatch'; END IF;
 EXECUTE replace(definition,marker,'(b.ongoing_pay_per_use OR b.max_reservations IS NOT NULL) AND EXISTS');

 SELECT pg_get_functiondef('public.videoforge_cloud_media_reserve_budget(uuid)'::regprocedure) INTO definition;
 marker:='authority.expires_at<=now()';
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'pay-per-use budget expiry preimage mismatch'; END IF;
 definition:=replace(definition,marker,'(authority.expires_at IS NOT NULL AND authority.expires_at<=now())');
 marker:='r.budget_usd>authority.max_reservation_usd';
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'pay-per-use reservation cap preimage mismatch'; END IF;
 definition:=replace(definition,marker,'(authority.max_reservation_usd IS NOT NULL AND r.budget_usd>authority.max_reservation_usd)');
 marker:='IF authority.debited_usd+r.budget_usd>authority.total_cap_usd THEN';
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'pay-per-use aggregate cap preimage mismatch'; END IF;
 definition:=replace(definition,marker,'IF authority.total_cap_usd IS NOT NULL AND authority.debited_usd+r.budget_usd>authority.total_cap_usd THEN');
 EXECUTE definition;

 -- Reuse existing finite rental deadlines for all readers; ongoing access has no account expiry.
 SELECT pg_get_functiondef('public.videoforge_cloud_media_reservation_authority(uuid,uuid,uuid)'::regprocedure) INTO definition;
 marker:='SELECT b.id,b.expires_at,b.enabled';
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'pay-per-use rental deadline preimage mismatch'; END IF;
 EXECUTE replace(definition,marker,'SELECT b.id,COALESCE(b.expires_at,LEAST(a.deadline_at,COALESCE(r.deadline_at,r.placement_deadline_at+make_interval(secs=>r.rental_seconds)))),b.enabled');
END; $migration$;

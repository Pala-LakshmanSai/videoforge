-- A fenced, expired test remains a cleanup responsibility, not an active video.
-- Preserve its UNKNOWN outcome, debit and global resource slot; never replay its create.
-- The existing singleton lock serializes active rentals and retains one live rental/account.
DROP INDEX public.cloud_media_active_account;
CREATE INDEX cloud_media_active_account ON public.cloud_media_reservations(account_id)
 WHERE state NOT IN ('WAITING_CAPACITY','CLEAN');

DO $migration$
DECLARE definition text; marker text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_guard_cloud_media_reservation()'::regprocedure) INTO definition;
 marker:=$old$OR EXISTS(SELECT 1 FROM cloud_media_reservations r WHERE r.id<>NEW.id AND r.account_id=NEW.account_id
     AND r.state NOT IN ('WAITING_CAPACITY','CLEAN'))$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'terminal cleanup rental guard preimage mismatch'; END IF;
 EXECUTE replace(definition,marker,$new$OR EXISTS(SELECT 1 FROM cloud_media_reservations r WHERE r.id<>NEW.id AND r.account_id=NEW.account_id
     AND r.state NOT IN ('WAITING_CAPACITY','CLEAN') AND NOT public.videoforge_cloud_cleanup_only(r.id))$new$);

 SELECT pg_get_functiondef('public.videoforge_guard_admission_against_cloud_cleanup()'::regprocedure) INTO definition;
 marker:=$old$revision.media_execution_backend='PERSONAL_WORKER'$old$;
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'terminal cleanup admission preimage mismatch'; END IF;
 EXECUTE replace(definition,marker,$new$revision.media_execution_backend IN ('PERSONAL_WORKER','RUNPOD_POD')$new$);

 SELECT pg_get_functiondef('public.videoforge_cloud_media_new_project_ready(uuid)'::regprocedure) INTO definition;
 marker:='AND r.cleanup_verified_at IS NULL';
 IF strpos(definition,marker)=0 THEN RAISE EXCEPTION 'terminal cleanup readiness preimage mismatch'; END IF;
 EXECUTE replace(definition,marker,'AND r.cleanup_verified_at IS NULL AND NOT public.videoforge_cloud_cleanup_only(r.id)');
END; $migration$;

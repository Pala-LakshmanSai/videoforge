-- Match ordinary Cloud admission (0237): a fenced historical cleanup-only rental
-- keeps its UNKNOWN state, liability and global slot without blocking another render.
-- The failed render's own rental must still be clean.
DO $migration$
DECLARE definition text; marker text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_prepare_cloud_media_render_recovery(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure) INTO definition;
 marker:=$old$WHERE r.account_id=supplied_account_id AND r.state NOT IN ('WAITING_CAPACITY','CLEAN'))$old$;
 IF (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1
  OR strpos(definition,$guard$WHERE j.attempt_id=failed.id AND r.state<>'CLEAN')$guard$)=0 THEN
  RAISE EXCEPTION 'render recovery cleanup preimage mismatch'; END IF;
 EXECUTE replace(definition,marker,$new$WHERE r.account_id=supplied_account_id AND r.state NOT IN ('WAITING_CAPACITY','CLEAN')
         AND NOT public.videoforge_cloud_cleanup_only(r.id))$new$);

 SELECT pg_get_functiondef('public.videoforge_read_hosted_api_render_recovery_status(uuid,uuid,uuid,uuid,text)'::regprocedure) INTO definition;
 marker:=$old$AND (r.state<>'CLEAN' OR r.cleanup_verified_at IS NULL)) THEN 'CLEANUP_PENDING'$old$;
 IF (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 THEN
  RAISE EXCEPTION 'render recovery status cleanup preimage mismatch'; END IF;
 EXECUTE replace(definition,marker,$new$AND (r.state<>'CLEAN' OR r.cleanup_verified_at IS NULL)
        AND (NOT public.videoforge_cloud_cleanup_only(r.id) OR EXISTS(
          SELECT 1 FROM cloud_media_jobs job WHERE job.reservation_id=r.id
            AND job.attempt_id=candidate.failed_id))) THEN 'CLEANUP_PENDING'$new$);
END; $migration$;

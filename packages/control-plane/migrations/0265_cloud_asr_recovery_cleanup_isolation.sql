-- Match 0237 Cloud admission and 0257 recovery: retain unrelated strictly fenced cleanup.
-- UNKNOWN launch evidence, authority debit and resource liability remain untouched.
DO $migration$
DECLARE definition text; marker text;
BEGIN
 SELECT pg_get_functiondef('public.videoforge_prepare_cloud_media_asr_recovery(uuid,uuid,uuid,uuid,uuid)'::regprocedure) INTO definition;
 marker:=$old$OR EXISTS(SELECT 1 FROM cloud_media_reservations r WHERE r.account_id=supplied_account_id
    AND (r.state<>'CLEAN' OR (r.project_revision_id=previous.id AND r.failure_settled_at IS NULL)))$old$;
 IF strpos(definition,marker)=0 THEN
  RAISE EXCEPTION 'failed ASR cleanup isolation preimage mismatch';
 END IF;
 EXECUTE replace(definition,marker,$new$OR EXISTS(SELECT 1 FROM cloud_media_reservations r WHERE r.account_id=supplied_account_id
    AND ((r.state<>'CLEAN' AND (r.project_id=supplied_project_id
      OR NOT public.videoforge_cloud_cleanup_only(r.id)))
      OR (r.project_revision_id=previous.id AND r.failure_settled_at IS NULL)))$new$);
END; $migration$;

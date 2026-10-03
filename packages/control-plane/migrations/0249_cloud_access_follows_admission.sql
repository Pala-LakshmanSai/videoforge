-- Ordinary Cloud access follows VideoForge admission, including future invitations.
-- Historical finite authority lists, balances, runtime pins and rental fences stay intact.
-- Replace in place to retain the readers' OIDs, owners and EXECUTE grants.
DO $migration$
DECLARE definition text; marker text; replacement text; reader regprocedure;
BEGIN
 FOR reader,marker,replacement IN
  SELECT * FROM (VALUES
   ('public.videoforge_cloud_media_new_project_ready(uuid)'::regprocedure,
    'public.videoforge_current_account_id()=ANY(b.allowed_account_ids)',
    $ready$((NOT b.ongoing_pay_per_use AND public.videoforge_current_account_id()=ANY(b.allowed_account_ids))
     OR (b.ongoing_pay_per_use AND EXISTS(
      SELECT 1 FROM public.accounts account
      JOIN public.hosted_auth_links link ON link.admitted_account_id=account.id
      JOIN public.hosted_auth_users auth_user ON auth_user.id=link.hosted_auth_user_id
      WHERE account.id=public.videoforge_current_account_id() AND account.status='ACTIVE'
       AND auth_user.email_verified
       AND NOT EXISTS(SELECT 1 FROM public.hosted_access_revocations revoked
        WHERE revoked.hosted_auth_user_id=auth_user.id))))$ready$),
   ('public.videoforge_cloud_media_authority_project_allowed(uuid,uuid,uuid,uuid)'::regprocedure,
    '$2=ANY(b.allowed_account_ids)',
    $project$((NOT b.ongoing_pay_per_use AND $2=ANY(b.allowed_account_ids))
     OR (b.ongoing_pay_per_use AND EXISTS(
      SELECT 1 FROM public.accounts account
      JOIN public.hosted_auth_links link ON link.admitted_account_id=account.id
      JOIN public.hosted_auth_users auth_user ON auth_user.id=link.hosted_auth_user_id
      WHERE account.id=$2 AND account.status='ACTIVE'
       AND auth_user.email_verified
       AND EXISTS(SELECT 1 FROM public.projects owned_project
        WHERE owned_project.id=$3 AND owned_project.account_id=$2)
       AND NOT EXISTS(SELECT 1 FROM public.hosted_access_revocations revoked
        WHERE revoked.hosted_auth_user_id=auth_user.id))))$project$),
   -- Admission controls new work. Existing fenced rentals retain their cleanup reader
   -- after VideoForge revocation; exact tenant/job/attempt/fence joins stay mandatory.
   ('public.videoforge_cloud_media_reservation_authority(uuid,uuid,uuid)'::regprocedure,
    'public.videoforge_cloud_media_authority_project_allowed(b.id,r.account_id,r.project_id,r.project_revision_id)',
    '(b.ongoing_pay_per_use OR public.videoforge_cloud_media_authority_project_allowed(b.id,r.account_id,r.project_id,r.project_revision_id))')
  ) AS patches(reader,marker,replacement)
 LOOP
  SELECT pg_get_functiondef(reader) INTO definition;
  IF strpos(definition,replacement)>0 THEN CONTINUE; END IF;
  IF strpos(definition,marker)=0 THEN
   RAISE EXCEPTION 'Cloud admission reader preimage mismatch: %',reader;
  END IF;
  EXECUTE replace(definition,marker,replacement);
 END LOOP;
END; $migration$;

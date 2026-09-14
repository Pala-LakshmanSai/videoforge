-- Permit bounded renewal of the same unused browser input upload. Existing
-- content/tenant identity, receipts and non-browser reservations remain sealed.
-- Rollback: restore the prior function definition; no rows or columns are removed.
DO $migration$
DECLARE
  definition text;
  source_hash text;
  needle text := 'IF TG_OP=''UPDATE'' THEN';
  replacement text := $renewal$IF TG_OP = 'UPDATE' THEN
    IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      IF OLD.state = 'ISSUED' AND NEW.state = 'ISSUED'
         AND OLD.used_count = 0 AND NEW.used_count = 0
         AND OLD.lane = 'INPUT' AND OLD.job_id = 'browser-upload'
         AND OLD.artifact_id = 'voiceover' AND OLD.method = 'PUT'
         AND NEW.expires_at > OLD.expires_at AND NEW.expires_at > now()
         AND NEW.expires_at <= now() + interval '15 minutes'
         AND (to_jsonb(NEW) - ARRAY['expires_at', 'updated_at']::text[])
             = (to_jsonb(OLD) - ARRAY['expires_at', 'updated_at']::text[])
         AND EXISTS (
           SELECT 1 FROM public.hosted_project_create_requests AS request
            JOIN public.projects AS project ON project.id = request.project_id
             AND project.account_id = request.account_id
             AND project.workspace_id = request.workspace_id
            WHERE request.account_id = OLD.account_id
              AND request.workspace_id = OLD.workspace_id
              AND request.project_id = OLD.project_id
              AND request.project_revision_id = OLD.project_revision_id
              AND request.voiceover_asset_id = OLD.asset_id
              AND request.upload_reservation_id = OLD.id
              AND request.state = 'UPLOAD_PENDING' AND project.status = 'ACTIVE'
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.artifact_receipts WHERE reservation_id = OLD.id
         ) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'artifact reservation expiry renewal rejected' USING ERRCODE = '55000';
    END IF;$renewal$;
BEGIN
  SELECT pg_get_functiondef(oid), encode(sha256(convert_to(prosrc, 'UTF8')), 'hex')
    INTO definition, source_hash FROM pg_proc
   WHERE oid = 'public.videoforge_artifact_reservation_guard()'::regprocedure;
  IF source_hash IS DISTINCT FROM 'd89ce5d3ae59708d8eabfb0c4299077de58b0c117bd01fe78c222e6475f77465'
     OR position(needle IN definition) = 0
     OR position('SECURITY DEFINER' IN definition) = 0
     OR position('videoforge_current_account_id() IS DISTINCT FROM NEW.account_id' IN definition) = 0 THEN
    RAISE EXCEPTION 'pending upload renewal predecessor drift' USING ERRCODE = '23514';
  END IF;
  EXECUTE replace(definition, needle, replacement);
END;
$migration$;

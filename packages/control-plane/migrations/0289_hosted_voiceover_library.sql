-- Standalone script-to-MP3 archive. The J1 job remains the provider identity and no video project
-- is created. Audio is published only after a verified private-object receipt is finalized.
CREATE TABLE public.hosted_voiceover_library_assets (
  voiceover_job_id uuid PRIMARY KEY REFERENCES public.hosted_voiceover_jobs(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  creator_user_id uuid NOT NULL,
  title text NOT NULL CHECK (title = btrim(title) AND length(title) BETWEEN 1 AND 240),
  voice_name text NOT NULL CHECK (voice_name = btrim(voice_name) AND length(voice_name) BETWEEN 1 AND 240),
  object_key text,
  filename text NOT NULL CHECK (filename ~ '^[A-Za-z0-9._-]{1,150}\.mp3$'),
  content_type text,
  content_length bigint,
  checksum_sha256 text,
  duration_ms bigint,
  archive_failure_code text CHECK (archive_failure_code IS NULL OR archive_failure_code ~ '^[A-Z0-9_]{1,96}$'),
  archive_claim_id uuid,
  archive_claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  FOREIGN KEY (account_id,workspace_id) REFERENCES public.workspaces(account_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id,creator_user_id) REFERENCES public.memberships(workspace_id,user_id) ON DELETE RESTRICT,
  CHECK ((object_key IS NULL AND content_type IS NULL AND content_length IS NULL AND checksum_sha256 IS NULL AND duration_ms IS NULL)
     OR (object_key IS NOT NULL AND content_type IS NOT NULL AND content_length IS NOT NULL AND checksum_sha256 IS NOT NULL AND duration_ms IS NOT NULL)),
  CHECK (content_type IS NULL OR content_type='audio/mpeg'),
  CHECK (content_length IS NULL OR content_length BETWEEN 1 AND 1073741824),
  CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (duration_ms IS NULL OR duration_ms BETWEEN 1 AND 3600000),
  CHECK ((archive_claim_id IS NULL) = (archive_claimed_at IS NULL)),
  CHECK (object_key IS NULL OR object_key ~ '^tenant/[A-Za-z0-9._:-]+/workspace/[A-Za-z0-9._:-]+/voiceover/[0-9a-f-]{36}/[0-9a-f-]{36}\.mp3$')
);
CREATE INDEX hosted_voiceover_library_owner
  ON public.hosted_voiceover_library_assets(account_id,workspace_id,created_at DESC);
CREATE INDEX hosted_voiceover_library_pending
  ON public.hosted_voiceover_library_assets(updated_at,voiceover_job_id)
  WHERE object_key IS NULL AND deleted_at IS NULL;
ALTER TABLE public.hosted_voiceover_library_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_voiceover_library_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY hosted_voiceover_library_tenant ON public.hosted_voiceover_library_assets
  USING (account_id=public.videoforge_current_account_id())
  WITH CHECK (account_id=public.videoforge_current_account_id());
REVOKE ALL ON public.hosted_voiceover_library_assets FROM PUBLIC;

CREATE FUNCTION public.videoforge_voiceover_library_tenant_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.account_id IS DISTINCT FROM public.videoforge_current_account_id()
       OR NOT EXISTS (
         SELECT 1 FROM public.workspaces w
          WHERE w.id=NEW.workspace_id AND w.account_id=NEW.account_id AND w.status='ACTIVE'
       )
       OR NOT EXISTS (
         SELECT 1 FROM public.memberships m
          WHERE m.workspace_id=NEW.workspace_id AND m.user_id=NEW.creator_user_id AND m.status='ACTIVE'
       )
       OR NOT EXISTS (
         SELECT 1 FROM public.hosted_voiceover_jobs j
          WHERE j.id=NEW.voiceover_job_id AND j.account_id=NEW.account_id AND j.workspace_id=NEW.workspace_id
       )
    THEN RAISE EXCEPTION 'voiceover library tenant scope invalid' USING ERRCODE='42501'; END IF;
  ELSIF NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.creator_user_id IS DISTINCT FROM OLD.creator_user_id
     OR NOT EXISTS (
       SELECT 1 FROM public.hosted_voiceover_jobs j
        WHERE j.id=NEW.voiceover_job_id AND j.account_id=NEW.account_id AND j.workspace_id=NEW.workspace_id
     )
  THEN RAISE EXCEPTION 'voiceover library tenant scope invalid' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hosted_voiceover_library_tenant_write
  BEFORE INSERT OR UPDATE ON public.hosted_voiceover_library_assets
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_voiceover_library_tenant_guard();

CREATE FUNCTION public.videoforge_voiceover_library_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
  IF NEW.voiceover_job_id IS DISTINCT FROM OLD.voiceover_job_id
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.creator_user_id IS DISTINCT FROM OLD.creator_user_id
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.voice_name IS DISTINCT FROM OLD.voice_name
     OR NEW.filename IS DISTINCT FROM OLD.filename
     OR (OLD.object_key IS NOT NULL AND (
       NEW.object_key IS DISTINCT FROM OLD.object_key OR NEW.content_type IS DISTINCT FROM OLD.content_type
       OR NEW.content_length IS DISTINCT FROM OLD.content_length OR NEW.checksum_sha256 IS DISTINCT FROM OLD.checksum_sha256
       OR NEW.duration_ms IS DISTINCT FROM OLD.duration_ms))
     OR (OLD.archive_failure_code IS NOT NULL AND NEW.archive_failure_code IS DISTINCT FROM OLD.archive_failure_code)
     OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
  THEN RAISE EXCEPTION 'voiceover library identity cannot replay' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hosted_voiceover_library_identity_guard
  BEFORE UPDATE ON public.hosted_voiceover_library_assets
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_voiceover_library_identity_guard();

-- Queue the existing durable J1 identity and its archive metadata in one database transaction.
CREATE FUNCTION public.videoforge_queue_standalone_voiceover(
  a uuid,w uuid,u uuid,j uuid,h text,s text,v text,f text,t text,n text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE queued jsonb; existing public.hosted_voiceover_library_assets; existing_job public.hosted_voiceover_jobs;
BEGIN
  IF a IS DISTINCT FROM public.videoforge_current_account_id()
     OR t IS NULL OR t<>btrim(t) OR length(t) NOT BETWEEN 1 AND 240
     OR n IS NULL OR n<>btrim(n) OR length(n) NOT BETWEEN 1 AND 240
  OR NOT EXISTS (SELECT 1 FROM public.memberships m JOIN public.workspaces w0 ON w0.id=m.workspace_id
                     WHERE m.workspace_id=w AND m.user_id=u AND w0.account_id=a AND m.status='ACTIVE' AND w0.status='ACTIVE')
  THEN RAISE EXCEPTION 'voiceover library tenant scope invalid' USING ERRCODE='42501'; END IF;
  -- A job already owned by the video pipeline, or any pre-existing hosted job
  -- without a library row, is never adopted by this standalone entrypoint.
  -- This preserves the original workflow identity and prevents a retry from
  -- silently changing its product surface.
  SELECT * INTO existing_job FROM public.hosted_voiceover_jobs WHERE id=j FOR UPDATE;
  IF FOUND AND existing_job.account_id=a AND existing_job.workspace_id=w THEN
    IF EXISTS (SELECT 1 FROM public.hosted_script_projects WHERE voiceover_job_id=j AND account_id=a AND workspace_id=w) THEN
      RAISE EXCEPTION 'VOICEOVER_LIBRARY_PIPELINE_JOB_CONFLICT';
    END IF;
    SELECT * INTO existing FROM public.hosted_voiceover_library_assets WHERE voiceover_job_id=j FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'VOICEOVER_LIBRARY_EXISTING_JOB_CONFLICT';
    END IF;
  END IF;
  queued:=public.videoforge_queue_voiceover_job(a,w,j,h,s,v,f);
  SELECT * INTO existing FROM public.hosted_voiceover_library_assets WHERE voiceover_job_id=j FOR UPDATE;
  IF FOUND THEN
    IF existing.account_id<>a OR existing.workspace_id<>w OR existing.creator_user_id<>u
       OR existing.title<>t OR existing.voice_name<>n OR existing.filename<>f
    THEN RAISE EXCEPTION 'VOICEOVER_LIBRARY_REQUEST_CONFLICT'; END IF;
    IF existing.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'VOICEOVER_LIBRARY_DELETED'; END IF;
  ELSE
    INSERT INTO public.hosted_voiceover_library_assets(
      voiceover_job_id,account_id,workspace_id,creator_user_id,title,voice_name,filename
    ) VALUES (j,a,w,u,t,n,f);
  END IF;
  RETURN queued;
END $$;

CREATE FUNCTION public.videoforge_read_voiceover_library_asset(a uuid,w uuid,j uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
  SELECT jsonb_build_object(
    'voiceover_job_id',asset.voiceover_job_id,'title',asset.title,'voice_name',asset.voice_name,
    'script',job.script,'voice_id',job.voice_id,'filename',asset.filename,'object_key',asset.object_key,
    'content_type',asset.content_type,'content_length',asset.content_length,
    'checksum_sha256',asset.checksum_sha256,'duration_ms',asset.duration_ms,
    'archive_failure_code',asset.archive_failure_code,
    'archive_claim_id',asset.archive_claim_id,'archive_claimed_at',asset.archive_claimed_at,
    'created_at',asset.created_at,'deleted_at',asset.deleted_at,'state',job.state
  )
    FROM public.hosted_voiceover_library_assets asset
    JOIN public.hosted_voiceover_jobs job ON job.id=asset.voiceover_job_id
   WHERE a=public.videoforge_current_account_id() AND asset.account_id=a
     AND asset.workspace_id=w AND asset.voiceover_job_id=j;
$$;

-- A short lease prevents an archive crash from blocking forever and prevents delete while an
-- in-flight downloader can still write. The object key contains the claim, so deletion can clean
-- the complete job prefix after the row is marked deleted.
CREATE FUNCTION public.videoforge_claim_voiceover_library_archive(a uuid,w uuid,j uuid,c uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE asset public.hosted_voiceover_library_assets; job public.hosted_voiceover_jobs;
BEGIN
  IF a IS DISTINCT FROM public.videoforge_current_account_id() THEN RAISE EXCEPTION 'voiceover library tenant scope invalid' USING ERRCODE='42501'; END IF;
  SELECT * INTO asset FROM public.hosted_voiceover_library_assets WHERE account_id=a AND workspace_id=w AND voiceover_job_id=j FOR UPDATE;
  IF NOT FOUND OR asset.deleted_at IS NOT NULL THEN RETURN NULL; END IF;
  SELECT * INTO job FROM public.hosted_voiceover_jobs WHERE id=j AND account_id=a AND workspace_id=w;
  IF NOT FOUND OR job.state<>'COMPLETED' OR job.provider_job_id IS NULL THEN RETURN NULL; END IF;
  IF asset.object_key IS NOT NULL THEN RETURN public.videoforge_read_voiceover_library_asset(a,w,j); END IF;
  IF asset.archive_failure_code IS NOT NULL THEN RETURN NULL; END IF;
  IF asset.archive_claim_id IS NOT NULL AND asset.archive_claimed_at>now()-interval '15 minutes' THEN
    RETURN NULL;
  END IF;
  UPDATE public.hosted_voiceover_library_assets
     SET archive_claim_id=c,archive_claimed_at=now(),updated_at=now()
   WHERE account_id=a AND workspace_id=w AND voiceover_job_id=j;
  RETURN jsonb_build_object(
    'voiceover_job_id',j,'title',asset.title,'voice_name',asset.voice_name,'script',job.script,
    'voice_id',job.voice_id,'provider_job_id',job.provider_job_id,'filename',asset.filename,
    'previous_claim_id',asset.archive_claim_id,
    'object_prefix','tenant/'||a::text||'/workspace/'||w::text||'/voiceover/'||j::text||'/'
  );
END $$;

CREATE FUNCTION public.videoforge_finalize_voiceover_library_archive(
  a uuid,w uuid,j uuid,c uuid,k text,ct text,bytes bigint,checksum text,duration bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE asset public.hosted_voiceover_library_assets; job public.hosted_voiceover_jobs;
BEGIN
  IF a IS DISTINCT FROM public.videoforge_current_account_id()
     OR k IS NULL OR k<>'tenant/'||a::text||'/workspace/'||w::text||'/voiceover/'||j::text||'/'||c::text||'.mp3'
     OR ct IS DISTINCT FROM 'audio/mpeg' OR bytes IS NULL OR bytes NOT BETWEEN 1 AND 1073741824
     OR checksum IS NULL OR checksum !~ '^sha256:[0-9a-f]{64}$'
     OR duration IS NULL OR duration NOT BETWEEN 1 AND 3600000
  THEN RAISE EXCEPTION 'VOICEOVER_LIBRARY_AUDIO_INVALID' USING ERRCODE='23514'; END IF;
  SELECT * INTO asset FROM public.hosted_voiceover_library_assets WHERE account_id=a AND workspace_id=w AND voiceover_job_id=j FOR UPDATE;
  IF NOT FOUND OR asset.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'VOICEOVER_NOT_READY' USING ERRCODE='55000'; END IF;
  SELECT * INTO job FROM public.hosted_voiceover_jobs WHERE id=j AND account_id=a AND workspace_id=w;
  IF NOT FOUND OR job.state<>'COMPLETED' OR job.provider_job_id IS NULL THEN RAISE EXCEPTION 'VOICEOVER_NOT_READY' USING ERRCODE='55000'; END IF;
  IF asset.object_key IS NOT NULL THEN
    IF asset.object_key<>k OR asset.content_type<>ct OR asset.content_length<>bytes OR asset.checksum_sha256<>checksum OR asset.duration_ms<>duration
    THEN RAISE EXCEPTION 'VOICEOVER_LIBRARY_IDENTITY_CONFLICT'; END IF;
    RETURN public.videoforge_read_voiceover_library_asset(a,w,j);
  END IF;
  IF asset.archive_claim_id IS DISTINCT FROM c THEN RAISE EXCEPTION 'VOICEOVER_LIBRARY_ARCHIVE_CLAIM_LOST' USING ERRCODE='55000'; END IF;
  UPDATE public.hosted_voiceover_library_assets
     SET object_key=k,content_type=ct,content_length=bytes,checksum_sha256=checksum,duration_ms=duration,
         archive_claim_id=NULL,archive_claimed_at=NULL,updated_at=now()
   WHERE account_id=a AND workspace_id=w AND voiceover_job_id=j;
  RETURN public.videoforge_read_voiceover_library_asset(a,w,j);
END $$;

-- A terminal validation failure must leave the completed provider job visible without making the
-- reconciler download the same malformed object forever. Transient fetch failures leave the claim
-- in place until its lease expires and are retried by the pending query.
CREATE FUNCTION public.videoforge_record_voiceover_library_archive_failure(
  a uuid,w uuid,j uuid,c uuid,e text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE asset public.hosted_voiceover_library_assets;
BEGIN
  IF a IS DISTINCT FROM public.videoforge_current_account_id()
     OR e IS DISTINCT FROM 'VOICEOVER_LIBRARY_AUDIO_INVALID'
  THEN RAISE EXCEPTION 'VOICEOVER_LIBRARY_ARCHIVE_FAILURE_INVALID' USING ERRCODE='23514'; END IF;
  SELECT * INTO asset FROM public.hosted_voiceover_library_assets
   WHERE account_id=a AND workspace_id=w AND voiceover_job_id=j FOR UPDATE;
  IF NOT FOUND OR asset.deleted_at IS NOT NULL THEN RETURN NULL; END IF;
  IF asset.object_key IS NOT NULL THEN RETURN public.videoforge_read_voiceover_library_asset(a,w,j); END IF;
  IF asset.archive_claim_id IS DISTINCT FROM c THEN
    RAISE EXCEPTION 'VOICEOVER_LIBRARY_ARCHIVE_CLAIM_LOST' USING ERRCODE='55000';
  END IF;
  UPDATE public.hosted_voiceover_library_assets
     SET archive_failure_code=e,archive_claim_id=NULL,archive_claimed_at=NULL,updated_at=now()
   WHERE account_id=a AND workspace_id=w AND voiceover_job_id=j;
  RETURN public.videoforge_read_voiceover_library_asset(a,w,j);
END $$;

CREATE FUNCTION public.videoforge_pending_voiceover_library_archives()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'accountId',pending.account_id,'workspaceId',pending.workspace_id,'jobId',pending.voiceover_job_id
  ) ORDER BY pending.updated_at,pending.voiceover_job_id),'[]'::jsonb)
    FROM (
      SELECT asset.account_id,asset.workspace_id,asset.voiceover_job_id,asset.updated_at
        FROM public.hosted_voiceover_library_assets asset
        JOIN public.hosted_voiceover_jobs job ON job.id=asset.voiceover_job_id
       WHERE asset.object_key IS NULL AND asset.deleted_at IS NULL AND job.state='COMPLETED'
         AND job.provider_job_id IS NOT NULL
         AND asset.archive_failure_code IS NULL
         AND (asset.archive_claim_id IS NULL OR asset.archive_claimed_at<=now()-interval '15 minutes')
       ORDER BY asset.updated_at,asset.voiceover_job_id
       LIMIT 20
    ) pending;
$$;

-- Common API shape for the private library and the owner-only centralized collection. The
-- database repeats the session/owner check so callers cannot turn the UI toggle into a tenant
-- bypass. Rows remain visible while the provider/archive state is pending; only finalized rows
-- receive an audio URL from the application layer.
CREATE FUNCTION public.videoforge_read_voiceover_library(
  supplied_token text, centralized boolean DEFAULT false, selected_job uuid DEFAULT NULL,
  search_text text DEFAULT '', selected_creator uuid DEFAULT NULL, page_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_catalog SET row_security=off AS $$
DECLARE scope record;
BEGIN
  SELECT * INTO scope FROM public.videoforge_hosted_session_scope(supplied_token) LIMIT 1;
  IF NOT FOUND OR (centralized AND lower(btrim(scope.normalized_email))<>'demo9gss@gmail.com') THEN
    RETURN jsonb_build_object('error',CASE WHEN centralized THEN 'CENTRALIZED_LIBRARY_FORBIDDEN' ELSE 'VOICEOVER_LIBRARY_FORBIDDEN' END);
  END IF;
  IF page_offset IS NULL OR page_offset<0 OR search_text IS NULL OR length(search_text)>200 THEN
    RETURN jsonb_build_object('error','VOICEOVER_QUERY_INVALID');
  END IF;
  RETURN (
    WITH base AS MATERIALIZED (
      SELECT asset.voiceover_job_id AS id,asset.title,asset.voice_name,job.voice_id,
             CASE WHEN asset.archive_failure_code IS NOT NULL THEN 'ARCHIVE_FAILED'
                  WHEN asset.object_key IS NULL AND job.state='COMPLETED' THEN 'ARCHIVING'
                  ELSE job.state END AS state,
             asset.filename,asset.created_at,job.script,length(job.script) AS character_count,
             asset.duration_ms,asset.content_length,asset.checksum_sha256,asset.object_key,
             coalesce(link.admitted_account_id,asset.account_id) AS creator_id,
             coalesce(nullif(auth_user.name,''),asset.creator_user_id::text) AS creator_name,
             coalesce(nullif(auth_user.email,''),'unknown') AS creator_email
        FROM public.hosted_voiceover_library_assets asset
        JOIN public.hosted_voiceover_jobs job ON job.id=asset.voiceover_job_id
         AND job.account_id=asset.account_id AND job.workspace_id=asset.workspace_id
        LEFT JOIN public.hosted_auth_links link ON link.user_id=asset.creator_user_id
         AND link.admitted_account_id=asset.account_id AND link.workspace_id=asset.workspace_id
        LEFT JOIN public.hosted_auth_users auth_user ON auth_user.id=link.hosted_auth_user_id
       WHERE asset.deleted_at IS NULL
         AND (centralized OR (asset.account_id=scope.account_id AND asset.workspace_id=scope.workspace_id))
    ), eligible AS MATERIALIZED (
      SELECT * FROM base
       WHERE (selected_job IS NULL OR id=selected_job)
         AND (selected_creator IS NULL OR creator_id=selected_creator)
         AND (search_text='' OR position(lower(search_text) IN lower(
              title||' '||voice_name||' '||voice_id||' '||filename||' '||creator_name||' '||creator_email))>0)
    ), paged AS (
      SELECT * FROM eligible ORDER BY created_at DESC,id DESC LIMIT 48 OFFSET page_offset
    )
    SELECT jsonb_build_object(
      'voiceovers',coalesce((SELECT jsonb_agg(to_jsonb(paged) ORDER BY created_at DESC,id DESC) FROM paged),'[]'::jsonb),
      'total',(SELECT count(*) FROM eligible),
      'total_voiceovers',(SELECT count(*) FROM eligible),
      'total_bytes',(SELECT coalesce(sum(content_length),0) FROM base),
      'creators',coalesce((SELECT jsonb_agg(jsonb_build_object('id',creator_id,'name',creator_name,'email',creator_email)
        ORDER BY creator_name,creator_id)
        FROM (SELECT DISTINCT creator_id,creator_name,creator_email FROM base) creator),'[]'::jsonb)
    )
  );
END $$;

-- The application performs the private-object delete between the plan and finalize calls. A
-- boolean keeps that two-phase contract small while this function still repeats the session and
-- tenant/owner fence for both library modes.
CREATE FUNCTION public.videoforge_delete_voiceover_library(
  supplied_token text, centralized boolean, selected_job uuid, finalize boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_catalog SET row_security=off AS $$
DECLARE scope record; asset public.hosted_voiceover_library_assets;
BEGIN
  SELECT * INTO scope FROM public.videoforge_hosted_session_scope(supplied_token) LIMIT 1;
  IF NOT FOUND OR (centralized AND lower(btrim(scope.normalized_email))<>'demo9gss@gmail.com')
  THEN RETURN jsonb_build_object('error',CASE WHEN centralized THEN 'CENTRALIZED_LIBRARY_FORBIDDEN' ELSE 'VOICEOVER_LIBRARY_FORBIDDEN' END); END IF;
  SELECT * INTO asset FROM public.hosted_voiceover_library_assets
   WHERE voiceover_job_id=selected_job
     AND (centralized OR (account_id=scope.account_id AND workspace_id=scope.workspace_id)) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','VOICEOVER_NOT_FOUND'); END IF;
  IF asset.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('deleted',true); END IF;
  IF asset.archive_claim_id IS NOT NULL THEN RETURN jsonb_build_object('error','VOICEOVER_ARCHIVE_BUSY'); END IF;
  IF asset.object_key IS NULL THEN RETURN jsonb_build_object('error','VOICEOVER_NOT_READY'); END IF;
  IF NOT finalize THEN
    RETURN jsonb_build_object(
      'object_key',asset.object_key,
      'artifact_prefix','tenant/'||asset.account_id::text||'/workspace/'||asset.workspace_id::text||'/voiceover/'||asset.voiceover_job_id::text||'/');
  END IF;
  UPDATE public.hosted_voiceover_library_assets SET deleted_at=now(),updated_at=now()
   WHERE voiceover_job_id=selected_job AND deleted_at IS NULL;
  RETURN jsonb_build_object('deleted',true);
END $$;

REVOKE ALL ON FUNCTION public.videoforge_voiceover_library_tenant_guard(),public.videoforge_voiceover_library_identity_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.videoforge_queue_standalone_voiceover(uuid,uuid,uuid,uuid,text,text,text,text,text,text),
  public.videoforge_read_voiceover_library_asset(uuid,uuid,uuid),
  public.videoforge_claim_voiceover_library_archive(uuid,uuid,uuid,uuid),
  public.videoforge_finalize_voiceover_library_archive(uuid,uuid,uuid,uuid,text,text,bigint,text,bigint),
  public.videoforge_record_voiceover_library_archive_failure(uuid,uuid,uuid,uuid,text),
  public.videoforge_pending_voiceover_library_archives(),
  public.videoforge_read_voiceover_library(text,boolean,uuid,text,uuid,integer),
  public.videoforge_delete_voiceover_library(text,boolean,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.videoforge_queue_standalone_voiceover(uuid,uuid,uuid,uuid,text,text,text,text,text,text),
  public.videoforge_read_voiceover_library_asset(uuid,uuid,uuid),
  public.videoforge_claim_voiceover_library_archive(uuid,uuid,uuid,uuid),
  public.videoforge_finalize_voiceover_library_archive(uuid,uuid,uuid,uuid,text,text,bigint,text,bigint),
  public.videoforge_record_voiceover_library_archive_failure(uuid,uuid,uuid,uuid,text),
  public.videoforge_pending_voiceover_library_archives(),
  public.videoforge_read_voiceover_library(text,boolean,uuid,text,uuid,integer),
  public.videoforge_delete_voiceover_library(text,boolean,uuid,boolean)
  TO videoforge_v209_runtime_dc9612d6;

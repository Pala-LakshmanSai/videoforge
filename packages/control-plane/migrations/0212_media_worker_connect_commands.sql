-- Account-issued, one-computer commands. Raw tokens are never stored.
CREATE TABLE public.media_worker_connect_commands (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  token_sha256 text NOT NULL UNIQUE CHECK (token_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  consumed_at timestamptz,
  FOREIGN KEY (account_id,workspace_id) REFERENCES public.workspaces(account_id,id)
);
ALTER TABLE public.media_worker_connect_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_worker_connect_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY media_worker_connect_commands_tenant ON public.media_worker_connect_commands
  USING (account_id=public.videoforge_current_account_id())
  WITH CHECK (account_id=public.videoforge_current_account_id());
CREATE TRIGGER media_worker_connect_commands_tenant_write_guard
  BEFORE INSERT OR UPDATE ON public.media_worker_connect_commands
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_assert_tenant_write();
REVOKE ALL ON public.media_worker_connect_commands FROM PUBLIC;

-- Only an exact unexpired token can establish scope. UPDATE locks the command until
-- enrollment and device creation commit; failures roll back consumption as well.
CREATE FUNCTION public.videoforge_media_worker_connect_consume(p_token_sha256 text)
RETURNS TABLE(account_id uuid, workspace_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE command public.media_worker_connect_commands%ROWTYPE;
BEGIN
  IF p_token_sha256 IS NULL OR p_token_sha256 !~ '^sha256:[0-9a-f]{64}$' THEN RETURN; END IF;
  SELECT * INTO command FROM public.media_worker_connect_commands c
    WHERE c.token_sha256=p_token_sha256 AND c.expires_at>now() AND c.consumed_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM set_config('videoforge.account_id',command.account_id::text,true);
  UPDATE public.media_worker_connect_commands c SET consumed_at=now() WHERE c.id=command.id;
  RETURN QUERY SELECT command.account_id,command.workspace_id;
END;
$$;
REVOKE ALL ON FUNCTION public.videoforge_media_worker_connect_consume(text) FROM PUBLIC;
CREATE FUNCTION public.videoforge_media_worker_connect_valid(p_token_sha256 text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS(SELECT 1 FROM public.media_worker_connect_commands c
    WHERE c.token_sha256=p_token_sha256 AND c.expires_at>now() AND c.consumed_at IS NULL);
$$;
REVOKE ALL ON FUNCTION public.videoforge_media_worker_connect_valid(text) FROM PUBLIC;
GRANT SELECT,INSERT,DELETE ON public.media_worker_connect_commands TO videoforge_v209_runtime_dc9612d6;
GRANT EXECUTE ON FUNCTION public.videoforge_media_worker_connect_consume(text) TO videoforge_v209_runtime_dc9612d6;
GRANT EXECUTE ON FUNCTION public.videoforge_media_worker_connect_valid(text) TO videoforge_v209_runtime_dc9612d6;

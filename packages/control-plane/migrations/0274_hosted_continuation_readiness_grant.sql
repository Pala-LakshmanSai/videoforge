-- The automatic continuation sweep uses the existing read-only, account-fenced
-- accepted-media check. Keep every other helper and operator entrypoint private.
GRANT EXECUTE ON FUNCTION public.videoforge_hosted_videos_ready(uuid,uuid,uuid)
  TO videoforge_v209_runtime_dc9612d6;

-- The live V2-09 runtime lost these two exact Stage 6 admission capabilities after 0196.
-- Restore only their established allowlist entries; do not grant table access or PUBLIC EXECUTE.
GRANT EXECUTE ON FUNCTION public.videoforge_admit_hosted_v209_generation(uuid,uuid,uuid,uuid)
  TO videoforge_v209_runtime_dc9612d6;
GRANT EXECUTE ON FUNCTION public.videoforge_has_hosted_v209_ordinary_candidate(uuid,uuid,uuid)
  TO videoforge_v209_runtime_dc9612d6;

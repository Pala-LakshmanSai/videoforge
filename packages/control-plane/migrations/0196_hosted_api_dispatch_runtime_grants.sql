-- The Stage 5 continuation reaches ordinary admission before span preparation. Restore only
-- the two direct runtime calls whose grants are absent in the production database.
GRANT EXECUTE ON FUNCTION public.videoforge_admit_hosted_v209_generation(uuid,uuid,uuid,uuid)
  TO videoforge_v209_runtime_dc9612d6;
GRANT EXECUTE ON FUNCTION public.videoforge_has_hosted_v209_ordinary_candidate(uuid,uuid,uuid)
  TO videoforge_v209_runtime_dc9612d6;

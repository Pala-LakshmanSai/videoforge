-- User selected prompt-only text prevention; no extra per-image inspection charge.
-- Preserve historical receipts and pinned jobs; new initial/replacement jobs skip paid QA.
ALTER TABLE public.hosted_api_generation_jobs
  ALTER COLUMN image_text_qa_required SET DEFAULT false;
ALTER TABLE public.hosted_api_image_regeneration_jobs
  ALTER COLUMN image_text_qa_required SET DEFAULT false;

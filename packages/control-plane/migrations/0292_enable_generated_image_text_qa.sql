-- Funded production activation after exact-image QA qualification.
-- Defaults affect only future jobs. Historical manifests, flags, receipts and paid tasks are unchanged.
ALTER TABLE public.hosted_api_generation_jobs
  ALTER COLUMN image_text_qa_required SET DEFAULT true;
ALTER TABLE public.hosted_api_image_regeneration_jobs
  ALTER COLUMN image_text_qa_required SET DEFAULT true;

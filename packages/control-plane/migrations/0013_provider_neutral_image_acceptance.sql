ALTER TABLE public.image_generation_acceptances
  DROP CONSTRAINT image_generation_acceptances_schema_version_check;

ALTER TABLE public.image_generation_acceptances
  ADD CONSTRAINT image_generation_acceptances_schema_version_check
  CHECK (
    schema_version IN (
      'videoforge.fixture-image-acceptance/v1',
      'videoforge.mage-image-acceptance/v1'
    )
  );

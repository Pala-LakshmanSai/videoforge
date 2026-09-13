-- 0119_hosted_v209_qualification_pair_uniqueness.sql
--
-- 0089 keyed activations by source/config/Cloudflare version only. A repeated
-- read-only qualification refresh keeps those identities but creates fresh
-- lane qualification attestations, so that key rejects valid append-only
-- renewal before 0104 can insert it. Keep the historical identities in the
-- key and add both qualification IDs to distinguish each immutable pair.
DO $migration_constraint$
DECLARE
  old_constraint text;
  old_constraint_count integer;
BEGIN
  SELECT count(*)::integer, min(c.conname)
  INTO old_constraint_count, old_constraint
  FROM pg_catalog.pg_constraint AS c
  WHERE c.conrelid = 'public.hosted_v209_qualified_activations'::regclass
    AND c.contype = 'u'
    AND c.conkey = ARRAY[
      (SELECT a.attnum
       FROM pg_catalog.pg_attribute AS a
       WHERE a.attrelid = c.conrelid
         AND a.attname = 'source_commit'
         AND NOT a.attisdropped),
      (SELECT a.attnum
       FROM pg_catalog.pg_attribute AS a
       WHERE a.attrelid = c.conrelid
         AND a.attname = 'deployed_config_sha256'
         AND NOT a.attisdropped),
      (SELECT a.attnum
       FROM pg_catalog.pg_attribute AS a
       WHERE a.attrelid = c.conrelid
         AND a.attname = 'cloudflare_version_id_sha256'
         AND NOT a.attisdropped)
    ]::smallint[];

  IF old_constraint_count <> 1 OR old_constraint IS NULL THEN
    RAISE EXCEPTION 'hosted V2-09 source/config/version uniqueness predecessor not exact'
      USING ERRCODE = '23514';
  END IF;

  EXECUTE format(
    'ALTER TABLE public.hosted_v209_qualified_activations DROP CONSTRAINT %I',
    old_constraint
  );
END;
$migration_constraint$;

ALTER TABLE public.hosted_v209_qualified_activations
  ADD CONSTRAINT hosted_v209_qualified_activations_source_config_version_qualification_pair_key
  UNIQUE (
    source_commit,
    deployed_config_sha256,
    cloudflare_version_id_sha256,
    mage_qualification_id,
    soulx_qualification_id
  );

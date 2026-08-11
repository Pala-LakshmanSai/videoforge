CREATE TABLE public.image_style_profile_artifacts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  style_id uuid NOT NULL,
  version_id uuid NOT NULL,
  origin text NOT NULL CHECK (origin IN ('VISION_ANALYSIS', 'MANUAL_EDIT')),
  profile_contract_name text NOT NULL CHECK (profile_contract_name = 'image-style-profile'),
  profile_contract_version text NOT NULL CHECK (profile_contract_version = 'v1'),
  profile_payload jsonb NOT NULL CHECK (jsonb_typeof(profile_payload) = 'object'),
  profile_hash text NOT NULL CHECK (profile_hash ~ '^sha256:[0-9a-f]{64}$'),
  canonical_profile_json text NOT NULL CHECK (octet_length(canonical_profile_json) > 0),
  root_source_artifact_id uuid NOT NULL,
  root_source_artifact_hash text NOT NULL CHECK (root_source_artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
  parent_artifact_id uuid,
  parent_artifact_hash text CHECK (
    parent_artifact_hash IS NULL OR parent_artifact_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  source_analysis_evidence text CHECK (
    source_analysis_evidence IS NULL OR source_analysis_evidence = 'HISTORICAL_SOURCE_TRUTH'
  ),
  source_analysis_attempt_id uuid,
  source_analysis_output_asset_id uuid,
  reference_aliases jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(reference_aliases) = 'array'),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, style_id, version_id, id),
  FOREIGN KEY (workspace_id, style_id, version_id)
    REFERENCES public.image_style_versions (workspace_id, style_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, created_by_user_id)
    REFERENCES public.memberships (workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, source_analysis_attempt_id)
    REFERENCES public.image_style_analysis_attempts (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, source_analysis_output_asset_id)
    REFERENCES public.assets (workspace_id, id) ON DELETE RESTRICT,
  CHECK (
    (parent_artifact_id IS NULL) = (parent_artifact_hash IS NULL) AND
    (
      (origin = 'VISION_ANALYSIS' AND id = root_source_artifact_id AND
       profile_hash = root_source_artifact_hash AND parent_artifact_id IS NULL AND
       source_analysis_evidence = 'HISTORICAL_SOURCE_TRUTH') OR
      (origin = 'MANUAL_EDIT' AND id <> root_source_artifact_id AND
       parent_artifact_id IS NOT NULL AND source_analysis_evidence IS NULL AND
       reference_aliases = '[]'::jsonb)
    )
  )
);

ALTER TABLE public.image_style_profile_artifacts
  ADD CONSTRAINT image_style_profile_artifacts_root_fk
    FOREIGN KEY (workspace_id, style_id, version_id, root_source_artifact_id)
    REFERENCES public.image_style_profile_artifacts (workspace_id, style_id, version_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT image_style_profile_artifacts_parent_fk
    FOREIGN KEY (workspace_id, style_id, version_id, parent_artifact_id)
    REFERENCES public.image_style_profile_artifacts (workspace_id, style_id, version_id, id)
    ON DELETE RESTRICT;

CREATE TABLE public.image_style_profile_edits (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  style_id uuid NOT NULL,
  version_id uuid NOT NULL,
  editor_user_id uuid NOT NULL,
  edited_at timestamptz NOT NULL,
  idempotency_key text NOT NULL CHECK (
    idempotency_key = btrim(idempotency_key) AND length(idempotency_key) BETWEEN 1 AND 240
  ),
  request_fingerprint_hash text NOT NULL CHECK (request_fingerprint_hash ~ '^sha256:[0-9a-f]{64}$'),
  expected_revision integer NOT NULL CHECK (expected_revision > 0),
  prior_revision integer NOT NULL CHECK (prior_revision = expected_revision),
  result_revision integer NOT NULL CHECK (result_revision = prior_revision + 1),
  root_source_artifact_id uuid NOT NULL,
  root_source_artifact_hash text NOT NULL CHECK (root_source_artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
  parent_artifact_id uuid NOT NULL,
  parent_artifact_hash text NOT NULL CHECK (parent_artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
  derived_artifact_id uuid NOT NULL,
  derived_artifact_hash text NOT NULL CHECK (derived_artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
  changed_pointers jsonb NOT NULL CHECK (
    jsonb_typeof(changed_pointers) = 'array' AND jsonb_array_length(changed_pointers) > 0
  ),
  invalidated_review_snapshot_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, idempotency_key),
  UNIQUE (workspace_id, version_id, result_revision),
  UNIQUE (workspace_id, derived_artifact_id),
  FOREIGN KEY (workspace_id, style_id, version_id)
    REFERENCES public.image_style_versions (workspace_id, style_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, editor_user_id)
    REFERENCES public.memberships (workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, style_id, version_id, root_source_artifact_id)
    REFERENCES public.image_style_profile_artifacts (workspace_id, style_id, version_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, style_id, version_id, parent_artifact_id)
    REFERENCES public.image_style_profile_artifacts (workspace_id, style_id, version_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, style_id, version_id, derived_artifact_id)
    REFERENCES public.image_style_profile_artifacts (workspace_id, style_id, version_id, id)
    ON DELETE RESTRICT
);

ALTER TABLE public.image_style_versions
  ADD COLUMN profile_revision integer NOT NULL DEFAULT 1 CHECK (profile_revision > 0),
  ADD COLUMN root_profile_artifact_id uuid,
  ADD COLUMN current_profile_artifact_id uuid,
  ADD COLUMN review_snapshot_id uuid,
  ADD COLUMN review_invalidated_at timestamptz;

INSERT INTO public.image_style_profile_artifacts (
  id, workspace_id, style_id, version_id, origin,
  profile_contract_name, profile_contract_version, profile_payload, profile_hash,
  canonical_profile_json, root_source_artifact_id, root_source_artifact_hash,
  parent_artifact_id, parent_artifact_hash, source_analysis_evidence,
  source_analysis_attempt_id, source_analysis_output_asset_id, reference_aliases,
  created_by_user_id, created_at
)
SELECT version.id, version.workspace_id, version.style_id, version.id, 'VISION_ANALYSIS',
       version.profile_contract_name, version.profile_contract_version, version.profile_payload,
       version.style_profile_hash, version.profile_payload::text, version.id,
       version.style_profile_hash, NULL, NULL, 'HISTORICAL_SOURCE_TRUTH',
       (
         SELECT analysis.id
           FROM public.image_style_analysis_attempts analysis
          WHERE analysis.workspace_id = version.workspace_id
            AND analysis.style_version_id = version.id
            AND analysis.state = 'SUCCEEDED'
          ORDER BY analysis.ordinal DESC
          LIMIT 1
       ),
       (
         SELECT execution.output_asset_id
           FROM public.image_style_analysis_attempts analysis
           JOIN public.attempts execution
             ON execution.workspace_id = analysis.workspace_id
            AND execution.id = analysis.execution_attempt_id
          WHERE analysis.workspace_id = version.workspace_id
            AND analysis.style_version_id = version.id
            AND analysis.state = 'SUCCEEDED'
            AND execution.state = 'SUCCEEDED'
            AND execution.result_disposition = 'ACCEPTED'
          ORDER BY analysis.ordinal DESC
          LIMIT 1
       ),
       COALESCE((
         SELECT jsonb_agg(to_jsonb('ref_' || lpad(reference.reference_order::text, 2, '0'))
                          ORDER BY reference.reference_order)
           FROM public.image_style_references reference
          WHERE reference.workspace_id = version.workspace_id
            AND reference.version_id = version.id
            AND reference.retention_state <> 'DELETED'
       ), '[]'::jsonb),
       version.disclosure_attested_by_user_id, version.updated_at
  FROM public.image_style_versions version
 WHERE version.profile_payload IS NOT NULL
   AND version.profile_contract_name = 'image-style-profile'
   AND version.profile_contract_version = 'v1'
   AND version.style_profile_hash IS NOT NULL
   AND version.disclosure_attested_by_user_id IS NOT NULL
   AND version.state IN ('NEEDS_REVIEW', 'PUBLISHED')
   AND EXISTS (
     SELECT 1
       FROM public.image_style_analysis_attempts analysis
       JOIN public.attempts execution
         ON execution.workspace_id = analysis.workspace_id
        AND execution.id = analysis.execution_attempt_id
      WHERE analysis.workspace_id = version.workspace_id
        AND analysis.style_version_id = version.id
        AND analysis.state = 'SUCCEEDED'
        AND execution.state = 'SUCCEEDED'
        AND execution.result_disposition = 'ACCEPTED'
        AND execution.output_asset_id IS NOT NULL
   );

DROP TRIGGER image_style_versions_published_immutable ON public.image_style_versions;

UPDATE public.image_style_versions version
   SET root_profile_artifact_id = artifact.id,
       current_profile_artifact_id = artifact.id,
       review_snapshot_id = CASE
         WHEN version.state = 'NEEDS_REVIEW' THEN artifact.source_analysis_attempt_id
         ELSE NULL
       END
  FROM public.image_style_profile_artifacts artifact
 WHERE artifact.workspace_id = version.workspace_id
   AND artifact.style_id = version.style_id
   AND artifact.version_id = version.id
   AND artifact.origin = 'VISION_ANALYSIS';

CREATE TRIGGER image_style_versions_published_immutable
  BEFORE UPDATE OR DELETE ON public.image_style_versions
  FOR EACH ROW WHEN (OLD.state = 'PUBLISHED')
  EXECUTE FUNCTION public.videoforge_reject_immutable_row();

ALTER TABLE public.image_style_versions
  ADD CONSTRAINT image_style_versions_root_profile_artifact_fk
    FOREIGN KEY (workspace_id, style_id, id, root_profile_artifact_id)
    REFERENCES public.image_style_profile_artifacts (workspace_id, style_id, version_id, id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT image_style_versions_current_profile_artifact_fk
    FOREIGN KEY (workspace_id, style_id, id, current_profile_artifact_id)
    REFERENCES public.image_style_profile_artifacts (workspace_id, style_id, version_id, id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT image_style_versions_profile_pointer_pair_check CHECK (
    (root_profile_artifact_id IS NULL) = (current_profile_artifact_id IS NULL)
  );

CREATE OR REPLACE FUNCTION public.videoforge_validate_style_profile_pointer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF OLD.root_profile_artifact_id IS NOT NULL AND
     NEW.root_profile_artifact_id IS DISTINCT FROM OLD.root_profile_artifact_id THEN
    RAISE EXCEPTION 'image style root profile artifact is immutable' USING ERRCODE = '23514';
  END IF;

  IF NEW.current_profile_artifact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.image_style_profile_artifacts artifact
     WHERE artifact.workspace_id = NEW.workspace_id
       AND artifact.style_id = NEW.style_id
       AND artifact.version_id = NEW.id
       AND artifact.id = NEW.current_profile_artifact_id
       AND artifact.profile_hash = NEW.style_profile_hash
       AND artifact.profile_contract_name = NEW.profile_contract_name
       AND artifact.profile_contract_version = NEW.profile_contract_version
       AND artifact.profile_payload = NEW.profile_payload
  ) THEN
    RAISE EXCEPTION 'image style current profile pointer does not match current profile bytes'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.current_profile_artifact_id IS NOT NULL AND
     NEW.current_profile_artifact_id IS DISTINCT FROM OLD.current_profile_artifact_id AND
     NEW.profile_revision <> OLD.profile_revision + 1 THEN
    RAISE EXCEPTION 'image style profile pointer movement must increment revision exactly once'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER image_style_versions_profile_pointer_guard
  BEFORE UPDATE ON public.image_style_versions
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_validate_style_profile_pointer();

CREATE TRIGGER image_style_profile_artifacts_append_only
  BEFORE UPDATE OR DELETE ON public.image_style_profile_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_reject_immutable_row();

CREATE TRIGGER image_style_profile_edits_append_only
  BEFORE UPDATE OR DELETE ON public.image_style_profile_edits
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_reject_immutable_row();

CREATE INDEX image_style_profile_artifacts_version_history_idx
  ON public.image_style_profile_artifacts (workspace_id, version_id, created_at, id);

CREATE INDEX image_style_profile_edits_version_history_idx
  ON public.image_style_profile_edits (workspace_id, version_id, result_revision);

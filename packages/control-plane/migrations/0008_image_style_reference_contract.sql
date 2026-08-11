DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.image_style_references LIMIT 1) THEN
    RAISE EXCEPTION 'image style reference contract migration requires an empty legacy table; rights and source facts cannot be inferred'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE public.image_style_references
  RENAME COLUMN asset_id TO normalized_asset_id;

ALTER TABLE public.image_style_references
  ADD COLUMN original_asset_id uuid NOT NULL,
  ADD COLUMN rights_basis text NOT NULL
    CHECK (rights_basis IN ('OWNED', 'LICENSED', 'PUBLIC_DOMAIN', 'OTHER_DOCUMENTED_BASIS')),
  ADD COLUMN rights_basis_note text,
  ADD COLUMN rights_attested_at timestamptz NOT NULL,
  ADD COLUMN original_retention_policy text NOT NULL
    CHECK (original_retention_policy IN ('RETAIN', 'DELETE_AFTER_ANALYSIS')),
  ADD CONSTRAINT image_style_references_original_asset_fk
    FOREIGN KEY (workspace_id, original_asset_id)
    REFERENCES public.assets (workspace_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT image_style_references_distinct_assets_check
    CHECK (original_asset_id <> normalized_asset_id),
  ADD CONSTRAINT image_style_references_rights_note_check
    CHECK (
      (rights_basis_note IS NULL OR (
        rights_basis_note = btrim(rights_basis_note) AND
        length(rights_basis_note) BETWEEN 1 AND 1000
      )) AND
      (rights_basis <> 'OTHER_DOCUMENTED_BASIS' OR rights_basis_note IS NOT NULL)
    );

CREATE UNIQUE INDEX image_style_references_original_asset_uq
  ON public.image_style_references (workspace_id, version_id, original_asset_id);

CREATE UNIQUE INDEX image_style_references_normalized_asset_uq
  ON public.image_style_references (workspace_id, version_id, normalized_asset_id);

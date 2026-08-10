-- VideoForge durable relational foundation (DEC_DB_001, DEC_QUEUE_001).
-- Additive PostgreSQL only. No external connection, schema push, or destructive down migration.

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  normalized_email text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CHECK (email = btrim(email) AND length(email) BETWEEN 3 AND 320),
  CHECK (normalized_email = lower(btrim(normalized_email)) AND length(normalized_email) BETWEEN 3 AND 320),
  CHECK (display_name = btrim(display_name) AND length(display_name) BETWEEN 1 AND 160),
  CHECK ((status = 'DISABLED') OR archived_at IS NULL)
);

CREATE UNIQUE INDEX users_active_email_uq
  ON users (normalized_email)
  WHERE archived_at IS NULL;

CREATE TABLE workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  normalized_name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 160),
  CHECK (normalized_name = lower(btrim(normalized_name)) AND length(normalized_name) BETWEEN 1 AND 160),
  CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL))
);

CREATE UNIQUE INDEX workspaces_active_name_uq
  ON workspaces (normalized_name)
  WHERE status = 'ACTIVE';

CREATE TABLE memberships (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  normalized_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('ADMIN', 'MEMBER')),
  status text NOT NULL CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CHECK (normalized_name = lower(btrim(normalized_name)) AND length(normalized_name) BETWEEN 1 AND 160),
  CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL))
);

CREATE UNIQUE INDEX memberships_active_name_uq
  ON memberships (workspace_id, normalized_name)
  WHERE status = 'ACTIVE';
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE assets (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid,
  project_revision_id uuid,
  source_attempt_id uuid,
  kind text NOT NULL CHECK (kind IN (
    'VOICEOVER', 'OPTIONAL_SCRIPT', 'AVATAR_ORIGINAL', 'AVATAR_RUNTIME', 'AVATAR_THUMBNAIL',
    'STYLE_REFERENCE_ORIGINAL', 'STYLE_REFERENCE_NORMALIZED', 'CANONICAL_DOCUMENT',
    'IMAGE', 'AVATAR_CLIP', 'AUDIO_SPAN', 'RENDER_PREVIEW', 'FINAL_VIDEO', 'OTHER'
  )),
  state text NOT NULL CHECK (state IN ('UPLOADING', 'VERIFIED', 'ACCEPTED', 'REJECTED', 'ARCHIVED')),
  object_key text,
  binary_sha256 text,
  canonical_contract_name text,
  canonical_contract_version text,
  canonical_document_sha256 text,
  content_type text,
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  width_px integer CHECK (width_px IS NULL OR width_px > 0),
  height_px integer CHECK (height_px IS NULL OR height_px > 0),
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  archived_at timestamptz,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE RESTRICT,
  CHECK (object_key IS NULL OR (length(object_key) BETWEEN 1 AND 600 AND object_key !~ '(^|/)\.\.(/|$)')),
  CHECK (binary_sha256 IS NULL OR binary_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (canonical_document_sha256 IS NULL OR canonical_document_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (
    (canonical_contract_name IS NULL AND canonical_contract_version IS NULL AND canonical_document_sha256 IS NULL)
    OR
    (canonical_contract_name IS NOT NULL AND canonical_contract_version IS NOT NULL AND canonical_document_sha256 IS NOT NULL)
  ),
  CHECK (state NOT IN ('VERIFIED', 'ACCEPTED') OR binary_sha256 IS NOT NULL OR canonical_document_sha256 IS NOT NULL),
  CHECK ((state = 'ARCHIVED') = (archived_at IS NOT NULL))
);

CREATE UNIQUE INDEX assets_object_key_uq
  ON assets (workspace_id, object_key)
  WHERE object_key IS NOT NULL;
CREATE INDEX assets_binary_sha256_idx
  ON assets (workspace_id, binary_sha256)
  WHERE binary_sha256 IS NOT NULL;
CREATE INDEX assets_canonical_document_sha256_idx
  ON assets (workspace_id, canonical_document_sha256)
  WHERE canonical_document_sha256 IS NOT NULL;

CREATE TABLE execution_profiles (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  lane text NOT NULL CHECK (lane IN ('LOCAL_MEDIA', 'IMAGE_MEDIA', 'AVATAR_PRIMARY', 'AVATAR_REPAIR', 'AVATAR_QUALITY')),
  state text NOT NULL CHECK (state IN ('DRAFT', 'TESTED', 'RETIRED')),
  dispatch_target text NOT NULL CHECK (dispatch_target IN ('FIXTURE', 'LOCAL', 'RUNPOD')),
  configuration jsonb NOT NULL CHECK (jsonb_typeof(configuration) = 'object'),
  configuration_hash text NOT NULL CHECK (configuration_hash ~ '^sha256:[0-9a-f]{64}$'),
  maximum_rate_micro_usd bigint NOT NULL CHECK (maximum_rate_micro_usd >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  checked_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, name, revision),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE RESTRICT,
  CHECK ((state = 'RETIRED') = (retired_at IS NOT NULL))
);

CREATE TABLE avatar_profiles (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  active_version_id uuid,
  thumbnail_asset_id uuid,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, created_by_user_id) REFERENCES memberships (workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, thumbnail_asset_id) REFERENCES assets (workspace_id, id) ON DELETE RESTRICT,
  CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 160),
  CHECK (normalized_name = lower(btrim(normalized_name)) AND length(normalized_name) BETWEEN 1 AND 160),
  CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL))
);

CREATE UNIQUE INDEX avatar_profiles_active_name_uq
  ON avatar_profiles (workspace_id, normalized_name)
  WHERE status = 'ACTIVE';

CREATE TABLE avatar_profile_versions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  state text NOT NULL CHECK (state IN ('DRAFT', 'UPLOADING', 'VALIDATING', 'NEEDS_REVIEW', 'READY', 'ABANDONED')),
  profile_contract_name text,
  profile_contract_version text,
  profile_payload jsonb,
  profile_hash text,
  original_asset_id uuid,
  runtime_source_asset_id uuid,
  runtime_source_binary_sha256 text,
  source_preparation_profile text,
  source_validation_profile text,
  rights_attested_by_user_id uuid,
  likeness_attested_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  abandoned_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, profile_id, id),
  UNIQUE (workspace_id, profile_id, version_number),
  FOREIGN KEY (workspace_id, profile_id) REFERENCES avatar_profiles (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, original_asset_id) REFERENCES assets (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, runtime_source_asset_id) REFERENCES assets (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, rights_attested_by_user_id) REFERENCES memberships (workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, likeness_attested_by_user_id) REFERENCES memberships (workspace_id, user_id) ON DELETE RESTRICT,
  CHECK (profile_hash IS NULL OR profile_hash ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (runtime_source_binary_sha256 IS NULL OR runtime_source_binary_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (profile_payload IS NULL OR jsonb_typeof(profile_payload) = 'object'),
  CHECK (
    state <> 'READY' OR (
      profile_contract_name IS NOT NULL AND profile_contract_version IS NOT NULL AND
      profile_payload IS NOT NULL AND profile_hash IS NOT NULL AND original_asset_id IS NOT NULL AND
      runtime_source_asset_id IS NOT NULL AND runtime_source_binary_sha256 IS NOT NULL AND
      source_preparation_profile IS NOT NULL AND source_validation_profile IS NOT NULL AND
      rights_attested_by_user_id IS NOT NULL AND likeness_attested_by_user_id IS NOT NULL AND ready_at IS NOT NULL
    )
  ),
  CHECK ((state = 'ABANDONED') = (abandoned_at IS NOT NULL))
);

CREATE UNIQUE INDEX avatar_profile_versions_open_draft_uq
  ON avatar_profile_versions (workspace_id, profile_id)
  WHERE state IN ('DRAFT', 'UPLOADING', 'VALIDATING', 'NEEDS_REVIEW');
CREATE UNIQUE INDEX avatar_profile_versions_ready_hash_uq
  ON avatar_profile_versions (workspace_id, profile_id, profile_hash)
  WHERE state = 'READY';

ALTER TABLE avatar_profiles
  ADD CONSTRAINT avatar_profiles_active_version_fk
  FOREIGN KEY (workspace_id, id, active_version_id)
  REFERENCES avatar_profile_versions (workspace_id, profile_id, id)
  ON DELETE RESTRICT;

CREATE TABLE avatar_profile_assets (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  version_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('ORIGINAL', 'RUNTIME', 'THUMBNAIL')),
  binary_sha256 text NOT NULL CHECK (binary_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  retention_state text NOT NULL DEFAULT 'RETAIN' CHECK (retention_state IN ('RETAIN', 'DELETE_REQUESTED', 'DELETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, version_id, role),
  FOREIGN KEY (workspace_id, profile_id, version_id) REFERENCES avatar_profile_versions (workspace_id, profile_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, asset_id) REFERENCES assets (workspace_id, id) ON DELETE RESTRICT,
  CHECK ((retention_state = 'DELETED') = (deleted_at IS NOT NULL))
);

CREATE TABLE avatar_compatibility_assessments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  avatar_profile_version_id uuid NOT NULL,
  execution_profile_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('UNTESTED', 'RUNNING', 'PASSED', 'FAILED', 'CANCELLED')),
  evidence_contract_name text,
  evidence_contract_version text,
  evidence_payload jsonb,
  evidence_hash text,
  model_snapshot_hash text,
  reviewer_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, avatar_profile_version_id, id),
  FOREIGN KEY (workspace_id, avatar_profile_version_id) REFERENCES avatar_profile_versions (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, execution_profile_id) REFERENCES execution_profiles (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, reviewer_user_id) REFERENCES memberships (workspace_id, user_id) ON DELETE RESTRICT,
  CHECK (evidence_payload IS NULL OR jsonb_typeof(evidence_payload) = 'object'),
  CHECK (evidence_hash IS NULL OR evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (model_snapshot_hash IS NULL OR model_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (
    state NOT IN ('PASSED', 'FAILED', 'CANCELLED') OR
    (evidence_contract_name IS NOT NULL AND evidence_contract_version IS NOT NULL AND evidence_payload IS NOT NULL AND
     evidence_hash IS NOT NULL AND model_snapshot_hash IS NOT NULL AND finished_at IS NOT NULL)
  )
);

CREATE TABLE avatar_profile_test_attempts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 240),
  state text NOT NULL CHECK (state IN ('CREATED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN')),
  external_job_id text,
  output_asset_id uuid,
  reported_cost_micro_usd bigint CHECK (reported_cost_micro_usd IS NULL OR reported_cost_micro_usd >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, assessment_id, ordinal),
  UNIQUE (workspace_id, idempotency_key),
  FOREIGN KEY (workspace_id, assessment_id) REFERENCES avatar_compatibility_assessments (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, output_asset_id) REFERENCES assets (workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE image_styles (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  active_version_id uuid,
  cover_asset_id uuid,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, created_by_user_id) REFERENCES memberships (workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, cover_asset_id) REFERENCES assets (workspace_id, id) ON DELETE RESTRICT,
  CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 160),
  CHECK (normalized_name = lower(btrim(normalized_name)) AND length(normalized_name) BETWEEN 1 AND 160),
  CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL))
);

CREATE UNIQUE INDEX image_styles_active_name_uq
  ON image_styles (workspace_id, normalized_name)
  WHERE status = 'ACTIVE';

CREATE TABLE image_style_versions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  style_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  state text NOT NULL CHECK (state IN ('DRAFT', 'ANALYZING', 'NEEDS_REVIEW', 'PUBLISHED', 'ABANDONED')),
  profile_contract_name text,
  profile_contract_version text,
  profile_payload jsonb,
  style_profile_hash text,
  analyzer_request_hash text,
  analyzer_model_snapshot text,
  disclosure_attested_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  abandoned_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, style_id, id),
  UNIQUE (workspace_id, style_id, version_number),
  FOREIGN KEY (workspace_id, style_id) REFERENCES image_styles (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, disclosure_attested_by_user_id) REFERENCES memberships (workspace_id, user_id) ON DELETE RESTRICT,
  CHECK (profile_payload IS NULL OR jsonb_typeof(profile_payload) = 'object'),
  CHECK (style_profile_hash IS NULL OR style_profile_hash ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (analyzer_request_hash IS NULL OR analyzer_request_hash ~ '^sha256:[0-9a-f]{64}$'),
  CHECK (
    state <> 'PUBLISHED' OR (
      profile_contract_name IS NOT NULL AND profile_contract_version IS NOT NULL AND profile_payload IS NOT NULL AND
      style_profile_hash IS NOT NULL AND disclosure_attested_by_user_id IS NOT NULL AND published_at IS NOT NULL
    )
  ),
  CHECK ((state = 'ABANDONED') = (abandoned_at IS NOT NULL))
);

CREATE UNIQUE INDEX image_style_versions_open_draft_uq
  ON image_style_versions (workspace_id, style_id)
  WHERE state IN ('DRAFT', 'ANALYZING', 'NEEDS_REVIEW');
CREATE UNIQUE INDEX image_style_versions_published_hash_uq
  ON image_style_versions (workspace_id, style_id, style_profile_hash)
  WHERE state = 'PUBLISHED';

ALTER TABLE image_styles
  ADD CONSTRAINT image_styles_active_version_fk
  FOREIGN KEY (workspace_id, id, active_version_id)
  REFERENCES image_style_versions (workspace_id, style_id, id)
  ON DELETE RESTRICT;

CREATE TABLE image_style_references (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  style_id uuid NOT NULL,
  version_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  reference_order integer NOT NULL CHECK (reference_order BETWEEN 1 AND 12),
  rights_attested_by_user_id uuid NOT NULL,
  confidence numeric(5, 4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  is_outlier boolean NOT NULL DEFAULT false,
  retention_state text NOT NULL DEFAULT 'RETAIN' CHECK (retention_state IN ('RETAIN', 'DELETE_REQUESTED', 'DELETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, version_id, reference_order),
  FOREIGN KEY (workspace_id, style_id, version_id) REFERENCES image_style_versions (workspace_id, style_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, asset_id) REFERENCES assets (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, rights_attested_by_user_id) REFERENCES memberships (workspace_id, user_id) ON DELETE RESTRICT,
  CHECK ((retention_state = 'DELETED') = (deleted_at IS NOT NULL))
);

CREATE TABLE image_style_analysis_attempts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  style_version_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 240),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('CREATED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN')),
  provider text NOT NULL,
  model text NOT NULL,
  model_revision text NOT NULL,
  response_hash text CHECK (response_hash IS NULL OR response_hash ~ '^sha256:[0-9a-f]{64}$'),
  usage_payload jsonb CHECK (usage_payload IS NULL OR jsonb_typeof(usage_payload) = 'object'),
  reported_cost_micro_usd bigint CHECK (reported_cost_micro_usd IS NULL OR reported_cost_micro_usd >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  problem_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, style_version_id, ordinal),
  UNIQUE (workspace_id, idempotency_key),
  FOREIGN KEY (workspace_id, style_version_id) REFERENCES image_style_versions (workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE image_style_previews (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  style_version_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  prompt_hash text NOT NULL CHECK (prompt_hash ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('GENERATED', 'ACCEPTED', 'REJECTED')),
  reviewer_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, style_version_id, asset_id),
  FOREIGN KEY (workspace_id, style_version_id) REFERENCES image_style_versions (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, asset_id) REFERENCES assets (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, reviewer_user_id) REFERENCES memberships (workspace_id, user_id) ON DELETE RESTRICT,
  CHECK (state = 'GENERATED' OR (reviewer_user_id IS NOT NULL AND reviewed_at IS NOT NULL))
);

CREATE TABLE projects (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, owner_user_id) REFERENCES memberships (workspace_id, user_id) ON DELETE RESTRICT,
  CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 240),
  CHECK (normalized_name = lower(btrim(normalized_name)) AND length(normalized_name) BETWEEN 1 AND 240),
  CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL))
);

CREATE UNIQUE INDEX projects_active_name_uq
  ON projects (workspace_id, normalized_name)
  WHERE status = 'ACTIVE';

CREATE TABLE project_inputs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('VOICEOVER', 'OPTIONAL_SCRIPT')),
  state text NOT NULL CHECK (state IN ('PENDING_UPLOAD', 'UPLOADED', 'VERIFIED', 'REJECTED', 'ARCHIVED')),
  asset_id uuid,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 240),
  declared_binary_sha256 text CHECK (declared_binary_sha256 IS NULL OR declared_binary_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  verified_binary_sha256 text CHECK (verified_binary_sha256 IS NULL OR verified_binary_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  optional_script text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  archived_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_id, idempotency_key),
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, asset_id) REFERENCES assets (workspace_id, id) ON DELETE RESTRICT,
  CHECK ((kind = 'OPTIONAL_SCRIPT') OR optional_script IS NULL),
  CHECK (state <> 'VERIFIED' OR (asset_id IS NOT NULL AND verified_binary_sha256 IS NOT NULL AND verified_at IS NOT NULL)),
  CHECK ((state = 'ARCHIVED') = (archived_at IS NOT NULL))
);

CREATE UNIQUE INDEX project_inputs_one_current_kind_uq
  ON project_inputs (workspace_id, project_id, kind)
  WHERE state <> 'ARCHIVED';

CREATE TABLE project_revisions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  status text NOT NULL CHECK (status IN ('DRAFT', 'LOCKED')),
  title text NOT NULL,
  voiceover_asset_id uuid NOT NULL,
  voiceover_binary_sha256 text NOT NULL CHECK (voiceover_binary_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  avatar_profile_id uuid NOT NULL,
  avatar_profile_version_id uuid NOT NULL,
  avatar_profile_hash text NOT NULL CHECK (avatar_profile_hash ~ '^sha256:[0-9a-f]{64}$'),
  avatar_runtime_source_asset_id uuid NOT NULL,
  avatar_runtime_source_binary_sha256 text NOT NULL CHECK (avatar_runtime_source_binary_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  avatar_source_preparation_profile text NOT NULL,
  avatar_source_validation_profile text NOT NULL,
  avatar_compatibility_state text NOT NULL CHECK (avatar_compatibility_state IN ('UNTESTED', 'RUNNING', 'PASSED', 'FAILED', 'CANCELLED')),
  avatar_compatibility_assessment_id uuid,
  avatar_compatibility_evidence_hash text CHECK (avatar_compatibility_evidence_hash IS NULL OR avatar_compatibility_evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  image_style_id uuid NOT NULL,
  image_style_version_id uuid NOT NULL,
  style_profile_hash text NOT NULL CHECK (style_profile_hash ~ '^sha256:[0-9a-f]{64}$'),
  extra_prompt_keywords text NOT NULL DEFAULT '',
  apply_extra_prompt_keywords boolean NOT NULL DEFAULT false,
  generation_mode text NOT NULL CHECK (generation_mode IN ('LOWEST_COST', 'BALANCED', 'FASTER')),
  maximum_cost_micro_usd bigint NOT NULL CHECK (maximum_cost_micro_usd >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  seed bigint NOT NULL,
  revision_config_contract_name text NOT NULL,
  revision_config_contract_version text NOT NULL,
  revision_config_payload jsonb NOT NULL CHECK (jsonb_typeof(revision_config_payload) = 'object'),
  revision_config_hash text NOT NULL CHECK (revision_config_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_id, id),
  UNIQUE (workspace_id, project_id, revision_number),
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, voiceover_asset_id) REFERENCES assets (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, avatar_profile_id, avatar_profile_version_id)
    REFERENCES avatar_profile_versions (workspace_id, profile_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, avatar_runtime_source_asset_id) REFERENCES assets (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, avatar_profile_version_id, avatar_compatibility_assessment_id)
    REFERENCES avatar_compatibility_assessments (workspace_id, avatar_profile_version_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, image_style_id, image_style_version_id)
    REFERENCES image_style_versions (workspace_id, style_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, created_by_user_id) REFERENCES memberships (workspace_id, user_id) ON DELETE RESTRICT,
  CHECK (title = btrim(title) AND length(title) BETWEEN 1 AND 240),
  CHECK (length(extra_prompt_keywords) <= 600),
  CHECK (
    (avatar_compatibility_state IN ('UNTESTED', 'RUNNING') AND avatar_compatibility_assessment_id IS NULL AND avatar_compatibility_evidence_hash IS NULL)
    OR
    (avatar_compatibility_state IN ('PASSED', 'FAILED', 'CANCELLED') AND avatar_compatibility_assessment_id IS NOT NULL AND avatar_compatibility_evidence_hash IS NOT NULL)
  ),
  CHECK ((status = 'LOCKED') = (locked_at IS NOT NULL))
);

CREATE UNIQUE INDEX project_revisions_one_draft_uq
  ON project_revisions (workspace_id, project_id)
  WHERE status = 'DRAFT';

CREATE TABLE transcripts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  source_asset_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('CREATED', 'READY', 'REJECTED')),
  model_name text NOT NULL,
  model_hash text NOT NULL CHECK (model_hash ~ '^sha256:[0-9a-f]{64}$'),
  duration_ms bigint NOT NULL CHECK (duration_ms >= 0),
  contract_name text NOT NULL,
  contract_version text NOT NULL,
  canonical_document_asset_id uuid,
  canonical_document_hash text CHECK (canonical_document_hash IS NULL OR canonical_document_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_revision_id, id),
  FOREIGN KEY (workspace_id, project_revision_id) REFERENCES project_revisions (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, source_asset_id) REFERENCES assets (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, canonical_document_asset_id) REFERENCES assets (workspace_id, id) ON DELETE RESTRICT,
  CHECK (state <> 'READY' OR (canonical_document_asset_id IS NOT NULL AND canonical_document_hash IS NOT NULL AND ready_at IS NOT NULL))
);

CREATE UNIQUE INDEX transcripts_one_ready_per_revision_uq
  ON transcripts (workspace_id, project_revision_id)
  WHERE state = 'READY';

CREATE TABLE transcript_words (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  transcript_id uuid NOT NULL,
  word_index integer NOT NULL CHECK (word_index >= 0),
  word text NOT NULL CHECK (length(word) BETWEEN 1 AND 240),
  start_ms bigint NOT NULL CHECK (start_ms >= 0),
  end_ms_exclusive bigint NOT NULL CHECK (end_ms_exclusive > start_ms),
  confidence numeric(5, 4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, transcript_id, word_index),
  FOREIGN KEY (workspace_id, transcript_id) REFERENCES transcripts (workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE timeline_segments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  segment_index integer NOT NULL CHECK (segment_index >= 0),
  start_frame integer NOT NULL CHECK (start_frame >= 0),
  end_frame_exclusive integer NOT NULL CHECK (end_frame_exclusive > start_frame),
  timeline_composition text NOT NULL CHECK (timeline_composition IN ('AVATAR_FULL', 'IMAGE_FULL', 'AVATAR_SPLIT_IMAGE')),
  in_image_shot_role text CHECK (in_image_shot_role IS NULL OR in_image_shot_role IN (
    'ENVIRONMENTAL_WIDE', 'HUMAN_MEDIUM', 'HANDS_ACTION', 'OBJECT_EVIDENCE', 'MACRO_DETAIL', 'REACTION_RESULT'
  )),
  narration text NOT NULL,
  required_slots jsonb NOT NULL CHECK (jsonb_typeof(required_slots) = 'object'),
  timeline_plan_hash text NOT NULL CHECK (timeline_plan_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_revision_id, segment_index),
  FOREIGN KEY (workspace_id, project_revision_id) REFERENCES project_revisions (workspace_id, id) ON DELETE RESTRICT,
  CHECK (length(narration) > 0),
  CHECK ((timeline_composition = 'AVATAR_FULL' AND in_image_shot_role IS NULL) OR
         (timeline_composition IN ('IMAGE_FULL', 'AVATAR_SPLIT_IMAGE') AND in_image_shot_role IS NOT NULL))
);

CREATE INDEX timeline_segments_frame_idx
  ON timeline_segments (workspace_id, project_revision_id, start_frame, end_frame_exclusive);

CREATE TABLE generation_tasks (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  owner_type text NOT NULL CHECK (owner_type IN ('PROJECT_REVISION', 'IMAGE_STYLE_VERSION', 'AVATAR_PROFILE_VERSION')),
  owner_id uuid NOT NULL,
  project_revision_id uuid,
  image_style_version_id uuid,
  avatar_profile_version_id uuid,
  task_key text NOT NULL CHECK (length(task_key) BETWEEN 1 AND 240),
  lane text NOT NULL CHECK (lane IN ('PREPARE', 'TRANSCRIBE', 'PLAN', 'PROMPT', 'IMAGE', 'AVATAR', 'RENDER', 'QA')),
  state text NOT NULL CHECK (state IN (
    'PENDING', 'READY', 'DISPATCHING', 'RUNNING', 'RETRY_WAIT', 'BLOCKED', 'FAILED',
    'CANCEL_REQUESTED', 'CANCELLED', 'COMPLETE'
  )),
  required boolean NOT NULL DEFAULT true,
  depends_on jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(depends_on) = 'array'),
  accepted_attempt_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancel_requested_at timestamptz,
  finished_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, id, owner_type, owner_id),
  UNIQUE (workspace_id, owner_type, owner_id, task_key),
  FOREIGN KEY (workspace_id, project_revision_id) REFERENCES project_revisions (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, image_style_version_id) REFERENCES image_style_versions (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, avatar_profile_version_id) REFERENCES avatar_profile_versions (workspace_id, id) ON DELETE RESTRICT,
  CHECK (
    (owner_type = 'PROJECT_REVISION' AND owner_id = project_revision_id AND image_style_version_id IS NULL AND avatar_profile_version_id IS NULL)
    OR
    (owner_type = 'IMAGE_STYLE_VERSION' AND owner_id = image_style_version_id AND project_revision_id IS NULL AND avatar_profile_version_id IS NULL)
    OR
    (owner_type = 'AVATAR_PROFILE_VERSION' AND owner_id = avatar_profile_version_id AND project_revision_id IS NULL AND image_style_version_id IS NULL)
  ),
  CHECK (state <> 'CANCEL_REQUESTED' OR cancel_requested_at IS NOT NULL)
);

CREATE INDEX generation_tasks_ready_idx
  ON generation_tasks (workspace_id, lane, state, created_at)
  WHERE state IN ('READY', 'RETRY_WAIT');

CREATE TABLE attempts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  task_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 240),
  state text NOT NULL CHECK (state IN ('CREATED', 'CLAIMED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN')),
  dispatch_state text NOT NULL CHECK (dispatch_state IN ('NOT_SENT', 'SENDING', 'ACKNOWLEDGED', 'AMBIGUOUS', 'RECONCILED')),
  claim_state text NOT NULL CHECK (claim_state IN ('UNCLAIMED', 'CLAIMED', 'REJECTED', 'EXPIRED')),
  execution_profile_id uuid NOT NULL,
  execution_claim_token_hash text NOT NULL CHECK (execution_claim_token_hash ~ '^sha256:[0-9a-f]{64}$'),
  external_job_id text,
  input_hash text NOT NULL CHECK (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  output_asset_id uuid,
  result_disposition text NOT NULL DEFAULT 'PENDING' CHECK (result_disposition IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  parent_attempt_id uuid,
  fallback_reason text,
  problem_code text,
  provider_details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provider_details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, task_id, id),
  UNIQUE (workspace_id, task_id, ordinal),
  UNIQUE (workspace_id, idempotency_key),
  FOREIGN KEY (workspace_id, task_id) REFERENCES generation_tasks (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, execution_profile_id) REFERENCES execution_profiles (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, output_asset_id) REFERENCES assets (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, parent_attempt_id) REFERENCES attempts (workspace_id, id) ON DELETE RESTRICT,
  CHECK (parent_attempt_id IS NULL OR parent_attempt_id <> id),
  CHECK (result_disposition <> 'ACCEPTED' OR (state = 'SUCCEEDED' AND output_asset_id IS NOT NULL))
);

CREATE UNIQUE INDEX attempts_one_accepted_result_uq
  ON attempts (workspace_id, task_id)
  WHERE result_disposition = 'ACCEPTED';
CREATE UNIQUE INDEX attempts_external_job_uq
  ON attempts (workspace_id, external_job_id)
  WHERE external_job_id IS NOT NULL;

ALTER TABLE generation_tasks
  ADD CONSTRAINT generation_tasks_accepted_attempt_fk
  FOREIGN KEY (workspace_id, id, accepted_attempt_id)
  REFERENCES attempts (workspace_id, task_id, id)
  ON DELETE RESTRICT;

ALTER TABLE assets
  ADD CONSTRAINT assets_project_fk
  FOREIGN KEY (workspace_id, project_id)
  REFERENCES projects (workspace_id, id)
  ON DELETE RESTRICT;

ALTER TABLE assets
  ADD CONSTRAINT assets_project_revision_fk
  FOREIGN KEY (workspace_id, project_id, project_revision_id)
  REFERENCES project_revisions (workspace_id, project_id, id)
  ON DELETE RESTRICT;

ALTER TABLE assets
  ADD CONSTRAINT assets_source_attempt_fk
  FOREIGN KEY (workspace_id, source_attempt_id)
  REFERENCES attempts (workspace_id, id)
  ON DELETE RESTRICT;

CREATE TABLE qa_results (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  qa_kind text NOT NULL CHECK (qa_kind IN ('TECHNICAL', 'CREATIVE')),
  state text NOT NULL CHECK (state IN ('PENDING', 'PASSED', 'FAILED', 'ACCEPTED', 'REJECTED')),
  defect_code text,
  score numeric(8, 4),
  notes text,
  reviewer_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, attempt_id, qa_kind, id),
  FOREIGN KEY (workspace_id, project_revision_id) REFERENCES project_revisions (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, attempt_id) REFERENCES attempts (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, asset_id) REFERENCES assets (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, reviewer_user_id) REFERENCES memberships (workspace_id, user_id) ON DELETE RESTRICT,
  CHECK (state = 'PENDING' OR decided_at IS NOT NULL),
  CHECK (qa_kind = 'TECHNICAL' OR state NOT IN ('ACCEPTED', 'REJECTED') OR reviewer_user_id IS NOT NULL)
);

CREATE UNIQUE INDEX qa_results_one_terminal_acceptance_uq
  ON qa_results (workspace_id, attempt_id, qa_kind)
  WHERE state IN ('PASSED', 'ACCEPTED');

CREATE TABLE render_jobs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('CREATED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  resolved_manifest_asset_id uuid NOT NULL,
  resolved_manifest_hash text NOT NULL CHECK (resolved_manifest_hash ~ '^sha256:[0-9a-f]{64}$'),
  output_asset_id uuid,
  render_profile text NOT NULL,
  total_frames integer NOT NULL CHECK (total_frames > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_revision_id, attempt_id),
  FOREIGN KEY (workspace_id, project_revision_id) REFERENCES project_revisions (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, attempt_id) REFERENCES attempts (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, resolved_manifest_asset_id) REFERENCES assets (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, output_asset_id) REFERENCES assets (workspace_id, id) ON DELETE RESTRICT,
  CHECK (state <> 'SUCCEEDED' OR (output_asset_id IS NOT NULL AND finished_at IS NOT NULL))
);

CREATE TABLE cost_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  owner_type text NOT NULL CHECK (owner_type IN ('PROJECT_REVISION', 'IMAGE_STYLE_VERSION', 'AVATAR_PROFILE_VERSION')),
  owner_id uuid NOT NULL,
  task_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL CHECK (event_type IN ('ESTIMATED', 'RESERVED', 'REPORTED', 'SETTLED', 'RELEASED', 'REFUNDED')),
  amount_micro_usd bigint NOT NULL CHECK (amount_micro_usd >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 240),
  provider_reference text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, owner_type, owner_id, sequence),
  UNIQUE (workspace_id, idempotency_key),
  FOREIGN KEY (workspace_id, task_id, owner_type, owner_id)
    REFERENCES generation_tasks (workspace_id, id, owner_type, owner_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, task_id, attempt_id)
    REFERENCES attempts (workspace_id, task_id, id) ON DELETE RESTRICT
);

CREATE INDEX cost_events_attempt_idx ON cost_events (workspace_id, attempt_id, sequence);

CREATE TABLE workflow_instances (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  owner_type text NOT NULL CHECK (owner_type IN ('PROJECT_REVISION', 'IMAGE_STYLE_VERSION', 'AVATAR_PROFILE_VERSION')),
  owner_id uuid NOT NULL,
  task_id uuid NOT NULL,
  workflow_type text NOT NULL CHECK (length(workflow_type) BETWEEN 1 AND 120),
  state text NOT NULL CHECK (state IN (
    'QUEUED', 'RUNNING', 'NEEDS_ATTENTION', 'RECONCILING', 'CANCEL_REQUESTED',
    'CANCELLED', 'READY_FOR_REVIEW', 'APPROVED', 'FAILED'
  )),
  external_system text NOT NULL CHECK (external_system IN ('LOCAL', 'CLOUDFLARE_WORKFLOW', 'RUNPOD')),
  external_instance_id text,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 240),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancel_requested_at timestamptz,
  finished_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, idempotency_key),
  FOREIGN KEY (workspace_id, task_id, owner_type, owner_id)
    REFERENCES generation_tasks (workspace_id, id, owner_type, owner_id) ON DELETE RESTRICT,
  CHECK (state <> 'CANCEL_REQUESTED' OR cancel_requested_at IS NOT NULL)
);

CREATE UNIQUE INDEX workflow_instances_external_id_uq
  ON workflow_instances (workspace_id, external_system, external_instance_id)
  WHERE external_instance_id IS NOT NULL;

CREATE TABLE workflow_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  workflow_instance_id uuid NOT NULL,
  task_id uuid,
  attempt_id uuid,
  aggregate_type text NOT NULL CHECK (aggregate_type IN ('WORKFLOW', 'TASK', 'ATTEMPT')),
  aggregate_id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  kind text NOT NULL CHECK (kind IN (
    'WORKFLOW_CREATED', 'TASK_READY', 'ATTEMPT_CREATED', 'DISPATCH_RECORDED',
    'DISPATCH_ACKNOWLEDGED', 'ATTEMPT_SUCCEEDED', 'ATTEMPT_FAILED', 'CANCEL_REQUESTED',
    'RECONCILIATION_RECORDED', 'WORKFLOW_READY_FOR_REVIEW', 'WORKFLOW_APPROVED'
  )),
  payload_contract_name text NOT NULL,
  payload_contract_version text NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, aggregate_type, aggregate_id, sequence),
  FOREIGN KEY (workspace_id, workflow_instance_id) REFERENCES workflow_instances (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, task_id) REFERENCES generation_tasks (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, task_id, attempt_id) REFERENCES attempts (workspace_id, task_id, id) ON DELETE RESTRICT,
  CHECK (attempt_id IS NULL OR task_id IS NOT NULL),
  CHECK (
    (aggregate_type = 'WORKFLOW' AND aggregate_id = workflow_instance_id)
    OR (aggregate_type = 'TASK' AND aggregate_id = task_id)
    OR (aggregate_type = 'ATTEMPT' AND aggregate_id = attempt_id)
  )
);

CREATE UNIQUE INDEX workflow_events_attempt_sequence_uq
  ON workflow_events (workspace_id, attempt_id, sequence)
  WHERE attempt_id IS NOT NULL;

CREATE TABLE outbox (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  task_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('DISPATCH', 'CANCEL', 'CALLBACK_RECONCILE')),
  state text NOT NULL CHECK (state IN ('PENDING', 'LEASED', 'DELIVERED', 'RETRY_WAIT', 'DEAD_LETTER')),
  dedupe_key text NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 240),
  payload_contract_name text NOT NULL,
  payload_contract_version text NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  available_at timestamptz NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, dedupe_key),
  FOREIGN KEY (workspace_id, task_id, attempt_id) REFERENCES attempts (workspace_id, task_id, id) ON DELETE RESTRICT,
  CHECK ((state = 'LEASED') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((state = 'DELIVERED') = (delivered_at IS NOT NULL))
);

CREATE INDEX outbox_delivery_idx
  ON outbox (state, available_at)
  WHERE state IN ('PENDING', 'RETRY_WAIT');

CREATE OR REPLACE FUNCTION videoforge_reject_immutable_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'immutable VideoForge provenance row cannot be changed: %', TG_TABLE_NAME
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER avatar_profile_versions_ready_immutable
  BEFORE UPDATE OR DELETE ON avatar_profile_versions
  FOR EACH ROW WHEN (OLD.state = 'READY')
  EXECUTE FUNCTION videoforge_reject_immutable_row();

CREATE TRIGGER image_style_versions_published_immutable
  BEFORE UPDATE OR DELETE ON image_style_versions
  FOR EACH ROW WHEN (OLD.state = 'PUBLISHED')
  EXECUTE FUNCTION videoforge_reject_immutable_row();

CREATE TRIGGER project_revisions_locked_immutable
  BEFORE UPDATE OR DELETE ON project_revisions
  FOR EACH ROW WHEN (OLD.status = 'LOCKED')
  EXECUTE FUNCTION videoforge_reject_immutable_row();

CREATE TRIGGER cost_events_append_only
  BEFORE UPDATE OR DELETE ON cost_events
  FOR EACH ROW
  EXECUTE FUNCTION videoforge_reject_immutable_row();

CREATE TRIGGER workflow_events_append_only
  BEFORE UPDATE OR DELETE ON workflow_events
  FOR EACH ROW
  EXECUTE FUNCTION videoforge_reject_immutable_row();

CREATE OR REPLACE FUNCTION videoforge_enforce_cost_event_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  latest_sequence integer;
BEGIN
  SELECT max(sequence)
    INTO latest_sequence
    FROM cost_events
   WHERE workspace_id = NEW.workspace_id
     AND owner_type = NEW.owner_type
     AND owner_id = NEW.owner_id;

  IF latest_sequence IS NOT NULL AND NEW.sequence <= latest_sequence THEN
    RAISE EXCEPTION 'cost event sequence must be monotonic for owner'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cost_events_monotonic_sequence
  BEFORE INSERT ON cost_events
  FOR EACH ROW
  EXECUTE FUNCTION videoforge_enforce_cost_event_sequence();

CREATE OR REPLACE FUNCTION videoforge_enforce_workflow_event_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  latest_aggregate_sequence integer;
  latest_attempt_sequence integer;
BEGIN
  SELECT max(sequence)
    INTO latest_aggregate_sequence
    FROM workflow_events
   WHERE workspace_id = NEW.workspace_id
     AND aggregate_type = NEW.aggregate_type
     AND aggregate_id = NEW.aggregate_id;

  IF latest_aggregate_sequence IS NOT NULL AND NEW.sequence <= latest_aggregate_sequence THEN
    RAISE EXCEPTION 'workflow event sequence must be monotonic for aggregate'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.attempt_id IS NOT NULL THEN
    SELECT max(sequence)
      INTO latest_attempt_sequence
      FROM workflow_events
     WHERE workspace_id = NEW.workspace_id
       AND attempt_id = NEW.attempt_id;
    IF latest_attempt_sequence IS NOT NULL AND NEW.sequence <= latest_attempt_sequence THEN
      RAISE EXCEPTION 'workflow event sequence must be monotonic for attempt'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER workflow_events_monotonic_sequence
  BEFORE INSERT ON workflow_events
  FOR EACH ROW
  EXECUTE FUNCTION videoforge_enforce_workflow_event_sequence();

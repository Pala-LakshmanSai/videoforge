CREATE TABLE public.avatar_generation_acceptances (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  timeline_plan_id uuid NOT NULL,
  timeline_segment_id uuid NOT NULL,
  avatar_profile_id uuid NOT NULL,
  avatar_profile_version_id uuid NOT NULL,
  avatar_profile_hash text NOT NULL CHECK (avatar_profile_hash ~ '^sha256:[0-9a-f]{64}$'),
  runtime_source_asset_id uuid NOT NULL,
  runtime_source_sha256 text NOT NULL CHECK (runtime_source_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  selected_span_audio_id uuid NOT NULL,
  span_audio_asset_id uuid NOT NULL,
  span_audio_sha256 text NOT NULL CHECK (span_audio_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  task_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  outbox_id uuid NOT NULL,
  outbox_kind text NOT NULL DEFAULT 'DISPATCH' CHECK (outbox_kind = 'DISPATCH'),
  callback_receipt_id uuid NOT NULL,
  reservation_cost_event_id uuid NOT NULL,
  reservation_event_type text NOT NULL DEFAULT 'RESERVED' CHECK (reservation_event_type = 'RESERVED'),
  output_asset_id uuid NOT NULL,
  qa_result_id uuid NOT NULL,
  schema_version text NOT NULL CHECK (schema_version = 'videoforge.avatar-fixture-acceptance/v1'),
  input_hash text NOT NULL CHECK (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  result_hash text NOT NULL CHECK (result_hash ~ '^sha256:[0-9a-f]{64}$'),
  acceptance_fingerprint_hash text NOT NULL CHECK (acceptance_fingerprint_hash ~ '^sha256:[0-9a-f]{64}$'),
  binary_sha256 text NOT NULL CHECK (binary_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  source_profile text NOT NULL CHECK (source_profile = 'avatarforcing-centered-832x480p25-v1'),
  rate_profile text NOT NULL CHECK (rate_profile = 'native-25-to-renderer-30-round-near-v1'),
  subjective_classification text NOT NULL DEFAULT 'UNREVIEWED'
    CHECK (subjective_classification IN ('UNREVIEWED', 'ACCEPTED', 'LIP_ONLY', 'WHOLE_FRAME')),
  reserved_cost_micro_usd bigint NOT NULL CHECK (reserved_cost_micro_usd >= 0),
  reported_cost_micro_usd bigint NOT NULL CHECK (
    reported_cost_micro_usd >= 0 AND reported_cost_micro_usd <= reserved_cost_micro_usd
  ),
  technical_validation jsonb NOT NULL CHECK (jsonb_typeof(technical_validation) = 'object'),
  acceptance_payload jsonb NOT NULL CHECK (jsonb_typeof(acceptance_payload) = 'object'),
  accepted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, task_id),
  UNIQUE (workspace_id, attempt_id),
  UNIQUE (workspace_id, outbox_id),
  UNIQUE (workspace_id, callback_receipt_id),
  UNIQUE (workspace_id, output_asset_id),
  UNIQUE (workspace_id, qa_result_id),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES public.projects (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, project_revision_id)
    REFERENCES public.project_revisions (workspace_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_revision_id, timeline_plan_id, timeline_segment_id)
    REFERENCES public.timeline_segments (
      workspace_id, project_revision_id, timeline_plan_id, id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, avatar_profile_id, avatar_profile_version_id)
    REFERENCES public.avatar_profile_versions (workspace_id, profile_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, runtime_source_asset_id)
    REFERENCES public.assets (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, selected_span_audio_id)
    REFERENCES public.selected_span_audio (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, span_audio_asset_id)
    REFERENCES public.assets (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, task_id)
    REFERENCES public.generation_tasks (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, task_id, attempt_id)
    REFERENCES public.attempts (workspace_id, task_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, task_id, attempt_id, outbox_id, outbox_kind)
    REFERENCES public.outbox (workspace_id, task_id, attempt_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, task_id, attempt_id, callback_receipt_id)
    REFERENCES public.callback_receipts (workspace_id, task_id, attempt_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id, task_id, attempt_id, reservation_cost_event_id, reservation_event_type
  ) REFERENCES public.cost_events (workspace_id, task_id, attempt_id, id, event_type)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, output_asset_id)
    REFERENCES public.assets (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, qa_result_id)
    REFERENCES public.qa_results (workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.avatar_renderer_bindings (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  avatar_generation_acceptance_id uuid NOT NULL,
  output_asset_id uuid NOT NULL,
  layout text NOT NULL CHECK (layout IN ('AVATAR_FULL', 'AVATAR_SPLIT_IMAGE')),
  source_profile text NOT NULL CHECK (source_profile = 'avatarforcing-centered-832x480p25-v1'),
  crop_profile text NOT NULL,
  rate_profile text NOT NULL CHECK (rate_profile = 'native-25-to-renderer-30-round-near-v1'),
  created_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, avatar_generation_acceptance_id, layout),
  FOREIGN KEY (workspace_id, avatar_generation_acceptance_id)
    REFERENCES public.avatar_generation_acceptances (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, output_asset_id)
    REFERENCES public.assets (workspace_id, id) ON DELETE RESTRICT,
  CHECK (
    (layout = 'AVATAR_FULL' AND crop_profile = '832:468:0:6') OR
    (layout = 'AVATAR_SPLIT_IMAGE' AND crop_profile = '416:468:208:6')
  )
);

CREATE INDEX avatar_generation_acceptances_span_idx
  ON public.avatar_generation_acceptances (workspace_id, selected_span_audio_id);

CREATE TRIGGER avatar_generation_acceptances_append_only
  BEFORE UPDATE OR DELETE ON public.avatar_generation_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_reject_immutable_row();

CREATE TRIGGER avatar_renderer_bindings_append_only
  BEFORE UPDATE OR DELETE ON public.avatar_renderer_bindings
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_reject_immutable_row();

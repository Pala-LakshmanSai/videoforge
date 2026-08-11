ALTER TABLE public.callback_receipts
  ADD CONSTRAINT callback_receipts_image_acceptance_link_uq
    UNIQUE (workspace_id, task_id, attempt_id, id);

ALTER TABLE public.prompt_scene_results
  ADD CONSTRAINT prompt_scene_results_image_acceptance_link_uq
    UNIQUE (workspace_id, prompt_execution_id, id);

CREATE TABLE public.image_generation_acceptances (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  timeline_plan_id uuid NOT NULL,
  image_style_id uuid NOT NULL,
  image_style_version_id uuid NOT NULL,
  style_profile_artifact_id uuid,
  prompt_execution_id uuid NOT NULL,
  prompt_scene_result_id uuid NOT NULL,
  task_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  outbox_id uuid NOT NULL,
  outbox_kind text NOT NULL DEFAULT 'DISPATCH' CHECK (outbox_kind = 'DISPATCH'),
  callback_receipt_id uuid NOT NULL,
  reservation_cost_event_id uuid NOT NULL,
  reservation_event_type text NOT NULL DEFAULT 'RESERVED' CHECK (reservation_event_type = 'RESERVED'),
  output_asset_id uuid NOT NULL,
  qa_result_id uuid NOT NULL,
  schema_version text NOT NULL CHECK (schema_version = 'videoforge.fixture-image-acceptance/v1'),
  input_hash text NOT NULL CHECK (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  result_hash text NOT NULL CHECK (result_hash ~ '^sha256:[0-9a-f]{64}$'),
  acceptance_fingerprint_hash text NOT NULL CHECK (acceptance_fingerprint_hash ~ '^sha256:[0-9a-f]{64}$'),
  timeline_hash text NOT NULL CHECK (timeline_hash ~ '^sha256:[0-9a-f]{64}$'),
  style_profile_hash text NOT NULL CHECK (style_profile_hash ~ '^sha256:[0-9a-f]{64}$'),
  positive_prompt_hash text NOT NULL CHECK (positive_prompt_hash ~ '^sha256:[0-9a-f]{64}$'),
  negative_prompt_hash text NOT NULL CHECK (negative_prompt_hash ~ '^sha256:[0-9a-f]{64}$'),
  binary_sha256 text NOT NULL CHECK (binary_sha256 ~ '^sha256:[0-9a-f]{64}$'),
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
  FOREIGN KEY (workspace_id, project_revision_id, timeline_plan_id)
    REFERENCES public.timeline_plans (workspace_id, project_revision_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, image_style_id, image_style_version_id)
    REFERENCES public.image_style_versions (workspace_id, style_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id, image_style_id, image_style_version_id, style_profile_artifact_id
  ) REFERENCES public.image_style_profile_artifacts (workspace_id, style_id, version_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, prompt_execution_id)
    REFERENCES public.prompt_executions (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, prompt_execution_id, prompt_scene_result_id)
    REFERENCES public.prompt_scene_results (workspace_id, prompt_execution_id, id)
    ON DELETE RESTRICT,
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

CREATE INDEX image_generation_acceptances_prompt_idx
  ON public.image_generation_acceptances (workspace_id, prompt_execution_id, prompt_scene_result_id);

CREATE TRIGGER image_generation_acceptances_append_only
  BEFORE UPDATE OR DELETE ON public.image_generation_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_reject_immutable_row();

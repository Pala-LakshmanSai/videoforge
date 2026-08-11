CREATE TABLE public.prompt_executions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  timeline_plan_id uuid NOT NULL,
  image_style_id uuid NOT NULL,
  image_style_version_id uuid NOT NULL,
  task_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  outbox_id uuid NOT NULL,
  outbox_kind text NOT NULL DEFAULT 'DISPATCH' CHECK (outbox_kind = 'DISPATCH'),
  reservation_cost_event_id uuid NOT NULL,
  reservation_event_type text NOT NULL DEFAULT 'RESERVED' CHECK (reservation_event_type = 'RESERVED'),
  output_asset_id uuid NOT NULL,
  schema_version text NOT NULL CHECK (schema_version = 'videoforge.durable-prompt-execution/v1'),
  input_hash text NOT NULL CHECK (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  response_hash text NOT NULL CHECK (response_hash ~ '^sha256:[0-9a-f]{64}$'),
  compiled_output_hash text NOT NULL CHECK (compiled_output_hash ~ '^sha256:[0-9a-f]{64}$'),
  acceptance_fingerprint_hash text NOT NULL CHECK (acceptance_fingerprint_hash ~ '^sha256:[0-9a-f]{64}$'),
  timeline_hash text NOT NULL CHECK (timeline_hash ~ '^sha256:[0-9a-f]{64}$'),
  style_profile_hash text NOT NULL CHECK (style_profile_hash ~ '^sha256:[0-9a-f]{64}$'),
  reserved_cost_micro_usd bigint NOT NULL CHECK (reserved_cost_micro_usd >= 0),
  reported_cost_micro_usd bigint NOT NULL CHECK (
    reported_cost_micro_usd >= 0 AND reported_cost_micro_usd <= reserved_cost_micro_usd
  ),
  acceptance_payload jsonb NOT NULL CHECK (jsonb_typeof(acceptance_payload) = 'object'),
  accepted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, task_id),
  UNIQUE (workspace_id, attempt_id),
  UNIQUE (workspace_id, outbox_id),
  UNIQUE (workspace_id, output_asset_id),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES public.projects (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, project_revision_id)
    REFERENCES public.project_revisions (workspace_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_revision_id, timeline_plan_id)
    REFERENCES public.timeline_plans (workspace_id, project_revision_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, image_style_id, image_style_version_id)
    REFERENCES public.image_style_versions (workspace_id, style_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, task_id)
    REFERENCES public.generation_tasks (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, task_id, attempt_id)
    REFERENCES public.attempts (workspace_id, task_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, task_id, attempt_id, outbox_id, outbox_kind)
    REFERENCES public.outbox (workspace_id, task_id, attempt_id, id, kind) ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id, task_id, attempt_id, reservation_cost_event_id, reservation_event_type
  ) REFERENCES public.cost_events (workspace_id, task_id, attempt_id, id, event_type)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, output_asset_id)
    REFERENCES public.assets (workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.prompt_writer_attempts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  prompt_execution_id uuid NOT NULL,
  execution_attempt_id uuid NOT NULL,
  attempt_index integer NOT NULL CHECK (attempt_index BETWEEN 1 AND 2),
  requested_scene_ids jsonb NOT NULL CHECK (jsonb_typeof(requested_scene_ids) = 'array'),
  request_bytes text NOT NULL CHECK (octet_length(request_bytes) BETWEEN 1 AND 2097152),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  response_bytes text NOT NULL CHECK (octet_length(response_bytes) BETWEEN 1 AND 2097152),
  response_hash text NOT NULL CHECK (response_hash ~ '^sha256:[0-9a-f]{64}$'),
  retry_of_request_hash text CHECK (
    retry_of_request_hash IS NULL OR retry_of_request_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  accepted_scene_ids jsonb NOT NULL CHECK (jsonb_typeof(accepted_scene_ids) = 'array'),
  unresolved_scene_ids jsonb NOT NULL CHECK (jsonb_typeof(unresolved_scene_ids) = 'array'),
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  reported_cost_micro_usd bigint NOT NULL CHECK (reported_cost_micro_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, prompt_execution_id, attempt_index),
  FOREIGN KEY (workspace_id, prompt_execution_id)
    REFERENCES public.prompt_executions (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, execution_attempt_id)
    REFERENCES public.prompt_executions (workspace_id, attempt_id) ON DELETE RESTRICT,
  CHECK (
    (attempt_index = 1 AND retry_of_request_hash IS NULL) OR
    (attempt_index = 2 AND retry_of_request_hash IS NOT NULL)
  )
);

CREATE TABLE public.prompt_scene_results (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  prompt_execution_id uuid NOT NULL,
  execution_attempt_id uuid NOT NULL,
  scene_ordinal integer NOT NULL CHECK (scene_ordinal >= 0),
  scene_id text NOT NULL CHECK (length(scene_id) BETWEEN 1 AND 160),
  writer_output jsonb NOT NULL CHECK (jsonb_typeof(writer_output) = 'object'),
  compiled_prompt jsonb NOT NULL CHECK (jsonb_typeof(compiled_prompt) = 'object'),
  positive_prompt_hash text NOT NULL CHECK (positive_prompt_hash ~ '^sha256:[0-9a-f]{64}$'),
  negative_prompt_hash text NOT NULL CHECK (negative_prompt_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, prompt_execution_id, scene_ordinal),
  UNIQUE (workspace_id, prompt_execution_id, scene_id),
  FOREIGN KEY (workspace_id, prompt_execution_id)
    REFERENCES public.prompt_executions (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, execution_attempt_id)
    REFERENCES public.prompt_executions (workspace_id, attempt_id) ON DELETE RESTRICT
);

CREATE INDEX prompt_writer_attempts_execution_idx
  ON public.prompt_writer_attempts (workspace_id, execution_attempt_id, attempt_index);

CREATE INDEX prompt_scene_results_execution_idx
  ON public.prompt_scene_results (workspace_id, execution_attempt_id, scene_ordinal);

CREATE TRIGGER prompt_executions_append_only
  BEFORE UPDATE OR DELETE ON public.prompt_executions
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_reject_immutable_row();

CREATE TRIGGER prompt_writer_attempts_append_only
  BEFORE UPDATE OR DELETE ON public.prompt_writer_attempts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_reject_immutable_row();

CREATE TRIGGER prompt_scene_results_append_only
  BEFORE UPDATE OR DELETE ON public.prompt_scene_results
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_reject_immutable_row();

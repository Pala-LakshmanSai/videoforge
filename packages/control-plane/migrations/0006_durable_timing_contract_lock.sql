-- VF-2-01: additive durable timing/timeline identity and lineage.
-- Existing Phase 1 rows remain readable as legacy rows; all v1 lineage writes use the exact
-- repository contract and immutable canonical documents.

ALTER TABLE public.transcripts
  ADD COLUMN lineage_contract_version text,
  ADD COLUMN source_binary_sha256 text
    CHECK (source_binary_sha256 IS NULL OR source_binary_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  ADD COLUMN engine_name text,
  ADD COLUMN engine_version text,
  ADD COLUMN language text,
  ADD COLUMN transcription_config_hash text
    CHECK (transcription_config_hash IS NULL OR transcription_config_hash ~ '^sha256:[0-9a-f]{64}$'),
  ADD COLUMN optional_script_hash text
    CHECK (optional_script_hash IS NULL OR optional_script_hash ~ '^sha256:[0-9a-f]{64}$'),
  ADD COLUMN input_fingerprint_hash text
    CHECK (input_fingerprint_hash IS NULL OR input_fingerprint_hash ~ '^sha256:[0-9a-f]{64}$'),
  ADD COLUMN idempotency_key text,
  ADD COLUMN lineage_sequence integer NOT NULL DEFAULT 1 CHECK (lineage_sequence > 0),
  ADD COLUMN supersedes_transcript_id uuid,
  ADD CONSTRAINT transcripts_lineage_shape_check CHECK (
    (lineage_contract_version IS NULL AND source_binary_sha256 IS NULL AND
     engine_name IS NULL AND engine_version IS NULL AND language IS NULL AND
     transcription_config_hash IS NULL AND optional_script_hash IS NULL AND
     input_fingerprint_hash IS NULL AND idempotency_key IS NULL AND
     supersedes_transcript_id IS NULL)
    OR
    (lineage_contract_version = 'timing-lineage/v1' AND state = 'READY' AND
     source_binary_sha256 IS NOT NULL AND engine_name IS NOT NULL AND
     engine_version IS NOT NULL AND language IS NOT NULL AND
     transcription_config_hash IS NOT NULL AND input_fingerprint_hash IS NOT NULL AND
     idempotency_key IS NOT NULL AND length(idempotency_key) BETWEEN 1 AND 240 AND
     idempotency_key = btrim(idempotency_key) AND
     ((lineage_sequence = 1 AND supersedes_transcript_id IS NULL) OR
      (lineage_sequence > 1 AND supersedes_transcript_id IS NOT NULL)))
  ),
  ADD CONSTRAINT transcripts_supersedes_fk
    FOREIGN KEY (workspace_id, project_revision_id, supersedes_transcript_id)
    REFERENCES public.transcripts (workspace_id, project_revision_id, id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX transcripts_input_fingerprint_uq
  ON public.transcripts (workspace_id, project_revision_id, input_fingerprint_hash)
  WHERE lineage_contract_version = 'timing-lineage/v1';

CREATE UNIQUE INDEX transcripts_idempotency_uq
  ON public.transcripts (workspace_id, idempotency_key)
  WHERE lineage_contract_version = 'timing-lineage/v1';

-- Preserve the Phase 1 legacy invariant without preventing immutable v1 lineage from advancing.
DROP INDEX public.transcripts_one_ready_per_revision_uq;
CREATE UNIQUE INDEX transcripts_one_ready_per_revision_uq
  ON public.transcripts (workspace_id, project_revision_id)
  WHERE state = 'READY' AND lineage_contract_version IS NULL;

CREATE TABLE public.transcript_sentences (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  transcript_id uuid NOT NULL,
  sentence_key text NOT NULL CHECK (length(sentence_key) BETWEEN 1 AND 160),
  sentence_index integer NOT NULL CHECK (sentence_index >= 0),
  word_start integer NOT NULL CHECK (word_start >= 0),
  word_end_exclusive integer NOT NULL CHECK (word_end_exclusive > word_start),
  start_ms bigint NOT NULL CHECK (start_ms >= 0),
  end_ms_exclusive bigint NOT NULL CHECK (end_ms_exclusive > start_ms),
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 12000),
  created_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, transcript_id, id),
  UNIQUE (workspace_id, transcript_id, sentence_key),
  UNIQUE (workspace_id, transcript_id, sentence_index),
  FOREIGN KEY (workspace_id, transcript_id)
    REFERENCES public.transcripts (workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.transcript_phrases (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  transcript_id uuid NOT NULL,
  sentence_id uuid NOT NULL,
  phrase_key text NOT NULL CHECK (length(phrase_key) BETWEEN 1 AND 160),
  phrase_index integer NOT NULL CHECK (phrase_index >= 0),
  word_start integer NOT NULL CHECK (word_start >= 0),
  word_end_exclusive integer NOT NULL CHECK (word_end_exclusive > word_start),
  start_ms bigint NOT NULL CHECK (start_ms >= 0),
  end_ms_exclusive bigint NOT NULL CHECK (end_ms_exclusive > start_ms),
  pause_before_ms bigint NOT NULL CHECK (pause_before_ms >= 0),
  pause_after_ms bigint NOT NULL CHECK (pause_after_ms >= 0),
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, transcript_id, id),
  UNIQUE (workspace_id, transcript_id, phrase_key),
  UNIQUE (workspace_id, transcript_id, phrase_index),
  FOREIGN KEY (workspace_id, transcript_id)
    REFERENCES public.transcripts (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, transcript_id, sentence_id)
    REFERENCES public.transcript_sentences (workspace_id, transcript_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.timeline_plans (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  transcript_id uuid NOT NULL,
  plan_sequence integer NOT NULL CHECK (plan_sequence > 0),
  supersedes_timeline_plan_id uuid,
  revision_config_hash text NOT NULL CHECK (revision_config_hash ~ '^sha256:[0-9a-f]{64}$'),
  transcript_document_hash text NOT NULL CHECK (transcript_document_hash ~ '^sha256:[0-9a-f]{64}$'),
  scheduler_version text NOT NULL CHECK (length(scheduler_version) BETWEEN 1 AND 160),
  scheduler_config_hash text NOT NULL CHECK (scheduler_config_hash ~ '^sha256:[0-9a-f]{64}$'),
  seed bigint NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
  input_fingerprint_hash text NOT NULL CHECK (input_fingerprint_hash ~ '^sha256:[0-9a-f]{64}$'),
  contract_name text NOT NULL,
  contract_version text NOT NULL,
  canonical_document_asset_id uuid NOT NULL,
  canonical_document_hash text NOT NULL CHECK (canonical_document_hash ~ '^sha256:[0-9a-f]{64}$'),
  output_fps_num integer NOT NULL CHECK (output_fps_num = 30),
  output_fps_den integer NOT NULL CHECK (output_fps_den = 1),
  total_frames integer NOT NULL CHECK (total_frames > 0),
  idempotency_key text NOT NULL CHECK (
    length(idempotency_key) BETWEEN 1 AND 240 AND idempotency_key = btrim(idempotency_key)
  ),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (
    (plan_sequence = 1 AND supersedes_timeline_plan_id IS NULL) OR
    (plan_sequence > 1 AND supersedes_timeline_plan_id IS NOT NULL)
  ),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_revision_id, id),
  UNIQUE (workspace_id, project_revision_id, plan_sequence),
  UNIQUE (workspace_id, project_revision_id, input_fingerprint_hash),
  UNIQUE (workspace_id, idempotency_key),
  FOREIGN KEY (workspace_id, project_revision_id)
    REFERENCES public.project_revisions (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_revision_id, transcript_id)
    REFERENCES public.transcripts (workspace_id, project_revision_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_revision_id, supersedes_timeline_plan_id)
    REFERENCES public.timeline_plans (workspace_id, project_revision_id, id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workspace_id, canonical_document_asset_id)
    REFERENCES public.assets (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, created_by_user_id)
    REFERENCES public.memberships (workspace_id, user_id) ON DELETE RESTRICT
);

ALTER TABLE public.timeline_segments
  DROP CONSTRAINT timeline_segments_workspace_id_project_revision_id_segment__key,
  ADD COLUMN timeline_plan_id uuid,
  ADD COLUMN segment_key text,
  ADD COLUMN source_audio_start_ms bigint CHECK (
    source_audio_start_ms IS NULL OR source_audio_start_ms >= 0
  ),
  ADD COLUMN source_audio_end_ms_exclusive bigint CHECK (
    source_audio_end_ms_exclusive IS NULL OR source_audio_end_ms_exclusive > source_audio_start_ms
  ),
  ADD COLUMN word_start integer CHECK (word_start IS NULL OR word_start >= 0),
  ADD COLUMN word_end_exclusive integer CHECK (
    word_end_exclusive IS NULL OR word_end_exclusive > word_start
  ),
  ADD CONSTRAINT timeline_segments_plan_shape_check CHECK (
    (timeline_plan_id IS NULL AND segment_key IS NULL AND source_audio_start_ms IS NULL AND
     source_audio_end_ms_exclusive IS NULL AND word_start IS NULL AND word_end_exclusive IS NULL)
    OR
    (timeline_plan_id IS NOT NULL AND segment_key IS NOT NULL AND
     length(segment_key) BETWEEN 1 AND 160 AND source_audio_start_ms IS NOT NULL AND
     source_audio_end_ms_exclusive IS NOT NULL AND word_start IS NOT NULL AND
     word_end_exclusive IS NOT NULL)
  ),
  ADD CONSTRAINT timeline_segments_timeline_plan_fk
    FOREIGN KEY (workspace_id, project_revision_id, timeline_plan_id)
    REFERENCES public.timeline_plans (workspace_id, project_revision_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT timeline_segments_plan_link_uq
    UNIQUE (workspace_id, project_revision_id, timeline_plan_id, id);

CREATE UNIQUE INDEX timeline_segments_legacy_revision_index_uq
  ON public.timeline_segments (workspace_id, project_revision_id, segment_index)
  WHERE timeline_plan_id IS NULL;

CREATE UNIQUE INDEX timeline_segments_plan_index_uq
  ON public.timeline_segments (workspace_id, timeline_plan_id, segment_index)
  WHERE timeline_plan_id IS NOT NULL;

CREATE UNIQUE INDEX timeline_segments_plan_key_uq
  ON public.timeline_segments (workspace_id, timeline_plan_id, segment_key)
  WHERE timeline_plan_id IS NOT NULL;

CREATE INDEX timeline_segments_plan_frame_idx
  ON public.timeline_segments (workspace_id, timeline_plan_id, start_frame, end_frame_exclusive)
  WHERE timeline_plan_id IS NOT NULL;

CREATE TABLE public.selected_span_audio (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  timeline_plan_id uuid NOT NULL,
  timeline_segment_id uuid NOT NULL,
  transcript_id uuid NOT NULL,
  span_key text NOT NULL CHECK (length(span_key) BETWEEN 1 AND 160),
  task_key text NOT NULL CHECK (length(task_key) BETWEEN 1 AND 240),
  source_asset_id uuid NOT NULL,
  source_binary_sha256 text NOT NULL CHECK (source_binary_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  selected_start_ms bigint NOT NULL CHECK (selected_start_ms >= 0),
  selected_end_ms_exclusive bigint NOT NULL CHECK (selected_end_ms_exclusive > selected_start_ms),
  padded_start_ms bigint NOT NULL CHECK (padded_start_ms >= 0),
  padded_end_ms_exclusive bigint NOT NULL CHECK (padded_end_ms_exclusive > padded_start_ms),
  trim_start_ms bigint NOT NULL CHECK (trim_start_ms >= 0),
  trim_end_ms_exclusive bigint NOT NULL CHECK (trim_end_ms_exclusive > trim_start_ms),
  state text NOT NULL CHECK (state IN ('PLANNED', 'MATERIALIZED')),
  materialized_asset_id uuid,
  materialized_binary_sha256 text CHECK (
    materialized_binary_sha256 IS NULL OR materialized_binary_sha256 ~ '^sha256:[0-9a-f]{64}$'
  ),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL,
  materialized_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, timeline_plan_id, timeline_segment_id),
  UNIQUE (workspace_id, timeline_plan_id, span_key),
  UNIQUE (workspace_id, timeline_plan_id, task_key),
  FOREIGN KEY (workspace_id, project_revision_id, timeline_plan_id, timeline_segment_id)
    REFERENCES public.timeline_segments (
      workspace_id, project_revision_id, timeline_plan_id, id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_revision_id, transcript_id)
    REFERENCES public.transcripts (workspace_id, project_revision_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, source_asset_id)
    REFERENCES public.assets (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, materialized_asset_id)
    REFERENCES public.assets (workspace_id, id) ON DELETE RESTRICT,
  CHECK (
    padded_start_ms <= selected_start_ms AND selected_end_ms_exclusive <= padded_end_ms_exclusive AND
    trim_start_ms = selected_start_ms - padded_start_ms AND
    trim_end_ms_exclusive = trim_start_ms + selected_end_ms_exclusive - selected_start_ms
  ),
  CHECK (
    (state = 'PLANNED' AND materialized_asset_id IS NULL AND
     materialized_binary_sha256 IS NULL AND materialized_at IS NULL)
    OR
    (state = 'MATERIALIZED' AND materialized_asset_id IS NOT NULL AND
     materialized_binary_sha256 IS NOT NULL AND materialized_at IS NOT NULL)
  )
);

CREATE TABLE public.revision_timing_heads (
  workspace_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  current_transcript_id uuid,
  current_timeline_plan_id uuid,
  transcript_input_fingerprint_hash text CHECK (
    transcript_input_fingerprint_hash IS NULL OR
    transcript_input_fingerprint_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  timeline_input_fingerprint_hash text CHECK (
    timeline_input_fingerprint_hash IS NULL OR
    timeline_input_fingerprint_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, project_revision_id),
  FOREIGN KEY (workspace_id, project_revision_id)
    REFERENCES public.project_revisions (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_revision_id, current_transcript_id)
    REFERENCES public.transcripts (workspace_id, project_revision_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_revision_id, current_timeline_plan_id)
    REFERENCES public.timeline_plans (workspace_id, project_revision_id, id) ON DELETE RESTRICT,
  CHECK (
    (current_transcript_id IS NULL AND current_timeline_plan_id IS NULL AND
     transcript_input_fingerprint_hash IS NULL AND timeline_input_fingerprint_hash IS NULL)
    OR
    (current_transcript_id IS NOT NULL AND transcript_input_fingerprint_hash IS NOT NULL AND
     (current_timeline_plan_id IS NULL) = (timeline_input_fingerprint_hash IS NULL))
  )
);

CREATE TABLE public.timing_invalidations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_revision_id uuid NOT NULL,
  invalidated_head_version integer NOT NULL CHECK (invalidated_head_version > 0),
  invalidated_transcript_id uuid NOT NULL,
  invalidated_timeline_plan_id uuid,
  prior_transcript_input_fingerprint_hash text NOT NULL
    CHECK (prior_transcript_input_fingerprint_hash ~ '^sha256:[0-9a-f]{64}$'),
  prior_timeline_input_fingerprint_hash text
    CHECK (
      prior_timeline_input_fingerprint_hash IS NULL OR
      prior_timeline_input_fingerprint_hash ~ '^sha256:[0-9a-f]{64}$'
    ),
  next_input_fingerprint_hash text NOT NULL
    CHECK (next_input_fingerprint_hash ~ '^sha256:[0-9a-f]{64}$'),
  reason text NOT NULL CHECK (reason IN (
    'SOURCE_CHANGED', 'MODEL_CHANGED', 'CONFIG_CHANGED', 'SCRIPT_CHANGED', 'SCHEDULER_CHANGED'
  )),
  idempotency_key text NOT NULL CHECK (
    length(idempotency_key) BETWEEN 1 AND 240 AND idempotency_key = btrim(idempotency_key)
  ),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, idempotency_key),
  FOREIGN KEY (workspace_id, project_revision_id)
    REFERENCES public.project_revisions (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_revision_id, invalidated_transcript_id)
    REFERENCES public.transcripts (workspace_id, project_revision_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_revision_id, invalidated_timeline_plan_id)
    REFERENCES public.timeline_plans (workspace_id, project_revision_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, created_by_user_id)
    REFERENCES public.memberships (workspace_id, user_id) ON DELETE RESTRICT,
  CHECK (
    (invalidated_timeline_plan_id IS NULL) = (prior_timeline_input_fingerprint_hash IS NULL)
  )
);

CREATE OR REPLACE FUNCTION public.videoforge_validate_transcript_lineage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.lineage_contract_version IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'durable transcript lineage is immutable' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.project_revisions revision
      JOIN public.assets source
        ON source.workspace_id = revision.workspace_id
       AND source.id = revision.voiceover_asset_id
      JOIN public.assets document
        ON document.workspace_id = revision.workspace_id
       AND document.id = NEW.canonical_document_asset_id
     WHERE revision.workspace_id = NEW.workspace_id
       AND revision.id = NEW.project_revision_id
       AND revision.status = 'LOCKED'
       AND revision.voiceover_asset_id = NEW.source_asset_id
       AND revision.voiceover_binary_sha256 = NEW.source_binary_sha256
       AND source.binary_sha256 = NEW.source_binary_sha256
       AND source.state IN ('VERIFIED', 'ACCEPTED')
       AND document.kind = 'CANONICAL_DOCUMENT'
       AND document.state IN ('VERIFIED', 'ACCEPTED')
       AND document.canonical_contract_name = NEW.contract_name
       AND document.canonical_contract_version = NEW.contract_version
       AND document.canonical_document_sha256 = NEW.canonical_document_hash
  ) THEN
    RAISE EXCEPTION 'transcript lineage does not match the locked revision and canonical assets'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER transcripts_validate_durable_lineage
  BEFORE INSERT OR UPDATE ON public.transcripts
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_validate_transcript_lineage();

CREATE OR REPLACE FUNCTION public.videoforge_enforce_transcript_completeness()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  word_count integer;
  sentence_count integer;
  phrase_count integer;
  bad_count integer;
BEGIN
  IF NEW.lineage_contract_version IS NULL THEN
    RETURN NULL;
  END IF;

  IF NEW.supersedes_transcript_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.transcripts parent
     WHERE parent.workspace_id = NEW.workspace_id
       AND parent.project_revision_id = NEW.project_revision_id
       AND parent.id = NEW.supersedes_transcript_id
       AND parent.lineage_contract_version = 'timing-lineage/v1'
       AND parent.lineage_sequence < NEW.lineage_sequence
  ) THEN
    RAISE EXCEPTION 'superseded transcript is not earlier immutable lineage'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer INTO word_count
    FROM public.transcript_words
   WHERE workspace_id = NEW.workspace_id AND transcript_id = NEW.id;
  IF word_count < 1 OR EXISTS (
    SELECT 1 FROM (
      SELECT word_index, lag(word_index) OVER (ORDER BY word_index) AS prior_index,
             start_ms, end_ms_exclusive,
             lag(end_ms_exclusive) OVER (ORDER BY word_index) AS prior_end_ms
        FROM public.transcript_words
       WHERE workspace_id = NEW.workspace_id AND transcript_id = NEW.id
    ) words
    WHERE (prior_index IS NULL AND word_index <> 0)
       OR (prior_index IS NOT NULL AND word_index <> prior_index + 1)
       OR (prior_end_ms IS NOT NULL AND start_ms < prior_end_ms)
       OR end_ms_exclusive > NEW.duration_ms
  ) THEN
    RAISE EXCEPTION 'transcript words are incomplete or outside source duration'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer INTO sentence_count
    FROM public.transcript_sentences
   WHERE workspace_id = NEW.workspace_id AND transcript_id = NEW.id;
  SELECT count(*)::integer INTO phrase_count
    FROM public.transcript_phrases
   WHERE workspace_id = NEW.workspace_id AND transcript_id = NEW.id;
  IF sentence_count < 1 OR phrase_count < 1 THEN
    RAISE EXCEPTION 'transcript sentences and phrases are required' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer INTO bad_count FROM (
    SELECT sentence_index AS item_index, word_start, word_end_exclusive,
           lag(sentence_index) OVER (ORDER BY sentence_index) AS prior_index,
           lag(word_end_exclusive) OVER (ORDER BY sentence_index) AS prior_word_end
      FROM public.transcript_sentences
     WHERE workspace_id = NEW.workspace_id AND transcript_id = NEW.id
  ) boundaries
  WHERE (prior_index IS NULL AND (item_index <> 0 OR word_start <> 0))
     OR (prior_index IS NOT NULL AND
         (item_index <> prior_index + 1 OR word_start <> prior_word_end))
     OR word_end_exclusive > word_count;
  IF EXISTS (
    SELECT 1 FROM public.transcript_sentences sentence
     WHERE sentence.workspace_id = NEW.workspace_id AND sentence.transcript_id = NEW.id
       AND (
         sentence.start_ms <> (
           SELECT word.start_ms FROM public.transcript_words word
            WHERE word.workspace_id = sentence.workspace_id
              AND word.transcript_id = sentence.transcript_id
              AND word.word_index = sentence.word_start
         ) OR
         sentence.end_ms_exclusive <> (
           SELECT word.end_ms_exclusive FROM public.transcript_words word
            WHERE word.workspace_id = sentence.workspace_id
              AND word.transcript_id = sentence.transcript_id
              AND word.word_index = sentence.word_end_exclusive - 1
         )
       )
  ) THEN
    bad_count := bad_count + 1;
  END IF;
  IF bad_count > 0 OR NOT EXISTS (
    SELECT 1 FROM public.transcript_sentences
     WHERE workspace_id = NEW.workspace_id AND transcript_id = NEW.id
       AND word_end_exclusive = word_count
  ) THEN
    RAISE EXCEPTION 'transcript sentence coverage is not exact' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer INTO bad_count FROM (
    SELECT phrase_index AS item_index, word_start, word_end_exclusive,
           lag(phrase_index) OVER (ORDER BY phrase_index) AS prior_index,
           lag(word_end_exclusive) OVER (ORDER BY phrase_index) AS prior_word_end
      FROM public.transcript_phrases
     WHERE workspace_id = NEW.workspace_id AND transcript_id = NEW.id
  ) boundaries
  WHERE (prior_index IS NULL AND (item_index <> 0 OR word_start <> 0))
     OR (prior_index IS NOT NULL AND
         (item_index <> prior_index + 1 OR word_start <> prior_word_end))
     OR word_end_exclusive > word_count;
  IF bad_count > 0 OR NOT EXISTS (
    SELECT 1 FROM public.transcript_phrases
     WHERE workspace_id = NEW.workspace_id AND transcript_id = NEW.id
       AND word_end_exclusive = word_count
  ) OR EXISTS (
    SELECT 1
      FROM public.transcript_phrases phrase
      JOIN public.transcript_sentences sentence
        ON sentence.workspace_id = phrase.workspace_id
       AND sentence.transcript_id = phrase.transcript_id
       AND sentence.id = phrase.sentence_id
     WHERE phrase.workspace_id = NEW.workspace_id AND phrase.transcript_id = NEW.id
       AND (phrase.word_start < sentence.word_start OR
            phrase.word_end_exclusive > sentence.word_end_exclusive OR
            phrase.start_ms < sentence.start_ms OR
            phrase.end_ms_exclusive > sentence.end_ms_exclusive)
  ) OR EXISTS (
    SELECT 1 FROM public.transcript_phrases phrase
     WHERE phrase.workspace_id = NEW.workspace_id AND phrase.transcript_id = NEW.id
       AND (
         phrase.start_ms <> (
           SELECT word.start_ms FROM public.transcript_words word
            WHERE word.workspace_id = phrase.workspace_id
              AND word.transcript_id = phrase.transcript_id
              AND word.word_index = phrase.word_start
         ) OR
         phrase.end_ms_exclusive <> (
           SELECT word.end_ms_exclusive FROM public.transcript_words word
            WHERE word.workspace_id = phrase.workspace_id
              AND word.transcript_id = phrase.transcript_id
              AND word.word_index = phrase.word_end_exclusive - 1
         )
       )
  ) THEN
    RAISE EXCEPTION 'transcript phrase coverage is not exact' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER transcripts_enforce_durable_completeness
  AFTER INSERT ON public.transcripts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_enforce_transcript_completeness();

CREATE OR REPLACE FUNCTION public.videoforge_reject_timing_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RAISE EXCEPTION 'durable timing history is immutable' USING ERRCODE = '23514';
END;
$function$;

CREATE TRIGGER transcript_words_immutable
  BEFORE UPDATE OR DELETE ON public.transcript_words
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_reject_timing_history_mutation();
CREATE TRIGGER transcript_sentences_immutable
  BEFORE UPDATE OR DELETE ON public.transcript_sentences
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_reject_timing_history_mutation();
CREATE TRIGGER transcript_phrases_immutable
  BEFORE UPDATE OR DELETE ON public.transcript_phrases
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_reject_timing_history_mutation();
CREATE TRIGGER timeline_plans_immutable
  BEFORE UPDATE OR DELETE ON public.timeline_plans
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_reject_timing_history_mutation();
CREATE TRIGGER timeline_segments_durable_immutable
  BEFORE UPDATE OR DELETE ON public.timeline_segments
  FOR EACH ROW
  WHEN (OLD.timeline_plan_id IS NOT NULL)
  EXECUTE FUNCTION public.videoforge_reject_timing_history_mutation();
CREATE TRIGGER timing_invalidations_immutable
  BEFORE UPDATE OR DELETE ON public.timing_invalidations
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_reject_timing_history_mutation();

CREATE OR REPLACE FUNCTION public.videoforge_validate_timeline_plan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  segment_count integer;
  avatar_segment_count integer;
  word_count integer;
BEGIN
  IF NEW.supersedes_timeline_plan_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.timeline_plans parent
     WHERE parent.workspace_id = NEW.workspace_id
       AND parent.project_revision_id = NEW.project_revision_id
       AND parent.id = NEW.supersedes_timeline_plan_id
       AND parent.plan_sequence < NEW.plan_sequence
  ) THEN
    RAISE EXCEPTION 'superseded timeline plan is not earlier immutable lineage'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.project_revisions revision
      JOIN public.transcripts transcript
        ON transcript.workspace_id = revision.workspace_id
       AND transcript.project_revision_id = revision.id
       AND transcript.id = NEW.transcript_id
      JOIN public.assets document
        ON document.workspace_id = NEW.workspace_id
       AND document.id = NEW.canonical_document_asset_id
     WHERE revision.workspace_id = NEW.workspace_id
       AND revision.id = NEW.project_revision_id
       AND revision.status = 'LOCKED'
       AND revision.revision_config_hash = NEW.revision_config_hash
       AND transcript.lineage_contract_version = 'timing-lineage/v1'
       AND transcript.canonical_document_hash = NEW.transcript_document_hash
       AND document.kind = 'CANONICAL_DOCUMENT'
       AND document.state IN ('VERIFIED', 'ACCEPTED')
       AND document.canonical_contract_name = NEW.contract_name
       AND document.canonical_contract_version = NEW.contract_version
       AND document.canonical_document_sha256 = NEW.canonical_document_hash
  ) THEN
    RAISE EXCEPTION 'timeline plan does not match its locked revision, transcript, and document'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer INTO word_count
    FROM public.transcript_words
   WHERE workspace_id = NEW.workspace_id AND transcript_id = NEW.transcript_id;
  SELECT count(*)::integer,
         count(*) FILTER (WHERE timeline_composition IN ('AVATAR_FULL', 'AVATAR_SPLIT_IMAGE'))::integer
    INTO segment_count, avatar_segment_count
    FROM public.timeline_segments
   WHERE workspace_id = NEW.workspace_id AND timeline_plan_id = NEW.id;

  IF segment_count < 1 OR EXISTS (
    SELECT 1 FROM (
      SELECT segment_index, start_frame, end_frame_exclusive,
             lag(segment_index) OVER (ORDER BY segment_index) AS prior_index,
             lag(end_frame_exclusive) OVER (ORDER BY segment_index) AS prior_end,
             source_audio_start_ms, source_audio_end_ms_exclusive,
             word_start, word_end_exclusive,
             lag(word_end_exclusive) OVER (ORDER BY segment_index) AS prior_word_end,
             timeline_plan_hash
        FROM public.timeline_segments
       WHERE workspace_id = NEW.workspace_id AND timeline_plan_id = NEW.id
    ) segments
    WHERE (prior_index IS NULL AND (segment_index <> 0 OR start_frame <> 0))
       OR (prior_index IS NOT NULL AND
           (segment_index <> prior_index + 1 OR start_frame <> prior_end))
       OR end_frame_exclusive > NEW.total_frames
       OR (prior_index IS NULL AND word_start <> 0)
       OR (prior_index IS NOT NULL AND word_start <> prior_word_end)
       OR source_audio_end_ms_exclusive > (
            SELECT duration_ms FROM public.transcripts
             WHERE workspace_id = NEW.workspace_id AND id = NEW.transcript_id
          )
       OR word_end_exclusive > word_count
       OR source_audio_start_ms <> (
            SELECT word.start_ms FROM public.transcript_words word
             WHERE word.workspace_id = NEW.workspace_id
               AND word.transcript_id = NEW.transcript_id
               AND word.word_index = word_start
          )
       OR source_audio_end_ms_exclusive <> (
            SELECT word.end_ms_exclusive FROM public.transcript_words word
             WHERE word.workspace_id = NEW.workspace_id
               AND word.transcript_id = NEW.transcript_id
               AND word.word_index = word_end_exclusive - 1
          )
       OR timeline_plan_hash <> NEW.canonical_document_hash
  ) OR NOT EXISTS (
    SELECT 1 FROM public.timeline_segments
     WHERE workspace_id = NEW.workspace_id AND timeline_plan_id = NEW.id
       AND end_frame_exclusive = NEW.total_frames
       AND word_end_exclusive = word_count
  ) THEN
    RAISE EXCEPTION 'timeline segments do not provide exact frame and source coverage'
      USING ERRCODE = '23514';
  END IF;

  IF (SELECT count(*) FROM public.selected_span_audio
       WHERE workspace_id = NEW.workspace_id AND timeline_plan_id = NEW.id) <> avatar_segment_count
     OR EXISTS (
       SELECT 1
         FROM public.timeline_segments segment
         LEFT JOIN public.selected_span_audio span
           ON span.workspace_id = segment.workspace_id
          AND span.timeline_plan_id = segment.timeline_plan_id
          AND span.timeline_segment_id = segment.id
        WHERE segment.workspace_id = NEW.workspace_id
          AND segment.timeline_plan_id = NEW.id
          AND segment.timeline_composition IN ('AVATAR_FULL', 'AVATAR_SPLIT_IMAGE')
          AND (
            span.id IS NULL OR span.transcript_id <> NEW.transcript_id OR
            span.selected_start_ms <> segment.source_audio_start_ms OR
            span.selected_end_ms_exclusive <> segment.source_audio_end_ms_exclusive OR
            span.task_key <> segment.required_slots->'avatar'->>'span_audio_task_key' OR
            NOT EXISTS (
              SELECT 1 FROM public.transcripts transcript
               WHERE transcript.workspace_id = span.workspace_id
                 AND transcript.id = span.transcript_id
                 AND transcript.source_asset_id = span.source_asset_id
                 AND transcript.source_binary_sha256 = span.source_binary_sha256
            )
          )
     )
  THEN
    RAISE EXCEPTION 'selected span audio ownership is incomplete or mismatched'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER timeline_plans_validate_complete_lineage
  AFTER INSERT ON public.timeline_plans
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_validate_timeline_plan();

CREATE OR REPLACE FUNCTION public.videoforge_validate_timing_head()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.current_timeline_plan_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.timeline_plans plan
     WHERE plan.workspace_id = NEW.workspace_id
       AND plan.project_revision_id = NEW.project_revision_id
       AND plan.id = NEW.current_timeline_plan_id
       AND plan.transcript_id = NEW.current_transcript_id
       AND plan.input_fingerprint_hash = NEW.timeline_input_fingerprint_hash
  ) THEN
    RAISE EXCEPTION 'timing head plan does not match its current transcript'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.current_transcript_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.transcripts transcript
     WHERE transcript.workspace_id = NEW.workspace_id
       AND transcript.project_revision_id = NEW.project_revision_id
       AND transcript.id = NEW.current_transcript_id
       AND transcript.input_fingerprint_hash = NEW.transcript_input_fingerprint_hash
  ) THEN
    RAISE EXCEPTION 'timing head transcript fingerprint does not match'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER revision_timing_heads_validate
  BEFORE INSERT OR UPDATE ON public.revision_timing_heads
  FOR EACH ROW EXECUTE FUNCTION public.videoforge_validate_timing_head();

-- Timeline source coverage follows scheduler phrase boundaries, including leading, inter-phrase,
-- and trailing silence. Migration 0006 incorrectly required every segment edge to equal a spoken
-- word edge, which rejected otherwise canonical timeline-plan/v1 documents containing silence.

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
             lag(source_audio_end_ms_exclusive) OVER (ORDER BY segment_index) AS prior_source_end,
             word_start, word_end_exclusive,
             lag(word_end_exclusive) OVER (ORDER BY segment_index) AS prior_word_end,
             timeline_plan_hash
        FROM public.timeline_segments
       WHERE workspace_id = NEW.workspace_id AND timeline_plan_id = NEW.id
    ) segments
    WHERE (prior_index IS NULL AND
           (segment_index <> 0 OR start_frame <> 0 OR source_audio_start_ms <> 0))
       OR (prior_index IS NOT NULL AND
           (segment_index <> prior_index + 1 OR start_frame <> prior_end OR
            source_audio_start_ms <> prior_source_end))
       OR end_frame_exclusive > NEW.total_frames
       OR (prior_index IS NULL AND word_start <> 0)
       OR (prior_index IS NOT NULL AND word_start <> prior_word_end)
       OR source_audio_end_ms_exclusive > (
            SELECT duration_ms FROM public.transcripts
             WHERE workspace_id = NEW.workspace_id AND id = NEW.transcript_id
          )
       OR word_end_exclusive > word_count
       OR source_audio_start_ms <> CASE
            WHEN segments.word_start = 0 THEN 0
            ELSE (
              SELECT phrase.start_ms FROM public.transcript_phrases phrase
               WHERE phrase.workspace_id = NEW.workspace_id
                 AND phrase.transcript_id = NEW.transcript_id
                 AND phrase.word_start = segments.word_start
            )
          END
       OR source_audio_end_ms_exclusive <> CASE
            WHEN segments.word_end_exclusive = word_count THEN (
              SELECT duration_ms FROM public.transcripts
               WHERE workspace_id = NEW.workspace_id AND id = NEW.transcript_id
            )
            ELSE (
              SELECT phrase.start_ms FROM public.transcript_phrases phrase
               WHERE phrase.workspace_id = NEW.workspace_id
                 AND phrase.transcript_id = NEW.transcript_id
                 AND phrase.word_start = segments.word_end_exclusive
            )
          END
       OR timeline_plan_hash <> NEW.canonical_document_hash
  ) OR NOT EXISTS (
    SELECT 1 FROM public.timeline_segments segment
     JOIN public.transcripts transcript
       ON transcript.workspace_id = segment.workspace_id
      AND transcript.id = NEW.transcript_id
     WHERE segment.workspace_id = NEW.workspace_id
       AND segment.timeline_plan_id = NEW.id
       AND segment.end_frame_exclusive = NEW.total_frames
       AND segment.source_audio_end_ms_exclusive = transcript.duration_ms
       AND segment.word_end_exclusive = word_count
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

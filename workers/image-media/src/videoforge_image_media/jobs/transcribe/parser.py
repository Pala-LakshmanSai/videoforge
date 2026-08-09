from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

TIMESTAMP_TOLERANCE_MS = 250
PHRASE_PAUSE_BOUNDARY_MS = 600
MAX_WORDS_PER_PHRASE = 12
MAX_PHRASE_DURATION_MS = 4500
_SENTENCE_END = re.compile(r"[.!?…][\"')\]]*$", re.UNICODE)
_CLAUSE_END = re.compile(r"[,;:][\"')\]]*$", re.UNICODE)
_CONJUNCTIONS = frozenset(
    {"although", "and", "because", "but", "however", "or", "so", "then", "when", "while"}
)


class WhisperOutputError(ValueError):
    pass


@dataclass(frozen=True)
class _WordCandidate:
    text: str
    start_ms: int
    end_ms: int


def _integer(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise WhisperOutputError(f"{label} must be an integer")
    return value


def _offsets(value: object, label: str) -> tuple[int, int]:
    if not isinstance(value, dict):
        raise WhisperOutputError(f"{label} offsets are missing")
    return _integer(value.get("from"), f"{label}.from"), _integer(value.get("to"), f"{label}.to")


def _normalize_text(value: object, label: str) -> str:
    if not isinstance(value, str):
        raise WhisperOutputError(f"{label} text must be a string")
    normalized = " ".join(value.split())
    if not normalized:
        raise WhisperOutputError(f"{label} text is empty")
    return normalized


def _words_from_segment(segment: dict[str, Any], segment_index: int) -> list[_WordCandidate]:
    raw_text = segment.get("text")
    if not isinstance(raw_text, str):
        raise WhisperOutputError(f"segment {segment_index} text must be a string")
    normalized = " ".join(raw_text.split())
    if not normalized:
        start_ms, end_ms = _offsets(segment.get("offsets"), f"segment {segment_index}")
        if start_ms == end_ms:
            return []
        raise WhisperOutputError(f"segment {segment_index} text is empty")
    text = _normalize_text(raw_text, f"segment {segment_index}")
    if any(character.isspace() for character in text):
        raise WhisperOutputError(
            f"segment {segment_index} is not word-split and has no usable token timestamps"
        )
    start_ms, end_ms = _offsets(segment.get("offsets"), f"segment {segment_index}")
    return [_WordCandidate(text, start_ms, end_ms)]


def _canonical_words(
    transcription: list[object], source_duration_ms: int
) -> list[dict[str, object]]:
    candidates: list[_WordCandidate] = []
    for segment_index, segment in enumerate(transcription):
        if not isinstance(segment, dict):
            raise WhisperOutputError(f"segment {segment_index} is invalid")
        candidates.extend(_words_from_segment(segment, segment_index))
    if not candidates:
        raise WhisperOutputError("whisper output contains no words")

    words: list[dict[str, object]] = []
    previous_end = 0
    for index, candidate in enumerate(candidates):
        start_ms = candidate.start_ms
        end_ms = candidate.end_ms
        if start_ms < 0 or end_ms <= start_ms:
            raise WhisperOutputError(f"word {index} has invalid timestamps")
        if index > 0 and start_ms < previous_end:
            raise WhisperOutputError(f"word {index} overlaps or moves backward")
        if start_ms >= source_duration_ms:
            raise WhisperOutputError(f"word {index} starts after the source duration")
        if end_ms > source_duration_ms + TIMESTAMP_TOLERANCE_MS:
            raise WhisperOutputError(f"word {index} exceeds the source duration tolerance")
        end_ms = min(end_ms, source_duration_ms)
        if end_ms <= start_ms:
            raise WhisperOutputError(f"word {index} has no duration after source-bound clamping")

        words.append(
            {
                "index": index,
                "text": candidate.text,
                "start_ms": start_ms,
                "end_ms": end_ms,
                "confidence": None,
            }
        )
        previous_end = end_ms
    return words


def _canonical_phrases(
    words: list[dict[str, object]], source_duration_ms: int
) -> list[dict[str, object]]:
    boundaries: list[int] = []
    phrase_word_start = 0
    for index, word in enumerate(words):
        phrase_start_ms = int(words[phrase_word_start]["start_ms"])
        if (
            index > phrase_word_start
            and int(word["end_ms"]) - phrase_start_ms > MAX_PHRASE_DURATION_MS
        ):
            boundaries.append(index)
            phrase_word_start = index
        is_last = index == len(words) - 1
        next_gap = 0 if is_last else int(words[index + 1]["start_ms"]) - int(word["end_ms"])
        current_length = index - phrase_word_start + 1
        next_is_conjunction = (
            not is_last
            and str(words[index + 1]["text"]).strip("\"'()[]{}.,;:!?…").casefold() in _CONJUNCTIONS
        )
        if (
            is_last
            or _SENTENCE_END.search(str(word["text"])) is not None
            or _CLAUSE_END.search(str(word["text"])) is not None
            or next_gap >= PHRASE_PAUSE_BOUNDARY_MS
            or current_length >= MAX_WORDS_PER_PHRASE
            or (next_is_conjunction and current_length >= 2)
        ):
            if not boundaries or boundaries[-1] != index + 1:
                boundaries.append(index + 1)
            phrase_word_start = index + 1

    phrases: list[dict[str, object]] = []
    word_start = 0
    sentence_index = 1
    previous_phrase_end = 0
    for phrase_index, word_end_exclusive in enumerate(boundaries, start=1):
        first = words[word_start]
        last = words[word_end_exclusive - 1]
        start_ms = int(first["start_ms"])
        end_ms = int(last["end_ms"])
        next_start = (
            int(words[word_end_exclusive]["start_ms"])
            if word_end_exclusive < len(words)
            else source_duration_ms
        )
        phrase = {
            "phrase_id": f"phrase_{phrase_index:04d}",
            "sentence_id": f"sentence_{sentence_index:04d}",
            "word_start": word_start,
            "word_end_exclusive": word_end_exclusive,
            "start_ms": start_ms,
            "end_ms": end_ms,
            "pause_before_ms": min(60_000, max(0, start_ms - previous_phrase_end)),
            "pause_after_ms": min(60_000, max(0, next_start - end_ms)),
            "text": " ".join(str(word["text"]) for word in words[word_start:word_end_exclusive]),
        }
        phrases.append(phrase)
        if _SENTENCE_END.search(str(last["text"])) is not None:
            sentence_index += 1
        word_start = word_end_exclusive
        previous_phrase_end = end_ms
    return phrases


def parse_whisper_json(
    raw_output_path: Path,
    *,
    project_revision_id: str,
    source_asset_id: str,
    source_sha256: str,
    source_duration_ms: int,
    tool_version: str,
    model_sha256: str,
) -> dict[str, object]:
    try:
        raw_document = json.loads(raw_output_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise WhisperOutputError("whisper JSON output could not be decoded") from error
    if not isinstance(raw_document, dict):
        raise WhisperOutputError("whisper JSON output must be an object")
    result = raw_document.get("result")
    if not isinstance(result, dict) or result.get("language") != "en":
        raise WhisperOutputError("whisper JSON output did not confirm English")
    transcription = raw_document.get("transcription")
    if not isinstance(transcription, list):
        raise WhisperOutputError("whisper JSON output has no transcription array")

    words = _canonical_words(transcription, source_duration_ms)
    phrases = _canonical_phrases(words, source_duration_ms)
    return {
        "schema_version": "transcript-timing/v1",
        "project_revision_id": project_revision_id,
        "source": {
            "asset_id": source_asset_id,
            "sha256": source_sha256,
            "duration_ms": source_duration_ms,
        },
        "engine": {
            "name": "whisper.cpp",
            "version": tool_version,
            "model_name": "base.en",
            "model_sha256": model_sha256,
            "language": "en",
        },
        "text": " ".join(str(word["text"]) for word in words),
        "words": words,
        "phrases": phrases,
    }

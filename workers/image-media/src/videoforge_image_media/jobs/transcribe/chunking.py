from __future__ import annotations

from dataclasses import dataclass
from math import ceil
from typing import Any

DEFAULT_MAX_CHUNK_MS = 10 * 60 * 1000
DEFAULT_OVERLAP_MS = 5 * 1000
TIMESTAMP_TOLERANCE_MS = 250


class ChunkReconciliationError(ValueError):
    pass


@dataclass(frozen=True)
class ChunkWindow:
    index: int
    start_ms: int
    end_ms: int
    emit_start_ms: int
    emit_end_ms: int

    @property
    def duration_ms(self) -> int:
        return self.end_ms - self.start_ms


def plan_chunks(
    source_duration_ms: int,
    *,
    max_chunk_ms: int = DEFAULT_MAX_CHUNK_MS,
    overlap_ms: int = DEFAULT_OVERLAP_MS,
) -> tuple[ChunkWindow, ...]:
    if source_duration_ms <= 0:
        raise ValueError("source duration must be positive")
    if max_chunk_ms <= 0 or overlap_ms < 0 or overlap_ms >= max_chunk_ms:
        raise ValueError("chunk duration and overlap are invalid")
    if source_duration_ms <= max_chunk_ms:
        return (ChunkWindow(0, 0, source_duration_ms, 0, source_duration_ms),)

    count = ceil((source_duration_ms - overlap_ms) / (max_chunk_ms - overlap_ms))
    chunk_ms = ceil((source_duration_ms + (count - 1) * overlap_ms) / count)
    stride_ms = chunk_ms - overlap_ms
    windows: list[ChunkWindow] = []
    for index in range(count):
        start_ms = index * stride_ms
        end_ms = min(source_duration_ms, start_ms + chunk_ms)
        emit_start_ms = 0 if index == 0 else start_ms + overlap_ms // 2
        emit_end_ms = (
            source_duration_ms if index == count - 1 else end_ms - (overlap_ms - overlap_ms // 2)
        )
        windows.append(ChunkWindow(index, start_ms, end_ms, emit_start_ms, emit_end_ms))

    if windows[0].start_ms != 0 or windows[-1].end_ms != source_duration_ms:
        raise AssertionError("chunk plan does not cover the source")
    for prior, current in zip(windows, windows[1:], strict=False):
        if prior.end_ms - current.start_ms != overlap_ms:
            raise AssertionError("chunk plan overlap drifted")
        if prior.emit_end_ms != current.emit_start_ms:
            raise AssertionError("chunk emission windows are not contiguous")
    return tuple(windows)


def reconcile_chunk_words(
    chunk_words: tuple[tuple[ChunkWindow, list[dict[str, Any]]], ...],
    *,
    source_duration_ms: int,
) -> list[dict[str, object]]:
    if not chunk_words:
        raise ChunkReconciliationError("no chunk transcripts were supplied")
    accepted: list[dict[str, object]] = []
    for expected_index, (window, words) in enumerate(chunk_words):
        if window.index != expected_index:
            raise ChunkReconciliationError("chunk transcripts are out of order")
        for local_index, word in enumerate(words):
            try:
                text = str(word["text"])
                local_start = int(word["start_ms"])
                local_end = int(word["end_ms"])
            except (KeyError, TypeError, ValueError) as error:
                raise ChunkReconciliationError("chunk word is invalid") from error
            if not text or any(character.isspace() for character in text):
                raise ChunkReconciliationError("chunk word text is invalid")
            if local_start < 0 or local_end <= local_start:
                raise ChunkReconciliationError("chunk word timestamps are invalid")
            if local_end > window.duration_ms + TIMESTAMP_TOLERANCE_MS:
                raise ChunkReconciliationError("chunk word exceeds its chunk")

            start_ms = window.start_ms + local_start
            end_ms = min(source_duration_ms, window.start_ms + local_end)
            midpoint_ms = start_ms + (end_ms - start_ms) // 2
            if midpoint_ms < window.emit_start_ms or midpoint_ms >= window.emit_end_ms:
                continue
            if start_ms >= source_duration_ms or end_ms <= start_ms:
                continue

            if accepted and start_ms < int(accepted[-1]["end_ms"]):
                prior = accepted[-1]
                if (
                    str(prior["text"]).casefold() == text.casefold()
                    and abs(int(prior["start_ms"]) - start_ms) <= DEFAULT_OVERLAP_MS
                ):
                    continue
                start_ms = int(prior["end_ms"])
                if end_ms <= start_ms:
                    continue

            accepted.append(
                {
                    "index": len(accepted),
                    "text": text,
                    "start_ms": start_ms,
                    "end_ms": end_ms,
                    "confidence": None,
                    "_chunk_index": window.index,
                    "_local_index": local_index,
                }
            )

    if not accepted:
        raise ChunkReconciliationError("chunk transcripts contain no accepted words")
    for word in accepted:
        word.pop("_chunk_index", None)
        word.pop("_local_index", None)
    return accepted

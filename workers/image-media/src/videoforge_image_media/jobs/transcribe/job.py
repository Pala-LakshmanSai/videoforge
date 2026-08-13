from __future__ import annotations

import hashlib
import json
import os
import re
import time
import uuid
from collections.abc import Callable, Mapping
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, cast

from videoforge_contracts import (
    AsrJobInputDocument,
    AsrJobResultDocument,
    TranscriptTimingDocument,
)

from .chunking import ChunkReconciliationError, ChunkWindow, plan_chunks, reconcile_chunk_words
from .parser import WhisperOutputError, build_transcript_document, parse_whisper_words
from .ports import (
    ArtifactResolver,
    CancellationProbe,
    DiagnosticSink,
    NeverCancelled,
    NullDiagnosticSink,
    ProcessResult,
    ProcessRunner,
    WhisperTool,
    WhisperToolResolver,
)

_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
_OBJECT_URI = re.compile(
    r"^vf-local://objects/sha256/(?P<prefix>[0-9a-f]{2})/"
    r"(?P<digest>[0-9a-f]{64})\.[a-z0-9]{1,10}$"
)
_RUN_URI = re.compile(
    r"^vf-local-run://(?P<revision>[A-Za-z0-9][A-Za-z0-9._:-]{0,159})/"
    r"(?P<attempt>[A-Za-z0-9][A-Za-z0-9._:-]{0,159})/"
    r"asr-result\.json$"
)
_ZERO_SHA256 = "sha256:" + ("0" * 64)
_DECODE_FAILURE_MARKERS = (
    "failed to read audio",
    "failed to load audio",
    "failed to decode",
    "could not open audio",
    "error opening input",
    "invalid audio",
    "unsupported audio",
)

_ERRORS: dict[str, tuple[str, bool]] = {
    "ASR_INPUT_INVALID": ("The ASR job input is invalid.", False),
    "ASR_SOURCE_HASH_MISMATCH": (
        "The source voiceover bytes do not match the claimed SHA-256.",
        False,
    ),
    "ASR_SOURCE_DECODE_FAILED": ("The source voiceover could not be decoded.", False),
    "ASR_TOOL_MISSING": ("A required pinned local ASR executable is unavailable.", False),
    "ASR_MODEL_MISSING": ("The pinned local whisper.cpp base.en model is unavailable.", False),
    "ASR_MODEL_HASH_MISMATCH": (
        "The local whisper.cpp model bytes do not match the pinned SHA-256.",
        False,
    ),
    "ASR_PROCESS_FAILED": ("The local whisper.cpp process failed.", True),
    "ASR_OUTPUT_INVALID": ("The local whisper.cpp output is invalid.", False),
    "ASR_CANCELLED": ("The local ASR attempt was cancelled.", False),
}


class _ChunkCancelled(Exception):
    pass


class _ChunkProcessError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class TranscriptionJob:
    """Execute one local, claim-bound whisper.cpp job without provider fallback or downloads."""

    def __init__(
        self,
        *,
        artifacts: ArtifactResolver,
        tools: WhisperToolResolver,
        processes: ProcessRunner,
        cancellation: CancellationProbe | None = None,
        diagnostics: DiagnosticSink | None = None,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._artifacts = artifacts
        self._tools = tools
        self._processes = processes
        self._cancellation = cancellation or NeverCancelled()
        self._diagnostics = diagnostics or NullDiagnosticSink()
        self._monotonic = monotonic

    def run(self, document: Mapping[str, object] | object) -> dict[str, Any]:
        safe_attempt_id, safe_source_hash, safe_model_hash = _safe_claims(document)
        try:
            validated = AsrJobInputDocument.model_validate(document).root
        except (TypeError, ValueError):
            return self._validated_result(
                _failure_result(
                    safe_attempt_id,
                    safe_source_hash,
                    safe_model_hash,
                    "ASR_INPUT_INVALID",
                )
            )

        job_input = cast(dict[str, Any], validated)
        attempt_id = cast(str, job_input["attempt_id"])
        source_hash = cast(str, job_input["voiceover"]["sha256"])
        model_hash = cast(str, job_input["model"]["sha256"])
        result_uri = cast(str, job_input["output"]["result_uri"])
        source_uri = cast(str, job_input["voiceover"]["artifact_uri"])

        object_match = _OBJECT_URI.fullmatch(source_uri)
        run_match = _RUN_URI.fullmatch(result_uri)
        if (
            object_match is None
            or run_match is None
            or object_match.group("prefix") != object_match.group("digest")[:2]
            or source_hash != f"sha256:{object_match.group('digest')}"
            or run_match.group("revision") != job_input["project_revision_id"]
            or run_match.group("attempt") != attempt_id
        ):
            return self._validated_result(
                _failure_result(attempt_id, source_hash, model_hash, "ASR_INPUT_INVALID")
            )

        try:
            result_path = self._artifacts.resolve_run(result_uri)
        except (OSError, ValueError):
            return self._validated_result(
                _failure_result(attempt_id, source_hash, model_hash, "ASR_OUTPUT_INVALID")
            )
        if not _safe_resolved_path(result_path, expected_suffix=".json"):
            return self._validated_result(
                _failure_result(attempt_id, source_hash, model_hash, "ASR_OUTPUT_INVALID")
            )

        if self._is_cancelled(cast(str, job_input["cancel_token"])):
            return self._finish(
                _cancelled_result(attempt_id, source_hash, model_hash), result_path=result_path
            )

        job_fingerprint = _job_fingerprint(job_input)
        work_receipt_path = result_path.with_name("asr-work-receipt.json")
        try:
            replay = _load_replay(result_path, work_receipt_path, job_fingerprint)
        except (OSError, TypeError, ValueError):
            return self._validated_result(
                _failure_result(attempt_id, source_hash, model_hash, "ASR_OUTPUT_INVALID")
            )
        if replay is not None:
            self._record("asr_replayed", {"attempt_id": attempt_id})
            return self._validated_result(replay)

        try:
            source_path = self._artifacts.resolve_object(source_uri)
        except (FileNotFoundError, OSError, ValueError):
            return self._finish(
                _failure_result(attempt_id, source_hash, model_hash, "ASR_SOURCE_DECODE_FAILED"),
                result_path=result_path,
            )
        if (
            not _safe_resolved_path(source_path)
            or source_path.is_symlink()
            or not source_path.is_file()
            or not _media_type_matches(source_path, cast(str, job_input["voiceover"]["media_type"]))
        ):
            return self._finish(
                _failure_result(attempt_id, source_hash, model_hash, "ASR_SOURCE_DECODE_FAILED"),
                result_path=result_path,
            )

        try:
            tool = self._tools.resolve(
                cast(str, job_input["model"]["engine"]),
                cast(str, job_input["model"]["name"]),
            )
        except (FileNotFoundError, OSError, ValueError):
            return self._finish(
                _failure_result(attempt_id, source_hash, model_hash, "ASR_TOOL_MISSING"),
                result_path=result_path,
            )
        tool_error = _tool_error(tool)
        if tool_error is not None:
            return self._finish(
                _failure_result(attempt_id, source_hash, model_hash, tool_error),
                result_path=result_path,
            )

        cancel_token = cast(str, job_input["cancel_token"])
        try:
            source_digest = _sha256_file(
                source_path, should_cancel=lambda: self._is_cancelled(cancel_token)
            )
        except OSError:
            return self._finish(
                _failure_result(attempt_id, source_hash, model_hash, "ASR_SOURCE_DECODE_FAILED"),
                result_path=result_path,
            )
        if source_digest is None:
            return self._finish(
                _cancelled_result(attempt_id, source_hash, model_hash), result_path=result_path
            )
        if source_digest != source_hash:
            return self._finish(
                _failure_result(attempt_id, source_hash, model_hash, "ASR_SOURCE_HASH_MISMATCH"),
                result_path=result_path,
            )

        try:
            model_digest = _sha256_file(
                tool.model, should_cancel=lambda: self._is_cancelled(cancel_token)
            )
        except OSError:
            return self._finish(
                _failure_result(attempt_id, source_hash, model_hash, "ASR_MODEL_MISSING"),
                result_path=result_path,
            )
        if model_digest is None:
            return self._finish(
                _cancelled_result(attempt_id, source_hash, model_hash), result_path=result_path
            )
        if model_digest != model_hash:
            return self._finish(
                _failure_result(attempt_id, source_hash, model_hash, "ASR_MODEL_HASH_MISMATCH"),
                result_path=result_path,
            )

        work_root = result_path.with_name("asr-work")
        chunk_receipt_root = work_root / "chunks"
        normalized_audio_path = work_root / "normalized-analysis.wav"
        try:
            result_path.parent.mkdir(parents=True, exist_ok=True)
            chunk_receipt_root.mkdir(parents=True, exist_ok=True)
            normalized_audio_path.unlink(missing_ok=True)
        except OSError:
            return self._finish(
                _failure_result(attempt_id, source_hash, model_hash, "ASR_OUTPUT_INVALID"),
                result_path=result_path,
            )

        try:
            probe_result = self._processes.run(
                _ffprobe_arguments(tool, source_path),
                should_cancel=lambda: self._is_cancelled(cancel_token),
            )
        except Exception:
            probe_result = ProcessResult(return_code=-1, launch_error="failed")
        if probe_result.cancelled or self._is_cancelled(cancel_token):
            _cleanup_paths(normalized_audio_path)
            return self._finish(
                _cancelled_result(attempt_id, source_hash, model_hash), result_path=result_path
            )
        probe_error = _probe_process_error(probe_result)
        if probe_error is not None:
            _cleanup_paths(normalized_audio_path)
            return self._finish(
                _failure_result(attempt_id, source_hash, model_hash, probe_error),
                result_path=result_path,
            )
        try:
            source_duration_ms = _probe_duration_ms(probe_result.stdout)
        except ValueError:
            _cleanup_paths(normalized_audio_path)
            return self._finish(
                _failure_result(attempt_id, source_hash, model_hash, "ASR_SOURCE_DECODE_FAILED"),
                result_path=result_path,
            )
        claimed_duration_ms = cast(int, job_input["voiceover"]["duration_ms"])
        if abs(source_duration_ms - claimed_duration_ms) > 250:
            _cleanup_paths(normalized_audio_path)
            return self._finish(
                _failure_result(attempt_id, source_hash, model_hash, "ASR_INPUT_INVALID"),
                result_path=result_path,
            )

        self._record(
            "asr_started",
            {
                "attempt_id": attempt_id,
                "threads": cast(int, job_input["options"]["threads"]),
                "flash_attention": cast(bool, job_input["options"]["flash_attention"]),
            },
        )
        started_at = self._monotonic()
        try:
            normalization_result = self._processes.run(
                _ffmpeg_arguments(tool, source_path, normalized_audio_path),
                should_cancel=lambda: self._is_cancelled(cancel_token),
            )
        except Exception:
            normalization_result = ProcessResult(return_code=-1, launch_error="failed")

        if normalization_result.cancelled or self._is_cancelled(cancel_token):
            _cleanup_paths(normalized_audio_path)
            return self._finish(
                _cancelled_result(attempt_id, source_hash, model_hash), result_path=result_path
            )
        normalization_error = _normalization_error(normalization_result)
        if normalization_error is not None:
            _cleanup_paths(normalized_audio_path)
            return self._finish(
                _failure_result(attempt_id, source_hash, model_hash, normalization_error),
                result_path=result_path,
            )
        if not _is_nonempty_file(normalized_audio_path):
            _cleanup_paths(normalized_audio_path)
            return self._finish(
                _failure_result(attempt_id, source_hash, model_hash, "ASR_SOURCE_DECODE_FAILED"),
                result_path=result_path,
            )
        if _pcm_wav_is_digital_silence(normalized_audio_path):
            _cleanup_paths(normalized_audio_path)
            return self._finish(
                _failure_result(attempt_id, source_hash, model_hash, "ASR_OUTPUT_INVALID"),
                result_path=result_path,
            )

        try:
            normalized_hash = _sha256_file(
                normalized_audio_path,
                should_cancel=lambda: self._is_cancelled(cancel_token),
            )
        except OSError:
            normalized_hash = None
        if normalized_hash is None:
            _cleanup_paths(normalized_audio_path)
            return self._finish(
                _failure_result(attempt_id, source_hash, model_hash, "ASR_SOURCE_DECODE_FAILED"),
                result_path=result_path,
            )

        chunk_outputs: list[tuple[ChunkWindow, list[dict[str, Any]]]] = []
        transient_paths: list[Path] = [normalized_audio_path]
        try:
            windows = plan_chunks(source_duration_ms)
            for window in windows:
                if self._is_cancelled(cancel_token):
                    raise _ChunkCancelled
                chunk_receipt_path = chunk_receipt_root / f"chunk_{window.index:04d}.json"
                chunk_fingerprint = _chunk_fingerprint(
                    job_fingerprint,
                    normalized_hash,
                    window,
                    tool.version,
                )
                recovered = _load_chunk_receipt(chunk_receipt_path, chunk_fingerprint, window)
                if recovered is not None:
                    chunk_outputs.append((window, recovered))
                    self._record(
                        "asr_chunk_replayed",
                        {"attempt_id": attempt_id, "chunk_index": window.index},
                    )
                    continue

                chunk_audio_path = work_root / f"chunk_{window.index:04d}.wav"
                raw_output_prefix = work_root / f"chunk_{window.index:04d}.whisper"
                raw_output_path = Path(f"{raw_output_prefix}.json")
                transient_paths.extend((chunk_audio_path, raw_output_path))
                whisper_input = normalized_audio_path
                if len(windows) > 1:
                    chunk_result = self._processes.run(
                        _ffmpeg_chunk_arguments(
                            tool,
                            normalized_audio_path,
                            chunk_audio_path,
                            window,
                        ),
                        should_cancel=lambda: self._is_cancelled(cancel_token),
                    )
                    if chunk_result.cancelled or self._is_cancelled(cancel_token):
                        raise _ChunkCancelled
                    chunk_error = _normalization_error(chunk_result)
                    if chunk_error is not None or not _is_nonempty_file(chunk_audio_path):
                        raise _ChunkProcessError(chunk_error or "ASR_SOURCE_DECODE_FAILED")
                    whisper_input = chunk_audio_path

                process_result = self._processes.run(
                    _whisper_arguments(
                        tool,
                        whisper_input,
                        raw_output_prefix,
                        threads=cast(int, job_input["options"]["threads"]),
                        flash_attention=cast(bool, job_input["options"]["flash_attention"]),
                    ),
                    should_cancel=lambda: self._is_cancelled(cancel_token),
                )
                if process_result.cancelled or self._is_cancelled(cancel_token):
                    raise _ChunkCancelled
                process_error = _process_error(process_result)
                if process_error is not None:
                    raise _ChunkProcessError(process_error)
                words = cast(
                    list[dict[str, Any]],
                    parse_whisper_words(
                        raw_output_path,
                        source_duration_ms=window.duration_ms,
                        allow_trailing_overhang=len(windows) > 1,
                    ),
                )
                _write_chunk_receipt(
                    chunk_receipt_path,
                    chunk_fingerprint,
                    normalized_hash,
                    window,
                    words,
                )
                chunk_outputs.append((window, words))
                self._record(
                    "asr_chunk_finished",
                    {"attempt_id": attempt_id, "chunk_index": window.index},
                )

            reconciled_words = reconcile_chunk_words(
                tuple(chunk_outputs), source_duration_ms=source_duration_ms
            )
            transcript = build_transcript_document(
                reconciled_words,
                project_revision_id=cast(str, job_input["project_revision_id"]),
                source_asset_id=cast(str, job_input["voiceover"]["asset_id"]),
                source_sha256=source_hash,
                source_duration_ms=source_duration_ms,
                tool_version=tool.version,
                model_sha256=model_hash,
            )
            transcript = cast(
                dict[str, object], TranscriptTimingDocument.model_validate(transcript).root
            )
        except _ChunkCancelled:
            return self._finish(
                _cancelled_result(attempt_id, source_hash, model_hash),
                result_path=result_path,
                cleanup=tuple(transient_paths),
            )
        except _ChunkProcessError as error:
            return self._finish(
                _failure_result(attempt_id, source_hash, model_hash, error.code),
                result_path=result_path,
                cleanup=tuple(transient_paths),
            )
        except (
            ChunkReconciliationError,
            OSError,
            TypeError,
            ValueError,
            WhisperOutputError,
        ):
            return self._finish(
                _failure_result(attempt_id, source_hash, model_hash, "ASR_OUTPUT_INVALID"),
                result_path=result_path,
                cleanup=tuple(transient_paths),
            )
        decode_duration_ms = max(0, int(round((self._monotonic() - started_at) * 1000)))
        if self._is_cancelled(cancel_token):
            return self._finish(
                _cancelled_result(attempt_id, source_hash, model_hash),
                result_path=result_path,
                cleanup=tuple(transient_paths),
            )

        success = {
            "schema_version": "asr-job-result/v1",
            "attempt_id": attempt_id,
            "status": "SUCCEEDED",
            "source_voiceover_sha256": source_hash,
            "model_sha256": model_hash,
            "transcript": transcript,
            "diagnostics": {
                "tool_version": tool.version,
                "source_duration_ms": source_duration_ms,
                "decode_duration_ms": decode_duration_ms,
            },
            "error": None,
        }
        try:
            _write_work_receipt(
                work_receipt_path,
                job_fingerprint=job_fingerprint,
                source_hash=source_hash,
                normalized_hash=normalized_hash,
                model_hash=model_hash,
                transcript=transcript,
                windows=windows,
                chunk_receipt_root=chunk_receipt_root,
            )
        except (OSError, TypeError, ValueError):
            return self._finish(
                _failure_result(attempt_id, source_hash, model_hash, "ASR_OUTPUT_INVALID"),
                result_path=result_path,
                cleanup=tuple(transient_paths),
            )
        return self._finish(
            success,
            result_path=result_path,
            cleanup=tuple(transient_paths),
        )

    def _is_cancelled(self, token: str) -> bool:
        try:
            return self._cancellation.is_cancelled(token)
        except Exception:  # cancellation probes fail closed
            return True

    def _record(self, event: str, fields: Mapping[str, str | int | bool]) -> None:
        try:
            self._diagnostics.record(event, fields)
        except Exception:  # diagnostics must never change job results
            return

    def _validated_result(self, result: dict[str, Any]) -> dict[str, Any]:
        return cast(dict[str, Any], AsrJobResultDocument.model_validate(result).root)

    def _finish(
        self,
        result: dict[str, Any],
        *,
        result_path: Path,
        cleanup: tuple[Path, ...] = (),
    ) -> dict[str, Any]:
        _cleanup_paths(*cleanup)
        try:
            validated = self._validated_result(result)
        except (TypeError, ValueError):
            validated = self._validated_result(
                _failure_result(
                    cast(str, result.get("attempt_id", "attempt_invalid")),
                    cast(str, result.get("source_voiceover_sha256", _ZERO_SHA256)),
                    cast(str, result.get("model_sha256", _ZERO_SHA256)),
                    "ASR_OUTPUT_INVALID",
                )
            )
        try:
            _write_result(result_path, validated)
        except OSError:
            validated = self._validated_result(
                _failure_result(
                    cast(str, validated["attempt_id"]),
                    cast(str, validated["source_voiceover_sha256"]),
                    cast(str, validated["model_sha256"]),
                    "ASR_OUTPUT_INVALID",
                )
            )
        error = validated.get("error")
        self._record(
            "asr_finished",
            {
                "attempt_id": cast(str, validated["attempt_id"]),
                "status": cast(str, validated["status"]),
                "error_code": cast(str, error["code"]) if isinstance(error, dict) else "NONE",
            },
        )
        return validated


def _safe_claims(document: object) -> tuple[str, str, str]:
    if not isinstance(document, Mapping):
        return "attempt_invalid", _ZERO_SHA256, _ZERO_SHA256
    attempt = document.get("attempt_id")
    voiceover = document.get("voiceover")
    model = document.get("model")
    source_hash = voiceover.get("sha256") if isinstance(voiceover, Mapping) else None
    model_hash = model.get("sha256") if isinstance(model, Mapping) else None
    return (
        attempt if isinstance(attempt, str) and _ID.fullmatch(attempt) else "attempt_invalid",
        source_hash
        if isinstance(source_hash, str) and _SHA256.fullmatch(source_hash)
        else _ZERO_SHA256,
        model_hash
        if isinstance(model_hash, str) and _SHA256.fullmatch(model_hash)
        else _ZERO_SHA256,
    )


def _safe_resolved_path(path: object, expected_suffix: str | None = None) -> bool:
    return (
        isinstance(path, Path)
        and path.is_absolute()
        and (expected_suffix is None or path.suffix == expected_suffix)
    )


def _is_nonempty_file(path: Path) -> bool:
    try:
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


def _media_type_matches(path: Path, media_type: str) -> bool:
    try:
        with path.open("rb") as stream:
            header = stream.read(16)
    except OSError:
        return False
    if media_type == "audio/wav":
        return len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WAVE"
    if media_type == "audio/flac":
        return header.startswith(b"fLaC")
    if media_type == "audio/mpeg":
        return header.startswith(b"ID3") or (
            len(header) >= 2 and header[0] == 0xFF and header[1] & 0xE0 == 0xE0
        )
    if media_type == "audio/mp4":
        return len(header) >= 8 and header[4:8] == b"ftyp"
    return False


def _pcm_wav_is_digital_silence(path: Path) -> bool:
    """Recognize exact PCM silence without treating malformed fixture bytes as silence."""

    try:
        with path.open("rb") as stream:
            header = stream.read(12)
            if len(header) != 12 or header[:4] != b"RIFF" or header[8:12] != b"WAVE":
                return False
            while True:
                chunk_header = stream.read(8)
                if len(chunk_header) != 8:
                    return False
                chunk_id = chunk_header[:4]
                chunk_size = int.from_bytes(chunk_header[4:], "little")
                if chunk_id != b"data":
                    stream.seek(chunk_size + (chunk_size % 2), os.SEEK_CUR)
                    continue
                remaining = chunk_size
                if remaining == 0:
                    return True
                while remaining > 0:
                    payload = stream.read(min(1024 * 1024, remaining))
                    if not payload:
                        return False
                    if any(payload):
                        return False
                    remaining -= len(payload)
                return True
    except OSError:
        return False


def _tool_error(tool: object) -> str | None:
    if not isinstance(tool, WhisperTool):
        return "ASR_TOOL_MISSING"
    if not _safe_resolved_path(tool.executable) or not tool.executable.is_file():
        return "ASR_TOOL_MISSING"
    if not _safe_resolved_path(tool.ffmpeg) or not tool.ffmpeg.is_file():
        return "ASR_TOOL_MISSING"
    if not _safe_resolved_path(tool.ffprobe) or not tool.ffprobe.is_file():
        return "ASR_TOOL_MISSING"
    if not _safe_resolved_path(tool.model) or not tool.model.is_file():
        return "ASR_MODEL_MISSING"
    if not tool.version or len(tool.version) > 80:
        return "ASR_TOOL_MISSING"
    return None


def _sha256_file(path: Path, *, should_cancel: Callable[[], bool]) -> str | None:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            if should_cancel():
                return None
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def _ffprobe_arguments(tool: WhisperTool, source_path: Path) -> tuple[str, ...]:
    return (
        str(tool.ffprobe),
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=duration:format=duration",
        "-of",
        "json",
        str(source_path),
    )


def _ffmpeg_arguments(
    tool: WhisperTool,
    source_path: Path,
    normalized_audio_path: Path,
) -> tuple[str, ...]:
    return (
        str(tool.ffmpeg),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source_path),
        "-map",
        "0:a:0",
        "-vn",
        "-map_metadata",
        "-1",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(normalized_audio_path),
    )


def _ffmpeg_chunk_arguments(
    tool: WhisperTool,
    normalized_audio_path: Path,
    chunk_audio_path: Path,
    window: ChunkWindow,
) -> tuple[str, ...]:
    return (
        str(tool.ffmpeg),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{window.start_ms / 1000:.3f}",
        "-t",
        f"{window.duration_ms / 1000:.3f}",
        "-i",
        str(normalized_audio_path),
        "-map",
        "0:a:0",
        "-vn",
        "-map_metadata",
        "-1",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(chunk_audio_path),
    )


def _whisper_arguments(
    tool: WhisperTool,
    source_path: Path,
    raw_output_prefix: Path,
    *,
    threads: int,
    flash_attention: bool,
) -> tuple[str, ...]:
    arguments = [
        str(tool.executable),
        "--model",
        str(tool.model),
        "--file",
        str(source_path),
        "--language",
        "en",
        "--threads",
        str(threads),
        "--processors",
        "1",
        "--temperature",
        "0",
        "--temperature-inc",
        "0",
        "--best-of",
        "1",
        "--beam-size",
        "1",
        "--no-fallback",
        "--max-len",
        "1",
        "--split-on-word",
        "--output-json",
        "--output-file",
        str(raw_output_prefix),
        "--no-prints",
    ]
    arguments.append("--flash-attn" if flash_attention else "--no-flash-attn")
    return tuple(arguments)


def _normalization_error(result: ProcessResult) -> str | None:
    if result.launch_error == "missing":
        return "ASR_TOOL_MISSING"
    if result.launch_error == "failed":
        return "ASR_PROCESS_FAILED"
    if result.return_code != 0:
        return "ASR_SOURCE_DECODE_FAILED"
    return None


def _probe_process_error(result: ProcessResult) -> str | None:
    if result.launch_error == "missing":
        return "ASR_TOOL_MISSING"
    if result.launch_error == "failed":
        return "ASR_PROCESS_FAILED"
    if result.return_code != 0:
        return "ASR_SOURCE_DECODE_FAILED"
    return None


def _probe_duration_ms(stdout: str) -> int:
    try:
        document = json.loads(stdout)
    except json.JSONDecodeError as error:
        raise ValueError("invalid ffprobe JSON") from error
    if not isinstance(document, dict):
        raise ValueError("invalid ffprobe document")
    streams = document.get("streams")
    media_format = document.get("format")
    if not isinstance(streams, list) or not streams or not isinstance(streams[0], dict):
        raise ValueError("ffprobe found no audio stream")
    duration_value = streams[0].get("duration")
    if duration_value in (None, "N/A") and isinstance(media_format, dict):
        duration_value = media_format.get("duration")
    try:
        duration_seconds = Decimal(str(duration_value))
    except (InvalidOperation, ValueError) as error:
        raise ValueError("invalid ffprobe duration") from error
    if not duration_seconds.is_finite() or duration_seconds <= 0:
        raise ValueError("invalid ffprobe duration")
    duration_ms = int((duration_seconds * 1000).to_integral_value(rounding=ROUND_HALF_UP))
    if duration_ms < 1 or duration_ms > 3_600_000:
        raise ValueError("ffprobe duration is out of range")
    return duration_ms


def _process_error(result: ProcessResult) -> str | None:
    if result.launch_error == "missing":
        return "ASR_TOOL_MISSING"
    if result.launch_error == "failed":
        return "ASR_PROCESS_FAILED"
    if result.return_code == 0:
        return None
    stderr = result.stderr.casefold()
    if any(marker in stderr for marker in _DECODE_FAILURE_MARKERS):
        return "ASR_SOURCE_DECODE_FAILED"
    return "ASR_PROCESS_FAILED"


def _failure_result(
    attempt_id: str,
    source_hash: str,
    model_hash: str,
    code: str,
) -> dict[str, Any]:
    message, retryable = _ERRORS[code]
    return {
        "schema_version": "asr-job-result/v1",
        "attempt_id": attempt_id,
        "status": "FAILED",
        "source_voiceover_sha256": source_hash,
        "model_sha256": model_hash,
        "transcript": None,
        "diagnostics": None,
        "error": {"code": code, "message": message, "retryable": retryable},
    }


def _cancelled_result(attempt_id: str, source_hash: str, model_hash: str) -> dict[str, Any]:
    result = _failure_result(attempt_id, source_hash, model_hash, "ASR_CANCELLED")
    result["status"] = "CANCELLED"
    return result


def _canonical_payload(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _canonical_hash(value: object) -> str:
    return f"sha256:{hashlib.sha256(_canonical_payload(value)).hexdigest()}"


def _job_fingerprint(job_input: Mapping[str, object]) -> str:
    return _canonical_hash(job_input)


def _chunk_fingerprint(
    job_fingerprint: str,
    normalized_hash: str,
    window: ChunkWindow,
    tool_version: str,
) -> str:
    return _canonical_hash(
        {
            "schema_version": "videoforge.asr-chunk-fingerprint/v1",
            "job_fingerprint": job_fingerprint,
            "normalized_analysis_sha256": normalized_hash,
            "tool_version": tool_version,
            "chunk": {
                "index": window.index,
                "start_ms": window.start_ms,
                "end_ms": window.end_ms,
                "emit_start_ms": window.emit_start_ms,
                "emit_end_ms": window.emit_end_ms,
            },
        }
    )


def _load_json_strict(path: Path) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise ValueError("durable ASR document must be a regular file")

    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        parsed: dict[str, Any] = {}
        for key, value in pairs:
            if key in parsed:
                raise ValueError("duplicate durable ASR property")
            parsed[key] = value
        return parsed

    def reject_constant(value: str) -> None:
        raise ValueError(f"non-finite durable ASR constant {value}")

    parsed = json.loads(
        path.read_text(encoding="utf-8"),
        object_pairs_hook=reject_duplicates,
        parse_constant=reject_constant,
    )
    if not isinstance(parsed, dict):
        raise ValueError("durable ASR document must be an object")
    return parsed


def _write_immutable_json(path: Path, document: Mapping[str, object]) -> None:
    temporary_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    payload = _canonical_payload(document) + b"\n"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() or path.is_symlink():
            existing = _load_json_strict(path)
            if _canonical_payload(existing) == _canonical_payload(document):
                return
            raise FileExistsError("durable ASR document conflicts with existing bytes")
        with temporary_path.open("xb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary_path, path)
        except FileExistsError:
            existing = _load_json_strict(path)
            if _canonical_payload(existing) != _canonical_payload(document):
                raise FileExistsError("durable ASR publication collided") from None
    finally:
        _cleanup_paths(temporary_path)


def _chunk_window_document(window: ChunkWindow) -> dict[str, int]:
    return {
        "index": window.index,
        "start_ms": window.start_ms,
        "end_ms": window.end_ms,
        "emit_start_ms": window.emit_start_ms,
        "emit_end_ms": window.emit_end_ms,
    }


def _write_chunk_receipt(
    path: Path,
    chunk_fingerprint: str,
    normalized_hash: str,
    window: ChunkWindow,
    words: list[dict[str, Any]],
) -> None:
    _write_immutable_json(
        path,
        {
            "schema_version": "videoforge.asr-chunk-receipt/v1",
            "chunk_fingerprint": chunk_fingerprint,
            "normalized_analysis_sha256": normalized_hash,
            "chunk": _chunk_window_document(window),
            "words": words,
            "words_sha256": _canonical_hash(words),
        },
    )


def _load_chunk_receipt(
    path: Path,
    chunk_fingerprint: str,
    window: ChunkWindow,
) -> list[dict[str, Any]] | None:
    if not path.exists() and not path.is_symlink():
        return None
    receipt = _load_json_strict(path)
    if set(receipt) != {
        "schema_version",
        "chunk_fingerprint",
        "normalized_analysis_sha256",
        "chunk",
        "words",
        "words_sha256",
    }:
        raise ValueError("chunk receipt shape is invalid")
    if (
        receipt["schema_version"] != "videoforge.asr-chunk-receipt/v1"
        or receipt["chunk_fingerprint"] != chunk_fingerprint
        or receipt["chunk"] != _chunk_window_document(window)
        or not isinstance(receipt["words"], list)
        or receipt["words_sha256"] != _canonical_hash(receipt["words"])
    ):
        raise ValueError("chunk receipt does not match the requested work")
    return cast(list[dict[str, Any]], receipt["words"])


def _write_work_receipt(
    path: Path,
    *,
    job_fingerprint: str,
    source_hash: str,
    normalized_hash: str,
    model_hash: str,
    transcript: Mapping[str, object],
    windows: tuple[ChunkWindow, ...],
    chunk_receipt_root: Path,
) -> None:
    chunks: list[dict[str, object]] = []
    for window in windows:
        receipt_path = chunk_receipt_root / f"chunk_{window.index:04d}.json"
        chunks.append(
            {
                **_chunk_window_document(window),
                "receipt_sha256": _sha256_file(receipt_path, should_cancel=lambda: False),
            }
        )
    _write_immutable_json(
        path,
        {
            "schema_version": "videoforge.transcription-work-receipt/v1",
            "job_fingerprint": job_fingerprint,
            "source_voiceover_sha256": source_hash,
            "original_voiceover_role": "FINAL_RENDER_TRUTH",
            "normalized_analysis_sha256": normalized_hash,
            "normalized_analysis_role": "ANALYSIS_AND_SPAN_INPUT_ONLY",
            "model_sha256": model_hash,
            "chunking": {
                "algorithm": "balanced-overlap-midpoint-v1",
                "max_chunk_ms": 600_000,
                "overlap_ms": 5_000,
                "chunks": chunks,
            },
            "transcript_sha256": _canonical_hash(transcript),
        },
    )


def _load_replay(
    result_path: Path,
    receipt_path: Path,
    job_fingerprint: str,
) -> dict[str, Any] | None:
    result_exists = result_path.exists() or result_path.is_symlink()
    receipt_exists = receipt_path.exists() or receipt_path.is_symlink()
    if not result_exists and not receipt_exists:
        return None
    if not result_exists:
        return None
    if not receipt_exists:
        raise ValueError("published ASR result has no matching work receipt")
    result = cast(
        dict[str, Any], AsrJobResultDocument.model_validate(_load_json_strict(result_path)).root
    )
    receipt = _load_json_strict(receipt_path)
    if (
        receipt.get("schema_version") != "videoforge.transcription-work-receipt/v1"
        or receipt.get("job_fingerprint") != job_fingerprint
    ):
        raise ValueError("published ASR result belongs to different work")
    transcript = result.get("transcript")
    if result.get("status") != "SUCCEEDED" or not isinstance(transcript, dict):
        raise ValueError("only successful ASR work is replayable")
    if receipt.get("transcript_sha256") != _canonical_hash(transcript):
        raise ValueError("published ASR transcript does not match its receipt")
    return result


def _write_result(path: Path, result: Mapping[str, object]) -> None:
    temporary_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")

    def existing_matches() -> bool:
        if path.is_symlink() or not path.is_file():
            return False

        def reject_duplicates(pairs: list[tuple[str, object]]) -> dict[str, object]:
            parsed: dict[str, object] = {}
            for key, value in pairs:
                if key in parsed:
                    raise ValueError("duplicate ASR result property")
                parsed[key] = value
            return parsed

        def reject_constant(value: str) -> None:
            raise ValueError(f"non-finite ASR result constant {value}")

        try:
            existing = json.loads(
                path.read_text(encoding="utf-8"),
                object_pairs_hook=reject_duplicates,
                parse_constant=reject_constant,
            )
        except (json.JSONDecodeError, OSError, UnicodeError, ValueError):
            return False
        return existing == result

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() or path.is_symlink():
            if existing_matches():
                return
            raise FileExistsError("ASR result URI already contains a different document")
        payload = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        with temporary_path.open("x", encoding="utf-8") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary_path, path)
        except FileExistsError:
            if not existing_matches():
                raise FileExistsError(
                    "ASR result URI was published concurrently with different content"
                ) from None
    except OSError as error:
        raise OSError("ASR result could not be published atomically") from error
    finally:
        _cleanup_paths(temporary_path)


def _cleanup_paths(*paths: Path) -> None:
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            continue

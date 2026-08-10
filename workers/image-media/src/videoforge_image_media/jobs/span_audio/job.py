from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from collections.abc import Mapping
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any

from .ports import ArtifactResolver, CancellationProbe, NeverCancelled, ProcessResult, ProcessRunner

_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_OBJECT_URI = re.compile(
    r"^vf-local://objects/sha256/(?P<prefix>[0-9a-f]{2})/"
    r"(?P<digest>[0-9a-f]{64})\.(?P<extension>[a-z0-9]{1,10})$"
)
_RUN_URI = re.compile(
    r"^vf-local-run://(?P<revision>[A-Za-z0-9][A-Za-z0-9._:-]{0,159})/"
    r"(?P<attempt>[A-Za-z0-9][A-Za-z0-9._:-]{0,159})/span-audio-result\.json$"
)
_TASK_KEY = re.compile(r"^[^\x00-\x1f\x7f]{1,240}$")
_ZERO_SHA256 = "sha256:" + ("0" * 64)

_ERRORS: dict[str, tuple[str, bool]] = {
    "SPAN_INPUT_INVALID": ("The selected span-audio input is invalid.", False),
    "SPAN_SOURCE_HASH_MISMATCH": (
        "The source voiceover bytes do not match the selected span lineage.",
        False,
    ),
    "SPAN_SOURCE_DECODE_FAILED": ("The selected source voiceover could not be decoded.", False),
    "SPAN_TOOL_MISSING": ("A required pinned local audio executable is unavailable.", False),
    "SPAN_PROCESS_FAILED": ("The selected span audio could not be materialized.", True),
    "SPAN_OUTPUT_INVALID": ("The materialized span audio did not pass exact validation.", False),
    "SPAN_CANCELLED": ("The selected span-audio attempt was cancelled.", False),
}


def _mapping(value: object, keys: set[str], label: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping) or set(value) != keys:
        raise ValueError(f"{label} has invalid fields")
    return value


def _text(value: object, label: str, *, maximum: int = 240) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise ValueError(f"{label} is invalid")
    return value


def _identifier(value: object, label: str) -> str:
    result = _text(value, label, maximum=160)
    if _ID.fullmatch(result) is None:
        raise ValueError(f"{label} is invalid")
    return result


def _task_key(value: object) -> str:
    result = _text(value, "task key")
    if _TASK_KEY.fullmatch(result) is None or result.strip() != result:
        raise ValueError("task key is invalid")
    return result


def _sha256(value: object, label: str) -> str:
    result = _text(value, label, maximum=71)
    if _SHA256.fullmatch(result) is None:
        raise ValueError(f"{label} is invalid")
    return result


def _integer(value: object, label: str, *, minimum: int = 0, maximum: int = 3_600_000) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"{label} is invalid")
    return value


def _validate_document(document: object) -> dict[str, Any]:
    root = _mapping(
        document,
        {
            "schema_version",
            "project_revision_id",
            "attempt_id",
            "timeline_plan_id",
            "transcript_id",
            "span_id",
            "timeline_segment_id",
            "task_key",
            "source_voiceover",
            "selection",
            "output",
            "cancel_token",
        },
        "selected span job",
    )
    if root["schema_version"] != "selected-span-audio-job/v1":
        raise ValueError("unsupported selected span job schema")
    source = _mapping(
        root["source_voiceover"],
        {"asset_id", "sha256", "artifact_uri", "duration_ms"},
        "source voiceover",
    )
    selection = _mapping(
        root["selection"],
        {
            "selected_start_ms",
            "selected_end_ms_exclusive",
            "padded_start_ms",
            "padded_end_ms_exclusive",
            "trim_start_ms",
            "trim_end_ms_exclusive",
        },
        "selection",
    )
    output = _mapping(root["output"], {"asset_id", "result_uri"}, "output")

    revision_id = _identifier(root["project_revision_id"], "project revision ID")
    attempt_id = _identifier(root["attempt_id"], "attempt ID")
    result_uri = _text(output["result_uri"], "result URI", maximum=600)
    run_match = _RUN_URI.fullmatch(result_uri)
    if (
        run_match is None
        or run_match.group("revision") != revision_id
        or run_match.group("attempt") != attempt_id
    ):
        raise ValueError("result URI does not match the revision and attempt")

    source_hash = _sha256(source["sha256"], "source SHA-256")
    source_uri = _text(source["artifact_uri"], "source URI", maximum=600)
    source_match = _OBJECT_URI.fullmatch(source_uri)
    if (
        source_match is None
        or source_match.group("prefix") != source_match.group("digest")[:2]
        or source_hash != f"sha256:{source_match.group('digest')}"
    ):
        raise ValueError("source URI does not match its SHA-256")

    duration_ms = _integer(source["duration_ms"], "source duration", minimum=10_000)
    selected_start = _integer(selection["selected_start_ms"], "selected start")
    selected_end = _integer(selection["selected_end_ms_exclusive"], "selected end", minimum=1)
    padded_start = _integer(selection["padded_start_ms"], "padded start")
    padded_end = _integer(selection["padded_end_ms_exclusive"], "padded end", minimum=1)
    trim_start = _integer(selection["trim_start_ms"], "trim start")
    trim_end = _integer(selection["trim_end_ms_exclusive"], "trim end", minimum=1)
    if not (
        padded_start <= selected_start < selected_end <= padded_end <= duration_ms
        and trim_start == selected_start - padded_start
        and trim_end == trim_start + selected_end - selected_start
    ):
        raise ValueError("selected and padded span boundaries are inconsistent")

    return {
        "schema_version": "selected-span-audio-job/v1",
        "project_revision_id": revision_id,
        "attempt_id": attempt_id,
        "timeline_plan_id": _identifier(root["timeline_plan_id"], "timeline plan ID"),
        "transcript_id": _identifier(root["transcript_id"], "transcript ID"),
        "span_id": _identifier(root["span_id"], "span ID"),
        "timeline_segment_id": _identifier(root["timeline_segment_id"], "timeline segment ID"),
        "task_key": _task_key(root["task_key"]),
        "source_voiceover": {
            "asset_id": _identifier(source["asset_id"], "source asset ID"),
            "sha256": source_hash,
            "artifact_uri": source_uri,
            "duration_ms": duration_ms,
        },
        "selection": {
            "selected_start_ms": selected_start,
            "selected_end_ms_exclusive": selected_end,
            "padded_start_ms": padded_start,
            "padded_end_ms_exclusive": padded_end,
            "trim_start_ms": trim_start,
            "trim_end_ms_exclusive": trim_end,
        },
        "output": {
            "asset_id": _identifier(output["asset_id"], "output asset ID"),
            "result_uri": result_uri,
        },
        "cancel_token": _text(root["cancel_token"], "cancel token", maximum=240),
    }


def _file_sha256(path: Path, should_cancel: Any) -> str | None:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            if should_cancel():
                return None
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def _safe_path(path: object, suffix: str | None = None) -> bool:
    return (
        isinstance(path, Path) and path.is_absolute() and (suffix is None or path.suffix == suffix)
    )


def _tool_path(path: Path) -> bool:
    return _safe_path(path) and not path.is_symlink() and path.is_file()


def _seconds(milliseconds: int) -> str:
    return f"{milliseconds / 1000:.3f}"


def _ffmpeg_arguments(
    ffmpeg: Path,
    source: Path,
    output: Path,
    padded_start_ms: int,
    padded_end_ms: int,
) -> tuple[str, ...]:
    return (
        str(ffmpeg),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-ss",
        _seconds(padded_start_ms),
        "-t",
        _seconds(padded_end_ms - padded_start_ms),
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
        "-bitexact",
        "-fflags",
        "+bitexact",
        str(output),
    )


def _ffprobe_arguments(ffprobe: Path, output: Path) -> tuple[str, ...]:
    return (
        str(ffprobe),
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=codec_name,sample_rate,channels,duration:format=duration",
        "-of",
        "json",
        str(output),
    )


def _probe(stdout: str) -> tuple[int, int, int]:
    try:
        document = json.loads(stdout)
        stream = document["streams"][0]
        media_format = document.get("format", {})
        duration = stream.get("duration", media_format.get("duration"))
        duration_ms = int((Decimal(str(duration)) * 1000).to_integral_value(rounding=ROUND_HALF_UP))
        sample_rate = int(stream["sample_rate"])
        channels = int(stream["channels"])
    except (
        KeyError,
        IndexError,
        TypeError,
        ValueError,
        InvalidOperation,
        json.JSONDecodeError,
    ) as error:
        raise ValueError("invalid span audio probe") from error
    if stream.get("codec_name") != "pcm_s16le" or sample_rate != 16000 or channels != 1:
        raise ValueError("span audio output profile mismatch")
    return duration_ms, sample_rate, channels


def _failure(
    document: Mapping[str, Any] | None, code: str, status: str = "FAILED"
) -> dict[str, Any]:
    message, retryable = _ERRORS[code]
    return {
        "schema_version": "selected-span-audio-result/v1",
        "attempt_id": document["attempt_id"] if document is not None else "attempt_invalid",
        "status": status,
        "span_id": document["span_id"] if document is not None else "span_invalid",
        "timeline_plan_id": document["timeline_plan_id"]
        if document is not None
        else "plan_invalid",
        "transcript_id": document["transcript_id"]
        if document is not None
        else "transcript_invalid",
        "timeline_segment_id": (
            document["timeline_segment_id"] if document is not None else "segment_invalid"
        ),
        "task_key": document["task_key"] if document is not None else "span:invalid",
        "source_voiceover": (
            {
                "asset_id": document["source_voiceover"]["asset_id"],
                "sha256": document["source_voiceover"]["sha256"],
                "duration_ms": document["source_voiceover"]["duration_ms"],
            }
            if document is not None
            else {"asset_id": "asset_invalid", "sha256": _ZERO_SHA256, "duration_ms": 10000}
        ),
        "selection": document["selection"] if document is not None else None,
        "audio": None,
        "error": {"code": code, "message": message, "retryable": retryable},
    }


def _write_result(path: Path, result: Mapping[str, object]) -> None:
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")

    def existing_matches() -> bool:
        if path.is_symlink() or not path.is_file():
            return False

        def reject_duplicates(pairs: list[tuple[str, object]]) -> dict[str, object]:
            parsed: dict[str, object] = {}
            for key, value in pairs:
                if key in parsed:
                    raise ValueError("duplicate span result property")
                parsed[key] = value
            return parsed

        def reject_constant(value: str) -> None:
            raise ValueError(f"non-finite span result constant {value}")

        try:
            return (
                json.loads(
                    path.read_text(encoding="utf-8"),
                    object_pairs_hook=reject_duplicates,
                    parse_constant=reject_constant,
                )
                == result
            )
        except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
            return False

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() or path.is_symlink():
            if existing_matches():
                return
            raise FileExistsError("span result URI already contains different facts")
        payload = json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        with temporary.open("x", encoding="utf-8") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if not existing_matches():
                raise FileExistsError("span result publication collided") from None
    finally:
        temporary.unlink(missing_ok=True)


class SpanAudioMaterializationJob:
    """Materialize exactly one persisted selected padded span into immutable local PCM WAV."""

    def __init__(
        self,
        *,
        artifacts: ArtifactResolver,
        process: ProcessRunner,
        ffmpeg: Path,
        ffprobe: Path,
        cancellation: CancellationProbe | None = None,
    ) -> None:
        self._artifacts = artifacts
        self._process = process
        self._ffmpeg = ffmpeg
        self._ffprobe = ffprobe
        self._cancellation = cancellation or NeverCancelled()

    def run(self, document: object) -> dict[str, Any]:
        try:
            job = _validate_document(document)
        except (TypeError, ValueError):
            return _failure(None, "SPAN_INPUT_INVALID")
        result_path: Path | None = None
        try:
            result_path = self._artifacts.resolve_run(job["output"]["result_uri"])
        except (OSError, ValueError):
            return _failure(job, "SPAN_OUTPUT_INVALID")
        if not _safe_path(result_path, ".json"):
            return _failure(job, "SPAN_OUTPUT_INVALID")

        token = job["cancel_token"]

        def cancelled() -> bool:
            try:
                return self._cancellation.is_cancelled(token)
            except Exception:
                return True

        if cancelled():
            result = _failure(job, "SPAN_CANCELLED", "CANCELLED")
            _write_result(result_path, result)
            return result
        if not _tool_path(self._ffmpeg) or not _tool_path(self._ffprobe):
            result = _failure(job, "SPAN_TOOL_MISSING")
            _write_result(result_path, result)
            return result
        try:
            source_path = self._artifacts.resolve_object(job["source_voiceover"]["artifact_uri"])
        except (FileNotFoundError, OSError, ValueError):
            result = _failure(job, "SPAN_SOURCE_DECODE_FAILED")
            _write_result(result_path, result)
            return result
        if not _safe_path(source_path) or source_path.is_symlink() or not source_path.is_file():
            result = _failure(job, "SPAN_SOURCE_DECODE_FAILED")
            _write_result(result_path, result)
            return result
        try:
            source_hash = _file_sha256(source_path, cancelled)
        except OSError:
            source_hash = None
        if cancelled():
            result = _failure(job, "SPAN_CANCELLED", "CANCELLED")
            _write_result(result_path, result)
            return result
        if source_hash != job["source_voiceover"]["sha256"]:
            result = _failure(job, "SPAN_SOURCE_HASH_MISMATCH")
            _write_result(result_path, result)
            return result

        audio_path = result_path.with_name(f".{result_path.stem}.wav")
        audio_path.unlink(missing_ok=True)
        selection = job["selection"]
        try:
            rendered = self._process.run(
                _ffmpeg_arguments(
                    self._ffmpeg,
                    source_path,
                    audio_path,
                    selection["padded_start_ms"],
                    selection["padded_end_ms_exclusive"],
                ),
                should_cancel=cancelled,
            )
        except Exception:
            rendered = ProcessResult(return_code=-1, launch_error="failed")
        if rendered.cancelled or cancelled():
            audio_path.unlink(missing_ok=True)
            result = _failure(job, "SPAN_CANCELLED", "CANCELLED")
            _write_result(result_path, result)
            return result
        if rendered.launch_error == "missing":
            code = "SPAN_TOOL_MISSING"
        elif rendered.return_code != 0:
            code = (
                "SPAN_SOURCE_DECODE_FAILED"
                if "decode" in rendered.stderr.casefold()
                else "SPAN_PROCESS_FAILED"
            )
        elif not audio_path.is_file() or audio_path.stat().st_size <= 44:
            code = "SPAN_OUTPUT_INVALID"
        else:
            code = ""
        if code:
            audio_path.unlink(missing_ok=True)
            result = _failure(job, code)
            _write_result(result_path, result)
            return result

        try:
            probed = self._process.run(
                _ffprobe_arguments(self._ffprobe, audio_path),
                should_cancel=cancelled,
            )
        except Exception:
            probed = ProcessResult(return_code=-1, launch_error="failed")
        expected_duration = selection["padded_end_ms_exclusive"] - selection["padded_start_ms"]
        try:
            duration_ms, sample_rate, channels = _probe(probed.stdout)
        except ValueError:
            duration_ms, sample_rate, channels = -1, -1, -1
        cancelled_after_probe = probed.cancelled or cancelled()
        if cancelled_after_probe or probed.return_code != 0 or duration_ms != expected_duration:
            audio_path.unlink(missing_ok=True)
            result = _failure(
                job,
                "SPAN_CANCELLED" if cancelled_after_probe else "SPAN_OUTPUT_INVALID",
                "CANCELLED" if cancelled_after_probe else "FAILED",
            )
            _write_result(result_path, result)
            return result

        output_hash = _file_sha256(audio_path, cancelled)
        if output_hash is None or cancelled():
            audio_path.unlink(missing_ok=True)
            result = _failure(job, "SPAN_CANCELLED", "CANCELLED")
            _write_result(result_path, result)
            return result
        try:
            artifact_uri = self._artifacts.publish_object(audio_path, output_hash, "wav")
            byte_size = audio_path.stat().st_size
        except (OSError, ValueError):
            audio_path.unlink(missing_ok=True)
            result = _failure(job, "SPAN_OUTPUT_INVALID")
            _write_result(result_path, result)
            return result
        finally:
            audio_path.unlink(missing_ok=True)
        if cancelled():
            result = _failure(job, "SPAN_CANCELLED", "CANCELLED")
            _write_result(result_path, result)
            return result

        result = {
            "schema_version": "selected-span-audio-result/v1",
            "attempt_id": job["attempt_id"],
            "status": "SUCCEEDED",
            "span_id": job["span_id"],
            "timeline_plan_id": job["timeline_plan_id"],
            "transcript_id": job["transcript_id"],
            "timeline_segment_id": job["timeline_segment_id"],
            "task_key": job["task_key"],
            "source_voiceover": {
                "asset_id": job["source_voiceover"]["asset_id"],
                "sha256": job["source_voiceover"]["sha256"],
                "duration_ms": job["source_voiceover"]["duration_ms"],
            },
            "selection": selection,
            "audio": {
                "asset_id": job["output"]["asset_id"],
                "sha256": output_hash,
                "artifact_uri": artifact_uri,
                "content_type": "audio/wav",
                "byte_size": byte_size,
                "duration_ms": duration_ms,
                "sample_rate_hz": sample_rate,
                "channels": channels,
            },
            "error": None,
        }
        _write_result(result_path, result)
        return result

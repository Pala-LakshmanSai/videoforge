"""Provider-free V2-08 SoulX Serverless-v3 whole-span batch boundary.

The handler deliberately contains no endpoint lifecycle or provider control code.  It accepts one
already-authorized ``soulx_avatar`` batch, reads exact tenant-scoped ports, prepares SoulX's 16 kHz
input in attempt-local scratch, emits one native clip per unresolved span, and signs the application
provenance receipt.  Full and split compositions consume the same native clip downstream.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import math
import os
import re
import subprocess
import time
import wave
from array import array
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from soulx_runtime import SoulXRuntime
from soulx_volume import EXPECTED_WARMUP_FACTS, verify_volume, warmup_attestation_sha256
from secure_scratch import ScratchIsolationError, soulx_worker_io, validate_scoped_port
from serverless_envelope import (
    EnvelopeRejection,
    restricted_canonical_sha256,
    request_body_from_payload,
    sign_receipt,
    validate_envelope,
)


class ServerlessSoulXError(RuntimeError):
    pass


_runtime: SoulXRuntime | None = None
_startup_lock = asyncio.Lock()
_delivery_lock = asyncio.Lock()
_claimed_deliveries: set[str] = set()

_BATCH_SCHEMA = "videoforge-soulx-span-batch/v1"
_RESUME_SCHEMA = "serverless-unit-resume/v1"
_GENERATED_OUTPUT_SCHEMA = "artifact-generated-output-authority/v1"
_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_FAILURE_CODE = re.compile(r"^[A-Z][A-Z0-9_.:-]{2,120}$")
_CAPABILITY = re.compile(r"^[A-Za-z0-9._:-]{32,512}$")
_MAX_BATCH_ITEMS = 128
_MAX_INPUT_BYTES = 512 * 1024 * 1024
_MAX_OUTPUT_BYTES = 128 * 1024 * 1024
_QUALIFICATION_INVALID_OUTPUT_PROBE = "SOULX_INVALID_OUTPUT_CONTRACT_V1"
_QUALIFICATION_TIMEOUT_PROBE = "RUNPOD_EXECUTION_TIMEOUT_V1"
_QUALIFICATION_INVALID_ATTEMPT = re.compile(r"^v213-soulx-invalid-output-[0-9a-f]{12}$")
_QUALIFICATION_TIMEOUT_ATTEMPT = re.compile(r"^v213-soulx-timeout-[0-9a-f]{12}$")
_QUALIFICATION_TIMEOUT_DELAY_SECONDS = 30


async def _run_sealed_qualification_probe(
    payload: dict[str, Any], *, accepted: dict[str, Any]
) -> None:
    """Exercise only exact signed SoulX negative cases after all port validation."""

    marker = payload.get("qualification_probe")
    work = accepted.get("work")
    runtime = accepted.get("runtime")
    attempt_id = work.get("attempt_id") if isinstance(work, dict) else None
    expected = None
    if isinstance(attempt_id, str):
        if _QUALIFICATION_INVALID_ATTEMPT.fullmatch(attempt_id):
            expected = _QUALIFICATION_INVALID_OUTPUT_PROBE
        elif _QUALIFICATION_TIMEOUT_ATTEMPT.fullmatch(attempt_id):
            expected = _QUALIFICATION_TIMEOUT_PROBE
    signed_probe = (
        isinstance(work, dict)
        and isinstance(runtime, dict)
        and expected is not None
        and work.get("lane") == "soulx_avatar"
        and work.get("task_id") == "soulx-live-qualification"
        and work.get("item_count") == 1
        and runtime.get("endpoint_profile_id") == "soulx-serverless-v1"
    )
    if marker is None and expected is None:
        return
    if marker != expected or not signed_probe:
        raise ServerlessSoulXError("SOULX_SERVERLESS_QUALIFICATION_PROBE_INVALID")
    if marker == _QUALIFICATION_TIMEOUT_PROBE:
        await asyncio.sleep(_QUALIFICATION_TIMEOUT_DELAY_SECONDS)
        raise TimeoutError("SOULX_SERVERLESS_TIMEOUT_PROBE_NOT_TERMINATED")
    raise ServerlessSoulXError("SOULX_OUTPUT_CONTRACT_INVALID")


def _canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")


def _digest(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def _required(value: Any, key: str) -> dict[str, Any]:
    if not isinstance(value, dict) or not isinstance(value.get(key), dict):
        raise ServerlessSoulXError("SOULX_SERVERLESS_JOB_SHAPE_INVALID")
    return value[key]


def _expect_identifier(value: object, code: str) -> str:
    if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
        raise ServerlessSoulXError(code)
    return value


def _expect_sha256(value: object, code: str) -> str:
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise ServerlessSoulXError(code)
    return value


def _environment(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ServerlessSoulXError(f"SOULX_SERVERLESS_{name}_MISSING")
    return value


def _authority_expectations(envelope: dict[str, Any]) -> dict[str, str]:
    tenant = envelope.get("tenant") if isinstance(envelope.get("tenant"), dict) else {}
    runtime = envelope.get("runtime") if isinstance(envelope.get("runtime"), dict) else {}
    # Tenant identity is signed per dispatch.  A shared endpoint must never be configured for one
    # account/workspace; doing so would make the production lane unusable by every other tenant.
    deployment_scope = os.environ.get("VIDEOFORGE_SOULX_DEPLOYMENT_ID")
    return {
        "expected_account_id": str(tenant.get("account_id", "")),
        "expected_workspace_id": str(tenant.get("workspace_id", "")),
        "expected_deployment_id": deployment_scope or str(runtime.get("deployment_id", "")),
        "expected_container_digest": _expect_sha256(
            _environment("VIDEOFORGE_SOULX_CONTAINER_DIGEST"),
            "SOULX_SERVERLESS_CONTAINER_DIGEST_INVALID",
        ),
        "expected_model_manifest_sha256": _expect_sha256(
            _environment("VIDEOFORGE_SOULX_MODEL_MANIFEST_SHA256"),
            "SOULX_SERVERLESS_MODEL_MANIFEST_INVALID",
        ),
        "expected_volume_id_sha256": _expect_sha256(
            _environment("VIDEOFORGE_SOULX_VOLUME_ID_SHA256"),
            "SOULX_SERVERLESS_VOLUME_ID_INVALID",
        ),
    }


def _signed_dispatch_timings(
    accepted: dict[str, Any], *, handler_started_epoch: float, runtime_ready_epoch: float
) -> tuple[int, int]:
    issued_at = accepted.get("limits", {}).get("issued_at")
    if not isinstance(issued_at, str):
        raise ServerlessSoulXError("SOULX_SERVERLESS_TIMING_ISSUED_AT_INVALID")
    try:
        issued_epoch = datetime.fromisoformat(issued_at.replace("Z", "+00:00")).timestamp()
    except ValueError as error:
        raise ServerlessSoulXError("SOULX_SERVERLESS_TIMING_ISSUED_AT_INVALID") from error
    allocation_ms = round((handler_started_epoch - issued_epoch) * 1000)
    container_ready_ms = round((runtime_ready_epoch - issued_epoch) * 1000)
    if allocation_ms < 0 or container_ready_ms < allocation_ms or container_ready_ms > 86_400_000:
        raise ServerlessSoulXError("SOULX_SERVERLESS_TIMING_ORDER_INVALID")
    return allocation_ms, container_ready_ms


def _observed_gpu(runtime_health: dict[str, Any]) -> dict[str, object]:
    gpu = runtime_health.get("gpu")
    if not isinstance(gpu, dict):
        raise ServerlessSoulXError("SOULX_SERVERLESS_GPU_NOT_QUALIFIED")
    # The production image already imports torch through SoulXRuntime.  Tests may provide the same
    # two observed fields directly, but neither path supplies a default.
    torch_module = os.sys.modules.get("torch")
    if torch_module is not None:
        try:
            count = int(torch_module.cuda.device_count())
            name = str(torch_module.cuda.get_device_name(0)) if count == 1 else ""
        except Exception as error:
            raise ServerlessSoulXError("SOULX_SERVERLESS_GPU_NOT_QUALIFIED") from error
    else:
        count = gpu.get("count")
        name = gpu.get("name")
    if count != 1 or name != "NVIDIA GeForce RTX 4090":
        raise ServerlessSoulXError("SOULX_SERVERLESS_GPU_NOT_QUALIFIED")
    total_vram_bytes = gpu.get("vram_bytes")
    if not isinstance(total_vram_bytes, int) or total_vram_bytes <= 0:
        raise ServerlessSoulXError("SOULX_SERVERLESS_GPU_NOT_QUALIFIED")
    return {"name": name, "count": count, "total_vram_bytes": total_vram_bytes}


def _validate_url(value: object) -> str:
    if not isinstance(value, str) or len(value) > 8_192:
        raise ServerlessSoulXError("SOULX_SERVERLESS_ARTIFACT_URL_INVALID")
    try:
        parsed = urlsplit(value)
    except ValueError as error:
        raise ServerlessSoulXError("SOULX_SERVERLESS_ARTIFACT_URL_INVALID") from error
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.fragment
        or any(ord(character) < 32 for character in value)
    ):
        raise ServerlessSoulXError("SOULX_SERVERLESS_ARTIFACT_URL_INVALID")
    return value


def _validate_batch(value: object, accepted: dict[str, Any]) -> tuple[dict[str, Any], ...]:
    if not isinstance(value, dict) or set(value) != {
        "schema_version",
        "attempt_id",
        "avatar_source",
        "spans",
    }:
        raise ServerlessSoulXError("SOULX_SERVERLESS_BATCH_INVALID")
    if value["schema_version"] != _BATCH_SCHEMA:
        raise ServerlessSoulXError("SOULX_SERVERLESS_BATCH_SCHEMA_INVALID")
    if value["attempt_id"] != accepted["work"]["attempt_id"]:
        raise ServerlessSoulXError("SOULX_SERVERLESS_ATTEMPT_MISMATCH")
    source = value["avatar_source"]
    if not isinstance(source, dict) or set(source) != {
        "asset_id",
        "sha256",
        "port_reservation_id",
    }:
        raise ServerlessSoulXError("SOULX_SERVERLESS_SOURCE_INVALID")
    _expect_identifier(source["asset_id"], "SOULX_SERVERLESS_SOURCE_INVALID")
    _expect_identifier(source["port_reservation_id"], "SOULX_SERVERLESS_SOURCE_INVALID")
    _expect_sha256(source["sha256"], "SOULX_SERVERLESS_SOURCE_INVALID")
    raw_spans = value["spans"]
    if not isinstance(raw_spans, list) or not 1 <= len(raw_spans) <= _MAX_BATCH_ITEMS:
        raise ServerlessSoulXError("SOULX_SERVERLESS_SPAN_COUNT_INVALID")
    spans: list[dict[str, Any]] = []
    item_ids: set[str] = set()
    for raw in raw_spans:
        if not isinstance(raw, dict) or set(raw) != {
            "item_id",
            "audio_asset_id",
            "audio_sha256",
            "audio_port_reservation_id",
            "output_reservation_id",
            "padded_samples_48k",
            "trim_start_sample_48k",
            "trim_end_sample_exclusive_48k",
        }:
            raise ServerlessSoulXError("SOULX_SERVERLESS_SPAN_INVALID")
        item_id = _expect_identifier(raw["item_id"], "SOULX_SERVERLESS_SPAN_INVALID")
        if item_id in item_ids:
            raise ServerlessSoulXError("SOULX_SERVERLESS_SPAN_DUPLICATE")
        item_ids.add(item_id)
        for key in ("audio_asset_id", "audio_port_reservation_id", "output_reservation_id"):
            _expect_identifier(raw[key], "SOULX_SERVERLESS_SPAN_INVALID")
        _expect_sha256(raw["audio_sha256"], "SOULX_SERVERLESS_SPAN_INVALID")
        padded = raw["padded_samples_48k"]
        trim_start = raw["trim_start_sample_48k"]
        trim_end = raw["trim_end_sample_exclusive_48k"]
        if any(
            isinstance(number, bool) or not isinstance(number, int)
            for number in (padded, trim_start, trim_end)
        ):
            raise ServerlessSoulXError("SOULX_SERVERLESS_SPAN_INVALID")
        selected = trim_end - trim_start
        # SoulX's native cadence is 25 fps: 48,000 / 25 = 1,920 exact source samples/frame.
        if (
            not 0 <= trim_start < trim_end <= padded
            or selected % 1_920 != 0
            or not 96_000 <= selected <= 480_000
            or padded % 3 != 0
            or trim_start % 3 != 0
            or trim_end % 3 != 0
            or not 144_000 <= padded <= 485_760
        ):
            raise ServerlessSoulXError("SOULX_SERVERLESS_SPAN_TRIM_INVALID")
        spans.append(dict(raw))
    return tuple(spans)


def _validate_generated_authority(
    value: object, *, accepted: dict[str, Any], span: dict[str, Any]
) -> dict[str, Any]:
    keys = {
        "schema_version",
        "reservation_id",
        "account_id",
        "workspace_id",
        "method",
        "path",
        "content_type",
        "max_content_length",
        "expires_at",
        "max_uses",
        "capability_handle",
    }
    if not isinstance(value, dict) or set(value) != keys:
        raise ServerlessSoulXError("SOULX_SERVERLESS_OUTPUT_AUTHORITY_INVALID")
    if (
        value["schema_version"] != _GENERATED_OUTPUT_SCHEMA
        or value["reservation_id"] != span["output_reservation_id"]
        or value["account_id"] != accepted["tenant"]["account_id"]
        or value["workspace_id"] != accepted["tenant"]["workspace_id"]
        or value["method"] != "PUT"
        or value["content_type"] != "video/mp4"
        or value["max_uses"] != 1
        or not isinstance(value["max_content_length"], int)
        or not 1 <= value["max_content_length"] <= _MAX_OUTPUT_BYTES
        or not isinstance(value["capability_handle"], str)
        or not _CAPABILITY.fullmatch(value["capability_handle"])
    ):
        raise ServerlessSoulXError("SOULX_SERVERLESS_OUTPUT_AUTHORITY_INVALID")
    expected = f"/{accepted['artifacts']['output_prefix']}/artifact/{span['item_id']}"
    if value["path"] != expected:
        raise ServerlessSoulXError("SOULX_SERVERLESS_OUTPUT_PATH_MISMATCH")
    try:
        expires = datetime.fromisoformat(str(value["expires_at"]).replace("Z", "+00:00"))
    except ValueError as error:
        raise ServerlessSoulXError("SOULX_SERVERLESS_OUTPUT_AUTHORITY_INVALID") from error
    if expires.tzinfo is None or datetime.now(UTC) >= expires.astimezone(UTC):
        raise ServerlessSoulXError("SOULX_SERVERLESS_OUTPUT_AUTHORITY_EXPIRED")
    return value


def _fetch_exact(port: dict[str, Any], url: str, worker_io: Any) -> Path:
    expected = port["content_length"]
    if not 1 <= expected <= _MAX_INPUT_BYTES:
        raise ServerlessSoulXError("SOULX_SERVERLESS_INPUT_LENGTH_INVALID")
    try:
        with urlopen(Request(_validate_url(url), method="GET"), timeout=60) as response:
            if response.status != 200:
                raise ServerlessSoulXError("SOULX_SERVERLESS_INPUT_DOWNLOAD_FAILED")
            body = response.read(expected + 1)
    except ServerlessSoulXError:
        raise
    except Exception as error:
        raise ServerlessSoulXError("SOULX_SERVERLESS_INPUT_DOWNLOAD_FAILED") from error
    if len(body) != expected or _digest(body) != port["checksum_sha256"]:
        raise ServerlessSoulXError("SOULX_SERVERLESS_INPUT_CHECKSUM_MISMATCH")
    path = worker_io.scratch.safe_path(f"inputs/{port['reservation_id']}.bin")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.write_bytes(body)
    return path


def _put_generated(authority: dict[str, Any], url: str, body: bytes) -> str:
    if not 1 <= len(body) <= authority["max_content_length"]:
        raise ServerlessSoulXError("SOULX_SERVERLESS_OUTPUT_LENGTH_INVALID")
    try:
        request = Request(
            _validate_url(url),
            data=body,
            method="PUT",
            headers={"content-type": "video/mp4", "content-length": str(len(body))},
        )
        with urlopen(request, timeout=60) as response:
            if response.status not in {200, 201, 204}:
                raise ServerlessSoulXError("SOULX_SERVERLESS_OUTPUT_UPLOAD_FAILED")
    except ServerlessSoulXError:
        raise
    except Exception as error:
        raise ServerlessSoulXError("SOULX_SERVERLESS_OUTPUT_UPLOAD_FAILED") from error
    return _digest(body)


def _prepare_audio_16k(source: Path, destination: Path, span: dict[str, Any]) -> dict[str, int]:
    """Validate exact mono PCM16 48 kHz input and decimate it to SoulX's 16 kHz contract."""
    try:
        with wave.open(str(source), "rb") as input_wave:
            if (
                input_wave.getnchannels() != 1
                or input_wave.getsampwidth() != 2
                or input_wave.getframerate() != 48_000
                or input_wave.getcomptype() != "NONE"
            ):
                raise ServerlessSoulXError("SOULX_SERVERLESS_AUDIO_FORMAT_INVALID")
            frame_count = input_wave.getnframes()
            payload = input_wave.readframes(frame_count)
    except (wave.Error, EOFError) as error:
        raise ServerlessSoulXError("SOULX_SERVERLESS_AUDIO_FORMAT_INVALID") from error
    if frame_count != span["padded_samples_48k"]:
        raise ServerlessSoulXError("SOULX_SERVERLESS_AUDIO_DURATION_MISMATCH")
    samples = array("h")
    samples.frombytes(payload)
    if os.sys.byteorder != "little":
        samples.byteswap()
    resampled = samples[::3]
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with wave.open(str(destination), "wb") as output_wave:
        output_wave.setnchannels(1)
        output_wave.setsampwidth(2)
        output_wave.setframerate(16_000)
        if os.sys.byteorder != "little":
            resampled.byteswap()
        output_wave.writeframes(resampled.tobytes())
    return {
        "input_sample_rate_hz": 48_000,
        "runtime_sample_rate_hz": 16_000,
        "padded_samples_48k": frame_count,
        "runtime_samples_16k": len(resampled),
        "trim_start_sample_48k": span["trim_start_sample_48k"],
        "trim_end_sample_exclusive_48k": span["trim_end_sample_exclusive_48k"],
        "trim_start_frame_25fps": span["trim_start_sample_48k"] // 1_920,
        "trim_end_frame_exclusive_25fps": span["trim_end_sample_exclusive_48k"] // 1_920,
    }


def _trim_native_mp4(source: bytes, destination: Path, span: dict[str, Any]) -> bytes:
    source_path = destination.with_suffix(".padded.mp4")
    source_path.write_bytes(source)
    start_frame = span["trim_start_sample_48k"] // 1_920
    end_frame = span["trim_end_sample_exclusive_48k"] // 1_920
    start_sample_16k = span["trim_start_sample_48k"] // 3
    end_sample_16k = span["trim_end_sample_exclusive_48k"] // 3
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(source_path),
            "-vf",
            f"trim=start_frame={start_frame}:end_frame={end_frame},setpts=PTS-STARTPTS",
            "-af",
            (
                f"atrim=start_sample={start_sample_16k}:end_sample={end_sample_16k},"
                "asetpts=PTS-STARTPTS"
            ),
            "-r",
            "25",
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            "15",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-frames:v",
            str(end_frame - start_frame),
            "-t",
            f"{(end_frame - start_frame) / 25:.2f}",
            "-shortest",
            str(destination),
        ],
        check=True,
        timeout=300,
    )
    return destination.read_bytes()


def _finite_number(value: object, code: str) -> float:
    try:
        parsed = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as error:
        raise ServerlessSoulXError(code) from error
    if not math.isfinite(parsed):
        raise ServerlessSoulXError(code)
    return parsed


def _parse_rate(value: object) -> tuple[int, int]:
    if not isinstance(value, str) or "/" not in value:
        raise ServerlessSoulXError("SOULX_SERVERLESS_MEDIA_PROBE_INVALID")
    numerator_text, denominator_text = value.split("/", 1)
    try:
        numerator, denominator = int(numerator_text), int(denominator_text)
    except ValueError as error:
        raise ServerlessSoulXError("SOULX_SERVERLESS_MEDIA_PROBE_INVALID") from error
    divisor = math.gcd(numerator, denominator)
    if numerator <= 0 or denominator <= 0:
        raise ServerlessSoulXError("SOULX_SERVERLESS_MEDIA_PROBE_INVALID")
    return numerator // divisor, denominator // divisor


def _parse_native_probe(
    value: object, *, expected_frames: int, expected_duration_ms: int
) -> dict[str, object]:
    if not isinstance(value, dict) or not isinstance(value.get("streams"), list):
        raise ServerlessSoulXError("SOULX_SERVERLESS_MEDIA_PROBE_INVALID")
    streams = value["streams"]
    video = [
        stream
        for stream in streams
        if isinstance(stream, dict) and stream.get("codec_type") == "video"
    ]
    audio = [
        stream
        for stream in streams
        if isinstance(stream, dict) and stream.get("codec_type") == "audio"
    ]
    if len(video) != 1 or len(audio) != 1:
        raise ServerlessSoulXError("SOULX_SERVERLESS_MEDIA_PROBE_INVALID")
    video_stream, audio_stream = video[0], audio[0]
    fps_num, fps_den = _parse_rate(video_stream.get("avg_frame_rate"))
    try:
        width = int(video_stream.get("width"))
        height = int(video_stream.get("height"))
        frame_count = int(video_stream.get("nb_read_frames"))
        sample_rate_hz = int(audio_stream.get("sample_rate"))
        channels = int(audio_stream.get("channels"))
    except (TypeError, ValueError) as error:
        raise ServerlessSoulXError("SOULX_SERVERLESS_MEDIA_PROBE_INVALID") from error
    video_duration_ms = round(
        _finite_number(video_stream.get("duration"), "SOULX_SERVERLESS_MEDIA_PROBE_INVALID") * 1000
    )
    audio_duration_ms = round(
        _finite_number(audio_stream.get("duration"), "SOULX_SERVERLESS_MEDIA_PROBE_INVALID") * 1000
    )
    format_value = value.get("format")
    if not isinstance(format_value, dict):
        raise ServerlessSoulXError("SOULX_SERVERLESS_MEDIA_PROBE_INVALID")
    format_duration_ms = round(
        _finite_number(format_value.get("duration"), "SOULX_SERVERLESS_MEDIA_PROBE_INVALID") * 1000
    )
    av_delta_ms = abs(video_duration_ms - audio_duration_ms)
    if (
        video_stream.get("codec_name") != "h264"
        or audio_stream.get("codec_name") != "aac"
        or width != 512
        or height != 512
        or (fps_num, fps_den) != (25, 1)
        or frame_count != expected_frames
        or sample_rate_hz != 16_000
        or channels != 1
        or abs(video_duration_ms - expected_duration_ms) > 40
        or abs(audio_duration_ms - expected_duration_ms) > 40
        or abs(format_duration_ms - expected_duration_ms) > 40
        or av_delta_ms > 40
    ):
        raise ServerlessSoulXError("SOULX_SERVERLESS_MEDIA_CONTRACT_INVALID")
    return {
        "format": "mp4",
        "video_codec": "h264",
        "audio_codec": "aac",
        "width": width,
        "height": height,
        "fps_num": fps_num,
        "fps_den": fps_den,
        "frame_count": frame_count,
        "duration_ms": format_duration_ms,
        "video_duration_ms": video_duration_ms,
        "audio_duration_ms": audio_duration_ms,
        "av_delta_ms": av_delta_ms,
        "audio_sample_rate_hz": sample_rate_hz,
        "audio_channels": channels,
    }


def _probe_native_mp4(
    path: Path, *, expected_frames: int, expected_duration_ms: int
) -> dict[str, object]:
    ffprobe = Path(os.environ.get("VIDEOFORGE_FFPROBE_PATH", "/usr/bin/ffprobe"))
    if not ffprobe.is_absolute() or not ffprobe.is_file():
        raise ServerlessSoulXError("SOULX_SERVERLESS_FFPROBE_INVALID")
    completed = subprocess.run(
        [
            str(ffprobe),
            "-v",
            "error",
            "-count_frames",
            "-show_entries",
            (
                "stream=codec_type,codec_name,width,height,avg_frame_rate,nb_read_frames,"
                "duration,sample_rate,channels:format=duration"
            ),
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
    )
    try:
        document = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise ServerlessSoulXError("SOULX_SERVERLESS_MEDIA_PROBE_INVALID") from error
    return _parse_native_probe(
        document,
        expected_frames=expected_frames,
        expected_duration_ms=expected_duration_ms,
    )


async def _ready_runtime() -> SoulXRuntime:
    global _runtime
    async with _startup_lock:
        if _runtime is None:
            candidate = SoulXRuntime()
            await asyncio.to_thread(candidate.initialize)
            if candidate.health().get("state") != "ready":
                raise ServerlessSoulXError("SOULX_SERVERLESS_MODEL_NOT_READY")
            _runtime = candidate
    return _runtime


async def _claim_delivery(attempt_id: str) -> None:
    async with _delivery_lock:
        if attempt_id in _claimed_deliveries:
            raise ServerlessSoulXError("SOULX_SERVERLESS_DUPLICATE_DELIVERY")
        _claimed_deliveries.add(attempt_id)


@contextmanager
def _terminal_worker_io(**kwargs: object) -> Iterator[Any]:
    """Scrub attempt scratch with the exact terminal classification."""
    worker_io = soulx_worker_io(**kwargs)
    worker_io.__enter__()
    try:
        yield worker_io
    except asyncio.CancelledError:
        worker_io.scratch.cleanup("CANCEL")
        raise
    except TimeoutError:
        worker_io.scratch.cleanup("TIMEOUT")
        raise
    except BaseException:
        worker_io.scratch.cleanup("FAILURE")
        raise
    else:
        worker_io.scratch.cleanup("SUCCESS")


def _validate_resume(
    payload: dict[str, Any], accepted: dict[str, Any], spans: tuple[dict[str, Any], ...]
) -> tuple[dict[str, Any], ...]:
    resume = payload.get("resume")
    if resume is None:
        return ()
    canonical = payload.get("resume_canonical_json")
    expected_hash = accepted["artifacts"].get("resume_manifest_sha256")
    if (
        not isinstance(resume, dict)
        or set(resume) != {"schema_version", "plan_manifest_sha256", "accepted_units"}
        or resume.get("schema_version") != _RESUME_SCHEMA
        or not isinstance(canonical, str)
        or _digest(canonical.encode("utf-8")) != expected_hash
    ):
        raise ServerlessSoulXError("SOULX_SERVERLESS_RESUME_INVALID")
    try:
        if json.loads(canonical) != resume:
            raise ServerlessSoulXError("SOULX_SERVERLESS_RESUME_INVALID")
    except json.JSONDecodeError as error:
        raise ServerlessSoulXError("SOULX_SERVERLESS_RESUME_INVALID") from error
    if resume["plan_manifest_sha256"] != accepted["artifacts"].get("plan_manifest_sha256"):
        raise ServerlessSoulXError("SOULX_SERVERLESS_RESUME_PLAN_MISMATCH")
    by_id = {span["item_id"]: span for span in spans}
    units = resume["accepted_units"]
    if not isinstance(units, list):
        raise ServerlessSoulXError("SOULX_SERVERLESS_RESUME_INVALID")
    accepted_units: list[dict[str, Any]] = []
    seen: set[str] = set()
    for unit in units:
        required = {
            "item_id",
            "output_sha256",
            "output_bytes",
            "artifact_commit_receipt_sha256",
            "signed_provenance_receipt_sha256",
            "readback_port",
            "readback_get_url",
        }
        if not isinstance(unit, dict) or set(unit) != required:
            raise ServerlessSoulXError("SOULX_SERVERLESS_RESUME_INVALID")
        item_id = unit["item_id"]
        if item_id not in by_id or item_id in seen:
            raise ServerlessSoulXError("SOULX_SERVERLESS_RESUME_ITEM_INVALID")
        seen.add(item_id)
        for key in (
            "output_sha256",
            "artifact_commit_receipt_sha256",
            "signed_provenance_receipt_sha256",
        ):
            _expect_sha256(unit[key], "SOULX_SERVERLESS_RESUME_INVALID")
        if (
            not isinstance(unit["output_bytes"], int)
            or not 1 <= unit["output_bytes"] <= _MAX_OUTPUT_BYTES
        ):
            raise ServerlessSoulXError("SOULX_SERVERLESS_RESUME_INVALID")
        port = unit["readback_port"]
        if not isinstance(port, dict):
            raise ServerlessSoulXError("SOULX_SERVERLESS_RESUME_INVALID")
        path = port.get("path")
        prior_attempt = None
        if isinstance(path, str):
            match = re.search(r"/job/([^/]+)/artifact/([^/]+)$", path)
            if match and match.group(2) == item_id:
                prior_attempt = match.group(1)
        # Resume ports name the prior attempt, but never another tenant, item, or method.
        if (
            prior_attempt is None
            or port.get("content_length") != unit["output_bytes"]
            or port.get("checksum_sha256") != unit["output_sha256"]
        ):
            raise ServerlessSoulXError("SOULX_SERVERLESS_RESUME_SCOPE_MISMATCH")
        try:
            validate_scoped_port(
                port,
                account_id=accepted["tenant"]["account_id"],
                workspace_id=accepted["tenant"]["workspace_id"],
                job_id=prior_attempt,
                method="GET",
                now=datetime.now(UTC),
            )
        except ScratchIsolationError as error:
            raise ServerlessSoulXError("SOULX_SERVERLESS_RESUME_SCOPE_MISMATCH") from error
        accepted_units.append(unit)
    return tuple(accepted_units)


def _verify_resume_readbacks(units: tuple[dict[str, Any], ...]) -> None:
    for unit in units:
        url = _validate_url(unit["readback_get_url"])
        expected = unit["output_bytes"]
        try:
            with urlopen(Request(url, method="GET"), timeout=60) as response:
                body = response.read(expected + 1)
        except Exception as error:
            raise ServerlessSoulXError("SOULX_SERVERLESS_RESUME_READBACK_FAILED") from error
        if len(body) != expected or _digest(body) != unit["output_sha256"]:
            raise ServerlessSoulXError("SOULX_SERVERLESS_RESUME_READBACK_MISMATCH")


async def _generate(runtime: SoulXRuntime, source: bytes, audio: bytes) -> dict[str, Any]:
    generated = await asyncio.to_thread(
        runtime._generate,
        base64.b64encode(source).decode("ascii"),
        base64.b64encode(audio).decode("ascii"),
    )
    if not isinstance(generated, dict) or not isinstance(generated.get("output_base64"), str):
        raise ServerlessSoulXError("SOULX_SERVERLESS_RUNTIME_OUTPUT_INVALID")
    return generated


async def handler(job: dict[str, Any]) -> dict[str, Any]:
    try:
        handler_started_epoch = time.time()
        payload = _required(job, "input")
        envelope = _required(payload, "envelope")
        envelope_sha256 = restricted_canonical_sha256(envelope)
        request_sha256 = restricted_canonical_sha256(request_body_from_payload(payload))
        accepted = validate_envelope(
            envelope,
            now=datetime.now(UTC),
            expected_envelope_key_id=_environment("VIDEOFORGE_ENVELOPE_KEY_ID"),
            expected_envelope_key_sha256=_environment("VIDEOFORGE_ENVELOPE_KEY_SHA256"),
            envelope_secret=bytes.fromhex(_environment("VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX")),
            receipt_secret=bytes.fromhex(_environment("VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX")),
            **_authority_expectations(envelope),
        )
        if accepted["work"]["lane"] != "soulx_avatar":
            raise ServerlessSoulXError("SOULX_SERVERLESS_LANE_INVALID")
        batch = _required(payload, "batch")
        spans = _validate_batch(batch, accepted)
        plan_hash = _digest(_canonical_bytes(batch))
        if (
            accepted["artifacts"].get("plan_manifest_sha256") != plan_hash
            or accepted["work"]["items_manifest_sha256"] != plan_hash
        ):
            raise ServerlessSoulXError("SOULX_SERVERLESS_PLAN_MISMATCH")
        resumed = _validate_resume(payload, accepted, spans)
        _verify_resume_readbacks(resumed)
        resumed_ids = {unit["item_id"] for unit in resumed}
        remaining = tuple(span for span in spans if span["item_id"] not in resumed_ids)
        if not remaining:
            raise ServerlessSoulXError("SOULX_SERVERLESS_NO_UNRESOLVED_ITEMS")
        if accepted["work"]["item_count"] != len(remaining):
            raise ServerlessSoulXError("SOULX_SERVERLESS_ITEM_COUNT_MISMATCH")

        ports = _required(payload, "ports")
        input_ports = ports.get("inputs")
        if not isinstance(input_ports, list) or any(
            not isinstance(port, dict) for port in input_ports
        ):
            raise ServerlessSoulXError("SOULX_SERVERLESS_INPUT_PORTS_INVALID")
        source_port_id = batch["avatar_source"]["port_reservation_id"]
        expected_input_ids = [source_port_id] + [
            span["audio_port_reservation_id"] for span in remaining
        ]
        if [port.get("reservation_id") for port in input_ports] != expected_input_ids:
            raise ServerlessSoulXError("SOULX_SERVERLESS_INPUT_PORTS_INVALID")
        input_urls = payload.get("input_get_urls")
        if not isinstance(input_urls, list) or len(input_urls) != len(input_ports):
            raise ServerlessSoulXError("SOULX_SERVERLESS_INPUT_URLS_INVALID")
        output_authorities = payload.get("generated_output_authorities")
        output_urls = payload.get("output_put_urls")
        if (
            not isinstance(output_authorities, list)
            or not isinstance(output_urls, list)
            or len(output_authorities) != len(remaining)
            or len(output_urls) != len(remaining)
        ):
            raise ServerlessSoulXError("SOULX_SERVERLESS_OUTPUTS_INVALID")
        output_authorities = [
            _validate_generated_authority(authority, accepted=accepted, span=span)
            for authority, span in zip(output_authorities, remaining, strict=True)
        ]
        expected_port_ids = expected_input_ids + [
            authority["reservation_id"] for authority in output_authorities
        ]
        if accepted["artifacts"]["transfer_port_reservation_ids"] != expected_port_ids:
            raise ServerlessSoulXError("SOULX_SERVERLESS_PORT_AUTHORITY_MISMATCH")
        for url in (*input_urls, *output_urls):
            _validate_url(url)

        now = datetime.now(UTC)
        for port in input_ports:
            validate_scoped_port(
                port,
                account_id=accepted["tenant"]["account_id"],
                workspace_id=accepted["tenant"]["workspace_id"],
                job_id=accepted["work"]["attempt_id"],
                method="GET",
                now=now,
            )
            if port.get("max_uses") != 1:
                raise ServerlessSoulXError("SOULX_SERVERLESS_INPUT_PORTS_INVALID")
        if input_ports[0].get("content_type") != "image/png" or any(
            port.get("content_type") != "audio/wav" for port in input_ports[1:]
        ):
            raise ServerlessSoulXError("SOULX_SERVERLESS_INPUT_CONTENT_TYPE_INVALID")
        # The extra marker is request-hashed; the authenticated envelope supplies the trusted
        # attempt, lane, task, item count, and runtime identity. Run only after every authority and
        # URL has passed validation, before delivery claim, model startup, input GET, or output PUT.
        await _run_sealed_qualification_probe(payload, accepted=accepted)
        await _claim_delivery(accepted["work"]["attempt_id"])
        pre_manifest = await asyncio.to_thread(verify_volume)
        if pre_manifest["manifest_sha256"] != accepted["runtime"]["model_manifest_sha256"]:
            raise ServerlessSoulXError("SOULX_SERVERLESS_VOLUME_MANIFEST_MISMATCH")
        # Captured before _ready_runtime mutates the process cache and signed into every output
        # item so qualification can distinguish a real same-worker warm reuse from a label.
        runtime_cache_hit = _runtime is not None
        runtime = await _ready_runtime()
        runtime_ready_epoch = time.time()
        runtime_health = runtime.health()
        gpu = _observed_gpu(runtime_health)
        observed_warmup_attestation_sha256 = _expect_sha256(
            runtime_health.get("warmup_attestation_sha256"),
            "SOULX_SERVERLESS_WARMUP_HASH_INVALID",
        )
        if observed_warmup_attestation_sha256 != warmup_attestation_sha256(
            accepted["runtime"]["container_digest"], dict(EXPECTED_WARMUP_FACTS)
        ):
            raise ServerlessSoulXError("SOULX_SERVERLESS_WARMUP_ATTESTATION_MISMATCH")
        allocation_ms, container_ready_ms = _signed_dispatch_timings(
            accepted,
            handler_started_epoch=handler_started_epoch,
            runtime_ready_epoch=runtime_ready_epoch,
        )
        scratch_root = Path(os.environ.get("VIDEOFORGE_JOB_SCRATCH_ROOT", "/tmp/videoforge-jobs"))
        receipt_items: list[dict[str, Any]] = []
        results: list[dict[str, Any]] = []
        peak_vram_bytes = 0
        started = time.monotonic()
        with _terminal_worker_io(
            root=scratch_root,
            account_id=accepted["tenant"]["account_id"],
            workspace_id=accepted["tenant"]["workspace_id"],
            job_id=accepted["work"]["attempt_id"],
            input_ports=tuple(input_ports),
            output_ports=(),
            now=now,
        ) as worker_io:
            worker_io.scratch.safe_path("inputs", directory=True)
            worker_io.scratch.safe_path("prepared", directory=True)
            worker_io.scratch.safe_path("outputs", directory=True)
            fetched = [
                _fetch_exact(port, url, worker_io)
                for port, url in zip(input_ports, input_urls, strict=True)
            ]
            source_bytes = fetched[0].read_bytes()
            if _digest(source_bytes) != batch["avatar_source"]["sha256"]:
                raise ServerlessSoulXError("SOULX_SERVERLESS_SOURCE_CHECKSUM_MISMATCH")
            first_inference_ms = 0
            upload_ms = 0
            execution_started = time.monotonic()
            execution_timeout = accepted["limits"]["execution_timeout_seconds"]
            for index, (span, input_path, authority, output_url) in enumerate(
                zip(remaining, fetched[1:], output_authorities, output_urls, strict=True)
            ):
                if _digest(input_path.read_bytes()) != span["audio_sha256"]:
                    raise ServerlessSoulXError("SOULX_SERVERLESS_AUDIO_CHECKSUM_MISMATCH")
                audio_16k = worker_io.scratch.safe_path(f"prepared/{span['item_id']}.wav")
                preparation = _prepare_audio_16k(input_path, audio_16k, span)
                inference_started = time.monotonic()
                remaining_seconds = execution_timeout - (time.monotonic() - execution_started)
                if remaining_seconds <= 0:
                    raise TimeoutError("SOULX_SERVERLESS_TIMEOUT")
                generated = await asyncio.wait_for(
                    _generate(runtime, source_bytes, audio_16k.read_bytes()),
                    timeout=remaining_seconds,
                )
                observed_peak = generated.get("peak_vram_bytes")
                if not isinstance(observed_peak, int) or observed_peak <= 0:
                    raise ServerlessSoulXError("SOULX_SERVERLESS_VRAM_EVIDENCE_INVALID")
                peak_vram_bytes = max(peak_vram_bytes, observed_peak)
                inference_ms = round((time.monotonic() - inference_started) * 1000)
                if index == 0:
                    first_inference_ms = inference_ms
                padded = base64.b64decode(generated["output_base64"], validate=True)
                native_path = worker_io.scratch.safe_path(f"outputs/{span['item_id']}.mp4")
                upload_started = time.monotonic()
                native = _trim_native_mp4(padded, native_path, span)
                if not native_path.is_file() or native_path.read_bytes() != native:
                    raise ServerlessSoulXError("SOULX_SERVERLESS_OUTPUT_BYTES_UNBOUND")
                selected_frames = (
                    span["trim_end_sample_exclusive_48k"] - span["trim_start_sample_48k"]
                ) // 1_920
                selected_duration_ms = selected_frames * 40
                media_probe = _probe_native_mp4(
                    native_path,
                    expected_frames=selected_frames,
                    expected_duration_ms=selected_duration_ms,
                )
                output_hash = _put_generated(authority, output_url, native)
                upload_ms += round((time.monotonic() - upload_started) * 1000)
                object_key = authority["path"].removeprefix("/")
                probe = {
                    "native_clip_reused_for_full_and_split": True,
                    "runtime_cache_hit": runtime_cache_hit,
                    **preparation,
                    **media_probe,
                }
                receipt_items.append(
                    {
                        "item_id": span["item_id"],
                        "state": "SUCCEEDED",
                        "output_object_key": object_key,
                        "output_sha256": output_hash,
                        "output_bytes": len(native),
                        "probe": probe,
                    }
                )
                results.append(
                    {
                        "item_id": span["item_id"],
                        "output_port_reservation_id": authority["reservation_id"],
                        "output_object_key": object_key,
                        "output_sha256": output_hash,
                        "output_bytes": len(native),
                        "probe": probe,
                        "inference_ms": inference_ms,
                    }
                )
            post_manifest = await asyncio.to_thread(verify_volume)
            if post_manifest["manifest_sha256"] != pre_manifest["manifest_sha256"]:
                raise ServerlessSoulXError("SOULX_SERVERLESS_VOLUME_MUTATION_DETECTED")
            timings = runtime_health.get("timings")
            if not isinstance(timings, dict):
                raise ServerlessSoulXError("SOULX_SERVERLESS_TIMING_INVALID")
            for timing_name in (
                "model_ready_ms",
                "manifest_verify_ms",
                "model_load_ms",
                "compile_warmup_ms",
            ):
                timing_value = timings.get(timing_name)
                if (
                    isinstance(timing_value, bool)
                    or not isinstance(timing_value, int)
                    or timing_value < 0
                    or timing_value > 86_400_000
                ):
                    raise ServerlessSoulXError("SOULX_SERVERLESS_TIMING_INVALID")
            receipt_body = {
                "schema_version": "serverless-provenance-receipt/v1",
                "attestation_scope": (
                    "VIDEOFORGE_APPLICATION_SIGNED_FACTS_NOT_PROVIDER_HARDWARE_ATTESTATION"
                ),
                "receipt_id": f"soulx-{accepted['work']['attempt_id']}",
                "dispatch_token": accepted["dispatch_token"],
                "envelope_sha256": envelope_sha256,
                "request_sha256": request_sha256,
                "attempt_id": accepted["work"]["attempt_id"],
                "provider_job_id": str(job.get("id", "unknown")),
                "worker_id": os.environ.get("RUNPOD_POD_ID", "serverless"),
                "tenant": accepted["tenant"],
                "lane": "soulx_avatar",
                "deployment": {
                    "deployment_id": accepted["runtime"]["deployment_id"],
                    "endpoint_id_sha256": _expect_sha256(
                        _environment("VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256"),
                        "SOULX_SERVERLESS_ENDPOINT_ID_INVALID",
                    ),
                    "container_digest": accepted["runtime"]["container_digest"],
                    "intended_region": "EU-RO-1",
                    "intended_volume_id_sha256": accepted["runtime"]["volume_id_sha256"],
                    "model_manifest_sha256": accepted["runtime"]["model_manifest_sha256"],
                },
                "runtime_probe": {
                    "gpu_name": gpu["name"],
                    "gpu_count": gpu["count"],
                    "total_vram_bytes": gpu["total_vram_bytes"],
                    "peak_vram_bytes": peak_vram_bytes,
                    "gpu_uuid_sha256": None,
                    "driver_version": os.environ.get("VIDEOFORGE_SOULX_DRIVER_VERSION", "UNKNOWN"),
                    "cuda_version": os.environ.get("VIDEOFORGE_SOULX_CUDA_VERSION", "UNKNOWN"),
                    "probe_source": "WORKER_RUNTIME_SELF_REPORT",
                },
                "volume_verification": {
                    "manifest_sha256_before": pre_manifest["manifest_sha256"],
                    "manifest_sha256_after": post_manifest["manifest_sha256"],
                    "mutation_detected": False,
                    "cross_mount_detected": False,
                },
                "model_ready_evidence": {
                    "state": "MODEL_READY",
                    "warmup_completed": True,
                    # The v1 receipt key is retained for wire compatibility; the value is an exact
                    # source/deployment-bound warmup attestation, never an environment placeholder.
                    "warmup_output_sha256": observed_warmup_attestation_sha256,
                },
                "timings": {
                    "allocation_ms": allocation_ms,
                    "container_ready_ms": container_ready_ms,
                    "volume_verified_ms": timings["manifest_verify_ms"],
                    "model_load_ms": timings["model_load_ms"],
                    "warmup_ms": timings["compile_warmup_ms"],
                    "first_inference_ms": first_inference_ms,
                    "upload_ms": upload_ms,
                    "total_ms": round((time.monotonic() - started) * 1000),
                },
                "items": receipt_items,
                "scratch_cleanup": {
                    "terminal_reason": "SUCCESS",
                    "removed": True,
                    "scratch_on_model_volume": False,
                },
                "receipt_nonce": 1,
                "issued_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            }
            receipt, receipt_body_bytes = sign_receipt(
                receipt_body,
                key_id=_environment("VIDEOFORGE_RECEIPT_KEY_ID"),
                secret=bytes.fromhex(_environment("VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX")),
            )
        return {
            "status": "SUCCEEDED",
            "items": results,
            "carried_forward_item_ids": [unit["item_id"] for unit in resumed],
            "provenance_receipt": receipt,
            "provenance_receipt_body_base64": base64.b64encode(receipt_body_bytes).decode("ascii"),
        }
    except TimeoutError:
        code = "SOULX_SERVERLESS_TIMEOUT"
    except (
        EnvelopeRejection,
        ScratchIsolationError,
        ServerlessSoulXError,
        ValueError,
        KeyError,
        subprocess.SubprocessError,
        wave.Error,
    ) as error:
        candidate = str(error)[:120]
        code = (
            candidate if _FAILURE_CODE.fullmatch(candidate) else "SOULX_SERVERLESS_HANDLER_FAILED"
        )
    except Exception:
        code = "SOULX_SERVERLESS_HANDLER_UNEXPECTED"
    return {"status": "FAILED", "failure_code": code, "error": {"code": code}}

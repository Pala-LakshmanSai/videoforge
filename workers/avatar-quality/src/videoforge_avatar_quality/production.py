from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import subprocess
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Literal, TypedDict

SHA256_PREFIX = "sha256:"
SKYREELS_SOURCE_REVISION = "28c771e8456341be6a213e3d1133ed1fd19bf75d"
SKYREELS_MODEL_REVISION = "fdad4053f492aba389b5a8c3c6982118c6a1ecf3"
SKYREELS_MODEL_ID = "Skywork/SkyReels-V3-A2V-19B"
STATIC_PROMPT = "A presenter speaks directly to camera. Static shot, realistic natural motion."
DIAGNOSTIC_TAIL_BYTES = 64 * 1024


class SkyReelsInferenceFailure(ValueError):
    def __init__(self, code: str, diagnostic_sha256: str) -> None:
        super().__init__(code)
        self.diagnostic_sha256 = diagnostic_sha256


class SkyReelsResult(TypedDict):
    schema_version: Literal["videoforge.avatar-quality-result/v1"]
    attempt_id: str
    output_sha256: str
    bytes: int
    duration_ms: int
    fps: Literal[25]
    width: Literal[960]
    height: Literal[960]
    source_revision: str
    model_revision: str
    renderer_source_profile: Literal["skyreels-centered-960x960p25-v2"]


class SkyReelsInlineResult(SkyReelsResult):
    output_base64: str


def _digest_valid(value: object) -> bool:
    if not isinstance(value, str) or len(value) != 71 or not value.startswith(SHA256_PREFIX):
        return False
    try:
        int(value.removeprefix(SHA256_PREFIX), 16)
    except ValueError:
        return False
    return True


def _attempt_valid(value: object) -> bool:
    return isinstance(value, str) and 1 <= len(value) <= 160 and value.replace("_", "").isalnum()


@dataclass(frozen=True)
class SkyReelsJob:
    attempt_id: str
    original_source_url: str
    original_source_sha256: str
    span_audio_url: str
    span_audio_sha256: str
    output_put_url: str
    duration_seconds: int
    timeout_seconds: int = 1_800

    @classmethod
    def from_value(cls, value: object) -> SkyReelsJob:
        keys = {
            "attempt_id",
            "original_source_url",
            "original_source_sha256",
            "span_audio_url",
            "span_audio_sha256",
            "output_put_url",
            "duration_seconds",
        }
        if not isinstance(value, dict) or set(value) != keys:
            raise ValueError("SKYREELS_JOB_SHAPE_INVALID")
        job = cls(**value)
        if not _attempt_valid(job.attempt_id):
            raise ValueError("SKYREELS_ATTEMPT_ID_INVALID")
        for url in (job.original_source_url, job.span_audio_url, job.output_put_url):
            if not isinstance(url, str) or not url.startswith("https://") or len(url) > 8192:
                raise ValueError("SKYREELS_SIGNED_URL_INVALID")
        if not _digest_valid(job.original_source_sha256) or not _digest_valid(
            job.span_audio_sha256
        ):
            raise ValueError("SKYREELS_DIGEST_INVALID")
        if not isinstance(job.duration_seconds, int) or not 1 <= job.duration_seconds <= 200:
            raise ValueError("SKYREELS_DURATION_INVALID")
        return job


@dataclass(frozen=True)
class SkyReelsInlineJob:
    mode: Literal["INLINE_QUALIFICATION_V1"]
    attempt_id: str
    original_source_base64: str
    original_source_sha256: str
    span_audio_base64: str
    span_audio_sha256: str
    duration_seconds: Literal[5]
    timeout_seconds: int = 1_800

    @classmethod
    def from_value(cls, value: object) -> SkyReelsInlineJob:
        keys = {
            "mode",
            "attempt_id",
            "original_source_base64",
            "original_source_sha256",
            "span_audio_base64",
            "span_audio_sha256",
            "duration_seconds",
        }
        if not isinstance(value, dict) or set(value) != keys:
            raise ValueError("SKYREELS_INLINE_JOB_SHAPE_INVALID")
        job = cls(**value)
        if job.mode != "INLINE_QUALIFICATION_V1" or job.duration_seconds != 5:
            raise ValueError("SKYREELS_INLINE_SCOPE_INVALID")
        if not _attempt_valid(job.attempt_id):
            raise ValueError("SKYREELS_ATTEMPT_ID_INVALID")
        if not _digest_valid(job.original_source_sha256) or not _digest_valid(
            job.span_audio_sha256
        ):
            raise ValueError("SKYREELS_DIGEST_INVALID")
        for encoded in (job.original_source_base64, job.span_audio_base64):
            if not isinstance(encoded, str) or len(encoded) > 7_000_000:
                raise ValueError("SKYREELS_INLINE_INPUT_TOO_LARGE")
        return job


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return SHA256_PREFIX + digest.hexdigest()


def _download(url: str, destination: Path, expected: str, maximum: int) -> None:
    request = urllib.request.Request(url, headers={"user-agent": "videoforge-skyreels/v1"})
    size = 0
    with urllib.request.urlopen(request, timeout=120) as response, destination.open("xb") as output:
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > maximum:
                raise ValueError("SKYREELS_INPUT_TOO_LARGE")
            output.write(chunk)
    if _sha256(destination) != expected:
        raise ValueError("SKYREELS_INPUT_CHECKSUM_MISMATCH")


def _decode(encoded: str, destination: Path, expected: str) -> None:
    try:
        value = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("SKYREELS_INLINE_BASE64_INVALID") from error
    if len(value) > 5 * 1024 * 1024:
        raise ValueError("SKYREELS_INLINE_INPUT_TOO_LARGE")
    destination.write_bytes(value)
    if _sha256(destination) != expected:
        raise ValueError("SKYREELS_INPUT_CHECKSUM_MISMATCH")


def build_command(source: Path, audio: Path, duration_seconds: int) -> list[str]:
    root = Path(os.environ.get("SKYREELS_ROOT", "/opt/skyreels-v3")).resolve()
    model = Path(os.environ.get("SKYREELS_MODEL_ROOT", "/models/skyreels-v3-a2v-19b")).resolve()
    return [
        "python",
        str(root / "generate_video.py"),
        "--task_type",
        "talking_avatar",
        "--model_id",
        str(model),
        "--input_image",
        str(source),
        "--input_audio",
        str(audio),
        "--prompt",
        STATIC_PROMPT,
        "--duration",
        str(duration_seconds),
        "--resolution",
        "720P",
        "--seed",
        "42",
        "--offload",
    ]


def _tail(stream: BinaryIO) -> bytes:
    stream.seek(0, os.SEEK_END)
    stream.seek(max(0, stream.tell() - DIAGNOSTIC_TAIL_BYTES))
    return stream.read(DIAGNOSTIC_TAIL_BYTES)


def _failure(code: str, diagnostic: bytes) -> SkyReelsInferenceFailure:
    return SkyReelsInferenceFailure(code, SHA256_PREFIX + hashlib.sha256(diagnostic).hexdigest())


def classify_failure(diagnostic: bytes) -> str:
    lower = diagnostic.lower()
    if b"out of memory" in lower or b"outofmemoryerror" in lower:
        return "SKYREELS_INFERENCE_CUDA_OOM"
    if b"no module named" in lower or b"modulenotfounderror" in lower:
        return "SKYREELS_INFERENCE_DEPENDENCY_MISSING"
    if b"no such file" in lower or b"filenotfounderror" in lower:
        return "SKYREELS_INFERENCE_ASSET_MISSING"
    return "SKYREELS_INFERENCE_PROCESS_FAILED"


def _probe(path: Path) -> tuple[int, int, int, int]:
    completed = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,width,height,r_frame_rate:format=duration",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    value = json.loads(completed.stdout)
    streams = value.get("streams", [])
    video = next((item for item in streams if item.get("codec_type") == "video"), None)
    audio = next((item for item in streams if item.get("codec_type") == "audio"), None)
    if not video or not audio or video.get("r_frame_rate") != "25/1":
        raise ValueError("SKYREELS_OUTPUT_PROBE_INVALID")
    if (video.get("width"), video.get("height")) != (960, 960):
        raise ValueError("SKYREELS_OUTPUT_PROFILE_INVALID")
    return round(float(value["format"]["duration"]) * 1000), 25, 960, 960


def _execute(attempt_id: str, source: Path, audio: Path, duration: int, timeout: int, root: Path):
    model = Path(os.environ.get("SKYREELS_MODEL_ROOT", "/models/skyreels-v3-a2v-19b"))
    if not (model / "config.json").is_file():
        raise ValueError("SKYREELS_MODEL_NOT_READY")
    output = root / "result" / "talking_avatar"
    with tempfile.TemporaryFile() as diagnostic:
        try:
            subprocess.run(
                build_command(source, audio, duration),
                cwd=root,
                check=True,
                timeout=timeout,
                stdout=diagnostic,
                stderr=subprocess.STDOUT,
                env={**os.environ, "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"},
            )
        except subprocess.TimeoutExpired as error:
            raise _failure("SKYREELS_INFERENCE_TIMEOUT", _tail(diagnostic)) from error
        except subprocess.CalledProcessError as error:
            tail = _tail(diagnostic)
            raise _failure(classify_failure(tail), tail) from error
    candidates = sorted(output.glob("*_with_audio.mp4"))
    if len(candidates) != 1:
        raise ValueError("SKYREELS_OUTPUT_MISSING")
    path = candidates[0]
    duration_ms, fps, width, height = _probe(path)
    result: SkyReelsResult = {
        "schema_version": "videoforge.avatar-quality-result/v1",
        "attempt_id": attempt_id,
        "output_sha256": _sha256(path),
        "bytes": path.stat().st_size,
        "duration_ms": duration_ms,
        "fps": fps,
        "width": width,
        "height": height,
        "source_revision": SKYREELS_SOURCE_REVISION,
        "model_revision": SKYREELS_MODEL_REVISION,
        "renderer_source_profile": "skyreels-centered-960x960p25-v2",
    }
    return result, path


def _upload(url: str, path: Path) -> None:
    request = urllib.request.Request(
        url, data=path.read_bytes(), method="PUT", headers={"content-type": "video/mp4"}
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        if not 200 <= response.status < 300:
            raise ValueError("SKYREELS_OUTPUT_UPLOAD_FAILED")


def run_job(job: SkyReelsJob) -> SkyReelsResult:
    with tempfile.TemporaryDirectory(prefix="videoforge-skyreels-") as temporary:
        root = Path(temporary)
        source = root / "original.png"
        audio = root / "span.wav"
        _download(job.original_source_url, source, job.original_source_sha256, 25 * 1024 * 1024)
        _download(job.span_audio_url, audio, job.span_audio_sha256, 100 * 1024 * 1024)
        result, output = _execute(
            job.attempt_id, source, audio, job.duration_seconds, job.timeout_seconds, root
        )
        _upload(job.output_put_url, output)
        return result


def run_inline_job(job: SkyReelsInlineJob) -> SkyReelsInlineResult:
    with tempfile.TemporaryDirectory(prefix="videoforge-skyreels-qualification-") as temporary:
        root = Path(temporary)
        source = root / "original.png"
        audio = root / "span.wav"
        _decode(job.original_source_base64, source, job.original_source_sha256)
        _decode(job.span_audio_base64, audio, job.span_audio_sha256)
        result, output = _execute(
            job.attempt_id, source, audio, job.duration_seconds, job.timeout_seconds, root
        )
        if result["bytes"] > 12 * 1024 * 1024:
            raise ValueError("SKYREELS_INLINE_OUTPUT_TOO_LARGE")
        return {**result, "output_base64": base64.b64encode(output.read_bytes()).decode("ascii")}

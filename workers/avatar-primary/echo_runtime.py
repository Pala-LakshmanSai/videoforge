from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import re
import subprocess
import time
from pathlib import Path

from echo_backend import EchoPreparedBackend
from echo_bootstrap import bootstrap
from echo_job import EchoQualificationJob
from echo_volume import (
    ECHO_AUDIO_REVISION,
    ECHO_FLASH_REVISION,
    ECHO_PRECISION,
    ECHO_RUNTIME_PROFILE_ID,
    ECHO_RUNTIME_PROFILE_LABEL,
    ECHO_SOURCE_REVISION,
    ECHO_UPSTREAM_MODEL_ID,
    ECHO_WAN_REVISION,
)
from scratch import create_scratch
from span_contract import (
    require_exact_media_probe,
    trim_filter,
    validate_output_probe,
)

SHA256 = re.compile(r"^sha256:[a-f0-9]{64}$")
IMAGE_DIGEST = re.compile(
    r"^ghcr\.io/pala-lakshmansai/videoforge-echo-flash-turbo-cp07@sha256:[a-f0-9]{64}$"
)
SUPPORTED_GPU_NAMES = {
    "NVIDIA GeForce RTX 4090": ("4090", 24_000, (8, 9)),
    "NVIDIA GeForce RTX 5090": ("5090", 31_000, (12, 0)),
    "NVIDIA L4": ("NVIDIA L4", 22_000, (8, 9)),
    "NVIDIA RTX PRO 6000 Blackwell Server Edition": ("RTX PRO 6000", 94_000, (12, 0)),
}
MAX_OUTPUT_BYTES = 128 * 1024 * 1024


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return "sha256:" + digest.hexdigest()


def _audio_probe(path: Path) -> tuple[int, int, int]:
    completed = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,sample_rate,channels:format=duration",
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
    audio = next(
        (item for item in value.get("streams", []) if item.get("codec_type") == "audio"), None
    )
    if audio is None:
        raise ValueError("ECHO_SPAN_AUDIO_PROBE_INVALID")
    return (
        int(audio["sample_rate"]),
        int(audio["channels"]),
        round(float(value["format"]["duration"]) * 1_000),
    )


def _output_probe(path: Path) -> dict[str, object]:
    completed = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,width,height,r_frame_rate,duration:format=duration",
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
    if video is None:
        raise ValueError("ECHO_SPAN_OUTPUT_PROBE_INVALID")
    rate = str(video.get("r_frame_rate", "0/1")).split("/", 1)
    fps = round(int(rate[0]) / int(rate[1]))
    video_duration = float(video.get("duration") or value["format"]["duration"])
    audio_duration = float(audio.get("duration") or value["format"]["duration"]) if audio else 0
    return {
        "duration_ms": round(float(value["format"]["duration"]) * 1_000),
        "video_duration_ms": round(video_duration * 1_000),
        "audio_duration_ms": round(audio_duration * 1_000),
        "av_duration_delta_ms": round(abs(video_duration - audio_duration) * 1_000),
        "fps": fps,
        "width": int(video["width"]),
        "height": int(video["height"]),
        "has_video": True,
        "has_audio": audio is not None,
    }


def _trim(raw: Path, output: Path, filter_graph: str) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(raw),
            "-filter_complex",
            filter_graph,
            "-map",
            "[v]",
            "-map",
            "[a]",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-r",
            "25",
            "-c:a",
            "aac",
            "-ar",
            "48000",
            "-movflags",
            "+faststart",
            str(output),
        ],
        check=True,
        capture_output=True,
        timeout=300,
    )


class EchoRuntime:
    def __init__(self, backend_factory=EchoPreparedBackend) -> None:
        self.backend_factory = backend_factory
        self.backend = None
        self.started = time.monotonic()
        self.phase_started = self.started
        self.phase = "process"
        self.phase_timings_ms: dict[str, int] = {}
        self.error_code: str | None = None
        self.error_detail: str | None = None
        self.ready = False
        self.bootstrap_evidence: dict[str, object] | None = None
        self.load_evidence: dict[str, object] | None = None
        self.warmup_evidence: dict[str, object] | None = None
        self.gpu: dict[str, object] = {"available": False, "approved": False, "device_count": 0}
        self.generation_lock = asyncio.Lock()

    def transition(self, phase: str) -> None:
        now = time.monotonic()
        self.phase_timings_ms[self.phase] = round((now - self.phase_started) * 1_000)
        self.phase = phase
        self.phase_started = now

    async def startup(self) -> None:
        try:
            self.verify_runtime_identity()
            self.transition("volume_verify")
            model_root = Path(
                os.environ.get("ECHO_MODEL_ROOT", "/runpod-volume/echo-flash-turbo-fp8")
            )
            self.bootstrap_evidence = await asyncio.to_thread(bootstrap, model_root)
            self.transition("gpu_verify")
            await asyncio.to_thread(self.verify_gpu)
            self.transition("model_load")
            self.backend = self.backend_factory(model_root)
            self.load_evidence = await asyncio.to_thread(self.backend.load)
            self.transition("warmup")
            scratch = Path(os.environ.get("ECHO_SCRATCH_ROOT", "/run/videoforge/echo-scratch"))
            warmup = scratch / "_warmup"
            warmup.mkdir(parents=True, exist_ok=False, mode=0o700)
            try:
                self.warmup_evidence = await asyncio.to_thread(self.backend.warm_up, warmup)
            finally:
                import shutil

                shutil.rmtree(warmup, ignore_errors=True)
            if self.warmup_evidence.get("real_inference_path") is not True:
                raise RuntimeError("ECHO_REAL_WARMUP_REQUIRED")
            self.gpu["ready_vram_used_bytes"] = self.device_vram_used_bytes()
            self.transition("ready")
            self.phase_timings_ms.setdefault("ready", 0)
            self.ready = True
        except Exception as error:
            detail = str(error) if str(error) else "ECHO_WORKER_BOOT_FAILED"
            self.error_code = detail[:120]
            if os.environ.get("VIDEOFORGE_ECHO_QUALIFICATION_ERROR_DETAIL") == "1":
                self.error_detail = detail[:4_000]
            self.transition("error")

    @staticmethod
    def verify_runtime_identity() -> None:
        if SHA256.fullmatch(os.environ.get("VIDEOFORGE_ECHO_VOLUME_ID_HASH", "")) is None:
            raise RuntimeError("ECHO_VOLUME_IDENTITY_INVALID")
        if (
            IMAGE_DIGEST.fullmatch(os.environ.get("VIDEOFORGE_ECHO_WORKER_IMAGE_DIGEST", ""))
            is None
        ):
            raise RuntimeError("ECHO_WORKER_IMAGE_IDENTITY_INVALID")
        if not os.environ.get("RUNPOD_POD_ID"):
            raise RuntimeError("ECHO_POD_IDENTITY_INVALID")
        if len(os.environ.get("VIDEOFORGE_ECHO_WORKER_TOKEN", "")) < 32:
            raise RuntimeError("ECHO_WORKER_TOKEN_INVALID")
        if os.environ.get("VIDEOFORGE_ECHO_GPU_OFFERING_ID") not in SUPPORTED_GPU_NAMES:
            raise RuntimeError("ECHO_GPU_OFFERING_INVALID")
        if Path(os.environ.get("ECHO_SCRATCH_ROOT", "/run/videoforge/echo-scratch")).is_relative_to(
            Path(os.environ.get("ECHO_MODEL_ROOT", "/runpod-volume/echo-flash-turbo-fp8"))
        ):
            raise RuntimeError("ECHO_SCRATCH_CROSS_MOUNT_FORBIDDEN")

    def verify_gpu(self) -> None:
        try:
            import torch
        except Exception as error:
            raise RuntimeError("ECHO_TORCH_UNAVAILABLE") from error
        if not torch.cuda.is_available() or torch.cuda.device_count() != 1:
            raise RuntimeError("ECHO_EXACTLY_ONE_CUDA_GPU_REQUIRED")
        actual = torch.cuda.get_device_name(0)
        properties = torch.cuda.get_device_properties(0)
        offering = os.environ.get("VIDEOFORGE_ECHO_GPU_OFFERING_ID", "")
        expected_fragment, minimum_mb, expected_capability = SUPPORTED_GPU_NAMES[offering]
        total_mb = properties.total_memory // (1024 * 1024)
        capability = tuple(torch.cuda.get_device_capability(0))
        if (
            expected_fragment.upper() not in actual.upper()
            or total_mb < minimum_mb
            or capability != expected_capability
        ):
            raise RuntimeError("ECHO_GPU_OFFERING_MISMATCH")
        self.gpu = {
            "available": True,
            "approved": True,
            "device_count": 1,
            "name": actual,
            "offering_id": offering,
            "total_memory_bytes": properties.total_memory,
            "cuda_version": str(torch.version.cuda or ""),
            "torch_version": str(torch.__version__),
            "compute_capability": f"{capability[0]}.{capability[1]}",
        }

    @staticmethod
    def device_vram_used_bytes() -> int:
        import torch

        free, total = torch.cuda.mem_get_info(0)
        used = int(total) - int(free)
        if used <= 0 or used > int(total):
            raise RuntimeError("ECHO_VRAM_USAGE_INVALID")
        return used

    async def generate_qualification(self, value: object) -> dict[str, object]:
        if not self.ready or self.backend is None:
            raise RuntimeError("ECHO_WORKER_NOT_READY")
        job = EchoQualificationJob.from_value(value)
        span = job.span_job()
        model_root = Path(os.environ.get("ECHO_MODEL_ROOT", "/runpod-volume/echo-flash-turbo-fp8"))
        scratch_root = Path(os.environ.get("ECHO_SCRATCH_ROOT", "/run/videoforge/echo-scratch"))
        async with self.generation_lock:
            scratch = create_scratch(span, scratch_root=scratch_root, model_root=model_root)
            started = time.monotonic()
            try:
                source = scratch.root / "source.png"
                audio = scratch.root / "span.wav"
                raw = scratch.root / "raw.mp4"
                output = scratch.root / "trimmed.mp4"
                job.decode_inputs(source, audio)
                sample_rate, channels, duration_ms = await asyncio.to_thread(_audio_probe, audio)
                require_exact_media_probe(
                    audio_sample_rate_hz=sample_rate,
                    audio_channels=channels,
                    audio_duration_ms=duration_ms,
                    job=span,
                )
                inference_started = time.monotonic()
                await asyncio.to_thread(
                    self.backend.generate,
                    source_path=source,
                    audio_path=audio,
                    prompt=span.prompt,
                    frame_limit=span.inference_frames,
                    output_path=raw,
                )
                inference_ms = round((time.monotonic() - inference_started) * 1_000)
                await asyncio.to_thread(_trim, raw, output, trim_filter(span))
                probe = await asyncio.to_thread(_output_probe, output)
                validate_output_probe(
                    job=span,
                    **{
                        key: probe[key]
                        for key in (
                            "duration_ms",
                            "fps",
                            "width",
                            "height",
                            "has_video",
                            "has_audio",
                        )
                    },
                )
                if output.stat().st_size > MAX_OUTPUT_BYTES:
                    raise ValueError("ECHO_QUALIFICATION_OUTPUT_TOO_LARGE")
                return {
                    "schema_version": "videoforge.echo-qualification-result/v1",
                    "attempt_id": span.attempt_id,
                    "project_revision_id": span.project_revision_id,
                    "span_id": span.span_id,
                    "core_duration_ms": span.core_duration_ms,
                    "padded_duration_ms": span.padded_duration_ms,
                    "trim_start_ms": span.trim_start_ms,
                    "trim_end_ms_exclusive": span.trim_end_ms_exclusive,
                    "inference_frames": span.inference_frames,
                    "output_sha256": _sha256(output),
                    "output_bytes": output.stat().st_size,
                    "output_base64": base64.b64encode(output.read_bytes()).decode("ascii"),
                    "probe": probe,
                    "runtime_stages_ms": {
                        "inference": inference_ms,
                        "request_total": round((time.monotonic() - started) * 1_000),
                    },
                    "runtime_evidence": self.runtime_evidence(),
                }
            finally:
                scratch.cleanup()

    def runtime_evidence(self) -> dict[str, object]:
        return {
            "schema_version": "videoforge.echo-flash-turbo-fp8-runtime-evidence/v1",
            "runtime_profile_id": ECHO_RUNTIME_PROFILE_ID,
            "pod_id_hash": "sha256:"
            + hashlib.sha256(os.environ.get("RUNPOD_POD_ID", "local").encode()).hexdigest(),
            "volume_id_hash": os.environ.get("VIDEOFORGE_ECHO_VOLUME_ID_HASH"),
            "worker_image_digest": os.environ.get("VIDEOFORGE_ECHO_WORKER_IMAGE_DIGEST"),
            "lineage": {
                "source_revision": ECHO_SOURCE_REVISION,
                "flash_revision": ECHO_FLASH_REVISION,
                "wan_revision": ECHO_WAN_REVISION,
                "audio_revision": ECHO_AUDIO_REVISION,
                "precision": ECHO_PRECISION,
            },
            "bootstrap": self.bootstrap_evidence,
            "load": self.load_evidence,
            "warmup": self.warmup_evidence,
            "gpu": self.gpu,
        }

    def health(self) -> dict[str, object]:
        timings = dict(self.phase_timings_ms)
        if self.phase not in {"ready", "error"}:
            timings[self.phase] = round((time.monotonic() - self.phase_started) * 1_000)
        return {
            "schema_version": "videoforge.echo-flash-turbo-fp8-worker-health/v1",
            "service": "videoforge-echo-flash-turbo-cp07-pod",
            "process": {
                "status": "ok",
                "uptime_ms": round((time.monotonic() - self.started) * 1_000),
            },
            "phase": self.phase,
            "model": {
                "id": ECHO_RUNTIME_PROFILE_LABEL,
                "runtime_profile_id": ECHO_RUNTIME_PROFILE_ID,
                "upstream_model_id": ECHO_UPSTREAM_MODEL_ID,
                "precision": ECHO_PRECISION,
                "status": "ready"
                if self.ready
                else "failed"
                if self.phase == "error"
                else "loading",
                "real_warmup_complete": self.ready,
            },
            "gpu": self.gpu,
            "phase_timings_ms": timings,
            "error_code": self.error_code,
            "error_detail": self.error_detail,
        }

from __future__ import annotations

import hashlib
import base64
import binascii
import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.request
import urllib.error
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Literal, TypedDict

SHA256_PREFIX = "sha256:"
AVATAR_SOURCE_REVISION = "7e89489ca51c0d008fc1963ec6c03fc5bd0b9397"
AVATAR_WEIGHTS_REVISION = "311e176905a8c4c24b240b530488fe636ce4d249"
WAN_REVISION = "fc913c34361f4ec879e2f9c78b4f11ae50a937d1"
WAV2VEC_REVISION = "3991242c806928916fff4a8c0e4f76acf661b743"
UPSTREAM_CONFIG_SHA256 = "21fe4409b664385a1c1cc5c23d92506ffb05ef3c374a18de9df67b715dca07e9"
ALLOWED_LAYOUTS = {"AVATAR_FULL", "SPLIT_LEFT_AVATAR"}
DIAGNOSTIC_TAIL_BYTES = 64 * 1024
DELIVERY_RESULT_MAX_BYTES = 64 * 1024 * 1024
OFFICIAL_FLASH_CONFIG = {
    "num_inference_steps": 8,
    "sampler_name": "Flow_Unipc",
    "video_length": 253,
    "guidance_scale": 6.0,
    "audio_guidance_scale": 3.0,
    "audio_scale": 1.0,
    "neg_scale": 1.0,
    "neg_steps": 0,
    "seed": 43,
    "teacache_threshold": 0.1,
    "num_skip_start_steps": 5,
    "riflex_k": 6,
    "ulysses_degree": 1,
    "ring_degree": 1,
    "weight_dtype": "float8_e4m3fn_dynamic_activation_weight",
    "activation_dtype": "float8_e4m3fn",
    "long_video_cfg": True,
    "partial_video_length": 81,
    "overlap_video_length": 5,
    "sample_size": [768, 768],
    "fps": 25,
    "add_prompt": "",
    "negative_prompt": "",
    "shift": 5.0,
}
INFERENCE_CONFIG_SHA256 = (
    "sha256:"
    + hashlib.sha256(
        json.dumps(OFFICIAL_FLASH_CONFIG, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
)


class AvatarPrimaryInferenceFailure(ValueError):
    def __init__(self, code: str, diagnostic_sha256: str) -> None:
        super().__init__(code)
        self.diagnostic_sha256 = diagnostic_sha256


def classify_inference_failure(diagnostic: bytes) -> str:
    value = diagnostic.lower()
    if any(
        marker in value
        for marker in [
            b"out of memory",
            b"outofmemoryerror",
            b"cuda_error_out_of_memory",
            b"cublas_status_alloc_failed",
        ]
    ):
        return "AVATAR_INFERENCE_CUDA_OOM"
    if b"modulenotfounderror" in value or b"no module named" in value:
        return "AVATAR_INFERENCE_DEPENDENCY_MISSING"
    if b"no such file or directory" in value or b"filenotfounderror" in value:
        return "AVATAR_INFERENCE_ASSET_MISSING"
    if any(
        marker in value
        for marker in [
            b"invalid data found when processing input",
            b"format not recognised",
            b"soundfile runtime error",
            b"could not find codec parameters",
        ]
    ):
        return "AVATAR_INFERENCE_MEDIA_INVALID"
    return "AVATAR_INFERENCE_PROCESS_FAILED"


def _diagnostic_tail(stream: BinaryIO) -> bytes:
    stream.seek(0, os.SEEK_END)
    length = stream.tell()
    stream.seek(max(0, length - DIAGNOSTIC_TAIL_BYTES))
    return stream.read(DIAGNOSTIC_TAIL_BYTES)


def _validate_gpu_profile(gpu_name: str, gpu_vram_mb: int) -> None:
    supported = ("4090" in gpu_name and gpu_vram_mb >= 24_000) or (
        "A100" in gpu_name and gpu_vram_mb >= 79_000
    )
    if not supported:
        raise ValueError("AVATAR_GPU_PROFILE_UNSUPPORTED")


def _inference_failure(code: str, diagnostic: bytes) -> AvatarPrimaryInferenceFailure:
    return AvatarPrimaryInferenceFailure(
        code,
        f"{SHA256_PREFIX}{hashlib.sha256(diagnostic).hexdigest()}",
    )


class AvatarPrimaryResult(TypedDict):
    schema_version: Literal["videoforge.avatar-primary-result/v1"]
    attempt_id: str
    output_sha256: str
    bytes: int
    duration_ms: int
    fps: int
    width: int
    height: int
    source_revision: str
    weights_revision: str
    base_revision: str
    audio_encoder_revision: str
    upstream_config_sha256: str
    inference_config_sha256: str
    source_input_sha256: str
    audio_input_sha256: str
    gpu_name: str
    gpu_vram_total_mb: int
    peak_vram_mb: int
    runtime_stages_ms: dict[str, int]
    bootstrap: dict[str, object]


class AvatarPrimaryInlineResult(AvatarPrimaryResult):
    output_base64: str


@dataclass(frozen=True)
class AvatarPrimaryJob:
    attempt_id: str
    source_url: str
    source_sha256: str
    span_audio_url: str
    span_audio_sha256: str
    output_put_url: str
    prompt: str
    layout: str
    num_output_frames: int
    timeout_seconds: int = 1_800

    @classmethod
    def from_value(cls, value: object) -> AvatarPrimaryJob:
        if not isinstance(value, dict) or set(value) != {
            "attempt_id",
            "source_url",
            "source_sha256",
            "span_audio_url",
            "span_audio_sha256",
            "output_put_url",
            "prompt",
            "layout",
            "num_output_frames",
        }:
            raise ValueError("AVATAR_JOB_SHAPE_INVALID")
        job = cls(**value)
        if (
            not job.attempt_id
            or len(job.attempt_id) > 160
            or not job.attempt_id.replace("_", "").isalnum()
        ):
            raise ValueError("AVATAR_ATTEMPT_ID_INVALID")
        for url in (job.source_url, job.span_audio_url, job.output_put_url):
            if not isinstance(url, str) or not url.startswith("https://") or len(url) > 8_192:
                raise ValueError("AVATAR_SIGNED_URL_INVALID")
        for digest in (job.source_sha256, job.span_audio_sha256):
            if (
                not isinstance(digest, str)
                or len(digest) != 71
                or not digest.startswith(SHA256_PREFIX)
            ):
                raise ValueError("AVATAR_DIGEST_INVALID")
            int(digest.removeprefix(SHA256_PREFIX), 16)
        if not isinstance(job.prompt, str) or not 1 <= len(job.prompt.strip()) <= 1_200:
            raise ValueError("AVATAR_PROMPT_INVALID")
        if job.layout not in ALLOWED_LAYOUTS:
            raise ValueError("AVATAR_LAYOUT_INVALID")
        if (
            not isinstance(job.num_output_frames, int)
            or job.num_output_frames < 5
            or job.num_output_frames > OFFICIAL_FLASH_CONFIG["video_length"]
            or (job.num_output_frames - 1) % 4 != 0
        ):
            raise ValueError("AVATAR_FRAME_COUNT_INVALID")
        return job


@dataclass(frozen=True)
class AvatarPrimaryInlineJob:
    mode: Literal["INLINE_QUALIFICATION_V1"]
    attempt_id: str
    source_base64: str
    source_sha256: str
    span_audio_base64: str
    span_audio_sha256: str
    prompt: str
    layout: str
    num_output_frames: int
    timeout_seconds: int = 1_800

    @classmethod
    def from_value(cls, value: object) -> AvatarPrimaryInlineJob:
        if not isinstance(value, dict) or set(value) != {
            "mode",
            "attempt_id",
            "source_base64",
            "source_sha256",
            "span_audio_base64",
            "span_audio_sha256",
            "prompt",
            "layout",
            "num_output_frames",
        }:
            raise ValueError("AVATAR_INLINE_JOB_SHAPE_INVALID")
        job = cls(**value)
        if (
            job.mode != "INLINE_QUALIFICATION_V1"
            or not isinstance(job.num_output_frames, int)
            or job.num_output_frames < 5
            or job.num_output_frames > OFFICIAL_FLASH_CONFIG["video_length"]
            or (job.num_output_frames - 1) % 4 != 0
        ):
            raise ValueError("AVATAR_INLINE_SCOPE_INVALID")
        if (
            not job.attempt_id
            or len(job.attempt_id) > 160
            or not job.attempt_id.replace("_", "").isalnum()
        ):
            raise ValueError("AVATAR_ATTEMPT_ID_INVALID")
        if not isinstance(job.prompt, str) or not 1 <= len(job.prompt.strip()) <= 1_200:
            raise ValueError("AVATAR_PROMPT_INVALID")
        if job.layout not in ALLOWED_LAYOUTS:
            raise ValueError("AVATAR_LAYOUT_INVALID")
        for digest in (job.source_sha256, job.span_audio_sha256):
            if (
                not isinstance(digest, str)
                or len(digest) != 71
                or not digest.startswith(SHA256_PREFIX)
            ):
                raise ValueError("AVATAR_DIGEST_INVALID")
            int(digest.removeprefix(SHA256_PREFIX), 16)
        for encoded in (job.source_base64, job.span_audio_base64):
            if not isinstance(encoded, str) or len(encoded) > 2_800_000:
                raise ValueError("AVATAR_INLINE_INPUT_TOO_LARGE")
        return job


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"{SHA256_PREFIX}{digest.hexdigest()}"


def _download(url: str, destination: Path, expected_sha256: str, maximum_bytes: int) -> None:
    request = urllib.request.Request(url, headers={"user-agent": "videoforge-avatar-primary/v1"})
    size = 0
    try:
        with (
            urllib.request.urlopen(request, timeout=120) as response,
            destination.open("xb") as output,
        ):
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > maximum_bytes:
                    raise ValueError("AVATAR_INPUT_TOO_LARGE")
                output.write(chunk)
    except ValueError:
        raise
    except (OSError, TimeoutError, urllib.error.URLError) as error:
        raise ValueError("AVATAR_INPUT_DOWNLOAD_FAILED") from error
    if _sha256(destination) != expected_sha256:
        raise ValueError("AVATAR_INPUT_CHECKSUM_MISMATCH")


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
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    if not video or not audio or video.get("r_frame_rate") != "25/1":
        raise ValueError("AVATAR_OUTPUT_PROBE_INVALID")
    duration_ms = round(float(value["format"]["duration"]) * 1_000)
    return duration_ms, 25, int(video["width"]), int(video["height"])


def _upload(url: str, path: Path) -> None:
    request = urllib.request.Request(
        url,
        data=path.read_bytes(),
        method="PUT",
        headers={"content-type": "video/mp4"},
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        if response.status < 200 or response.status >= 300:
            raise ValueError("AVATAR_OUTPUT_UPLOAD_FAILED")


def _encode_delivery_output(source: Path, destination: Path) -> None:
    # Upstream Flash already emits H.264/AAC. Preserve those exact native bytes.
    shutil.copyfile(source, destination)
    if not destination.is_file() or destination.stat().st_size > DELIVERY_RESULT_MAX_BYTES:
        raise ValueError("AVATAR_DELIVERY_OUTPUT_TOO_LARGE")
    _probe(destination)


def _resolve_inference_output(output_root: Path) -> Path:
    expected = output_root / "source_output.mp4"
    if expected.is_file():
        return expected
    candidates = sorted(
        path
        for path in output_root.rglob("*.mp4")
        if path.is_file() and not path.name.endswith(".tmp.mp4")
    )
    if len(candidates) != 1:
        raise ValueError("AVATAR_OUTPUT_MISSING" if not candidates else "AVATAR_OUTPUT_AMBIGUOUS")
    return candidates[0]


def _run_inference_with_peak_vram(
    command: list[str],
    *,
    root: Path,
    env: dict[str, str],
    timeout_seconds: int,
    diagnostic: BinaryIO,
) -> tuple[int, int]:
    process = subprocess.Popen(
        command,
        cwd=root,
        env=env,
        stdout=diagnostic,
        stderr=subprocess.STDOUT,
    )
    deadline = time.monotonic() + timeout_seconds
    peak_vram_mb = 0
    while process.poll() is None:
        if time.monotonic() >= deadline:
            process.kill()
            process.wait(timeout=30)
            raise subprocess.TimeoutExpired(command, timeout_seconds)
        query = subprocess.run(
            [
                "nvidia-smi",
                "--query-compute-apps=used_memory",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        peak_vram_mb = max(
            [peak_vram_mb]
            + [
                int(value.strip()) for value in query.stdout.splitlines() if value.strip().isdigit()
            ],
        )
        time.sleep(1)
    if process.returncode != 0:
        raise subprocess.CalledProcessError(process.returncode, command)
    generation_ms = 0
    for line in _diagnostic_tail(diagnostic).decode("utf-8", errors="replace").splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and value.get("event") == "echomimic_generation_complete":
            generation_ms = int(value.get("duration_ms", 0))
    if generation_ms < 1:
        raise RuntimeError("ECHOMIMIC_GENERATION_TIMING_MISSING")
    return peak_vram_mb, generation_ms


def _execute(
    *,
    attempt_id: str,
    prompt: str,
    num_output_frames: int,
    timeout_seconds: int,
    source_path: Path,
    audio_path: Path,
    output_root: Path,
) -> tuple[AvatarPrimaryResult, Path]:
    root = Path(os.environ.get("ECHOMIMIC_ROOT", "/opt/echomimic_v3")).resolve()
    model_root = Path(os.environ.get("ECHOMIMIC_MODEL_ROOT", "/models")).resolve()
    transformer_path = (
        model_root / "flash" / "echomimicv3-flash-pro" / "diffusion_pytorch_model.safetensors"
    )
    base_path = model_root / "base"
    audio_model_path = model_root / "audio"
    config_path = root / "config" / "config.yaml"
    if (
        not root.is_dir()
        or not transformer_path.is_file()
        or not base_path.is_dir()
        or not audio_model_path.is_dir()
        or _sha256(config_path) != f"{SHA256_PREFIX}{UPSTREAM_CONFIG_SHA256}"
    ):
        raise ValueError("AVATAR_MODEL_NOT_READY")
    output_root.mkdir(parents=True, exist_ok=False)
    command = [
        "python",
        "/opt/videoforge/infer_flash_fp8.py",
        "--image_path",
        str(source_path),
        "--audio_path",
        str(audio_path),
        "--prompt",
        prompt.strip(),
        "--num_inference_steps",
        "8",
        "--config_path",
        str(config_path),
        "--model_name",
        str(base_path),
        "--ckpt_idx",
        "50000",
        "--transformer_path",
        str(transformer_path),
        "--save_path",
        str(output_root),
        "--wav2vec_model_dir",
        str(audio_model_path),
        "--sampler_name",
        "Flow_Unipc",
        "--video_length",
        str(num_output_frames),
        "--guidance_scale",
        "6.0",
        "--audio_guidance_scale",
        "3.0",
        "--audio_scale",
        "1.0",
        "--neg_scale",
        "1.0",
        "--neg_steps",
        "0",
        "--seed",
        "43",
        "--enable_teacache",
        "--teacache_threshold",
        "0.1",
        "--num_skip_start_steps",
        "5",
        "--riflex_k",
        "6",
        "--ulysses_degree",
        "1",
        "--ring_degree",
        "1",
        "--weight_dtype",
        "bfloat16",
        "--sample_size",
        "768",
        "768",
        "--fps",
        "25",
        "--add_prompt",
        "",
        "--negative_prompt",
        "",
        "--shift",
        "5.0",
    ]
    env = {
        **os.environ,
        "PYTHONPATH": f"/opt/videoforge/src:{root}",
        "HF_HUB_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
    }
    source_input_sha256 = _sha256(source_path)
    audio_input_sha256 = _sha256(audio_path)
    gpu_started = time.monotonic()
    try:
        gpu = (
            subprocess.run(
                ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
                check=True,
                capture_output=True,
                text=True,
                timeout=30,
            )
            .stdout.strip()
            .splitlines()
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError("AVATAR_GPU_QUERY_FAILED") from error
    if len(gpu) != 1:
        raise ValueError("AVATAR_GPU_INVALID")
    gpu_name, gpu_vram = [item.strip() for item in gpu[0].rsplit(",", 1)]
    _validate_gpu_profile(gpu_name, int(gpu_vram))
    inference_started = time.monotonic()
    with tempfile.TemporaryFile() as diagnostic:
        try:
            peak_vram, generation_ms = _run_inference_with_peak_vram(
                command,
                root=root,
                env=env,
                timeout_seconds=timeout_seconds,
                diagnostic=diagnostic,
            )
        except subprocess.TimeoutExpired as error:
            raise _inference_failure(
                "AVATAR_INFERENCE_TIMEOUT", _diagnostic_tail(diagnostic)
            ) from error
        except subprocess.CalledProcessError as error:
            tail = _diagnostic_tail(diagnostic)
            raise _inference_failure(classify_inference_failure(tail), tail) from error
    inference_ms = round((time.monotonic() - inference_started) * 1000)
    output_path = _resolve_inference_output(output_root)
    duration_ms, fps, width, height = _probe(output_path)
    return (
        {
            "schema_version": "videoforge.avatar-primary-result/v1",
            "attempt_id": attempt_id,
            "output_sha256": _sha256(output_path),
            "bytes": output_path.stat().st_size,
            "duration_ms": duration_ms,
            "fps": fps,
            "width": width,
            "height": height,
            "source_revision": AVATAR_SOURCE_REVISION,
            "weights_revision": AVATAR_WEIGHTS_REVISION,
            "base_revision": WAN_REVISION,
            "audio_encoder_revision": WAV2VEC_REVISION,
            "upstream_config_sha256": f"{SHA256_PREFIX}{UPSTREAM_CONFIG_SHA256}",
            "inference_config_sha256": INFERENCE_CONFIG_SHA256,
            "source_input_sha256": source_input_sha256,
            "audio_input_sha256": audio_input_sha256,
            "gpu_name": gpu_name,
            "gpu_vram_total_mb": int(gpu_vram),
            "peak_vram_mb": peak_vram,
            "runtime_stages_ms": {
                "gpu_preflight": round((inference_started - gpu_started) * 1000),
                "generation": generation_ms,
                "model_load_and_inference_encode": inference_ms,
            },
            "bootstrap": {},
        },
        output_path,
    )


def run_avatar_primary_job(job: AvatarPrimaryJob) -> AvatarPrimaryResult:
    with tempfile.TemporaryDirectory(prefix="videoforge-avatar-") as temporary:
        task_root = Path(temporary)
        source_path = task_root / "source.jpg"
        audio_path = task_root / "span.wav"
        output_root = task_root / "output"
        _download(job.source_url, source_path, job.source_sha256, 25 * 1024 * 1024)
        _download(job.span_audio_url, audio_path, job.span_audio_sha256, 100 * 1024 * 1024)
        result, output_path = _execute(
            attempt_id=job.attempt_id,
            prompt=job.prompt,
            num_output_frames=job.num_output_frames,
            timeout_seconds=job.timeout_seconds,
            source_path=source_path,
            audio_path=audio_path,
            output_root=output_root,
        )
        delivery_path = task_root / "delivery.mp4"
        _encode_delivery_output(output_path, delivery_path)
        duration_ms, fps, width, height = _probe(delivery_path)
        result = {
            **result,
            "output_sha256": _sha256(delivery_path),
            "bytes": delivery_path.stat().st_size,
            "duration_ms": duration_ms,
            "fps": fps,
            "width": width,
            "height": height,
        }
        _upload(job.output_put_url, delivery_path)
        return result


def _decode_inline(encoded: str, destination: Path, expected_sha256: str) -> None:
    try:
        value = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("AVATAR_INLINE_BASE64_INVALID") from error
    if len(value) > 2 * 1024 * 1024:
        raise ValueError("AVATAR_INLINE_INPUT_TOO_LARGE")
    destination.write_bytes(value)
    if _sha256(destination) != expected_sha256:
        raise ValueError("AVATAR_INPUT_CHECKSUM_MISMATCH")


def run_avatar_primary_inline_job(job: AvatarPrimaryInlineJob) -> AvatarPrimaryInlineResult:
    with tempfile.TemporaryDirectory(prefix="videoforge-avatar-qualification-") as temporary:
        task_root = Path(temporary)
        source_path = task_root / "source.jpg"
        audio_path = task_root / "span.wav"
        output_root = task_root / "output"
        _decode_inline(job.source_base64, source_path, job.source_sha256)
        _decode_inline(job.span_audio_base64, audio_path, job.span_audio_sha256)
        result, output_path = _execute(
            attempt_id=job.attempt_id,
            prompt=job.prompt,
            num_output_frames=job.num_output_frames,
            timeout_seconds=job.timeout_seconds,
            source_path=source_path,
            audio_path=audio_path,
            output_root=output_root,
        )
        inline_path = task_root / "inline.mp4"
        _encode_delivery_output(output_path, inline_path)
        duration_ms, fps, width, height = _probe(inline_path)
        result = {
            **result,
            "output_sha256": _sha256(inline_path),
            "bytes": inline_path.stat().st_size,
            "duration_ms": duration_ms,
            "fps": fps,
            "width": width,
            "height": height,
        }
        return {
            **result,
            "output_base64": base64.b64encode(inline_path.read_bytes()).decode("ascii"),
        }

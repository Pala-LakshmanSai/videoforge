from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, TypedDict

SHA256_PREFIX = "sha256:"
AVATAR_SOURCE_REVISION = "63b73e6c0f7bb42180ca6d7e1bf11c1de1a80b39"
AVATAR_WEIGHTS_REVISION = "e2448919a7b535c29f34e07892884ae1a43c6ace"
WAN_REVISION = "37ec512624d61f7aa208f7ea8140a131f93afc9a"
WAV2VEC_REVISION = "22aad52d435eb6dbaf354bdad9b0da84ce7d6156"
ALLOWED_LAYOUTS = {"AVATAR_FULL", "SPLIT_LEFT_AVATAR"}


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
            or job.num_output_frames > 225
            or (job.num_output_frames - 1) % 4 != 0
        ):
            raise ValueError("AVATAR_FRAME_COUNT_INVALID")
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
    with urllib.request.urlopen(request, timeout=120) as response, destination.open("xb") as output:
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > maximum_bytes:
                raise ValueError("AVATAR_INPUT_TOO_LARGE")
            output.write(chunk)
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


def run_avatar_primary_job(job: AvatarPrimaryJob) -> AvatarPrimaryResult:
    root = Path(os.environ.get("AVATARFORCING_ROOT", "/opt/avatarforcing")).resolve()
    model_root = Path(os.environ.get("AVATARFORCING_MODEL_ROOT", "/models")).resolve()
    model_path = model_root / "avatarforcing" / "model.pt"
    if not root.is_dir() or not model_path.is_file():
        raise ValueError("AVATAR_MODEL_NOT_READY")
    with tempfile.TemporaryDirectory(prefix="videoforge-avatar-") as temporary:
        task_root = Path(temporary)
        source_path = task_root / "source.jpg"
        audio_path = task_root / "span.wav"
        prompt_path = task_root / "input.txt"
        output_root = task_root / "output"
        _download(job.source_url, source_path, job.source_sha256, 25 * 1024 * 1024)
        _download(job.span_audio_url, audio_path, job.span_audio_sha256, 100 * 1024 * 1024)
        prompt_path.write_text(
            f"{source_path} {audio_path} {json.dumps(job.prompt.strip(), ensure_ascii=False)}\n",
            encoding="utf-8",
        )
        env = {
            **os.environ,
            "PYTHONPATH": str(root),
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
        }
        subprocess.run(
            [
                "python",
                "inference.py",
                "--config_path",
                "configs/avatarforcing.yaml",
                "--output_folder",
                str(output_root),
                "--checkpoint_path",
                str(model_path),
                "--data_path",
                str(prompt_path),
                "--num_output_frames",
                str(job.num_output_frames),
                "--seed",
                "42",
                "--num_samples",
                "1",
                "--save_with_index",
                "--i2v",
            ],
            cwd=root,
            env=env,
            check=True,
            timeout=job.timeout_seconds,
        )
        output_path = output_root / "0-0_regular.mp4"
        if not output_path.is_file():
            raise ValueError("AVATAR_OUTPUT_MISSING")
        duration_ms, fps, width, height = _probe(output_path)
        output_sha256 = _sha256(output_path)
        output_bytes = output_path.stat().st_size
        _upload(job.output_put_url, output_path)
        return {
            "schema_version": "videoforge.avatar-primary-result/v1",
            "attempt_id": job.attempt_id,
            "output_sha256": output_sha256,
            "bytes": output_bytes,
            "duration_ms": duration_ms,
            "fps": fps,
            "width": width,
            "height": height,
            "source_revision": AVATAR_SOURCE_REVISION,
            "weights_revision": AVATAR_WEIGHTS_REVISION,
        }

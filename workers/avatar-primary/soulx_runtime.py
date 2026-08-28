from __future__ import annotations

import base64
import hashlib
import math
import os
import subprocess
import tempfile
import threading
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
import torch
from PIL import Image

from soulx_volume import (
    SOULX_SOURCE_REVISION,
    expected_manifest_sha256,
    validate_warmup_observation,
    verify_volume,
    volume_root,
    warmup_attestation_sha256,
)


class SoulXRuntime:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._state = "loading"
        self._error: str | None = None
        self._jobs: dict[str, dict[str, Any]] = {}
        self._pipeline: Any = None
        self._infer: Any = None
        self._boot_started = time.monotonic()
        self._timings: dict[str, int] = {}
        self._gpu: dict[str, Any] = {}
        self._warmup_attestation_sha256: str | None = None

    def initialize(self) -> None:
        try:
            verified_at = time.monotonic()
            verification = verify_volume()
            self._timings["manifest_verify_ms"] = round((time.monotonic() - verified_at) * 1000)

            if not torch.cuda.is_available():
                raise RuntimeError("SoulX Pro requires CUDA")
            properties = torch.cuda.get_device_properties(0)
            self._gpu = {
                "name": properties.name,
                "vram_bytes": properties.total_memory,
                "compute_capability": f"{properties.major}.{properties.minor}",
            }
            load_started = time.monotonic()
            os.chdir("/opt/soulx-flashhead")
            from flash_head import inference

            self._infer = inference
            root = volume_root()
            self._pipeline = inference.get_pipeline(
                world_size=1,
                ckpt_dir=str(root / "checkpoint"),
                wav2vec_dir=str(root / "wav2vec"),
                model_type="pro",
            )
            self._timings["model_load_ms"] = round((time.monotonic() - load_started) * 1000)
            warmup_started = time.monotonic()
            warmup_facts = self._warmup()
            self._warmup_attestation_sha256 = warmup_attestation_sha256(
                os.environ.get("VIDEOFORGE_SOULX_CONTAINER_DIGEST", ""), warmup_facts
            )
            self._timings["compile_warmup_ms"] = round((time.monotonic() - warmup_started) * 1000)
            self._timings["model_ready_ms"] = round((time.monotonic() - self._boot_started) * 1000)
            self._timings["manifest_total_bytes"] = int(verification["total_bytes"])
            torch.cuda.reset_peak_memory_stats()
            with self._state_lock:
                self._state = "ready"
        except Exception as error:
            with self._state_lock:
                self._state = "failed"
                self._error = f"{type(error).__name__}: {error}"

    def _warmup(self) -> dict[str, object]:
        with tempfile.TemporaryDirectory(prefix="vf924s-warmup-") as temp_dir:
            image_path = Path(temp_dir) / "warmup.png"
            Image.new("RGB", (512, 512), (112, 112, 112)).save(image_path)
            self._infer.get_base_data(
                self._pipeline,
                cond_image_path_or_dir=str(image_path),
                base_seed=42,
                use_face_crop=False,
            )
            params = self._infer.get_infer_params()
            audio = (
                np.sin(
                    2
                    * np.pi
                    * 220
                    * np.arange(params["sample_rate"] * params["cached_audio_duration"])
                    / params["sample_rate"]
                ).astype(np.float32)
                * 0.01
            )
            embedding = self._infer.get_audio_embedding(
                self._pipeline,
                audio,
                params["cached_audio_duration"] * params["tgt_fps"] - params["frame_num"],
                params["cached_audio_duration"] * params["tgt_fps"],
            )
            frames = self._infer.run_pipeline(self._pipeline, embedding)
            torch.cuda.synchronize()
            params_contract = {
                "sample_rate": params.get("sample_rate"),
                "tgt_fps": params.get("tgt_fps"),
                "frame_num": params.get("frame_num"),
                "motion_frames_num": params.get("motion_frames_num"),
            }
            observed = frames.detach().float().cpu().numpy()
            return validate_warmup_observation(
                parameters=params_contract,
                output_shape=tuple(observed.shape),
                output_finite=bool(np.isfinite(observed).all()),
                output_min=float(observed.min()) if observed.size else None,
                output_max=float(observed.max()) if observed.size else None,
            )

    def health(self) -> dict[str, Any]:
        with self._state_lock:
            return {
                "schema_version": "videoforge.soulx-flashhead-pro-worker-health/v1",
                "service": "videoforge-soulx-flashhead-pro-vf924s",
                "state": self._state,
                "error": self._error,
                "source_revision": SOULX_SOURCE_REVISION,
                "manifest_sha256": expected_manifest_sha256(),
                "warmup_attestation_sha256": self._warmup_attestation_sha256,
                "settings": {
                    "model_type": "pro",
                    "precision": "bfloat16",
                    "width": 512,
                    "height": 512,
                    "fps": 25,
                    "sampling_steps": 4,
                    "shift": 5,
                    "color_correction_strength": 1.0,
                    "seed": 42,
                    "torch_compile": True,
                    "audio_encode_mode": "stream",
                    "face_crop": False,
                },
                "gpu": self._gpu,
                "timings": self._timings,
            }

    def submit(self, source_b64: str, audio_b64: str) -> str:
        if self.health()["state"] != "ready":
            raise RuntimeError("SoulX runtime is not ready")
        job_id = uuid.uuid4().hex
        with self._state_lock:
            self._jobs[job_id] = {"status": "queued", "job_id": job_id}
        threading.Thread(
            target=self._run_job,
            args=(job_id, source_b64, audio_b64),
            daemon=True,
        ).start()
        return job_id

    def job(self, job_id: str) -> dict[str, Any]:
        with self._state_lock:
            if job_id not in self._jobs:
                raise KeyError(job_id)
            return dict(self._jobs[job_id])

    def _run_job(self, job_id: str, source_b64: str, audio_b64: str) -> None:
        try:
            with self._lock:
                with self._state_lock:
                    self._jobs[job_id] = {"status": "running", "job_id": job_id}
                result = self._generate(source_b64, audio_b64)
            with self._state_lock:
                self._jobs[job_id] = {"status": "complete", "job_id": job_id, **result}
        except Exception as error:
            with self._state_lock:
                self._jobs[job_id] = {
                    "status": "failed",
                    "job_id": job_id,
                    "error": f"{type(error).__name__}: {error}",
                }

    def _generate(self, source_b64: str, audio_b64: str) -> dict[str, Any]:
        scratch_root = Path(os.environ.get("SOULX_SCRATCH_ROOT", "/run/videoforge/soulx-scratch"))
        scratch_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="vf924s-job-", dir=scratch_root) as temp_dir:
            root = Path(temp_dir)
            source_path = root / "source.png"
            audio_path = root / "audio.wav"
            silent_path = root / "silent.mp4"
            output_path = root / "output.mp4"
            source_path.write_bytes(base64.b64decode(source_b64, validate=True))
            audio_path.write_bytes(base64.b64decode(audio_b64, validate=True))
            with Image.open(source_path) as source:
                source.verify()
            speech, sample_rate = sf.read(audio_path, dtype="float32", always_2d=False)
            if sample_rate != 16_000 or speech.ndim != 1:
                raise RuntimeError("audio must be mono 16 kHz PCM WAV")
            target_frames = round(len(speech) * 25 / 16_000)
            if target_frames < 75 or target_frames > 253:
                raise RuntimeError("sample duration must be 3.00 through 10.12 seconds")
            exact_duration = target_frames / 25

            params_started = time.monotonic()
            self._infer.get_base_data(
                self._pipeline,
                cond_image_path_or_dir=str(source_path),
                base_seed=42,
                use_face_crop=False,
            )
            torch.cuda.synchronize()
            base_prepare_ms = round((time.monotonic() - params_started) * 1000)

            params = self._infer.get_infer_params()
            slice_frames = params["frame_num"] - params["motion_frames_num"]
            slice_samples = slice_frames * params["sample_rate"] // params["tgt_fps"]
            chunks = math.ceil(target_frames / slice_frames)
            padded = np.pad(speech, (0, chunks * slice_samples - len(speech)))
            audio_history = deque(
                [0.0] * (params["sample_rate"] * params["cached_audio_duration"]),
                maxlen=params["sample_rate"] * params["cached_audio_duration"],
            )
            audio_end = params["cached_audio_duration"] * params["tgt_fps"]
            audio_start = audio_end - params["frame_num"]
            generated: list[np.ndarray] = []
            inference_started = time.monotonic()
            for audio_slice in padded.reshape(-1, slice_samples):
                audio_history.extend(audio_slice.tolist())
                embedding = self._infer.get_audio_embedding(
                    self._pipeline,
                    np.asarray(audio_history, dtype=np.float32),
                    audio_start,
                    audio_end,
                )
                frames = self._infer.run_pipeline(self._pipeline, embedding)
                frames = frames[params["motion_frames_num"] :].cpu().numpy().astype(np.uint8)
                generated.append(frames)
            torch.cuda.synchronize()
            inference_ms = round((time.monotonic() - inference_started) * 1000)
            frames = np.concatenate(generated, axis=0)[:target_frames]

            encode_started = time.monotonic()
            command = [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "-s:v",
                "512x512",
                "-r",
                "25",
                "-i",
                "pipe:0",
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "slow",
                "-crf",
                "15",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                str(silent_path),
            ]
            subprocess.run(command, input=frames.tobytes(), check=True)
            subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-i",
                    str(silent_path),
                    "-i",
                    str(audio_path),
                    "-map",
                    "0:v:0",
                    "-map",
                    "1:a:0",
                    "-c:v",
                    "copy",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-t",
                    f"{exact_duration:.2f}",
                    "-movflags",
                    "+faststart",
                    str(output_path),
                ],
                check=True,
            )
            encode_ms = round((time.monotonic() - encode_started) * 1000)
            output = output_path.read_bytes()
            return {
                "output_base64": base64.b64encode(output).decode(),
                "output_sha256": hashlib.sha256(output).hexdigest(),
                "output_bytes": len(output),
                "frame_count": target_frames,
                "duration_seconds": exact_duration,
                "timings": {
                    "source_and_base_prepare_ms": base_prepare_ms,
                    "inference_ms": inference_ms,
                    "encode_and_mux_ms": encode_ms,
                },
                "peak_vram_bytes": torch.cuda.max_memory_allocated(),
            }


runtime = SoulXRuntime()

from __future__ import annotations

import asyncio
import hashlib
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

from mage_bootstrap import bootstrap
from mage_volume import MAGE_COMFYUI_REVISION, MAGE_MODEL_REVISION, MAGE_PRECISION
from videoforge_image_media import MageInlineJob, run_inline_job

MIN_GPU_MEMORY_BYTES = 16_380 * 1024**2
COMFY_URL = "http://127.0.0.1:8188"
SUPPORTED_GPU_NAMES = {
    "NVIDIA GeForce RTX 4090": "4090",
    "NVIDIA RTX PRO 4500 Blackwell": "RTX PRO 4500",
}
SHA256 = re.compile(r"^sha256:[a-f0-9]{64}$")
IMAGE_DIGEST = re.compile(r"^ghcr\.io/pala-lakshmansai/videoforge-mage-cp06@sha256:[a-f0-9]{64}$")


class MageRuntime:
    def __init__(self) -> None:
        self.started = time.monotonic()
        self.phase_started = self.started
        self.phase = "process"
        self.phase_timings_ms: dict[str, int] = {}
        self.error_code: str | None = None
        self.ready = False
        self.gpu: dict[str, object] = {
            "available": False,
            "approved": False,
            "device_count": 0,
        }
        self.bootstrap_evidence: dict[str, object] | None = None
        self.warmup_output_sha256: str | None = None
        self.comfy_process: subprocess.Popen[bytes] | None = None
        self.generation_lock = asyncio.Lock()

    def transition(self, phase: str) -> None:
        now = time.monotonic()
        self.phase_timings_ms[self.phase] = round((now - self.phase_started) * 1000)
        self.phase = phase
        self.phase_started = now

    async def startup(self) -> None:
        try:
            self.verify_runtime_identity()
            self.transition("storage")
            model_root = Path(os.environ.get("MAGE_MODEL_ROOT", "/runpod-volume"))
            comfy_root = Path(os.environ.get("COMFY_ROOT", "/opt/comfyui"))
            self.bootstrap_evidence = await asyncio.to_thread(bootstrap, model_root, comfy_root)
            self.transition("gpu_load")
            await asyncio.to_thread(self.verify_gpu)
            await asyncio.to_thread(self.start_comfyui, comfy_root)
            await self.wait_for_comfyui()
            self.transition("warmup")
            self.warmup_output_sha256 = await asyncio.to_thread(self.real_warmup, model_root)
            self.gpu["ready_vram_used_bytes"] = self.device_vram_used_bytes()
            self.transition("ready")
            self.phase_timings_ms.setdefault("ready", 0)
            self.ready = True
        except Exception as error:
            self.error_code = str(error)[:120] if str(error) else "MAGE_WORKER_BOOT_FAILED"
            self.transition("error")

    @staticmethod
    def verify_runtime_identity() -> None:
        if not SHA256.fullmatch(os.environ.get("VIDEOFORGE_MAGE_VOLUME_ID_HASH", "")):
            raise RuntimeError("MAGE_VOLUME_IDENTITY_INVALID")
        if not IMAGE_DIGEST.fullmatch(os.environ.get("VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST", "")):
            raise RuntimeError("MAGE_WORKER_IMAGE_IDENTITY_INVALID")
        if not os.environ.get("RUNPOD_POD_ID"):
            raise RuntimeError("MAGE_POD_IDENTITY_INVALID")
        if len(os.environ.get("VIDEOFORGE_MAGE_WORKER_TOKEN", "")) < 32:
            raise RuntimeError("MAGE_WORKER_TOKEN_INVALID")
        if os.environ.get("VIDEOFORGE_MAGE_GPU_OFFERING_ID") not in SUPPORTED_GPU_NAMES:
            raise RuntimeError("MAGE_GPU_OFFERING_INVALID")

    def verify_gpu(self) -> None:
        try:
            import torch
        except Exception as error:
            raise RuntimeError("MAGE_TORCH_UNAVAILABLE") from error
        if not torch.cuda.is_available() or torch.cuda.device_count() != 1:
            raise RuntimeError("MAGE_EXACTLY_ONE_CUDA_GPU_REQUIRED")
        name = torch.cuda.get_device_name(0)
        properties = torch.cuda.get_device_properties(0)
        offering = os.environ.get("VIDEOFORGE_MAGE_GPU_OFFERING_ID")
        expected_name = SUPPORTED_GPU_NAMES.get(str(offering))
        if expected_name is None or expected_name.upper() not in name.upper():
            raise RuntimeError("MAGE_GPU_OFFERING_MISMATCH")
        if "NVIDIA" not in name.upper() or properties.total_memory < MIN_GPU_MEMORY_BYTES:
            raise RuntimeError("MAGE_GPU_INCOMPATIBLE")
        cuda_version = str(torch.version.cuda or "")
        try:
            cuda_major, cuda_minor = (int(part) for part in cuda_version.split(".")[:2])
        except (TypeError, ValueError) as error:
            raise RuntimeError("MAGE_CUDA_VERSION_INVALID") from error
        if (cuda_major, cuda_minor) < (13, 0):
            raise RuntimeError("MAGE_CUDA_VERSION_INCOMPATIBLE")
        self.gpu = {
            "available": True,
            "approved": True,
            "device_count": 1,
            "name": name,
            "offering_id": offering,
            "total_memory_bytes": properties.total_memory,
            "cuda_version": cuda_version,
            "torch_version": torch.__version__,
        }

    @staticmethod
    def device_vram_used_bytes() -> int:
        import torch

        free_bytes, total_bytes = torch.cuda.mem_get_info(0)
        used_bytes = int(total_bytes) - int(free_bytes)
        if used_bytes <= 0 or used_bytes > int(total_bytes):
            raise RuntimeError("MAGE_VRAM_USAGE_INVALID")
        return used_bytes

    async def sample_peak_vram_used(self, stop: asyncio.Event) -> int:
        peak = 0
        while True:
            peak = max(peak, self.device_vram_used_bytes())
            if stop.is_set():
                return peak
            try:
                await asyncio.wait_for(stop.wait(), timeout=0.05)
            except TimeoutError:
                pass

    def start_comfyui(self, comfy_root: Path) -> None:
        main = comfy_root / "main.py"
        if not main.is_file():
            raise RuntimeError("MAGE_COMFYUI_MISSING")
        environment = dict(os.environ)
        environment.update(
            {
                "HF_HUB_OFFLINE": "1",
                "TRANSFORMERS_OFFLINE": "1",
                "DIFFUSERS_OFFLINE": "1",
            }
        )
        self.comfy_process = subprocess.Popen(
            [
                sys.executable,
                str(main),
                "--listen",
                "127.0.0.1",
                "--port",
                "8188",
                "--output-directory",
                "/tmp/comfy-output",
                "--disable-auto-launch",
                "--disable-metadata",
            ],
            cwd=comfy_root,
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )

    async def wait_for_comfyui(self) -> None:
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            if self.comfy_process is not None and self.comfy_process.poll() is not None:
                raise RuntimeError("MAGE_COMFYUI_EXITED_DURING_BOOT")
            try:
                await asyncio.to_thread(self.probe_comfyui)
                return
            except (URLError, OSError, TimeoutError):
                await asyncio.sleep(1)
        raise RuntimeError("MAGE_COMFYUI_START_TIMEOUT")

    @staticmethod
    def probe_comfyui() -> None:
        with urlopen(f"{COMFY_URL}/system_stats", timeout=2) as response:
            if response.status != 200:
                raise RuntimeError("MAGE_COMFYUI_HEALTH_INVALID")

    @staticmethod
    def real_warmup(model_root: Path) -> str:
        prompt = "A neutral studio lighting calibration chart, no text, no logo"
        negative = "text, letters, logo, watermark, malformed objects"
        job = MageInlineJob.from_value(
            {
                "mode": "INLINE_QUALIFICATION_V1",
                "attempt_id": "videoforge_mage_warmup",
                "model_revision": MAGE_MODEL_REVISION,
                "items": [
                    {
                        "scene_id": "warmup",
                        "positive_prompt": prompt,
                        "positive_prompt_sha256": "sha256:"
                        + hashlib.sha256(prompt.encode()).hexdigest(),
                        "negative_prompt": negative,
                        "negative_prompt_sha256": "sha256:"
                        + hashlib.sha256(negative.encode()).hexdigest(),
                        "seed": 0,
                        "width": 1280,
                        "height": 720,
                    }
                ],
            }
        )
        result = run_inline_job(job, model_root, base_url=COMFY_URL)
        if result["width"] != 1280 or result["height"] != 720:
            raise RuntimeError("MAGE_WARMUP_OUTPUT_INVALID")
        return str(result["output_sha256"])

    async def generate(self, value: object) -> dict[str, object]:
        if not self.ready:
            raise RuntimeError("MAGE_WORKER_NOT_READY")
        job = MageInlineJob.from_value(value)
        model_root = Path(os.environ.get("MAGE_MODEL_ROOT", "/runpod-volume"))
        async with self.generation_lock:
            import torch

            torch.cuda.reset_peak_memory_stats(0)
            stop = asyncio.Event()
            sampler = asyncio.create_task(self.sample_peak_vram_used(stop))
            try:
                result = await asyncio.to_thread(
                    run_inline_job, job, model_root, base_url=COMFY_URL
                )
            finally:
                stop.set()
                peak_vram_used_bytes = await sampler
        result["runtime_evidence"] = self.runtime_evidence(
            peak_vram_used_bytes=peak_vram_used_bytes
        )
        return result

    def runtime_evidence(self, *, peak_vram_used_bytes: int) -> dict[str, object]:
        import torch

        gpu = {
            **self.gpu,
            "memory_allocated_bytes": torch.cuda.memory_allocated(0),
            "memory_reserved_bytes": torch.cuda.memory_reserved(0),
            "peak_memory_allocated_bytes": torch.cuda.max_memory_allocated(0),
            "peak_memory_reserved_bytes": torch.cuda.max_memory_reserved(0),
            "peak_vram_used_bytes": peak_vram_used_bytes,
        }
        return {
            "schema_version": "videoforge.mage-runtime-evidence/v3",
            "pod_id_hash": "sha256:"
            + hashlib.sha256(os.environ.get("RUNPOD_POD_ID", "local").encode()).hexdigest(),
            "volume_id_hash": os.environ.get("VIDEOFORGE_MAGE_VOLUME_ID_HASH"),
            "worker_image_digest": os.environ.get("VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST"),
            "model_revision": MAGE_MODEL_REVISION,
            "comfyui_revision": MAGE_COMFYUI_REVISION,
            "precision": MAGE_PRECISION,
            "bootstrap": self.bootstrap_evidence,
            "gpu": gpu,
        }

    def health(self) -> dict[str, object]:
        current_timings = dict(self.phase_timings_ms)
        if self.phase not in {"ready", "error"}:
            current_timings[self.phase] = round((time.monotonic() - self.phase_started) * 1000)
        return {
            "schema_version": "videoforge.mage-worker-health/v2",
            "service": "videoforge-mage-pod",
            "process": {
                "status": "ok",
                "uptime_ms": round((time.monotonic() - self.started) * 1000),
            },
            "phase": self.phase,
            "model": {
                "id": "Comfy-Org/Mage-Flow",
                "revision": MAGE_MODEL_REVISION,
                "precision": MAGE_PRECISION,
                "status": "ready" if self.ready else "error" if self.error_code else "loading",
            },
            "gpu": dict(self.gpu),
            "phase_timings_ms": current_timings,
            **({"error": {"code": self.error_code}} if self.error_code else {}),
        }

    async def shutdown(self) -> None:
        self.ready = False
        process = self.comfy_process
        self.comfy_process = None
        if process is None or process.poll() is not None:
            return
        os.killpg(os.getpgid(process.pid), signal.SIGTERM)
        try:
            await asyncio.to_thread(process.wait, 20)
        except subprocess.TimeoutExpired:
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
            await asyncio.to_thread(process.wait, 10)

from __future__ import annotations

import json
import os
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

import runpod

from mage_bootstrap import verify_model_root
from videoforge_image_media import MAGE_MODEL_REVISION, MageInlineJob, run_inline_job
from videoforge_image_media.mage_production import MageContractError

MODEL_ROOT = Path(os.environ.get("MAGE_MODEL_ROOT", "/models/mage-flow-turbo"))
_bootstrap_lock = threading.Lock()
_Result = TypeVar("_Result")


def _read_timing(path: str, schema_version: str) -> dict[str, object]:
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as error:
        raise MageContractError("MAGE_RUNTIME_EVIDENCE_INVALID") from error
    if not isinstance(value, dict) or value.get("schema_version") != schema_version:
        raise MageContractError("MAGE_RUNTIME_EVIDENCE_INVALID")
    return value


def runtime_evidence(received_unix_ms: int) -> dict[str, object]:
    try:
        import torch

        properties = torch.cuda.get_device_properties(0)
        gpu = {
            "name": torch.cuda.get_device_name(0),
            "total_memory_bytes": properties.total_memory,
            "cuda_version": torch.version.cuda,
            "torch_version": torch.__version__,
        }
    except Exception as error:
        raise MageContractError("MAGE_GPU_EVIDENCE_UNAVAILABLE") from error
    return {
        "schema_version": "videoforge.mage-runtime-evidence/v1",
        "network_volume_attached": False,
        "handler_received_unix_ms": received_unix_ms,
        "handler_completed_unix_ms": round(time.time() * 1000),
        "bootstrap": _read_timing("/tmp/mage-bootstrap.json", "videoforge.mage-bootstrap/v1"),
        "comfy_start": _read_timing("/tmp/mage-comfy-start.json", "videoforge.mage-comfy-start/v1"),
        "gpu": gpu,
    }


def safe_progress(event: dict[str, object], phase: str) -> None:
    try:
        runpod.serverless.progress_update(event, phase)
    except Exception:
        return


def ensure_model(event: dict[str, object]) -> None:
    with _bootstrap_lock:
        safe_progress(event, "bootstrap_mage_verify_started")
        try:
            verify_model_root(MODEL_ROOT)
        except Exception as error:
            raise MageContractError("MAGE_BOOTSTRAP_FAILED") from error
        safe_progress(event, "bootstrap_mage_verify_complete")


def run_with_heartbeat(
    event: dict[str, object], operation: Callable[[], _Result], interval_seconds: float = 30
) -> _Result:
    stopped = threading.Event()

    def heartbeat() -> None:
        elapsed = 0
        while not stopped.wait(interval_seconds):
            elapsed += round(interval_seconds)
            safe_progress(event, f"inference_mage_heartbeat_{elapsed}s")

    safe_progress(event, "inference_mage_started")
    thread = threading.Thread(target=heartbeat, name="mage-heartbeat", daemon=True)
    thread.start()
    try:
        result = operation()
        safe_progress(event, "output_mage_validated")
        return result
    finally:
        stopped.set()
        thread.join(timeout=1)


def handler(event: dict[str, object]) -> dict[str, object]:
    try:
        received_unix_ms = round(time.time() * 1000)
        value = event.get("input")
        if not isinstance(value, dict):
            raise MageContractError("MAGE_INLINE_JOB_SHAPE_INVALID")
        if value.get("cancel_requested") is True:
            return {"ok": False, "error_code": "MAGE_INFERENCE_CANCELLED"}
        job = MageInlineJob.from_value(value)
        ensure_model(event)
        result = run_with_heartbeat(event, lambda: run_inline_job(job, MODEL_ROOT))
        result["runtime_evidence"] = runtime_evidence(received_unix_ms)  # type: ignore[typeddict-unknown-key]
        return {"ok": True, "result": result}
    except MageContractError as error:
        return {"ok": False, "error_code": str(error)[:120]}
    except Exception:
        return {"ok": False, "error_code": "MAGE_WORKER_FAILED"}


def start_worker() -> None:
    print(
        json.dumps(
            {"event": "mage_worker_start", "model_revision": MAGE_MODEL_REVISION}, sort_keys=True
        ),
        flush=True,
    )
    runpod.serverless.start({"handler": handler})


if __name__ == "__main__":
    start_worker()

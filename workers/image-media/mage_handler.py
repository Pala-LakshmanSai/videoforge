from __future__ import annotations

import json
import os
import threading
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

import runpod

from mage_bootstrap import verify_embedded_model
from videoforge_image_media import MAGE_MODEL_REVISION, MageInlineJob, run_inline_job
from videoforge_image_media.mage_production import MageContractError

MODEL_ROOT = Path(os.environ.get("MAGE_MODEL_ROOT", "/models/mage-flow-turbo"))
_bootstrap_lock = threading.Lock()
_Result = TypeVar("_Result")


def safe_progress(event: dict[str, object], phase: str) -> None:
    try:
        runpod.serverless.progress_update(event, phase)
    except Exception:
        return


def ensure_model(event: dict[str, object]) -> None:
    with _bootstrap_lock:
        safe_progress(event, "bootstrap_mage_verify_started")
        try:
            verify_embedded_model(MODEL_ROOT)
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
        value = event.get("input")
        if not isinstance(value, dict):
            raise MageContractError("MAGE_INLINE_JOB_SHAPE_INVALID")
        if value.get("cancel_requested") is True:
            return {"ok": False, "error_code": "MAGE_INFERENCE_CANCELLED"}
        job = MageInlineJob.from_value(value)
        ensure_model(event)
        result = run_with_heartbeat(event, lambda: run_inline_job(job, MODEL_ROOT))
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

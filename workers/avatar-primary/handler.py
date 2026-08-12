from __future__ import annotations

import threading
import hashlib
import json
import os
from collections.abc import Callable
from typing import TypeVar

import runpod

from bootstrap_models import bootstrap_models
from videoforge_avatar_primary import (
    AvatarPrimaryInlineJob,
    AvatarPrimaryInferenceFailure,
    AvatarPrimaryJob,
    run_avatar_primary_inline_job,
    run_avatar_primary_job,
)
from videoforge_avatar_primary.production import AVATAR_SOURCE_REVISION

_bootstrap_lock = threading.Lock()
_Result = TypeVar("_Result")


def _diagnostic_hash(error: Exception) -> str:
    return "sha256:" + hashlib.sha256(str(error).encode("utf-8", errors="replace")).hexdigest()


def _bootstrap_failure_code(error: Exception) -> str:
    value = str(error)
    if isinstance(error, RuntimeError) and value.startswith("ECHOMIMIC_"):
        return "AVATAR_BOOTSTRAP_" + value.removeprefix("ECHOMIMIC_")
    if isinstance(error, OSError) and getattr(error, "errno", None) == 28:
        return "AVATAR_BOOTSTRAP_DISK_FULL"
    return "AVATAR_BOOTSTRAP_DOWNLOAD_FAILED"


def _progress(event: dict[str, object], stage: str) -> None:
    print(
        json.dumps({"event": "avatar_primary_progress", "stage": stage}, sort_keys=True), flush=True
    )
    runpod.serverless.progress_update(event, stage)


def _safe_progress(event: dict[str, object], stage: str) -> None:
    try:
        _progress(event, stage)
    except Exception:
        return


def _run_with_heartbeat(
    event: dict[str, object], operation: Callable[[], _Result], interval_seconds: float = 60
) -> _Result:
    stopped = threading.Event()

    def heartbeat() -> None:
        elapsed = 0
        while not stopped.wait(interval_seconds):
            elapsed += max(1, round(interval_seconds))
            _safe_progress(event, f"inference_echomimic_heartbeat_{elapsed}s")

    _safe_progress(event, "inference_echomimic_started")
    thread = threading.Thread(target=heartbeat, name="echomimic-heartbeat", daemon=True)
    thread.start()
    try:
        result = operation()
        _safe_progress(event, "output_echomimic_validated")
        return result
    finally:
        stopped.set()
        thread.join(timeout=1)


def ensure_models(event: dict[str, object]) -> dict[str, object]:
    with _bootstrap_lock:
        try:
            return bootstrap_models(lambda progress: _progress(event, progress))
        except Exception as error:
            code = _bootstrap_failure_code(error)
            print(
                json.dumps(
                    {
                        "diagnostic_sha256": _diagnostic_hash(error),
                        "error_code": code,
                        "event": "avatar_primary_bootstrap_failed",
                    },
                    sort_keys=True,
                ),
                flush=True,
            )
            raise ValueError(code) from error


def handler(event: dict[str, object]) -> dict[str, object]:
    try:
        bootstrap = ensure_models(event)
        value = event.get("input")
        if value == {"mode": "BOOTSTRAP_ONLY_V1"}:
            return {"ok": True, "result": {"bootstrap": bootstrap}}
        if isinstance(value, dict) and value.get("mode") == "INLINE_QUALIFICATION_V1":
            job = AvatarPrimaryInlineJob.from_value(value)
            result = _run_with_heartbeat(event, lambda: run_avatar_primary_inline_job(job))
            result["bootstrap"] = bootstrap
            return {"ok": True, "result": result}
        job = AvatarPrimaryJob.from_value(value)
        result = _run_with_heartbeat(event, lambda: run_avatar_primary_job(job))
        result["bootstrap"] = bootstrap
        return {"ok": True, "result": result}
    except AvatarPrimaryInferenceFailure as error:
        return {
            "ok": False,
            "error_code": str(error),
            "diagnostic_sha256": error.diagnostic_sha256,
        }
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) else "AVATAR_PRIMARY_FAILED"
        return {"ok": False, "error_code": code[:120]}


def start_worker() -> None:
    print(
        json.dumps(
            {
                "event": "avatar_primary_worker_start",
                "source_revision": AVATAR_SOURCE_REVISION,
            },
            sort_keys=True,
        ),
        flush=True,
    )
    if os.environ.get("VIDEOFORGE_WORKER_STARTUP_SMOKE") == "1":
        print(json.dumps({"event": "avatar_primary_startup_smoke_ok"}, sort_keys=True), flush=True)
        return
    runpod.serverless.start({"handler": handler})


if __name__ == "__main__":
    start_worker()

from __future__ import annotations

import json
import threading

import runpod

from bootstrap_models import bootstrap_models
from videoforge_avatar_quality import (
    SKYREELS_SOURCE_REVISION,
    SkyReelsInferenceFailure,
    SkyReelsInlineJob,
    SkyReelsJob,
    run_inline_job,
    run_job,
)

_bootstrap_lock = threading.Lock()


def ensure_models(event: dict[str, object]) -> None:
    with _bootstrap_lock:
        try:
            bootstrap_models(lambda value: runpod.serverless.progress_update(event, value))
        except Exception as error:
            raise ValueError("SKYREELS_BOOTSTRAP_FAILED") from error


def handler(event: dict[str, object]) -> dict[str, object]:
    try:
        value = event.get("input")
        if not isinstance(value, dict):
            raise ValueError("SKYREELS_JOB_SHAPE_INVALID")
        if value.get("cancel_requested") is True:
            return {"ok": False, "error_code": "SKYREELS_CANCELLED"}
        if value.get("mode") == "INLINE_QUALIFICATION_V1":
            job = SkyReelsInlineJob.from_value(value)
            ensure_models(event)
            return {"ok": True, "result": run_inline_job(job)}
        job = SkyReelsJob.from_value(value)
        ensure_models(event)
        return {"ok": True, "result": run_job(job)}
    except SkyReelsInferenceFailure as error:
        return {"ok": False, "error_code": str(error), "diagnostic_sha256": error.diagnostic_sha256}
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) else "SKYREELS_WORKER_FAILED"
        return {"ok": False, "error_code": code[:120]}


def start_worker() -> None:
    print(
        json.dumps(
            {"event": "avatar_quality_worker_start", "source_revision": SKYREELS_SOURCE_REVISION},
            sort_keys=True,
        ),
        flush=True,
    )
    runpod.serverless.start({"handler": handler})


if __name__ == "__main__":
    start_worker()

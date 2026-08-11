from __future__ import annotations

import threading
import json

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


def ensure_models(event: dict[str, object]) -> None:
    with _bootstrap_lock:
        try:
            bootstrap_models(lambda progress: runpod.serverless.progress_update(event, progress))
        except Exception as error:
            raise ValueError("AVATAR_BOOTSTRAP_FAILED") from error


def handler(event: dict[str, object]) -> dict[str, object]:
    try:
        ensure_models(event)
        value = event.get("input")
        if isinstance(value, dict) and value.get("mode") == "INLINE_QUALIFICATION_V1":
            job = AvatarPrimaryInlineJob.from_value(value)
            return {"ok": True, "result": run_avatar_primary_inline_job(job)}
        job = AvatarPrimaryJob.from_value(value)
        return {"ok": True, "result": run_avatar_primary_job(job)}
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
    runpod.serverless.start({"handler": handler})


if __name__ == "__main__":
    start_worker()

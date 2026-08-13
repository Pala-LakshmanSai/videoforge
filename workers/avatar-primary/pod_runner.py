from __future__ import annotations

import hmac
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from bootstrap_models import bootstrap_models
from videoforge_avatar_primary import (
    AvatarPrimaryInferenceFailure,
    AvatarPrimaryInlineJob,
    run_avatar_primary_inline_job,
)


STARTED = time.monotonic()
TOKEN = os.environ.get("VIDEOFORGE_POD_TOKEN", "")
RUN_LOCK = threading.Lock()
STATE_LOCK = threading.Lock()
JOB_STATE: dict[str, object] = {"status": "IDLE"}
MAX_BODY_BYTES = 6 * 1024 * 1024


def _set_state(**values: object) -> None:
    with STATE_LOCK:
        JOB_STATE.update(values)


def _run_job(job: AvatarPrimaryInlineJob, request_started: float) -> None:
    try:
        bootstrap = bootstrap_models(
            lambda stage: (
                print(json.dumps({"event": "pod_progress", "stage": stage}), flush=True),
                _set_state(progress=stage),
            )
        )
        _set_state(progress="inference_started")
        result = run_avatar_primary_inline_job(job)
        result["bootstrap"] = bootstrap
        _set_state(
            status="COMPLETED",
            progress="output_ready",
            response={
                "ok": True,
                "result": result,
                "request_execution_ms": round((time.monotonic() - request_started) * 1000),
            },
        )
    except AvatarPrimaryInferenceFailure as error:
        _set_state(
            status="FAILED",
            progress="failed",
            response={
                "diagnostic_sha256": error.diagnostic_sha256,
                "diagnostic_tail": error.diagnostic_tail.decode("utf-8", errors="replace"),
                "error_code": str(error),
                "ok": False,
            },
        )
    except Exception as error:
        _set_state(
            status="FAILED",
            progress="failed",
            response={"ok": False, "error_code": str(error)[:120]},
        )
    finally:
        RUN_LOCK.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "videoforge-pod-runner/v1"

    def log_message(self, format: str, *args: object) -> None:
        return

    def _json(self, status: int, value: object) -> None:
        body = json.dumps(value, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        supplied = self.headers.get("authorization", "").removeprefix("Bearer ")
        return len(TOKEN) >= 32 and hmac.compare_digest(supplied, TOKEN)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json(200, {"ok": True, "uptime_ms": round((time.monotonic() - STARTED) * 1000)})
            return
        if self.path == "/status" and self._authorized():
            with STATE_LOCK:
                value = dict(JOB_STATE)
            self._json(200, {"ok": True, **value})
            return
        if self.path != "/health":
            self._json(404, {"ok": False})
            return

    def do_POST(self) -> None:
        if self.path != "/run" or not self._authorized():
            self._json(401, {"ok": False})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError:
            length = 0
        if length < 1 or length > MAX_BODY_BYTES:
            self._json(413, {"ok": False})
            return
        if not RUN_LOCK.acquire(blocking=False):
            self._json(409, {"ok": False, "error_code": "AVATAR_POD_BUSY"})
            return
        request_started = time.monotonic()
        try:
            value = json.loads(self.rfile.read(length))
            job = AvatarPrimaryInlineJob.from_value(value)
            with STATE_LOCK:
                JOB_STATE.clear()
                JOB_STATE.update(
                    {
                        "attempt_id": job.attempt_id,
                        "progress": "accepted",
                        "status": "IN_PROGRESS",
                    }
                )
            threading.Thread(
                target=_run_job,
                args=(job, request_started),
                name="echomimic-pod-job",
                daemon=True,
            ).start()
            self._json(
                202,
                {"ok": True, "attempt_id": job.attempt_id, "status": "IN_PROGRESS"},
            )
        except Exception as error:
            RUN_LOCK.release()
            self._json(500, {"ok": False, "error_code": str(error)[:120]})


if __name__ == "__main__":
    if len(TOKEN) < 32:
        raise RuntimeError("VIDEOFORGE_POD_TOKEN_INVALID")
    print(json.dumps({"event": "avatar_primary_pod_runner_start", "port": 8000}), flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()

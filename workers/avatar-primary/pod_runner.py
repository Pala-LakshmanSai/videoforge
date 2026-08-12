from __future__ import annotations

import hmac
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from bootstrap_models import bootstrap_models
from videoforge_avatar_primary import AvatarPrimaryInlineJob, run_avatar_primary_inline_job


STARTED = time.monotonic()
TOKEN = os.environ.get("VIDEOFORGE_POD_TOKEN", "")
RUN_LOCK = threading.Lock()
MAX_BODY_BYTES = 6 * 1024 * 1024


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
        if self.path != "/health":
            self._json(404, {"ok": False})
            return
        self._json(200, {"ok": True, "uptime_ms": round((time.monotonic() - STARTED) * 1000)})

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
            bootstrap = bootstrap_models(
                lambda stage: print(
                    json.dumps({"event": "pod_progress", "stage": stage}), flush=True
                )
            )
            result = run_avatar_primary_inline_job(job)
            result["bootstrap"] = bootstrap
            self._json(
                200,
                {
                    "ok": True,
                    "result": result,
                    "request_execution_ms": round((time.monotonic() - request_started) * 1000),
                },
            )
        except Exception as error:
            self._json(500, {"ok": False, "error_code": str(error)[:120]})
        finally:
            RUN_LOCK.release()


if __name__ == "__main__":
    if len(TOKEN) < 32:
        raise RuntimeError("VIDEOFORGE_POD_TOKEN_INVALID")
    print(json.dumps({"event": "avatar_primary_pod_runner_start", "port": 8000}), flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()

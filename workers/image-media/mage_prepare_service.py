from __future__ import annotations

import hashlib
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Final

from mage_volume import (
    MAGE_MODEL_BYTES,
    MAGE_MODEL_ID,
    MAGE_MODEL_REVISION,
    MAGE_PRECISION,
    MAGE_VOLUME_SIZE_GB,
)
from prepare_mage_volume import prepare

PREPARE_SCHEMA: Final = "videoforge.mage-volume-preparation/v1"
_state: dict[str, object] = {
    "phase": "starting",
    "failure_code": None,
    "manifest_sha256": None,
}


def volume_id() -> str:
    value = os.environ.get("VIDEOFORGE_MAGE_VOLUME_ID", "")
    if not value or len(value) > 191 or not all(c.isalnum() or c in "_-" for c in value):
        raise RuntimeError("MAGE_VOLUME_ID_INVALID")
    return value


def safe_failure_code(error: Exception) -> str:
    value = str(error)
    return value if value.startswith("MAGE_") and len(value) <= 120 else "MAGE_PREPARATION_FAILED"


def health_payload() -> dict[str, object]:
    raw_volume_id = volume_id()
    phase = str(_state["phase"])
    return {
        "schema_version": PREPARE_SCHEMA,
        "process": {"status": "ok"},
        "phase": phase,
        "failure_code": _state["failure_code"],
        "model": {
            "id": MAGE_MODEL_ID,
            "revision": MAGE_MODEL_REVISION,
            "precision": MAGE_PRECISION,
            "exact_bytes": MAGE_MODEL_BYTES,
            "status": (
                "ready" if phase == "ready" else "error" if phase == "failed" else "loading"
            ),
        },
        "volume": {
            "id_hash": "sha256:" + hashlib.sha256(raw_volume_id.encode("utf-8")).hexdigest(),
            "requested_size_gb": MAGE_VOLUME_SIZE_GB,
            "manifest_sha256": _state["manifest_sha256"],
        },
    }


def run_preparation() -> None:
    _state.update(phase="preparing", failure_code=None, manifest_sha256=None)
    try:
        marker = prepare(
            Path(os.environ.get("MAGE_MODEL_ROOT", "/workspace/mage-model")),
            volume_id=volume_id(),
            volume_size_gb=MAGE_VOLUME_SIZE_GB,
            confirmation=os.environ.get("VIDEOFORGE_MAGE_DOWNLOAD_CONFIRMATION", ""),
        )
        manifest_sha256 = marker.get("manifest_sha256")
        if not isinstance(manifest_sha256, str) or not manifest_sha256.startswith("sha256:"):
            raise RuntimeError("MAGE_VOLUME_MANIFEST_HASH_MISMATCH")
        _state.update(phase="ready", manifest_sha256=manifest_sha256)
    except Exception as error:
        _state.update(phase="failed", failure_code=safe_failure_code(error))


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path not in {"/v1/health", "/v1/prepare/health"}:
            self.send_error(404)
            return
        payload = json.dumps(health_payload(), separators=(",", ":"), sort_keys=True).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, _format: str, *_args: object) -> None:
        return


def main() -> None:
    volume_id()
    threading.Thread(target=run_preparation, name="mage-volume-preparation", daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", 8000), HealthHandler).serve_forever()


if __name__ == "__main__":
    main()

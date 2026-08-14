from __future__ import annotations

import json
import os
import time
from pathlib import Path

from echo_volume import require_offline_runtime, verify_model_root


def bootstrap(model_root: Path) -> dict[str, object]:
    started = time.time()
    require_offline_runtime()
    expected_volume_hash = os.environ.get("VIDEOFORGE_ECHO_VOLUME_ID_HASH")
    if not expected_volume_hash:
        raise RuntimeError("ECHO_EXPECTED_VOLUME_ID_REQUIRED")
    manifest = verify_model_root(model_root, expected_volume_id_hash=expected_volume_hash)
    completed = time.time()
    result = {
        "schema_version": "videoforge.echo-fp8-bootstrap/v1",
        "manifest_sha256": manifest["manifest_sha256"],
        "precision": manifest["precision"],
        "downloaded_model_bytes": 0,
        "material_quantization_performed": False,
        "registry_access_allowed": False,
        "started_unix_ms": round(started * 1_000),
        "completed_unix_ms": round(completed * 1_000),
        "duration_ms": round((completed - started) * 1_000),
    }
    evidence_path = Path(os.environ.get("ECHO_BOOTSTRAP_EVIDENCE", "/tmp/echo-bootstrap.json"))
    evidence_path.write_text(json.dumps(result, sort_keys=True), encoding="utf-8")
    return result

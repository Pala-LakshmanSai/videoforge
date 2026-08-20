from __future__ import annotations

import json
import os
import time
from pathlib import Path

from mage_volume import MAGE_MODEL_FILES, require_offline_runtime, verify_model_root


def link_comfyui_models(model_root: Path, comfy_root: Path) -> None:
    models_root = comfy_root / "models"
    models_root.mkdir(parents=True, exist_ok=True)
    for item in MAGE_MODEL_FILES:
        source = model_root / item.path
        destination = models_root / item.path
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.is_symlink() or destination.is_file():
            destination.unlink()
        elif destination.exists():
            raise RuntimeError("MAGE_COMFY_MODEL_PATH_CONFLICT")
        destination.symlink_to(source)


def bootstrap(model_root: Path, comfy_root: Path) -> dict[str, object]:
    started = time.time()
    require_offline_runtime()
    expected_volume_hash = os.environ.get("VIDEOFORGE_MAGE_VOLUME_ID_HASH")
    if not expected_volume_hash:
        raise RuntimeError("MAGE_EXPECTED_VOLUME_ID_REQUIRED")
    marker = verify_model_root(model_root, expected_volume_id_hash=expected_volume_hash)
    link_comfyui_models(model_root, comfy_root)
    completed = time.time()
    started_unix_ms = round(started * 1000)
    completed_unix_ms = round(completed * 1000)
    evidence = {
        "schema_version": "videoforge.mage-bootstrap/v2",
        "manifest_sha256": marker["manifest_sha256"],
        "model_revision": marker["model_revision"],
        "comfyui_revision": marker["comfyui_revision"],
        "precision": marker["precision"],
        "downloaded_model_bytes": 0,
        "registry_access_allowed": False,
        "started_unix_ms": started_unix_ms,
        "completed_unix_ms": completed_unix_ms,
        "duration_ms": completed_unix_ms - started_unix_ms,
    }
    evidence_path = Path(
        os.environ.get(
            "MAGE_BOOTSTRAP_EVIDENCE",
            "/tmp/videoforge-worker/bootstrap/mage-bootstrap.json",
        )
    )
    if evidence_path == Path("/runpod-volume") or Path("/runpod-volume") in evidence_path.parents:
        raise RuntimeError("MAGE_BOOTSTRAP_EVIDENCE_ON_MODEL_VOLUME")
    evidence_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    evidence_path.write_text(json.dumps(evidence, sort_keys=True), encoding="utf-8")
    return evidence


if __name__ == "__main__":
    bootstrap(
        Path(os.environ.get("MAGE_MODEL_ROOT", "/runpod-volume")),
        Path(os.environ.get("COMFY_ROOT", "/opt/comfyui")),
    )

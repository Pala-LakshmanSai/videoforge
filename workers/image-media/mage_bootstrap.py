from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path

from videoforge_image_media import MAGE_MODEL_ID, MAGE_MODEL_REVISION
from videoforge_image_media.mage_production import (
    MAGE_TEXT_ENCODER_BYTES,
    MAGE_TEXT_ENCODER_FILENAME,
    MAGE_TEXT_ENCODER_SHA256,
    MAGE_TRANSFORMER_BYTES,
    MAGE_TRANSFORMER_FILENAME,
    MAGE_TRANSFORMER_SHA256,
    MAGE_VAE_BYTES,
    MAGE_VAE_FILENAME,
    MAGE_VAE_SHA256,
)

FILES = (
    (
        "diffusion_models/" + MAGE_TRANSFORMER_FILENAME,
        MAGE_TRANSFORMER_BYTES,
        MAGE_TRANSFORMER_SHA256,
    ),
    (
        "text_encoders/" + MAGE_TEXT_ENCODER_FILENAME,
        MAGE_TEXT_ENCODER_BYTES,
        MAGE_TEXT_ENCODER_SHA256,
    ),
    ("vae/" + MAGE_VAE_FILENAME, MAGE_VAE_BYTES, MAGE_VAE_SHA256),
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_model_root(model_root: Path) -> dict[str, object]:
    marker_path = model_root / ".videoforge-model.json"
    try:
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as error:
        raise RuntimeError("MAGE_MODEL_MARKER_INVALID") from error
    expected = {
        "model_id": MAGE_MODEL_ID,
        "model_revision": MAGE_MODEL_REVISION,
        "files": [
            {"path": relative, "bytes": size, "sha256": digest} for relative, size, digest in FILES
        ],
    }
    if marker != expected:
        raise RuntimeError("MAGE_MODEL_MARKER_MISMATCH")
    for relative, size, digest in FILES:
        path = model_root / relative
        if not path.is_file() or path.stat().st_size != size or _sha256(path) != digest:
            raise RuntimeError("MAGE_MODEL_FILE_INVALID")
    return marker


def bootstrap(model_root: Path, comfy_root: Path) -> dict[str, object]:
    from huggingface_hub import hf_hub_download

    started = time.time()
    cache_hit = True
    try:
        verify_model_root(model_root)
    except RuntimeError:
        cache_hit = False
        model_root.mkdir(parents=True, exist_ok=True)
        for relative, _size, _digest in FILES:
            target = model_root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            downloaded = Path(
                hf_hub_download(
                    repo_id=MAGE_MODEL_ID,
                    revision=MAGE_MODEL_REVISION,
                    filename=relative,
                    cache_dir=os.environ.get("HF_HOME"),
                )
            )
            target.unlink(missing_ok=True)
            target.symlink_to(downloaded)
        marker = {
            "model_id": MAGE_MODEL_ID,
            "model_revision": MAGE_MODEL_REVISION,
            "files": [
                {"path": relative, "bytes": size, "sha256": digest}
                for relative, size, digest in FILES
            ],
        }
        (model_root / ".videoforge-model.json").write_text(
            json.dumps(marker, sort_keys=True), encoding="utf-8"
        )
        verify_model_root(model_root)
    for relative, _size, _digest in FILES:
        destination = comfy_root / "models" / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.unlink(missing_ok=True)
        destination.symlink_to(model_root / relative)
    completed = time.time()
    evidence = {
        "schema_version": "videoforge.mage-bootstrap/v1",
        "model_revision": MAGE_MODEL_REVISION,
        "cache_hit": cache_hit,
        "started_unix_ms": round(started * 1000),
        "completed_unix_ms": round(completed * 1000),
        "duration_ms": round((completed - started) * 1000),
    }
    evidence_path = Path(os.environ.get("MAGE_BOOTSTRAP_EVIDENCE", "/tmp/mage-bootstrap.json"))
    evidence_path.write_text(json.dumps(evidence, sort_keys=True), encoding="utf-8")
    return evidence


if __name__ == "__main__":
    bootstrap(
        Path(os.environ.get("MAGE_MODEL_ROOT", "/models/mage-flow-turbo")),
        Path(os.environ.get("COMFY_ROOT", "/opt/comfyui")),
    )

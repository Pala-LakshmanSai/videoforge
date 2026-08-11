from __future__ import annotations

import json
from pathlib import Path

from videoforge_image_media import (
    MAGE_MODEL_ID,
    MAGE_MODEL_REVISION,
    MAGE_REPOSITORY_BYTE_CEILING,
    MAGE_TRANSFORMER_BYTES,
    MAGE_TRANSFORMER_SHA256,
)

REQUIRED_FILES = (
    "model_index.json",
    "scheduler/scheduler_config.json",
    "text_encoder/config.json",
    "transformer/config.json",
    "transformer/diffusion_pytorch_model.safetensors",
    "vae/config.json",
    "vae/diffusion_pytorch_model.safetensors",
)


def verify_embedded_model(model_root: Path) -> None:
    try:
        marker = json.loads((model_root / ".videoforge-model.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as error:
        raise RuntimeError("MAGE_MODEL_MARKER_INVALID") from error
    expected = {
        "model_id": MAGE_MODEL_ID,
        "model_revision": MAGE_MODEL_REVISION,
        "repository_byte_ceiling": MAGE_REPOSITORY_BYTE_CEILING,
        "transformer_bytes": MAGE_TRANSFORMER_BYTES,
        "transformer_sha256": MAGE_TRANSFORMER_SHA256,
    }
    if marker != expected:
        raise RuntimeError("MAGE_MODEL_MARKER_MISMATCH")
    if any(not (model_root / relative).is_file() for relative in REQUIRED_FILES):
        raise RuntimeError("MAGE_MODEL_INCOMPLETE")


if __name__ == "__main__":
    verify_embedded_model(Path("/models/mage-flow-turbo"))

from __future__ import annotations

import argparse
import hashlib
import os
from datetime import UTC, datetime
from pathlib import Path

from mage_volume import (
    MAGE_MARKER_NAME,
    MAGE_MODEL_FILES,
    MAGE_MODEL_ID,
    MAGE_MODEL_REVISION,
    MAGE_VOLUME_SIZE_GB,
    canonical_json,
    manifest_body,
    seal_manifest,
    sha256_file,
    verify_model_root,
)

CONFIRMATION = "DOWNLOAD_EXACT_VIDEOFORGE_MAGE_INT8"


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare one VideoForge-owned Mage INT8 persistent volume exactly once."
    )
    parser.add_argument("--model-root", required=True, type=Path)
    parser.add_argument("--volume-id", required=True)
    parser.add_argument("--volume-size-gb", required=True, type=int)
    parser.add_argument("--confirm-download", required=True)
    return parser.parse_args()


def prepare(
    model_root: Path, *, volume_id: str, volume_size_gb: int, confirmation: str
) -> dict[str, object]:
    if confirmation != CONFIRMATION:
        raise RuntimeError("MAGE_PREPARATION_CONFIRMATION_INVALID")
    if volume_size_gb != MAGE_VOLUME_SIZE_GB:
        raise RuntimeError("MAGE_VOLUME_SIZE_MISMATCH")
    if (
        not volume_id
        or len(volume_id) > 191
        or not all(c.isalnum() or c in "_-" for c in volume_id)
    ):
        raise RuntimeError("MAGE_VOLUME_ID_INVALID")
    model_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    marker_path = model_root / MAGE_MARKER_NAME
    volume_id_hash = "sha256:" + hashlib.sha256(volume_id.encode("utf-8")).hexdigest()
    if marker_path.exists():
        return verify_model_root(model_root, expected_volume_id_hash=volume_id_hash)
    allowed_partial_entries = {".cache", "diffusion_models", "text_encoders", "vae"}
    if any(path.name not in allowed_partial_entries for path in model_root.iterdir()):
        raise RuntimeError("MAGE_VOLUME_NOT_EMPTY")

    previous = {
        name: os.environ.get(name)
        for name in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "DIFFUSERS_OFFLINE")
    }
    os.environ["HF_HUB_OFFLINE"] = "0"
    try:
        from huggingface_hub import hf_hub_download

        for item in MAGE_MODEL_FILES:
            downloaded = Path(
                hf_hub_download(
                    repo_id=MAGE_MODEL_ID,
                    revision=MAGE_MODEL_REVISION,
                    filename=item.path,
                    local_dir=model_root,
                )
            )
            if downloaded != model_root / item.path:
                raise RuntimeError("MAGE_PREPARATION_PATH_MISMATCH")
            if downloaded.stat().st_size != item.bytes or sha256_file(downloaded) != item.sha256:
                raise RuntimeError("MAGE_PREPARATION_HASH_MISMATCH")
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    cache = model_root / ".cache"
    if cache.exists():
        import shutil

        shutil.rmtree(cache)
    body = manifest_body(
        volume_id_hash=volume_id_hash,
        prepared_at=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    )
    marker = seal_manifest(body)
    temporary = model_root / f"{MAGE_MARKER_NAME}.tmp"
    temporary.write_bytes(canonical_json(marker) + b"\n")
    os.chmod(temporary, 0o600)
    temporary.replace(marker_path)
    return verify_model_root(model_root, expected_volume_id_hash=marker["volume_id_hash"])


if __name__ == "__main__":
    arguments = parse_arguments()
    observed = prepare(
        arguments.model_root,
        volume_id=arguments.volume_id,
        volume_size_gb=arguments.volume_size_gb,
        confirmation=arguments.confirm_download,
    )
    print(observed["manifest_sha256"])

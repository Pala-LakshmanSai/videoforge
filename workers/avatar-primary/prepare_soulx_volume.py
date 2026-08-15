from __future__ import annotations

import os
import shutil
import uuid
from pathlib import Path

from huggingface_hub import hf_hub_download

from soulx_volume import FILE_SPECS, MARKER_NAME, canonical_json, expected_manifest, verify_volume


def prepare() -> dict[str, object]:
    final_root = Path(os.environ.get("SOULX_MODEL_ROOT", "/runpod-volume/soulx-flashhead-pro"))
    parent = final_root.parent
    parent.mkdir(parents=True, exist_ok=True)
    if final_root.exists():
        raise RuntimeError(f"refusing to overwrite existing SoulX root: {final_root}")
    staging = parent / f".vf924s-soulx-staging-{uuid.uuid4().hex}"
    staging.mkdir(mode=0o700)
    try:
        for spec in FILE_SPECS:
            destination = staging / str(spec["relative_path"])
            destination.parent.mkdir(parents=True, exist_ok=True)
            local_root = staging / (
                "checkpoint"
                if spec["repository"] == "Soul-AILab/SoulX-FlashHead-1_3B"
                else "wav2vec"
            )
            downloaded = Path(
                hf_hub_download(
                    repo_id=str(spec["repository"]),
                    revision=str(spec["revision"]),
                    filename=str(spec["remote_path"]),
                    local_dir=local_root,
                )
            )
            if downloaded != destination:
                shutil.move(str(downloaded), destination)
        for cache in staging.rglob(".cache"):
            if cache.is_dir():
                shutil.rmtree(cache)
        (staging / MARKER_NAME).write_bytes(canonical_json(expected_manifest()))
        verification = verify_volume(staging)
        staging.rename(final_root)
        verification["root"] = str(final_root)
        return verification
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


if __name__ == "__main__":
    import json

    print(json.dumps(prepare(), sort_keys=True), flush=True)

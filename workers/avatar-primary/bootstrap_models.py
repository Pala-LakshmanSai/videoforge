from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Callable

from huggingface_hub import snapshot_download

MODEL_ROOT = Path(os.environ.get("ECHOMIMIC_MODEL_ROOT", "/models"))
MARKER = MODEL_ROOT / ".videoforge-echomimic-v3-flash-complete.json"

SOURCE_REVISION = "7e89489ca51c0d008fc1963ec6c03fc5bd0b9397"
FLASH_REVISION = "311e176905a8c4c24b240b530488fe636ce4d249"
BASE_REVISION = "fc913c34361f4ec879e2f9c78b4f11ae50a937d1"
AUDIO_REVISION = "3991242c806928916fff4a8c0e4f76acf661b743"

REPOSITORIES = (
    (
        "BadToBest/EchoMimicV3",
        FLASH_REVISION,
        "flash",
        [
            "echomimicv3-flash-pro/config.json",
            "echomimicv3-flash-pro/diffusion_pytorch_model.safetensors",
        ],
    ),
    (
        "alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP",
        BASE_REVISION,
        "base",
        [
            "*.json",
            "*.pth",
            "*.safetensors",
            "google/umt5-xxl/*",
            "xlm-roberta-large/*",
            "tokenizer/*",
            "text_encoder/*",
            "image_encoder/*",
            "transformer/*",
            "vae/*",
        ],
    ),
    (
        "TencentGameMate/chinese-wav2vec2-base",
        AUDIO_REVISION,
        "audio",
        ["*.json", "*.txt", "*.bin", "*.safetensors"],
    ),
)

# The exact selected large/runtime files verified by VF-9-22. Small configs are downloaded too.
REQUIRED_FILES = (
    ("flash/echomimicv3-flash-pro/config.json", 577, None),
    (
        "flash/echomimicv3-flash-pro/diffusion_pytorch_model.safetensors",
        3727671120,
        "5ebdbb2fc709108bf2a1728fd92eb2874804e4bc0324e92a2cd55425968c85a4",
    ),
    (
        "base/Wan2.1_VAE.pth",
        507609880,
        "38071ab59bd94681c686fa51d75a1968f64e470262043be31f7a094e442fd981",
    ),
    (
        "base/diffusion_pytorch_model.safetensors",
        3128957992,
        "4ec199076538b946935ebcb3ba808d3c427e638f29519a3c3c98d31d821e5eed",
    ),
    (
        "base/google/umt5-xxl/spiece.model",
        4548313,
        "e3909a67b780650b35cf529ac782ad2b6b26e6d1f849d3fbb6a872905f452458",
    ),
    (
        "base/google/umt5-xxl/tokenizer.json",
        16837417,
        "6e197b4d3dbd71da14b4eb255f4fa91c9c1f2068b20a2de2472967ca3d22602",
    ),
    (
        "base/models_clip_open-clip-xlm-roberta-large-vit-huge-14.pth",
        4772359047,
        "628c9998b613391f193eb67ff68da9667d75f492911e4eb3decf23460a158c38",
    ),
    (
        "base/models_t5_umt5-xxl-enc-bf16.pth",
        11361920418,
        "7cace0da2b446bbbbc57d031ab6cf163a3d59b366da94e5afe36745b746fd81d",
    ),
    (
        "base/xlm-roberta-large/sentencepiece.bpe.model",
        5069051,
        "cfc8146abe2a0488e9e2a0c56de7952f7c11ab059eca145a0a727afce0db2865",
    ),
    (
        "base/xlm-roberta-large/tokenizer.json",
        17082660,
        "62c24cdc13d4c9952d63718d6c9fa4c287974249e16b7ade6d5a85e7bbb75626",
    ),
    (
        "audio/pytorch_model.bin",
        380261837,
        "be2da40c9e7ae26bfc904a3ed79ebb9e8f060bec6dba85d6a6ae86114bc38901",
    ),
)
SELECTED_RUNTIME_BYTES = 23922317735


def _sha256(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(8 * 1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def verify_cache() -> dict[str, object]:
    observed_bytes = 0
    for relative, size, digest in REQUIRED_FILES:
        path = MODEL_ROOT / relative
        if not path.is_file() or path.stat().st_size != size:
            raise RuntimeError("ECHOMIMIC_CACHE_INCOMPLETE")
        if digest and _sha256(path) != digest:
            raise RuntimeError("ECHOMIMIC_CACHE_MUTATED")
        if digest:
            observed_bytes += size
    if observed_bytes != SELECTED_RUNTIME_BYTES:
        raise RuntimeError("ECHOMIMIC_MANIFEST_BYTES_MISMATCH")
    return {
        "schema_version": "videoforge.echomimic-cache/v1",
        "source_revision": SOURCE_REVISION,
        "flash_revision": FLASH_REVISION,
        "base_revision": BASE_REVISION,
        "audio_revision": AUDIO_REVISION,
        "selected_runtime_bytes": observed_bytes,
    }


def bootstrap_models(progress: Callable[[str], None] = lambda _: None) -> dict[str, object]:
    started = time.monotonic()
    if MARKER.is_file():
        expected = verify_cache()
        if json.loads(MARKER.read_text(encoding="utf-8")) != expected:
            raise RuntimeError("ECHOMIMIC_CACHE_MARKER_MISMATCH")
        progress("bootstrap_cache_hit")
        return {
            **expected,
            "cache_hit": True,
            "bootstrap_ms": round((time.monotonic() - started) * 1000),
        }
    if MODEL_ROOT.exists() and any(MODEL_ROOT.iterdir()):
        raise RuntimeError("ECHOMIMIC_CACHE_INCOMPLETE")
    MODEL_ROOT.mkdir(parents=True, exist_ok=True)
    for repo_id, revision, directory, patterns in REPOSITORIES:
        progress(f"bootstrap_{directory}_started")
        snapshot_download(
            repo_id=repo_id,
            revision=revision,
            local_dir=MODEL_ROOT / directory,
            allow_patterns=patterns,
            max_workers=4,
        )
        progress(f"bootstrap_{directory}_complete")
    value = verify_cache()
    MARKER.write_text(json.dumps(value, sort_keys=True, separators=(",", ":")), encoding="utf-8")
    MARKER.chmod(0o444)
    progress("bootstrap_complete")
    return {**value, "cache_hit": False, "bootstrap_ms": round((time.monotonic() - started) * 1000)}


if __name__ == "__main__":
    bootstrap_models(print)

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Final

SOULX_SOURCE_REPOSITORY: Final = "Soul-AILab/SoulX-FlashHead"
SOULX_SOURCE_REVISION: Final = "9bc03de06bb0de82cd6bc477804512ae06144bf2"
SOULX_MODEL_REPOSITORY: Final = "Soul-AILab/SoulX-FlashHead-1_3B"
SOULX_MODEL_REVISION: Final = "59119b6c681230c3eeee157e224ae1941746711e"
WAV2VEC_REPOSITORY: Final = "facebook/wav2vec2-base-960h"
WAV2VEC_REVISION: Final = "22aad52d435eb6dbaf354bdad9b0da84ce7d6156"
RUNTIME_PROFILE_ID: Final = "videoforge_soulx_flashhead_pro_bf16_v1"
VOLUME_SCHEMA: Final = "videoforge.soulx-flashhead-pro-volume/v1"
MARKER_NAME: Final = ".videoforge-soulx-flashhead-pro-volume.json"

FILE_SPECS: Final = (
    {
        "repository": SOULX_MODEL_REPOSITORY,
        "revision": SOULX_MODEL_REVISION,
        "remote_path": "Model_Pro/diffusion_pytorch_model.safetensors",
        "relative_path": "checkpoint/Model_Pro/diffusion_pytorch_model.safetensors",
        "size_bytes": 6_030_864_656,
        "sha256": "e47e61b9023ea1aac60c0c0fff077289bc6cca443c71907e5a76a411480af250",
    },
    {
        "repository": SOULX_MODEL_REPOSITORY,
        "revision": SOULX_MODEL_REVISION,
        "remote_path": "Model_Pro/config.json",
        "relative_path": "checkpoint/Model_Pro/config.json",
        "size_bytes": 353,
        "sha256": "94b480d3af70e73989371ed0c106656c2c887201286b1210e835cd09e71e32b1",
    },
    {
        "repository": SOULX_MODEL_REPOSITORY,
        "revision": SOULX_MODEL_REVISION,
        "remote_path": "VAE_Wan/Wan2.1_VAE.pth",
        "relative_path": "checkpoint/VAE_Wan/Wan2.1_VAE.pth",
        "size_bytes": 507_609_880,
        "sha256": "38071ab59bd94681c686fa51d75a1968f64e470262043be31f7a094e442fd981",
    },
    {
        "repository": WAV2VEC_REPOSITORY,
        "revision": WAV2VEC_REVISION,
        "remote_path": "model.safetensors",
        "relative_path": "wav2vec/model.safetensors",
        "size_bytes": 377_607_901,
        "sha256": "8aa76ab2243c81747a1f832954586bc566090c83a0ac167df6f31f0fa917d74a",
    },
    {
        "repository": WAV2VEC_REPOSITORY,
        "revision": WAV2VEC_REVISION,
        "remote_path": "config.json",
        "relative_path": "wav2vec/config.json",
        "size_bytes": 1_596,
        "sha256": "d3ec255c063d9f95057b553b19c20135b259875834a4fe9deb218a6be25b4cf3",
    },
    {
        "repository": WAV2VEC_REPOSITORY,
        "revision": WAV2VEC_REVISION,
        "remote_path": "preprocessor_config.json",
        "relative_path": "wav2vec/preprocessor_config.json",
        "size_bytes": 159,
        "sha256": "b225d617c025463b9e157e06afea8b90dc7078fc70b013c533328423e0486b4a",
    },
    {
        "repository": WAV2VEC_REPOSITORY,
        "revision": WAV2VEC_REVISION,
        "remote_path": "feature_extractor_config.json",
        "relative_path": "wav2vec/feature_extractor_config.json",
        "size_bytes": 158,
        "sha256": "d3de0c797bf9b65f90bc65c30cb7b303ebeda341f6fc80af33628c4b26b95632",
    },
)


def volume_root() -> Path:
    return Path(os.environ.get("SOULX_MODEL_ROOT", "/runpod-volume/soulx-flashhead-pro"))


def canonical_json(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha256_file(path: Path, chunk_size: int = 8 * 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def expected_manifest() -> dict[str, object]:
    return {
        "schema_version": VOLUME_SCHEMA,
        "runtime_profile_id": RUNTIME_PROFILE_ID,
        "model_type": "pro",
        "precision": "bfloat16",
        "source": {
            "repository": SOULX_SOURCE_REPOSITORY,
            "revision": SOULX_SOURCE_REVISION,
        },
        "model": {
            "repository": SOULX_MODEL_REPOSITORY,
            "revision": SOULX_MODEL_REVISION,
        },
        "audio_encoder": {
            "repository": WAV2VEC_REPOSITORY,
            "revision": WAV2VEC_REVISION,
        },
        "settings": {
            "width": 512,
            "height": 512,
            "fps": 25,
            "frame_num": 33,
            "motion_frames_num": 5,
            "new_frames_per_chunk": 28,
            "sampling_steps": 4,
            "timestep_shift": 5,
            "color_correction_strength": 1.0,
            "seed": 42,
            "audio_encode_mode": "stream",
            "face_crop": False,
        },
        "files": [
            {
                "relative_path": spec["relative_path"],
                "size_bytes": spec["size_bytes"],
                "sha256": spec["sha256"],
            }
            for spec in FILE_SPECS
        ],
        "total_bytes": sum(int(spec["size_bytes"]) for spec in FILE_SPECS),
    }


def expected_manifest_sha256() -> str:
    return hashlib.sha256(canonical_json(expected_manifest())).hexdigest()


def verify_volume(root: Path | None = None) -> dict[str, object]:
    selected_root = root or volume_root()
    marker = selected_root / MARKER_NAME
    if not marker.is_file():
        raise RuntimeError(f"sealed SoulX marker is absent: {marker}")
    if marker.read_bytes() != canonical_json(expected_manifest()):
        raise RuntimeError("sealed SoulX marker does not match the compiled manifest")
    for spec in FILE_SPECS:
        path = selected_root / str(spec["relative_path"])
        if not path.is_file():
            raise RuntimeError(f"required SoulX file is absent: {spec['relative_path']}")
        if path.stat().st_size != spec["size_bytes"]:
            raise RuntimeError(f"SoulX size mismatch: {spec['relative_path']}")
        if sha256_file(path) != spec["sha256"]:
            raise RuntimeError(f"SoulX SHA-256 mismatch: {spec['relative_path']}")
    return {
        "manifest_sha256": expected_manifest_sha256(),
        "total_bytes": expected_manifest()["total_bytes"],
        "root": str(selected_root),
    }

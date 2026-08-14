from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Final

MAGE_VOLUME_SCHEMA: Final = "videoforge.mage-volume-manifest/v1"
MAGE_LANE: Final = "mage_image"
MAGE_MODEL_ID: Final = "Comfy-Org/Mage-Flow"
MAGE_MODEL_REVISION: Final = "d8c99241f6fa80fbd453014234af2bf337ea21e6"
MAGE_PRECISION: Final = "int8-convrot"
MAGE_COMFYUI_REVISION: Final = "26d7f8556822d9d08c2d3e1878636ac3b4969af9"
MAGE_VOLUME_SIZE_GB: Final = 20
# RunPod's network-volume REST contract and billing use integer GB. This is a
# requested provider size, not a claim that the mounted filesystem reports an
# exact binary capacity.
MAGE_REQUESTED_VOLUME_BYTES: Final = MAGE_VOLUME_SIZE_GB * 1_000_000_000
MAGE_MARKER_NAME: Final = ".videoforge-mage-volume.json"


@dataclass(frozen=True, slots=True)
class MageModelFile:
    path: str
    bytes: int
    sha256: str


MAGE_MODEL_FILES: Final = (
    MageModelFile(
        path="diffusion_models/mage_flow_turbo_int8_convrot.safetensors",
        bytes=4_159_146_840,
        sha256="327c3967a5190ea52e453ec3dd81ba168e37a2a0ff2c763aa3e9260bbbe1913c",
    ),
    MageModelFile(
        path="text_encoders/qwen3vl_4b_bf16.safetensors",
        bytes=8_875_719_384,
        sha256="36f3ff447ef59201722e8f9ce6020c9819fdcfba6aa2608c4e09b1c0ce114e34",
    ),
    MageModelFile(
        path="vae/mage_flow_vae_bf16.safetensors",
        bytes=345_053_056,
        sha256="34e076dc1e8a15321e1e07be5111d59cf16dd10b804b7c7e20b4de29013427e0",
    ),
)
MAGE_MODEL_BYTES: Final = sum(item.bytes for item in MAGE_MODEL_FILES)
MAGE_MINIMUM_HEADROOM_BYTES: Final = MAGE_REQUESTED_VOLUME_BYTES - MAGE_MODEL_BYTES


class MageVolumeError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode(
        "utf-8"
    )


def manifest_body(*, volume_id_hash: str, prepared_at: str) -> dict[str, object]:
    return {
        "schema_version": MAGE_VOLUME_SCHEMA,
        "owner": "videoforge",
        "lane": MAGE_LANE,
        "model_id": MAGE_MODEL_ID,
        "model_revision": MAGE_MODEL_REVISION,
        "precision": MAGE_PRECISION,
        "comfyui_revision": MAGE_COMFYUI_REVISION,
        "volume_id_hash": volume_id_hash,
        "requested_volume_size_gb": MAGE_VOLUME_SIZE_GB,
        "model_bytes": MAGE_MODEL_BYTES,
        "minimum_headroom_bytes": MAGE_MINIMUM_HEADROOM_BYTES,
        "prepared_at": prepared_at,
        "files": [
            {"path": item.path, "bytes": item.bytes, "sha256": item.sha256}
            for item in MAGE_MODEL_FILES
        ],
    }


def seal_manifest(body: dict[str, object]) -> dict[str, object]:
    return {**body, "manifest_sha256": "sha256:" + hashlib.sha256(canonical_json(body)).hexdigest()}


def validate_manifest_shape(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise MageVolumeError("MAGE_VOLUME_MARKER_INVALID")
    manifest = dict(value)
    manifest_hash = manifest.pop("manifest_sha256", None)
    if not isinstance(manifest_hash, str) or manifest_hash != (
        "sha256:" + hashlib.sha256(canonical_json(manifest)).hexdigest()
    ):
        raise MageVolumeError("MAGE_VOLUME_MANIFEST_HASH_MISMATCH")
    expected_fixed = {
        "schema_version": MAGE_VOLUME_SCHEMA,
        "owner": "videoforge",
        "lane": MAGE_LANE,
        "model_id": MAGE_MODEL_ID,
        "model_revision": MAGE_MODEL_REVISION,
        "precision": MAGE_PRECISION,
        "comfyui_revision": MAGE_COMFYUI_REVISION,
        "requested_volume_size_gb": MAGE_VOLUME_SIZE_GB,
        "model_bytes": MAGE_MODEL_BYTES,
        "minimum_headroom_bytes": MAGE_MINIMUM_HEADROOM_BYTES,
        "files": [
            {"path": item.path, "bytes": item.bytes, "sha256": item.sha256}
            for item in MAGE_MODEL_FILES
        ],
    }
    for key, expected in expected_fixed.items():
        if manifest.get(key) != expected:
            code = "MAGE_VOLUME_LANE_MISMATCH" if key == "lane" else "MAGE_VOLUME_MARKER_MISMATCH"
            raise MageVolumeError(code)
    if set(manifest) != {*expected_fixed, "volume_id_hash", "prepared_at"}:
        raise MageVolumeError("MAGE_VOLUME_MARKER_INVALID")
    if (
        not isinstance(manifest["volume_id_hash"], str)
        or not str(manifest["volume_id_hash"]).startswith("sha256:")
        or len(str(manifest["volume_id_hash"])) != 71
        or any(
            character not in "0123456789abcdef" for character in str(manifest["volume_id_hash"])[7:]
        )
        or not isinstance(manifest["prepared_at"], str)
        or not manifest["prepared_at"]
    ):
        raise MageVolumeError("MAGE_VOLUME_MARKER_INVALID")
    return value


def verify_model_root(
    model_root: Path, *, expected_volume_id_hash: str | None = None
) -> dict[str, object]:
    try:
        marker = json.loads((model_root / MAGE_MARKER_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as error:
        raise MageVolumeError("MAGE_VOLUME_MARKER_INVALID") from error
    validated = validate_manifest_shape(marker)
    if (
        expected_volume_id_hash is not None
        and validated["volume_id_hash"] != expected_volume_id_hash
    ):
        raise MageVolumeError("MAGE_VOLUME_ID_MISMATCH")

    expected_paths = {item.path for item in MAGE_MODEL_FILES}
    actual_weight_paths = {
        path.relative_to(model_root).as_posix()
        for directory in ("diffusion_models", "text_encoders", "vae")
        for path in (model_root / directory).rglob("*")
        if path.is_file()
    }
    if actual_weight_paths != expected_paths:
        raise MageVolumeError("MAGE_VOLUME_FILE_SET_MISMATCH")
    for item in MAGE_MODEL_FILES:
        path = model_root / item.path
        if path.is_symlink() or not path.is_file():
            raise MageVolumeError("MAGE_VOLUME_FILE_INVALID")
        stat = path.stat()
        if stat.st_size != item.bytes or sha256_file(path) != item.sha256:
            raise MageVolumeError("MAGE_VOLUME_FILE_INVALID")
    return validated


def require_offline_runtime() -> None:
    required = {
        "HF_HUB_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
        "DIFFUSERS_OFFLINE": "1",
    }
    for name, expected in required.items():
        if os.environ.get(name) != expected:
            raise MageVolumeError("MAGE_OFFLINE_RUNTIME_REQUIRED")

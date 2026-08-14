from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Final

ECHO_VOLUME_SCHEMA: Final = "videoforge.echo-fp8-volume-manifest/v1"
ECHO_LANE: Final = "echo_avatar"
ECHO_MODEL_ID: Final = "EchoMimicV3-Flash"
ECHO_SOURCE_REVISION: Final = "7e89489ca51c0d008fc1963ec6c03fc5bd0b9397"
ECHO_FLASH_REVISION: Final = "311e176905a8c4c24b240b530488fe636ce4d249"
ECHO_WAN_REVISION: Final = "fc913c34361f4ec879e2f9c78b4f11ae50a937d1"
ECHO_AUDIO_REVISION: Final = "3991242c806928916fff4a8c0e4f76acf661b743"
ECHO_PRECISION: Final = "float8_e4m3fn_dynamic_activation_weight"
ECHO_TORCH_VERSION: Final = "2.7.1"
ECHO_TORCHAO_VERSION: Final = "0.11.0"
ECHO_VOLUME_SIZE_GB: Final = 50
ECHO_REQUESTED_VOLUME_BYTES: Final = ECHO_VOLUME_SIZE_GB * 1_000_000_000
ECHO_SELECTED_SOURCE_BYTES: Final = 23_922_317_735
ECHO_PREPARED_ARTIFACT_MAX_BYTES: Final = 4_000_000_000
ECHO_MINIMUM_POST_PREPARATION_HEADROOM_BYTES: Final = (
    ECHO_REQUESTED_VOLUME_BYTES - ECHO_SELECTED_SOURCE_BYTES - ECHO_PREPARED_ARTIFACT_MAX_BYTES
)
ECHO_MARKER_NAME: Final = ".videoforge-echo-fp8-volume.json"
ECHO_MANIFEST_NAME: Final = "manifest.json"
ECHO_PREPARED_STATE_PATH: Final = "prepared/echo-transformer-fp8-state.pt"
ECHO_PREPARATION_REPORT_PATH: Final = "prepared/quantization.json"


@dataclass(frozen=True, slots=True)
class EchoSourceFile:
    repository: str
    revision: str
    path: str
    bytes: int
    sha256: str


ECHO_REQUIRED_SOURCE_FILES: Final = (
    EchoSourceFile(
        "BadToBest/EchoMimicV3",
        ECHO_FLASH_REVISION,
        "source/flash/echomimicv3-flash-pro/diffusion_pytorch_model.safetensors",
        3_727_671_120,
        "5ebdbb2fc709108bf2a1728fd92eb2874804e4bc0324e92a2cd55425968c85a4",
    ),
    EchoSourceFile(
        "alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP",
        ECHO_WAN_REVISION,
        "source/base/Wan2.1_VAE.pth",
        507_609_880,
        "38071ab59bd94681c686fa51d75a1968f64e470262043be31f7a094e442fd981",
    ),
    EchoSourceFile(
        "alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP",
        ECHO_WAN_REVISION,
        "source/base/diffusion_pytorch_model.safetensors",
        3_128_957_992,
        "4ec199076538b946935ebcb3ba808d3c427e638f29519a3c3c98d31d821e5eed",
    ),
    EchoSourceFile(
        "alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP",
        ECHO_WAN_REVISION,
        "source/base/google/umt5-xxl/spiece.model",
        4_548_313,
        "e3909a67b780650b35cf529ac782ad2b6b26e6d1f849d3fbb6a872905f452458",
    ),
    EchoSourceFile(
        "alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP",
        ECHO_WAN_REVISION,
        "source/base/google/umt5-xxl/tokenizer.json",
        16_837_417,
        "6e197b4d3dbd71da14b4eb255f4fa91c9c1f2068b20a2de2472967ca3d22602b",
    ),
    EchoSourceFile(
        "alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP",
        ECHO_WAN_REVISION,
        "source/base/models_clip_open-clip-xlm-roberta-large-vit-huge-14.pth",
        4_772_359_047,
        "628c9998b613391f193eb67ff68da9667d75f492911e4eb3decf23460a158c38",
    ),
    EchoSourceFile(
        "alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP",
        ECHO_WAN_REVISION,
        "source/base/models_t5_umt5-xxl-enc-bf16.pth",
        11_361_920_418,
        "7cace0da2b446bbbbc57d031ab6cf163a3d59b366da94e5afe36745b746fd81d",
    ),
    EchoSourceFile(
        "alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP",
        ECHO_WAN_REVISION,
        "source/base/xlm-roberta-large/sentencepiece.bpe.model",
        5_069_051,
        "cfc8146abe2a0488e9e2a0c56de7952f7c11ab059eca145a0a727afce0db2865",
    ),
    EchoSourceFile(
        "alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP",
        ECHO_WAN_REVISION,
        "source/base/xlm-roberta-large/tokenizer.json",
        17_082_660,
        "62c24cdc13d4c9952d63718d6c9fa4c287974249e16b7ade6d5a85e7bbb75626",
    ),
    EchoSourceFile(
        "TencentGameMate/chinese-wav2vec2-base",
        ECHO_AUDIO_REVISION,
        "source/audio/pytorch_model.bin",
        380_261_837,
        "be2da40c9e7ae26bfc904a3ed79ebb9e8f060bec6dba85d6a6ae86114bc38901",
    ),
)


class EchoVolumeError(RuntimeError):
    pass


def canonical_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode(
        "utf-8"
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_relative_path(value: object) -> str:
    if not isinstance(value, str) or not value or len(value) > 512:
        raise EchoVolumeError("ECHO_VOLUME_FILE_PATH_INVALID")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or "." in path.parts:
        raise EchoVolumeError("ECHO_VOLUME_FILE_PATH_INVALID")
    return value


def _sha256(value: object) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise EchoVolumeError("ECHO_VOLUME_FILE_HASH_INVALID")
    return value


def source_lineage() -> list[dict[str, str]]:
    return [
        {
            "kind": "source",
            "repository": "antgroup/echomimic_v3",
            "revision": ECHO_SOURCE_REVISION,
        },
        {
            "kind": "flash",
            "repository": "BadToBest/EchoMimicV3",
            "revision": ECHO_FLASH_REVISION,
        },
        {
            "kind": "wan_base",
            "repository": "alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP",
            "revision": ECHO_WAN_REVISION,
        },
        {
            "kind": "audio_encoder",
            "repository": "TencentGameMate/chinese-wav2vec2-base",
            "revision": ECHO_AUDIO_REVISION,
        },
    ]


def manifest_body(
    *,
    volume_id_hash: str,
    prepared_at: str,
    files: list[dict[str, object]],
    prepared_state_sha256: str,
    prepared_state_bytes: int,
    quantized_linear_count: int,
) -> dict[str, object]:
    return {
        "schema_version": ECHO_VOLUME_SCHEMA,
        "owner": "videoforge",
        "lane": ECHO_LANE,
        "region": "EU-RO-1",
        "model_id": ECHO_MODEL_ID,
        "precision": ECHO_PRECISION,
        "source_lineage": source_lineage(),
        "toolchain": {
            "torch": ECHO_TORCH_VERSION,
            "torchao": ECHO_TORCHAO_VERSION,
            "serialization": "torch_state_dict_weights_only_v1",
            "load_policy": "weights_only_true",
        },
        "quantization": {
            "algorithm": "float8_dynamic_activation_float8_weight",
            "activation_dtype": "float8_e4m3fn",
            "weight_dtype": "float8_e4m3fn",
            "remaining_tensor_dtype": "bfloat16",
            "quantized_linear_count": quantized_linear_count,
            "source_flash_sha256": ECHO_REQUIRED_SOURCE_FILES[0].sha256,
            "prepared_state_path": ECHO_PREPARED_STATE_PATH,
            "prepared_state_sha256": prepared_state_sha256,
            "prepared_state_bytes": prepared_state_bytes,
            "material_quantization_phase": "one_time_volume_preparation_only",
        },
        "runtime": {
            "ordinary_boot_downloads": False,
            "first_request_quantization": False,
            "long_video_cfg": False,
            "full_voiceover_allowed": False,
            "warmup": "real_inference_path_before_model_ready",
            "model_mount_mutable": False,
        },
        "volume_id_hash": volume_id_hash,
        "requested_volume_size_gb": ECHO_VOLUME_SIZE_GB,
        "selected_source_bytes": ECHO_SELECTED_SOURCE_BYTES,
        "prepared_artifact_max_bytes": ECHO_PREPARED_ARTIFACT_MAX_BYTES,
        "minimum_post_preparation_headroom_bytes": ECHO_MINIMUM_POST_PREPARATION_HEADROOM_BYTES,
        "prepared_at": prepared_at,
        "files": files,
    }


def seal_manifest(body: dict[str, object]) -> dict[str, object]:
    return {**body, "manifest_sha256": "sha256:" + hashlib.sha256(canonical_json(body)).hexdigest()}


def validate_manifest_shape(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise EchoVolumeError("ECHO_VOLUME_MANIFEST_INVALID")
    manifest = dict(value)
    manifest_hash = manifest.pop("manifest_sha256", None)
    expected_hash = "sha256:" + hashlib.sha256(canonical_json(manifest)).hexdigest()
    if manifest_hash != expected_hash:
        raise EchoVolumeError("ECHO_VOLUME_MANIFEST_HASH_MISMATCH")
    fixed = {
        "schema_version": ECHO_VOLUME_SCHEMA,
        "owner": "videoforge",
        "lane": ECHO_LANE,
        "region": "EU-RO-1",
        "model_id": ECHO_MODEL_ID,
        "precision": ECHO_PRECISION,
        "source_lineage": source_lineage(),
        "requested_volume_size_gb": ECHO_VOLUME_SIZE_GB,
        "selected_source_bytes": ECHO_SELECTED_SOURCE_BYTES,
        "prepared_artifact_max_bytes": ECHO_PREPARED_ARTIFACT_MAX_BYTES,
        "minimum_post_preparation_headroom_bytes": ECHO_MINIMUM_POST_PREPARATION_HEADROOM_BYTES,
    }
    for key, expected in fixed.items():
        if manifest.get(key) != expected:
            code = "ECHO_VOLUME_LANE_MISMATCH" if key == "lane" else "ECHO_VOLUME_MANIFEST_MISMATCH"
            raise EchoVolumeError(code)
    expected_keys = {
        *fixed,
        "toolchain",
        "quantization",
        "runtime",
        "volume_id_hash",
        "prepared_at",
        "files",
    }
    if set(manifest) != expected_keys:
        raise EchoVolumeError("ECHO_VOLUME_MANIFEST_INVALID")
    if manifest.get("toolchain") != {
        "torch": ECHO_TORCH_VERSION,
        "torchao": ECHO_TORCHAO_VERSION,
        "serialization": "torch_state_dict_weights_only_v1",
        "load_policy": "weights_only_true",
    }:
        raise EchoVolumeError("ECHO_VOLUME_TOOLCHAIN_MISMATCH")
    if manifest.get("runtime") != {
        "ordinary_boot_downloads": False,
        "first_request_quantization": False,
        "long_video_cfg": False,
        "full_voiceover_allowed": False,
        "warmup": "real_inference_path_before_model_ready",
        "model_mount_mutable": False,
    }:
        raise EchoVolumeError("ECHO_VOLUME_RUNTIME_POLICY_MISMATCH")
    volume_hash = manifest.get("volume_id_hash")
    if not isinstance(volume_hash, str) or not volume_hash.startswith("sha256:"):
        raise EchoVolumeError("ECHO_VOLUME_ID_INVALID")
    _sha256(volume_hash.removeprefix("sha256:"))
    if not isinstance(manifest.get("prepared_at"), str) or not manifest["prepared_at"]:
        raise EchoVolumeError("ECHO_VOLUME_MANIFEST_INVALID")
    quantization = manifest.get("quantization")
    if not isinstance(quantization, dict) or set(quantization) != {
        "algorithm",
        "activation_dtype",
        "weight_dtype",
        "remaining_tensor_dtype",
        "quantized_linear_count",
        "source_flash_sha256",
        "prepared_state_path",
        "prepared_state_sha256",
        "prepared_state_bytes",
        "material_quantization_phase",
    }:
        raise EchoVolumeError("ECHO_VOLUME_QUANTIZATION_INVALID")
    if (
        quantization.get("algorithm") != "float8_dynamic_activation_float8_weight"
        or quantization.get("activation_dtype") != "float8_e4m3fn"
        or quantization.get("weight_dtype") != "float8_e4m3fn"
        or quantization.get("remaining_tensor_dtype") != "bfloat16"
        or quantization.get("source_flash_sha256") != ECHO_REQUIRED_SOURCE_FILES[0].sha256
        or quantization.get("prepared_state_path") != ECHO_PREPARED_STATE_PATH
        or quantization.get("material_quantization_phase") != "one_time_volume_preparation_only"
        or not isinstance(quantization.get("quantized_linear_count"), int)
        or int(quantization["quantized_linear_count"]) < 1
        or not isinstance(quantization.get("prepared_state_bytes"), int)
        or not 1 <= int(quantization["prepared_state_bytes"]) <= ECHO_PREPARED_ARTIFACT_MAX_BYTES
    ):
        raise EchoVolumeError("ECHO_VOLUME_QUANTIZATION_INVALID")
    _sha256(quantization.get("prepared_state_sha256"))
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise EchoVolumeError("ECHO_VOLUME_FILES_INVALID")
    paths: set[str] = set()
    for item in files:
        if not isinstance(item, dict) or set(item) != {"path", "bytes", "sha256", "role"}:
            raise EchoVolumeError("ECHO_VOLUME_FILES_INVALID")
        relative = _safe_relative_path(item.get("path"))
        if relative in paths:
            raise EchoVolumeError("ECHO_VOLUME_FILE_DUPLICATE")
        paths.add(relative)
        if item.get("role") not in {"source", "prepared"}:
            raise EchoVolumeError("ECHO_VOLUME_FILES_INVALID")
        if not isinstance(item.get("bytes"), int) or int(item["bytes"]) < 1:
            raise EchoVolumeError("ECHO_VOLUME_FILES_INVALID")
        _sha256(item.get("sha256"))
    indexed = {str(item["path"]): item for item in files}
    for required in ECHO_REQUIRED_SOURCE_FILES:
        if indexed.get(required.path) != {
            "path": required.path,
            "bytes": required.bytes,
            "sha256": required.sha256,
            "role": "source",
        }:
            raise EchoVolumeError("ECHO_VOLUME_REQUIRED_SOURCE_MISMATCH")
    prepared = indexed.get(ECHO_PREPARED_STATE_PATH)
    if prepared != {
        "path": ECHO_PREPARED_STATE_PATH,
        "bytes": quantization["prepared_state_bytes"],
        "sha256": quantization["prepared_state_sha256"],
        "role": "prepared",
    }:
        raise EchoVolumeError("ECHO_VOLUME_PREPARED_STATE_MISMATCH")
    if ECHO_PREPARATION_REPORT_PATH not in indexed:
        raise EchoVolumeError("ECHO_VOLUME_PREPARATION_REPORT_MISSING")
    return value


def verify_model_root(
    model_root: Path, *, expected_volume_id_hash: str | None = None
) -> dict[str, object]:
    try:
        manifest_bytes = (model_root / ECHO_MANIFEST_NAME).read_bytes()
        marker = json.loads((model_root / ECHO_MARKER_NAME).read_text(encoding="utf-8"))
        manifest = json.loads(manifest_bytes)
    except (OSError, ValueError, TypeError) as error:
        raise EchoVolumeError("ECHO_VOLUME_MANIFEST_INVALID") from error
    validated = validate_manifest_shape(manifest)
    if marker != {
        "schema_version": "videoforge.echo-fp8-volume-completion/v1",
        "manifest_sha256": validated["manifest_sha256"],
    }:
        raise EchoVolumeError("ECHO_VOLUME_COMPLETION_MARKER_INVALID")
    if (
        expected_volume_id_hash is not None
        and validated["volume_id_hash"] != expected_volume_id_hash
    ):
        raise EchoVolumeError("ECHO_VOLUME_ID_MISMATCH")
    expected_paths = {str(item["path"]) for item in validated["files"]}
    actual_paths = {
        path.relative_to(model_root).as_posix()
        for directory in ("source", "prepared")
        for path in (model_root / directory).rglob("*")
        if path.is_file()
    }
    if actual_paths != expected_paths:
        raise EchoVolumeError("ECHO_VOLUME_FILE_SET_MISMATCH")
    for item in validated["files"]:
        path = model_root / str(item["path"])
        if path.is_symlink() or not path.is_file():
            raise EchoVolumeError("ECHO_VOLUME_FILE_INVALID")
        if path.stat().st_size != item["bytes"] or sha256_file(path) != item["sha256"]:
            raise EchoVolumeError("ECHO_VOLUME_FILE_INVALID")
    return validated


def require_offline_runtime() -> None:
    for name in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "DIFFUSERS_OFFLINE"):
        if os.environ.get(name) != "1":
            raise EchoVolumeError("ECHO_OFFLINE_RUNTIME_REQUIRED")
    if os.environ.get("VIDEOFORGE_ECHO_PREPARATION") == "1":
        raise EchoVolumeError("ECHO_PREPARATION_MODE_FORBIDDEN_DURING_BOOT")

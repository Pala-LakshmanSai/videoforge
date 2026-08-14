from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from datetime import UTC, datetime
from pathlib import Path

from echo_volume import (
    ECHO_AUDIO_REVISION,
    ECHO_FLASH_REVISION,
    ECHO_MANIFEST_NAME,
    ECHO_MARKER_NAME,
    ECHO_PINNED_SMALL_CONFIG_MAX_BYTES,
    ECHO_PREPARATION_REPORT_PATH,
    ECHO_PREPARED_STATE_PATH,
    ECHO_REQUIRED_SOURCE_FILES,
    ECHO_SELECTED_RUNTIME_BLOB_BYTES,
    ECHO_VOLUME_SIZE_GB,
    ECHO_WAN_REVISION,
    canonical_json,
    manifest_body,
    seal_manifest,
    sha256_file,
    verify_model_root,
)
from prepare_fp8_artifact import prepare_fp8_artifact

CONFIRMATION = "DOWNLOAD_AND_PREPARE_EXACT_VIDEOFORGE_ECHO_FLASH_TURBO_FP8"
REPOSITORIES = (
    (
        "BadToBest/EchoMimicV3",
        ECHO_FLASH_REVISION,
        "source/flash",
        [
            "echomimicv3-flash-pro/config.json",
            "echomimicv3-flash-pro/diffusion_pytorch_model.safetensors",
        ],
    ),
    (
        "alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP",
        ECHO_WAN_REVISION,
        "source/base",
        [
            "*.json",
            "Wan2.1_VAE.pth",
            "diffusion_pytorch_model.safetensors",
            "google/umt5-xxl/*",
            "xlm-roberta-large/*",
            "models_clip_open-clip-xlm-roberta-large-vit-huge-14.pth",
            "models_t5_umt5-xxl-enc-bf16.pth",
        ],
    ),
    (
        "TencentGameMate/chinese-wav2vec2-base",
        ECHO_AUDIO_REVISION,
        "source/audio",
        ["config.json", "preprocessor_config.json", "pytorch_model.bin"],
    ),
)


def _volume_hash(volume_id: str) -> str:
    if (
        not volume_id
        or len(volume_id) > 191
        or not all(character.isalnum() or character in "_-" for character in volume_id)
    ):
        raise RuntimeError("ECHO_VOLUME_ID_INVALID")
    return "sha256:" + hashlib.sha256(volume_id.encode()).hexdigest()


def _collect_files(model_root: Path) -> list[dict[str, object]]:
    files: list[dict[str, object]] = []
    for role, directory in (("source", "source"), ("prepared", "prepared")):
        for path in sorted((model_root / directory).rglob("*")):
            if path.is_symlink() or (path.exists() and not path.is_file() and not path.is_dir()):
                raise RuntimeError("ECHO_PREPARATION_UNSAFE_FILE")
            if not path.is_file():
                continue
            files.append(
                {
                    "path": path.relative_to(model_root).as_posix(),
                    "bytes": path.stat().st_size,
                    "sha256": sha256_file(path),
                    "role": role,
                }
            )
    return files


def prepare(
    model_root: Path, *, volume_id: str, volume_size_gb: int, confirmation: str
) -> dict[str, object]:
    if confirmation != CONFIRMATION:
        raise RuntimeError("ECHO_PREPARATION_CONFIRMATION_INVALID")
    if volume_size_gb != ECHO_VOLUME_SIZE_GB:
        raise RuntimeError("ECHO_VOLUME_SIZE_MISMATCH")
    if os.environ.get("VIDEOFORGE_ECHO_PREPARATION") != "1":
        raise RuntimeError("ECHO_PREPARATION_MODE_REQUIRED")
    volume_id_hash = _volume_hash(volume_id)
    model_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    marker = model_root / ECHO_MARKER_NAME
    if marker.exists():
        return verify_model_root(model_root, expected_volume_id_hash=volume_id_hash)
    if any(model_root.iterdir()):
        raise RuntimeError("ECHO_VOLUME_NOT_EMPTY")
    try:
        from huggingface_hub import snapshot_download
    except Exception as error:
        raise RuntimeError("ECHO_PREPARATION_DOWNLOAD_TOOL_UNAVAILABLE") from error
    previous = {name: os.environ.get(name) for name in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE")}
    try:
        os.environ["HF_HUB_OFFLINE"] = "0"
        os.environ["TRANSFORMERS_OFFLINE"] = "0"
        for repository, revision, relative, patterns in REPOSITORIES:
            snapshot_download(
                repo_id=repository,
                revision=revision,
                local_dir=model_root / relative,
                allow_patterns=patterns,
                max_workers=4,
            )
        for cache in model_root.rglob(".cache"):
            if cache.is_dir():
                shutil.rmtree(cache)
        for item in ECHO_REQUIRED_SOURCE_FILES:
            path = model_root / item.path
            if (
                not path.is_file()
                or path.is_symlink()
                or path.stat().st_size != item.bytes
                or sha256_file(path) != item.sha256
            ):
                raise RuntimeError("ECHO_PREPARATION_SOURCE_MISMATCH")
        report = prepare_fp8_artifact(model_root)
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
    files = _collect_files(model_root)
    indexed = {str(item["path"]): item for item in files}
    actual_source_bytes = sum(int(item["bytes"]) for item in files if item["role"] == "source")
    if (
        not ECHO_SELECTED_RUNTIME_BLOB_BYTES
        <= actual_source_bytes
        <= (ECHO_SELECTED_RUNTIME_BLOB_BYTES + ECHO_PINNED_SMALL_CONFIG_MAX_BYTES)
    ):
        raise RuntimeError("ECHO_PREPARATION_SOURCE_BYTE_BUDGET_EXCEEDED")
    prepared = indexed.get(ECHO_PREPARED_STATE_PATH)
    if prepared is None or ECHO_PREPARATION_REPORT_PATH not in indexed:
        raise RuntimeError("ECHO_PREPARATION_ARTIFACT_MISSING")
    body = manifest_body(
        volume_id_hash=volume_id_hash,
        prepared_at=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        files=files,
        prepared_state_sha256=str(prepared["sha256"]),
        prepared_state_bytes=int(prepared["bytes"]),
        quantized_linear_count=int(report["quantized_linear_count"]),
        actual_source_bytes=actual_source_bytes,
    )
    sealed = seal_manifest(body)
    manifest_path = model_root / ECHO_MANIFEST_NAME
    temporary = manifest_path.with_suffix(".tmp")
    temporary.write_bytes(canonical_json(sealed) + b"\n")
    os.chmod(temporary, 0o400)
    temporary.replace(manifest_path)
    completion = {
        "schema_version": "videoforge.echo-flash-turbo-fp8-volume-completion/v1",
        "manifest_sha256": sealed["manifest_sha256"],
    }
    marker_temporary = model_root / f"{ECHO_MARKER_NAME}.tmp"
    marker_temporary.write_bytes(canonical_json(completion) + b"\n")
    os.chmod(marker_temporary, 0o400)
    marker_temporary.replace(marker)
    return verify_model_root(model_root, expected_volume_id_hash=volume_id_hash)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare one exact VideoForge EchoMimicV3-Flash Turbo FP8 volume"
    )
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--volume-id", required=True)
    parser.add_argument("--volume-size-gb", type=int, required=True)
    parser.add_argument("--confirm-download", required=True)
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_arguments()
    result = prepare(
        arguments.model_root,
        volume_id=arguments.volume_id,
        volume_size_gb=arguments.volume_size_gb,
        confirmation=arguments.confirm_download,
    )
    print(json.dumps({"manifest_sha256": result["manifest_sha256"]}, sort_keys=True))

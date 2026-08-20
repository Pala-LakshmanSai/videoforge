"""Build a deterministic, source-only OCI/Docker image overlay.

This builder deliberately works from a registry manifest and config blob only.
It does not invoke Docker, download any base layer, contact a registry, or
touch model bytes.  The output is a tiny replacement layer for the repaired
Serverless handler plus a new config and manifest whose SHA-256 values are
stable across runs.

The caller supplies the immutable parent manifest/config blobs and an explicit
creation timestamp.  Requiring those inputs makes the image identity an
auditable function of the parent, source bytes, labels, and timestamp rather
than of a local Docker daemon or wall clock.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import struct
import tarfile
import zlib
from pathlib import Path
from typing import Any, Mapping


DOCKER_MANIFEST_MEDIA_TYPE = "application/vnd.docker.distribution.manifest.v2+json"
DOCKER_CONFIG_MEDIA_TYPE = "application/vnd.docker.container.image.v1+json"
DOCKER_LAYER_MEDIA_TYPE = "application/vnd.docker.image.rootfs.diff.tar.gzip"
SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")
GIT_COMMIT = re.compile(r"^[0-9a-f]{40}$")

DEFAULT_DESTINATION = "/opt/videoforge/mage_serverless.py"
DEFAULT_CREATED_BY = (
    "COPY workers/image-media/mage_serverless.py "
    "/opt/videoforge/mage_serverless.py"
)
DEFAULT_OVERLAY_KIND = "source-only-overlay-v2"


class OverlayError(ValueError):
    """Raised when an input blob is not a safe exact overlay input."""


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise OverlayError(f"{label} is not readable JSON") from exc
    if not isinstance(value, dict):
        raise OverlayError(f"{label} must be a JSON object")
    return value


def _canonical_json(value: Mapping[str, Any]) -> bytes:
    """Return the exact JSON byte representation used for OCI blobs."""

    return (
        json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
        + "\n"
    ).encode("utf-8")


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _descriptor_digest(descriptor: Mapping[str, Any], label: str) -> str:
    digest = descriptor.get("digest")
    if not isinstance(digest, str) or not SHA256.fullmatch(digest):
        raise OverlayError(f"{label} has an invalid sha256 descriptor")
    return digest


def _validate_manifest(manifest: Mapping[str, Any]) -> None:
    if manifest.get("schemaVersion") != 2:
        raise OverlayError("base manifest must use schemaVersion 2")
    if manifest.get("mediaType") != DOCKER_MANIFEST_MEDIA_TYPE:
        raise OverlayError("base manifest must use the Docker schema-2 media type")
    config = manifest.get("config")
    layers = manifest.get("layers")
    if not isinstance(config, dict):
        raise OverlayError("base manifest config descriptor is missing")
    if config.get("mediaType") != DOCKER_CONFIG_MEDIA_TYPE:
        raise OverlayError("base config descriptor has an unexpected media type")
    _descriptor_digest(config, "base config")
    if not isinstance(config.get("size"), int) or config["size"] < 1:
        raise OverlayError("base config descriptor has an invalid size")
    if not isinstance(layers, list) or not layers:
        raise OverlayError("base manifest must contain at least one layer")
    for index, layer in enumerate(layers):
        if not isinstance(layer, dict):
            raise OverlayError(f"base layer {index} is not an object")
        if layer.get("mediaType") != DOCKER_LAYER_MEDIA_TYPE:
            raise OverlayError(f"base layer {index} has an unexpected media type")
        _descriptor_digest(layer, f"base layer {index}")
        if not isinstance(layer.get("size"), int) or layer["size"] < 1:
            raise OverlayError(f"base layer {index} has an invalid size")


def _validate_config(config: Mapping[str, Any], config_bytes: bytes, descriptor: Mapping[str, Any]) -> None:
    expected_digest = _descriptor_digest(descriptor, "base config")
    actual_digest = "sha256:" + _sha256(config_bytes)
    if actual_digest != expected_digest:
        raise OverlayError(
            f"base config digest mismatch: descriptor={expected_digest} actual={actual_digest}"
        )
    descriptor_size = descriptor.get("size")
    if descriptor_size != len(config_bytes):
        raise OverlayError(
            f"base config size mismatch: descriptor={descriptor_size} actual={len(config_bytes)}"
        )
    if not isinstance(config.get("architecture"), str) or config["architecture"] != "amd64":
        raise OverlayError("base config architecture must be amd64")
    if not isinstance(config.get("os"), str) or config["os"] != "linux":
        raise OverlayError("base config OS must be linux")
    rootfs = config.get("rootfs")
    if not isinstance(rootfs, dict) or rootfs.get("type") != "layers":
        raise OverlayError("base config rootfs must use layers")
    diff_ids = rootfs.get("diff_ids")
    if not isinstance(diff_ids, list) or not diff_ids:
        raise OverlayError("base config has no rootfs diff IDs")
    for index, diff_id in enumerate(diff_ids):
        if not isinstance(diff_id, str) or not SHA256.fullmatch(diff_id):
            raise OverlayError(f"base rootfs diff ID {index} is invalid")
    history = config.get("history")
    if not isinstance(history, list):
        raise OverlayError("base config history is missing")
    non_empty_history = sum(
        1 for entry in history if not isinstance(entry, dict) or not entry.get("empty_layer", False)
    )
    if non_empty_history != len(diff_ids):
        raise OverlayError("base history and rootfs layer counts do not agree")


def _safe_source_bytes(source: Path) -> bytes:
    if not source.is_file() or source.is_symlink():
        raise OverlayError("source must be a regular, non-symlink file")
    try:
        data = source.read_bytes()
    except OSError as exc:
        raise OverlayError("source is not readable") from exc
    if not data:
        raise OverlayError("source must not be empty")
    return data


def _tar_layer(destination: str, source_bytes: bytes) -> bytes:
    """Create a reproducible uncompressed tar layer containing one file."""

    if not destination.startswith("/") or destination.endswith("/"):
        raise OverlayError("destination must be an absolute file path")
    relative = destination.lstrip("/")
    if not relative or ".." in Path(relative).parts:
        raise OverlayError("destination must not escape the image root")
    # USTAR avoids implementation-dependent PAX records for this short path.
    stream = __import__("io").BytesIO()
    with tarfile.open(fileobj=stream, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        info = tarfile.TarInfo(name=relative)
        info.size = len(source_bytes)
        info.mode = 0o644
        info.uid = 0
        info.gid = 0
        info.uname = ""
        info.gname = ""
        info.mtime = 0
        archive.addfile(info, __import__("io").BytesIO(source_bytes))
    return stream.getvalue()


def _gzip_layer(tar_bytes: bytes) -> bytes:
    """Gzip a tar with fixed header, compression level, and no timestamp."""

    # gzip.compress(mtime=0) has emitted a platform-dependent OS byte on some
    # Python/zlib combinations.  Build the tiny wrapper explicitly so the
    # compressed layer digest is stable on macOS and Linux alike.
    compressor = zlib.compressobj(level=9, method=zlib.DEFLATED, wbits=-15)
    deflated = compressor.compress(tar_bytes) + compressor.flush()
    header = b"\x1f\x8b\x08\x00\x00\x00\x00\x00\x02\xff"
    trailer = struct.pack("<II", zlib.crc32(tar_bytes) & 0xFFFFFFFF, len(tar_bytes) & 0xFFFFFFFF)
    return header + deflated + trailer


def _validate_source_commit(value: str) -> str:
    if not GIT_COMMIT.fullmatch(value):
        raise OverlayError("source commit must be 40 lowercase hexadecimal characters")
    return value


def build_overlay(
    *,
    base_manifest: Mapping[str, Any],
    base_manifest_bytes: bytes,
    base_config: Mapping[str, Any],
    base_config_bytes: bytes,
    source_bytes: bytes,
    source_commit: str,
    parent_image: str,
    created: str,
    destination: str = DEFAULT_DESTINATION,
    created_by: str = DEFAULT_CREATED_BY,
    overlay_kind: str = DEFAULT_OVERLAY_KIND,
) -> dict[str, Any]:
    """Return deterministic OCI blobs and identity metadata in memory."""

    _validate_manifest(base_manifest)
    if not isinstance(base_manifest_bytes, bytes) or not base_manifest_bytes:
        raise OverlayError("base manifest bytes are required for digest binding")
    if "@" not in parent_image:
        raise OverlayError("parent image must be an immutable @sha256 reference")
    parent_digest = parent_image.rsplit("@", 1)[1]
    if not SHA256.fullmatch(parent_digest):
        raise OverlayError("parent image must be an immutable @sha256 reference")
    actual_parent_digest = "sha256:" + _sha256(base_manifest_bytes)
    if actual_parent_digest != parent_digest:
        raise OverlayError(
            f"base manifest digest mismatch: parent={parent_digest} actual={actual_parent_digest}"
        )
    config_descriptor = base_manifest["config"]
    if not isinstance(config_descriptor, dict):  # narrowed for type checkers
        raise OverlayError("base config descriptor is missing")
    _validate_config(base_config, base_config_bytes, config_descriptor)
    diff_ids = base_config["rootfs"]["diff_ids"]
    layers = base_manifest["layers"]
    if len(layers) != len(diff_ids):
        raise OverlayError(
            f"base manifest/config layer count mismatch: manifest={len(layers)} config={len(diff_ids)}"
        )
    source_commit = _validate_source_commit(source_commit)
    if not created or not created.endswith("Z"):
        raise OverlayError("created must be an explicit UTC timestamp ending in Z")

    tar_bytes = _tar_layer(destination, source_bytes)
    layer_bytes = _gzip_layer(tar_bytes)
    uncompressed_digest = "sha256:" + _sha256(tar_bytes)
    layer_digest = "sha256:" + _sha256(layer_bytes)

    config = copy.deepcopy(dict(base_config))
    labels = config.setdefault("config", {}).setdefault("Labels", {})
    if not isinstance(labels, dict):
        raise OverlayError("base config labels must be an object when present")
    labels.update(
        {
            "org.opencontainers.image.revision": source_commit,
            "ai.videoforge.source-commit": source_commit,
            "org.opencontainers.image.version": "v2-07-serverless-repair-v2",
            "ai.videoforge.repair.kind": overlay_kind,
            "org.opencontainers.image.base.name": parent_image.split("@", 1)[0],
            "org.opencontainers.image.base.digest": parent_image.split("@", 1)[1],
            "ai.videoforge.base-image": parent_image,
            "ai.videoforge.overlay-parent": parent_image,
        }
    )
    rootfs = config.get("rootfs")
    if not isinstance(rootfs, dict):
        raise OverlayError("base config rootfs is not an object")
    diff_ids = rootfs.get("diff_ids")
    if not isinstance(diff_ids, list):
        raise OverlayError("base config rootfs diff IDs are not a list")
    diff_ids.append(uncompressed_digest)
    history = config.get("history")
    if not isinstance(history, list):
        raise OverlayError("base config history is not a list")
    history.append(
        {
            "comment": "videoforge deterministic source-only overlay",
            "created": created,
            "created_by": created_by,
        }
    )
    config_bytes = _canonical_json(config)
    config_digest = "sha256:" + _sha256(config_bytes)

    manifest = copy.deepcopy(dict(base_manifest))
    manifest["config"] = {
        "digest": config_digest,
        "mediaType": DOCKER_CONFIG_MEDIA_TYPE,
        "size": len(config_bytes),
    }
    layers = manifest.get("layers")
    if not isinstance(layers, list):
        raise OverlayError("base manifest layers are not a list")
    layers.append(
        {
            "digest": layer_digest,
            "mediaType": DOCKER_LAYER_MEDIA_TYPE,
            "size": len(layer_bytes),
        }
    )
    manifest_bytes = _canonical_json(manifest)
    manifest_digest = "sha256:" + _sha256(manifest_bytes)
    return {
        "base_manifest": dict(base_manifest),
        "config": config,
        "config_bytes": config_bytes,
        "manifest": manifest,
        "manifest_bytes": manifest_bytes,
        "layer_tar_bytes": tar_bytes,
        "layer_bytes": layer_bytes,
        "identity": {
            "manifest_digest": manifest_digest,
            "config_digest": config_digest,
            "config_size_bytes": len(config_bytes),
            "layer_digest": layer_digest,
            "layer_size_bytes": len(layer_bytes),
            "layer_diff_id": uncompressed_digest,
            "layer_tar_size_bytes": len(tar_bytes),
            "source_commit": source_commit,
            "source_sha256": "sha256:" + _sha256(source_bytes),
            "parent_image": parent_image,
            "destination": destination,
            "created": created,
            "created_by": created_by,
            "overlay_kind": overlay_kind,
            "media_type": DOCKER_MANIFEST_MEDIA_TYPE,
            "os": config.get("os"),
            "architecture": config.get("architecture"),
        },
    }


def _write_output(result: Mapping[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "layer.tar").write_bytes(result["layer_tar_bytes"])
    (output_dir / "layer.tar.gz").write_bytes(result["layer_bytes"])
    (output_dir / "config.json").write_bytes(result["config_bytes"])
    (output_dir / "manifest.json").write_bytes(result["manifest_bytes"])
    metadata = {
        "schema_version": "videoforge.v2-07-deterministic-oci-overlay/v1",
        **result["identity"],
    }
    (output_dir / "identity.json").write_bytes(_canonical_json(metadata))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-manifest", type=Path, required=True)
    parser.add_argument("--base-config", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--parent-image", required=True)
    parser.add_argument("--created", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--destination", default=DEFAULT_DESTINATION)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    base_manifest = _read_json(args.base_manifest, "base manifest")
    base_config = _read_json(args.base_config, "base config")
    base_manifest_bytes = args.base_manifest.read_bytes()
    base_config_bytes = args.base_config.read_bytes()
    source_bytes = _safe_source_bytes(args.source)
    result = build_overlay(
        base_manifest=base_manifest,
        base_manifest_bytes=base_manifest_bytes,
        base_config=base_config,
        base_config_bytes=base_config_bytes,
        source_bytes=source_bytes,
        source_commit=args.source_commit,
        parent_image=args.parent_image,
        created=args.created,
        destination=args.destination,
    )
    _write_output(result, args.output_dir)
    print(json.dumps(result["identity"], sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

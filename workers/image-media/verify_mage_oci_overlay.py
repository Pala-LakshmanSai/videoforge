"""Verify and extract the exact deterministic Mage OCI candidate.

This is a provider-free check for the artifact that will be published.  It
binds the candidate manifest/config/layer digests to the immutable parent
manifest/config, verifies the candidate's runtime identity labels and offline
environment, and extracts only the handler payload for a subsequent local
container smoke test.  It never invokes Docker, contacts a registry, or
mutates model/provider state.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import re
import tarfile
from pathlib import Path
from typing import Any, Mapping

from publish_mage_oci_overlay import PublishError, _validate_artifacts


SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
GIT_COMMIT = re.compile(r"^[0-9a-f]{40}$")
HANDLER_PATH = "opt/videoforge/mage_serverless.py"
ENTRYPOINT = ["python", "/opt/videoforge/mage-serverless-entrypoint.py"]
REQUIRED_ENV = {
    "HF_HUB_OFFLINE=1",
    "TRANSFORMERS_OFFLINE=1",
    "DIFFUSERS_OFFLINE=1",
    "MAGE_MODEL_ROOT=/runpod-volume",
}


class CandidateError(ValueError):
    """Raised when the candidate does not match the exact V2-07 identity."""


def _sha256(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CandidateError(f"{label} is not readable JSON") from exc
    if not isinstance(value, dict):
        raise CandidateError(f"{label} must be a JSON object")
    return value


def _digest(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA256.fullmatch(value):
        raise CandidateError(f"{label} is not a valid sha256 digest")
    return value


def _immutable_image_parts(value: str, label: str) -> tuple[str, str]:
    if "@" not in value:
        raise CandidateError(f"{label} must be an immutable image reference")
    repository, digest = value.rsplit("@", 1)
    if not repository or not SHA256.fullmatch(digest):
        raise CandidateError(f"{label} must be an immutable image reference")
    return repository, digest


def _extract_handler(layer_bytes: bytes) -> bytes:
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(layer_bytes), mode="rb") as compressed:
            tar_bytes = compressed.read()
        with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:") as archive:
            members = archive.getmembers()
            if [member.name for member in members] != [HANDLER_PATH]:
                raise CandidateError("candidate layer must contain only the exact handler path")
            member = members[0]
            if not member.isfile() or member.uid != 0 or member.gid != 0 or member.mode != 0o644:
                raise CandidateError("candidate handler layer metadata is not exact")
            stream = archive.extractfile(member)
            if stream is None:
                raise CandidateError("candidate handler layer payload is missing")
            payload = stream.read()
    except (gzip.BadGzipFile, OSError, tarfile.TarError) as exc:
        raise CandidateError("candidate layer is not a valid gzip tar") from exc
    if not payload:
        raise CandidateError("candidate handler payload is empty")
    try:
        compile(payload, HANDLER_PATH, "exec")
    except SyntaxError as exc:
        raise CandidateError("candidate handler payload is not valid Python") from exc
    return payload


def _assert_parent_binding(
    *,
    candidate: Mapping[str, Any],
    candidate_config: Mapping[str, Any],
    parent_manifest: Mapping[str, Any],
    parent_manifest_bytes: bytes,
    parent_config: Mapping[str, Any],
    parent_config_bytes: bytes,
    parent_image: str,
) -> None:
    _repository, parent_digest = _immutable_image_parts(parent_image, "parent image")
    if _sha256(parent_manifest_bytes) != parent_digest:
        raise CandidateError("parent manifest bytes do not match the immutable parent digest")
    if parent_manifest.get("schemaVersion") != 2 or not isinstance(parent_manifest.get("layers"), list):
        raise CandidateError("parent manifest is not a valid Docker schema-2 manifest")
    parent_descriptor = parent_manifest.get("config")
    if not isinstance(parent_descriptor, dict):
        raise CandidateError("parent manifest config descriptor is missing")
    if _digest(parent_descriptor.get("digest"), "parent config descriptor") != _sha256(parent_config_bytes):
        raise CandidateError("parent config bytes do not match the parent manifest descriptor")
    if parent_descriptor.get("size") != len(parent_config_bytes):
        raise CandidateError("parent config size does not match its descriptor")
    if candidate.get("config") is None or not isinstance(candidate.get("layers"), list):
        raise CandidateError("candidate manifest is missing config or layers")
    candidate_layers = candidate["layers"]
    parent_layers = parent_manifest["layers"]
    if candidate_layers[: len(parent_layers)] != parent_layers:
        raise CandidateError("candidate changed a parent layer descriptor")
    if len(candidate_layers) != len(parent_layers) + 1:
        raise CandidateError("candidate must append exactly one source layer")
    candidate_rootfs = candidate_config.get("rootfs")
    parent_rootfs = parent_config.get("rootfs")
    if not isinstance(candidate_rootfs, dict) or not isinstance(parent_rootfs, dict):
        raise CandidateError("candidate or parent rootfs is missing")
    candidate_diff_ids = candidate_rootfs.get("diff_ids")
    parent_diff_ids = parent_rootfs.get("diff_ids")
    if not isinstance(candidate_diff_ids, list) or not isinstance(parent_diff_ids, list):
        raise CandidateError("candidate or parent diff IDs are missing")
    if candidate_diff_ids[: len(parent_diff_ids)] != parent_diff_ids:
        raise CandidateError("candidate changed a parent rootfs diff ID")
    if len(candidate_diff_ids) != len(parent_diff_ids) + 1:
        raise CandidateError("candidate must append exactly one rootfs diff ID")


def verify_candidate(
    *,
    output_dir: Path,
    base_manifest_path: Path,
    base_config_path: Path,
    expected_manifest_digest: str,
    expected_config_digest: str,
    expected_layer_digest: str,
    expected_source_commit: str,
    expected_source_sha256: str,
    expected_parent_image: str,
    extract_source: Path | None = None,
) -> dict[str, Any]:
    try:
        artifacts = _validate_artifacts(output_dir)
    except PublishError as exc:
        raise CandidateError(str(exc)) from exc
    for actual, expected, label in (
        (artifacts["manifest_digest"], expected_manifest_digest, "manifest"),
        (artifacts["config_digest"], expected_config_digest, "config"),
        (artifacts["layer_digest"], expected_layer_digest, "layer"),
    ):
        if actual != expected:
            raise CandidateError(f"candidate {label} digest mismatch")
    if not GIT_COMMIT.fullmatch(expected_source_commit):
        raise CandidateError("expected source commit is invalid")
    if not SHA256.fullmatch(expected_source_sha256):
        raise CandidateError("expected source SHA-256 is invalid")
    if artifacts["identity"].get("source_commit") != expected_source_commit:
        raise CandidateError("candidate identity source commit mismatch")
    if artifacts["identity"].get("source_sha256") != expected_source_sha256:
        raise CandidateError("candidate identity source hash mismatch")
    if artifacts["identity"].get("parent_image") != expected_parent_image:
        raise CandidateError("candidate identity parent image mismatch")

    parent_manifest_bytes = base_manifest_path.read_bytes()
    parent_config_bytes = base_config_path.read_bytes()
    parent_manifest = _read_json(base_manifest_path, "parent manifest")
    parent_config = _read_json(base_config_path, "parent config")
    candidate_manifest = artifacts["manifest"]
    candidate_config = _read_json(output_dir / "config.json", "candidate config")
    _assert_parent_binding(
        candidate=candidate_manifest,
        candidate_config=candidate_config,
        parent_manifest=parent_manifest,
        parent_manifest_bytes=parent_manifest_bytes,
        parent_config=parent_config,
        parent_config_bytes=parent_config_bytes,
        parent_image=expected_parent_image,
    )
    if candidate_config.get("os") != "linux" or candidate_config.get("architecture") != "amd64":
        raise CandidateError("candidate runtime platform is not linux/amd64")
    config = candidate_config.get("config")
    if not isinstance(config, dict):
        raise CandidateError("candidate runtime config is missing")
    if config.get("Entrypoint") != ENTRYPOINT:
        raise CandidateError("candidate entrypoint identity mismatch")
    environment = config.get("Env")
    if not isinstance(environment, list) or not REQUIRED_ENV.issubset(environment):
        raise CandidateError("candidate offline/model-root environment is incomplete")
    labels = config.get("Labels")
    if not isinstance(labels, dict):
        raise CandidateError("candidate labels are missing")
    if labels.get("org.opencontainers.image.revision") != expected_source_commit:
        raise CandidateError("candidate OCI revision label mismatch")
    if labels.get("ai.videoforge.source-commit") != expected_source_commit:
        raise CandidateError("candidate source label mismatch")
    _parent_repository, parent_digest = _immutable_image_parts(expected_parent_image, "parent image")
    if labels.get("org.opencontainers.image.base.digest") != parent_digest:
        raise CandidateError("candidate base digest label mismatch")
    if labels.get("ai.videoforge.base-image") != expected_parent_image:
        raise CandidateError("candidate base image label mismatch")
    if labels.get("ai.videoforge.overlay-parent") != expected_parent_image:
        raise CandidateError("candidate overlay parent label mismatch")
    source_bytes = _extract_handler(artifacts["layer_bytes"])
    if _sha256(source_bytes) != expected_source_sha256:
        raise CandidateError("candidate handler layer source hash mismatch")
    if extract_source is not None:
        extract_source.parent.mkdir(parents=True, exist_ok=True)
        extract_source.write_bytes(source_bytes)
    return {
        "manifest_digest": artifacts["manifest_digest"],
        "config_digest": artifacts["config_digest"],
        "layer_digest": artifacts["layer_digest"],
        "source_commit": expected_source_commit,
        "source_sha256": expected_source_sha256,
        "parent_image": expected_parent_image,
        "runtime_platform": "linux/amd64",
        "entrypoint": ENTRYPOINT,
        "handler_path": "/" + HANDLER_PATH,
        "handler_extracted": extract_source is not None,
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--base-manifest", type=Path, required=True)
    parser.add_argument("--base-config", type=Path, required=True)
    parser.add_argument("--expected-manifest-digest", required=True)
    parser.add_argument("--expected-config-digest", required=True)
    parser.add_argument("--expected-layer-digest", required=True)
    parser.add_argument("--expected-source-commit", required=True)
    parser.add_argument("--expected-source-sha256", required=True)
    parser.add_argument("--expected-parent-image", required=True)
    parser.add_argument("--extract-source", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    result = verify_candidate(
        output_dir=args.output_dir,
        base_manifest_path=args.base_manifest,
        base_config_path=args.base_config,
        expected_manifest_digest=args.expected_manifest_digest,
        expected_config_digest=args.expected_config_digest,
        expected_layer_digest=args.expected_layer_digest,
        expected_source_commit=args.expected_source_commit,
        expected_source_sha256=args.expected_source_sha256,
        expected_parent_image=args.expected_parent_image,
        extract_source=args.extract_source,
    )
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except CandidateError as exc:
        raise SystemExit(f"mage OCI candidate verification refused: {exc}") from exc

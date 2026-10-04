"""Prepare an unqualified source overlay on the exact accepted private runtime.

No network, dependency/model installation or Docker execution. Real offline jobs
must qualify the candidate before the final immutable image is published.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

BASE_IMAGE = "ghcr.io/pala-lakshmansai/videoforge-cloud-media-runtime-private@sha256:8ffb9239eafe74147031f5aa15e88f7a009524ed29e7f680873b13f8a94550c9"
BASE_RUNTIME_SHA256 = "sha256:24b8ba9357ada3d8417e2b8c2482df88e25202035833a40f78e219d95900f6d7"
BASE_SOURCE_SHA256 = "sha256:2e3a6f9440f6faacda439520134ba9876058f4bebbcbc1f88002ed5c188da9a0"
# Exact exported lock in the original qualified source (fe61), unchanged by this overlay.
BASE_LOCK_SHA256 = "sha256:065037ca5ed47b2117bfa7949abc3b6c4acb66640d9c6f15f31decae02989114"
SOURCE_ROOTS = ("packages/contracts/python", "workers/image-media/src", "workers/media-local/src")


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return "sha256:" + hashlib.file_digest(source, "sha256").hexdigest()


def prepare(root: Path, base: dict, image: str) -> dict:
    if (image != BASE_IMAGE or base.get("schema_version") != "videoforge-linux-media-runtime/v1"
            or base.get("platform") != "linux" or base.get("qualified") is not True
            or base.get("source_sha256") != BASE_SOURCE_SHA256
            or "sha256:" + hashlib.sha256(canonical(base)).hexdigest() != BASE_RUNTIME_SHA256):
        raise ValueError("Source overlay requires the exact qualified Linux base")
    lock = root / "workers/media-local/runpod-requirements.lock"
    if lock.is_symlink() or digest(lock) != BASE_LOCK_SHA256:
        raise ValueError("Source overlay dependency lock differs from qualified base")
    sources = {}
    for relative in SOURCE_ROOTS:
        directory = root / relative
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError("Source overlay root is unsafe")
        for path in sorted(directory.rglob("*")):
            if "__pycache__" in path.parts:
                continue
            if path.is_symlink():
                raise ValueError("Source overlay cannot contain symlinks")
            if path.is_file() and path.suffix == ".py":
                sources[path.relative_to(root).as_posix()] = digest(path)
    if not sources or sources.keys() != base["source_files"].keys():
        raise ValueError("Source inventory changed; qualify a full runtime build")
    candidate = {key: value for key, value in base.items() if key != "offline_acceptance"}
    candidate.update(qualified=False, source_files=sources,
                     source_sha256="sha256:" + hashlib.sha256(canonical(sources)).hexdigest(),
                     dependency_lock_sha256=BASE_LOCK_SHA256)
    return candidate


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--base-runtime", type=Path, required=True)
    parser.add_argument("--base-image", required=True)
    args = parser.parse_args()
    if args.base_runtime.is_symlink() or args.base_runtime.stat().st_size > 1024**2:
        raise ValueError("Source overlay base manifest is unsafe")
    manifest = prepare(args.root, json.loads(args.base_runtime.read_bytes()), args.base_image)
    target = args.root / ".videoforge/cloud-media/build"
    target.mkdir(parents=True, exist_ok=False)
    (target / "runtime.json").write_bytes(canonical(manifest) + b"\n")
    print("Prepared unqualified source overlay: " + manifest["source_sha256"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

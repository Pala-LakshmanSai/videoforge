from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import subprocess
from pathlib import Path
from types import ModuleType

SCHEMA_VERSION = "videoforge-personal-worker-execution-bundle/v1"
WORKER_SOURCE_ROOTS = (
    "workers/media-local/src/videoforge_media_local",
    "workers/image-media/src/videoforge_image_media",
    "packages/contracts/python/videoforge_contracts",
)
RELEASE_FILES = (
    ".github/workflows/media-worker-release.yml",
    "pyproject.toml",
    "uv.lock",
    "apps/media-worker-desktop/build_release_config.py",
    "apps/media-worker-desktop/compute_execution_bundle_sha256.py",
    "apps/media-worker-desktop/prepare_release_tools.py",
    "apps/media-worker-desktop/videoforge-worker.spec",
    "apps/media-worker-desktop/windows-installer.iss",
    "workers/media-local/pyproject.toml",
    "workers/image-media/pyproject.toml",
    "packages/contracts/pyproject.toml",
)
VERSION_PATTERNS = (
    (
        "apps/media-worker-desktop/windows-installer.iss",
        re.compile(r'^#define WorkerVersion "([^"]+)"$', re.MULTILINE),
    ),
    (
        "apps/media-worker-desktop/videoforge-worker.spec",
        re.compile(r'"CFBundleShortVersionString": "([^"]+)"'),
    ),
    (
        "workers/media-local/src/videoforge_media_local/personal_worker.py",
        re.compile(r'^_WORKER_VERSION = "([^"]+)"$', re.MULTILINE),
    ),
)


def _sha256_bytes(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def _git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def _git_blob(root: Path, relative: Path) -> bytes:
    result = subprocess.run(
        ["git", "-C", str(root), "cat-file", "blob", f"HEAD:{relative.as_posix()}"],
        check=True,
        capture_output=True,
    )
    return result.stdout


def _sha256_repo_file(root: Path, relative: Path) -> str:
    return _sha256_bytes(_git_blob(root, relative))


def _assert_clean(root: Path) -> None:
    status = _git(root, "status", "--porcelain", "--untracked-files=all")
    if status:
        raise SystemExit("execution bundle identity requires a clean Git worktree")


def _load_release_tools(root: Path) -> ModuleType:
    path = root / "apps/media-worker-desktop/prepare_release_tools.py"
    spec = importlib.util.spec_from_file_location("videoforge_release_tools", path)
    if spec is None or spec.loader is None:
        raise SystemExit("unable to load pinned release-tool manifest")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _source_files(root: Path) -> list[dict[str, object]]:
    paths = {Path(path) for path in RELEASE_FILES}
    for source_root in WORKER_SOURCE_ROOTS:
        directory = root / source_root
        if not directory.is_dir():
            raise SystemExit(f"missing execution source directory: {source_root}")
        paths.update(
            path.relative_to(root)
            for path in directory.rglob("*")
            if path.is_file() and not path.is_symlink()
        )
    values = []
    for relative in sorted(paths, key=lambda path: path.as_posix()):
        path = root / relative
        if not path.is_file() or path.is_symlink():
            raise SystemExit(f"execution source is not a regular file: {relative}")
        content = _git_blob(root, relative)
        values.append(
            {
                "path": relative.as_posix(),
                "sha256": _sha256_bytes(content),
                "size_bytes": len(content),
            }
        )
    return values


def _worker_version(root: Path) -> str:
    versions = []
    for relative, pattern in VERSION_PATTERNS:
        match = pattern.search(_git_blob(root, Path(relative)).decode("utf-8"))
        if match is None:
            raise SystemExit(f"worker version is missing from {relative}")
        versions.append(match.group(1))
    if len(set(versions)) != 1:
        raise SystemExit(f"worker version drifted across release files: {versions}")
    return versions[0]


def _tool_pins(root: Path) -> dict[str, str]:
    module = _load_release_tools(root)
    return {
        name: str(value)
        for name, value in sorted(vars(module).items())
        if (name.endswith("_URL") or name.endswith("_SHA256")) and isinstance(value, str)
    }


def build_manifest(root: Path) -> dict[str, object]:
    _assert_clean(root)
    return {
        "schema_version": SCHEMA_VERSION,
        "worker_version": _worker_version(root),
        "git_commit": _git(root, "rev-parse", "HEAD"),
        "release_workflow_sha256": _sha256_repo_file(
            root, Path(".github/workflows/media-worker-release.yml")
        ),
        "pinned_release_inputs": _tool_pins(root),
        "source_files": _source_files(root),
    }


def _canonical_bytes(manifest: dict[str, object]) -> bytes:
    return (
        json.dumps(manifest, ensure_ascii=True, separators=(",", ":"), sort_keys=True) + "\n"
    ).encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compute the canonical personal-worker bundle identity"
    )
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--format", choices=("sha256", "json"), default="sha256")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--expected-version", default="0.1.5")
    args = parser.parse_args()

    root = args.root.resolve()
    manifest = build_manifest(root)
    if manifest["worker_version"] != args.expected_version:
        raise SystemExit(
            f"worker version {manifest['worker_version']} does not match {args.expected_version}"
        )
    digest = _sha256_bytes(_canonical_bytes(manifest))
    value = {"execution_bundle_sha256": digest, **manifest}
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if args.format == "json":
        print(json.dumps(value, indent=2, sort_keys=True))
    else:
        print(digest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

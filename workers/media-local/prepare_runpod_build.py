"""Prepare a private offline Docker context from already supplied Linux artifacts.

No network, installs, model acquisition or Docker launch. The resulting unqualified
manifest cannot allocate compute. Qualify actual retained jobs with --network=none,
then copy runtime.json/release-config.json back and rebuild the final immutable image.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import struct
import subprocess
from pathlib import Path

MODEL_SHA256 = "sha256:a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"
WHISPER_SOURCE_SHA256 = "sha256:b26f30e52c095ccb75da40b168437736605eb280de57381887bf9e2b65f31e66"


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return "sha256:" + hashlib.file_digest(source, "sha256").hexdigest()


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def validate_tools(tools: Path, model: Path, provenance: dict) -> dict:
    if provenance.get("platform") != "linux/amd64":
        raise ValueError("Supplied media tools must be Linux amd64")
    facts = {}
    for key, filename, version in (("ffmpeg", "ffmpeg", "8.1.2"),
                                    ("ffprobe", "ffprobe", "8.1.2"),
                                    ("whisper", "whisper-cli", "1.8.4")):
        path = tools / filename
        expected = provenance[key]
        if path.is_symlink() or expected.get("version") != version or digest(path) != expected.get("sha256"):
            raise ValueError("Supplied Linux tool hash or version differs from provenance")
        with path.open("rb") as source:
            header = source.read(20)
        if header[:6] != b"\x7fELF\x02\x01" or struct.unpack("<H", header[18:20])[0] != 62:
            raise ValueError("Supplied tool is not a Linux amd64 ELF executable")
        facts[key] = {"path": f"/opt/videoforge/tools/{filename}", "version": version,
                      "sha256": expected["sha256"]}
    if provenance["whisper"].get("source_sha256") != WHISPER_SOURCE_SHA256:
        raise ValueError("Supplied Whisper source differs from pinned 1.8.4 archive")
    if model.is_symlink() or digest(model) != MODEL_SHA256:
        raise ValueError("Supplied model differs from accepted base.en bytes")
    facts["whisper_model"] = {"path": "/opt/videoforge/tools/ggml-base.en.bin", "sha256": MODEL_SHA256}
    return facts


def validate_wheels(wheels: Path, requirements: str) -> list[Path]:
    allowed = set(re.findall(r"--hash=sha256:([0-9a-f]{64})", requirements))
    packages = dict(re.findall(r"^([A-Za-z0-9._-]+)==([^\s\\]+)", requirements, re.MULTILINE))
    selected = []
    def normalize(value):
        return re.sub(r"[-_.]+", "_", value).lower()
    for name, version in packages.items():
        matches = []
        for path in wheels.glob("*.whl"):
            pieces = path.name.split("-")
            if normalize(pieces[0]) != normalize(name) or pieces[1] != version:
                continue
            platform_tag = pieces[-1].removesuffix(".whl")
            python_tag, abi_tag = pieces[-3:-1]
            if abi_tag not in {"none", "abi3"} and (python_tag != "cp312" or abi_tag != "cp312"):
                continue
            if abi_tag == "abi3":
                version_tag = re.fullmatch(r"cp(3)([0-9]+)", python_tag)
                if version_tag is None or int(version_tag.group(2)) > 12:
                    continue
            if platform_tag != "any" and not ("manylinux" in platform_tag and "x86_64" in platform_tag):
                continue
            if path.is_symlink() or digest(path).removeprefix("sha256:") not in allowed:
                raise ValueError("Supplied wheel hash differs from uv.lock export")
            matches.append(path)
        if len(matches) != 1:
            raise ValueError(f"Provide exactly one locked Linux-compatible wheel for {name}")
        selected.append(matches[0])
    if not selected:
        raise ValueError("Locked runtime dependencies are missing")
    return selected


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--tools", type=Path, required=True)
    parser.add_argument("--wheels", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--provenance", type=Path, required=True)
    args = parser.parse_args()
    requirements_path = args.root / "workers/media-local/runpod-requirements.lock"
    exported = subprocess.run(["uv", "export", "--offline", "--frozen", "--package",
                  "videoforge-media-local-worker", "--no-dev", "--no-editable", "--no-emit-workspace",
                  "--no-header"], cwd=args.root, capture_output=True, check=True).stdout
    if exported != requirements_path.read_bytes():
        raise ValueError("Tracked cloud dependency lock differs from current uv.lock export")
    provenance = json.loads(args.provenance.read_bytes())
    tools = validate_tools(args.tools, args.model, provenance)
    wheels = validate_wheels(args.wheels, exported.decode())
    sources = {}
    for relative in ("packages/contracts/python", "workers/image-media/src", "workers/media-local/src"):
        for path in sorted((args.root / relative).rglob("*.py")):
            if "__pycache__" not in path.parts:
                if path.is_symlink():
                    raise ValueError("Runtime source cannot contain symlinks")
                sources[str(path.relative_to(args.root))] = digest(path)
    target = args.root / ".videoforge/cloud-media/build"
    target.mkdir(parents=True, exist_ok=False)
    (target / "tools").mkdir()
    (target / "wheels").mkdir()
    for name in ("ffmpeg", "ffprobe", "whisper-cli"):
        shutil.copyfile(args.tools / name, target / "tools" / name)
        (target / "tools" / name).chmod(0o755)
    shutil.copyfile(args.model, target / "tools/ggml-base.en.bin")
    for path in wheels:
        shutil.copyfile(path, target / "wheels" / path.name)
    (target / "requirements.txt").write_bytes(exported)
    whisper = {"version": "1.8.4", "source_sha256": WHISPER_SOURCE_SHA256,
               "binary_sha256": tools["whisper"]["sha256"]}
    (target / "tools/whisper-build.json").write_bytes(canonical(whisper) + b"\n")
    manifest = {"schema_version": "videoforge-linux-media-runtime/v1", "platform": "linux",
                "qualified": False, "tools": tools, "source_files": sources,
                "source_sha256": "sha256:" + hashlib.sha256(canonical(sources)).hexdigest(),
                "dependency_lock_sha256": digest(requirements_path)}
    (target / "runtime.json").write_bytes(canonical(manifest) + b"\n")
    (target / "build-args.json").write_bytes(canonical({
        "FFMPEG_SHA256": tools["ffmpeg"]["sha256"].removeprefix("sha256:"),
        "FFPROBE_SHA256": tools["ffprobe"]["sha256"].removeprefix("sha256:"),
        "WHISPER_SHA256": tools["whisper"]["sha256"].removeprefix("sha256:")}) + b"\n")
    print(f"Prepared unqualified offline context: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

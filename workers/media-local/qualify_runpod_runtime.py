"""Record a Linux runtime only after exact-job offline acceptance has passed.

Run inside the candidate image with --network=none. Supply retained accepted ASR,
SPAN_AUDIO and RENDER job documents and object trees; no provider work is invoked.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import sys
from pathlib import Path

MODEL_SHA256 = "sha256:a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return "sha256:" + hashlib.file_digest(source, "sha256").hexdigest()


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("/opt/videoforge"))
    parser.add_argument("--artifact-root", type=Path, required=True)
    for kind in ("asr", "span", "render"):
        parser.add_argument(f"--{kind}-input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if sys.platform != "linux" or platform.machine() != "x86_64" or sys.version_info[:2] != (3, 12):
        raise ValueError("Qualification requires Linux Python 3.12")
    from videoforge_media_local.runpod_job import REQUIRED_CPU_FLAGS, _verify_cpu_features
    _verify_cpu_features(REQUIRED_CPU_FLAGS)
    import cv2
    import numpy
    tools = {}
    for name, filename, version in (("ffmpeg", "ffmpeg", "8.1.2"),
                                    ("ffprobe", "ffprobe", "8.1.2"),
                                    ("whisper", "whisper-cli", "1.8.4"),
                                    ("whisper_model", "ggml-base.en.bin", None)):
        path = args.root / "tools" / filename
        tools[name] = {"path": str(path), "sha256": digest(path)}
        if version:
            flag = "--help" if name == "whisper" else "-version"
            result = subprocess.run([str(path), flag], capture_output=True, timeout=30,
                                    check=name != "whisper")
            output = (result.stdout + result.stderr).decode(errors="replace")
            if ("usage:" if name == "whisper" else version) not in output:
                raise ValueError(f"Exact {name} version is unavailable")
            if name == "whisper":
                provenance = json.loads((args.root / "tools" / "whisper-build.json").read_bytes())
                if (provenance.get("version") != "1.8.4"
                        or provenance.get("source_sha256") != "sha256:b26f30e52c095ccb75da40b168437736605eb280de57381887bf9e2b65f31e66"
                        or provenance.get("binary_sha256") != tools[name]["sha256"]):
                    raise ValueError("Whisper binary lacks exact source provenance")
            tools[name]["version"] = version
    if tools["whisper_model"]["sha256"] != MODEL_SHA256:
        raise ValueError("Accepted base.en model differs")
    evidence = {}
    for kind, command in (("asr", "transcribe"), ("span", "materialize-span"), ("render", "render")):
        input_path = getattr(args, f"{kind}_input")
        document = json.loads(input_path.read_bytes())
        arguments = [sys.executable, "-m", "videoforge_media_local.cli", command,
                     "--artifact-root", str(args.artifact_root), "--input", str(input_path),
                     "--ffmpeg", tools["ffmpeg"]["path"], "--ffprobe", tools["ffprobe"]["path"]]
        if kind == "asr":
            arguments += ["--whisper", tools["whisper"]["path"], "--model", tools["whisper_model"]["path"],
                          "--whisper-version", "1.8.4"]
        elif kind == "render":
            arguments += ["--claimed-attempt-id", document["attempt_id"], "--ffmpeg-version", "8.1.2",
                          "--ffprobe-version", "8.1.2"]
            # Qualification must exercise current Fal composition, not only a still fixture.
            from videoforge_media_local.artifacts import R2PortFixtureArtifactResolver
            resolver = R2PortFixtureArtifactResolver(args.artifact_root)
            pointer = document["resolved_render_manifest"]
            manifest_path = resolver.resolve_object(pointer["artifact_uri"])
            if digest(manifest_path) != pointer["sha256"]:
                raise ValueError("Qualification render manifest hash differs")
            resolved = json.loads(manifest_path.read_bytes())
            fal_compositions = {segment["timeline_composition"] for segment in resolved["segments"]
                                if segment["render"].get("avatar_source_profile") == "fal-flashhead-512x512p25-wide-v2"}
            if not {"AVATAR_FULL", "AVATAR_SPLIT_IMAGE"}.issubset(fal_compositions):
                raise ValueError("Qualification render must contain accepted full and split Fal media")
        result = subprocess.run(arguments, capture_output=True, check=True, timeout=7200)
        receipt = json.loads(result.stdout)
        if receipt.get("status") != "SUCCEEDED":
            raise ValueError(f"Real {kind} qualification failed")
        evidence[kind] = {"input_sha256": digest(input_path),
                          "receipt_sha256": "sha256:" + hashlib.sha256(canonical(receipt)).hexdigest()}
    files = {}
    for relative in ("packages/contracts/python", "workers/image-media/src", "workers/media-local/src"):
        for path in sorted((args.root / relative).rglob("*.py")):
            if "__pycache__" not in path.parts:
                files[str(path.relative_to(args.root))] = digest(path)
    manifest = {"schema_version": "videoforge-linux-media-runtime/v1", "platform": "linux",
                "qualified": True, "tools": tools, "source_files": files,
                "required_cpu_flags": REQUIRED_CPU_FLAGS,
                "source_sha256": "sha256:" + hashlib.sha256(canonical(files)).hexdigest(),
                "opencv_version": cv2.__version__, "numpy_version": numpy.__version__,
                "offline_acceptance": evidence}
    args.output.write_bytes(canonical(manifest) + b"\n")
    runtime_sha256 = "sha256:" + hashlib.sha256(canonical(manifest)).hexdigest()
    release = {"schema_version": "videoforge-runpod-media-release/v1", "platform": "linux/amd64",
               "qualified": True, "runtime_sha256": runtime_sha256,
               "required_cpu_flags": REQUIRED_CPU_FLAGS,
               "source_sha256": manifest["source_sha256"], "tooling": {
                   "whisper_model_sha256": MODEL_SHA256,
                   "ffmpeg_version": "8.1.2", "ffprobe_version": "8.1.2", "whisper_version": "1.8.4",
                   "ffmpeg_sha256": tools["ffmpeg"]["sha256"],
                   "ffprobe_sha256": tools["ffprobe"]["sha256"],
                   "whisper_sha256": tools["whisper"]["sha256"]}}
    args.output.with_name("release-config.json").write_bytes(canonical(release) + b"\n")
    print(runtime_sha256)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

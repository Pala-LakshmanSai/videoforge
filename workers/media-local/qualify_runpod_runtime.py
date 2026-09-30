"""Record a Linux runtime only after exact-job offline acceptance has passed.

Run inside the candidate image with --network=none. Supply retained accepted ASR,
SPAN_AUDIO and RENDER job documents and object trees; no provider work is invoked.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
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


def stage_input(artifact_root: Path, source: Path, kind: str) -> Path:
    """Retain exact input bytes inside the existing CLI's trusted artifact root."""
    if (kind not in {"asr", "span", "render"} or not artifact_root.is_absolute()
            or artifact_root.is_symlink() or source.is_symlink() or not source.is_file()):
        raise ValueError("Offline qualification input path is invalid")
    directory = artifact_root / "qualification-inputs"
    directory.mkdir(exist_ok=True)
    if directory.is_symlink() or not directory.resolve().is_relative_to(artifact_root.resolve()):
        raise ValueError("Offline qualification input escaped artifact root")
    with source.open("rb") as stream:
        encoded = stream.read(16 * 1024**2 + 1)
    if len(encoded) > 16 * 1024**2:
        raise ValueError("Offline qualification input exceeds bound")
    destination = directory / f"{kind}.json"
    with destination.open("xb") as output:
        output.write(encoded)
    return destination


def stage_bundle_objects(artifact_root: Path) -> None:
    """Adapt the bounded archive layout to the unchanged private R2 fixture port."""
    from videoforge_media_local.artifacts import R2PortFixtureArtifactResolver
    resolver = R2PortFixtureArtifactResolver(artifact_root)
    for namespace in ("objects", "runs"):
        source_root = resolver.root / namespace
        if source_root.is_symlink():
            raise ValueError("Offline qualification namespace is unsafe")
        for source in sorted(source_root.rglob("*")):
            if source.is_symlink():
                raise ValueError("Offline qualification object is unsafe")
            if source.is_file():
                relative = source.relative_to(source_root)
                parent = resolver._ensure_directory(resolver.bucket, namespace, *relative.parts[:-1])
                destination = parent / relative.name
                os.link(source, destination)  # Exact immutable bytes; never overwrite an input.


def failure_code(receipt: dict) -> str:
    from videoforge_media_local import personal_execution as media
    allowed = media._ASR_FAILURE_CODES | media._SPAN_AUDIO_FAILURE_CODES | media._RENDER_FAILURE_CODES
    error = receipt.get("error")
    code = error.get("code") if isinstance(error, dict) else None
    return code if isinstance(code, str) and code in allowed else "OFFLINE_RECEIPT_INVALID"


def qualify_span_stream(document: dict, artifact_root: Path, tools: dict) -> dict:
    """Exercise the real two-clip worker offline; only control/storage transport is replaced."""
    import copy
    import shutil
    from datetime import datetime, timedelta, timezone
    from unittest.mock import patch
    from uuid import uuid4
    from videoforge_media_local import runpod_job as cloud
    from videoforge_media_local.artifacts import R2PortFixtureArtifactResolver
    resolver = R2PortFixtureArtifactResolver(artifact_root)
    voice = document["source_voiceover"]
    source = resolver.resolve_object(voice["artifact_uri"])
    if digest(source) != voice["sha256"]:
        raise ValueError("Stream qualification source checksum differs")
    deadline = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
    reservation = str(uuid4())
    documents = []
    for _ in range(2):
        attempt = str(uuid4())
        child = copy.deepcopy(document)
        child.update(attempt_id=attempt,cancel_token=attempt)
        child["output"]["result_uri"] = f"vf-local-run://{child['project_revision_id']}/{attempt}/span-audio-result.json"
        base = f"https://offline.test/reservations/{reservation}"
        key = f"tenant/offline/workspace/offline/project/offline/revision/{child['project_revision_id']}/lane/input/job/{attempt}/artifact"
        documents.append({"schema_version":"videoforge-runpod-pod-job-spec/v2","span_batch_limit":128,
            "reservation_id":reservation,"source_sha256":voice["sha256"],"runtime_sha256":voice["sha256"],
            "deadline_at":deadline,"job":{"schema_version":"videoforge-personal-worker-job-spec/v1",
                "attempt_id":attempt,"kind":"SPAN_AUDIO","expires_at":deadline,"input_document":child,
                "objects":[{"uri":voice["artifact_uri"],"sha256":voice["sha256"],"bytes":source.stat().st_size,"url":"https://offline.test/source"}],
                "outputs":[{"source":"PRIMARY_RESULT_OUTPUT","object_key":key+"/audio","sign_url":base+"/upload-port","content_type":"audio/wav","max_bytes":2097152}],
                "result":{"object_key":key+"/result","sign_url":base+"/upload-port","max_bytes":1048576},
                "cancellation_url":base+"/heartbeat","completion_url":base+"/complete?attempt_id="+attempt,
                "tooling":{"whisper_model_sha256":MODEL_SHA256,"whisper_version":"1.8.4","ffmpeg_version":"8.1.2","ffprobe_version":"8.1.2"}}})
    downloads,receipts,uploads,phases,cleanup = [],[],[],[],[]
    def download(item,destination,cancelled):
        if cancelled():
            raise ValueError("Offline stream cancelled")
        downloads.append(item["uri"])
        destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(source,destination)
    def put(port,stream,size):
        encoded=stream.read(size+1)
        if len(encoded)!=size or "sha256:"+hashlib.sha256(encoded).hexdigest()!=port["checksumSha256"]:
            raise ValueError("Offline stream upload checksum differs")
        uploads.append(port["checksumSha256"])
    def control(url,token,lease,body):
        if "/heartbeat" in url:
            phases.append(body.get("phase"))
            return {"schema_version":"videoforge-personal-worker-lease-heartbeat/v1","cancel_requested":False,"lease_expires_in_seconds":300}
        if "/upload-port" in url:
            if body.get("schema_version")!="videoforge-cloud-span-upload-authorities/v1":
                raise ValueError("Offline stream missed combined authorities")
            return {"uploads":[{"method":"PUT","contentLength":u["content_length"],"checksumSha256":u["checksum_sha256"],"contentType":u["content_type"]} for u in body["uploads"]]}
        if "/complete" in url:
            ordinal=body["executed_span_count"]
            if body["status"]!="SUCCEEDED" or ordinal not in (len(receipts),len(receipts)+1) or ordinal<1:
                raise ValueError("Offline stream completion failed")
            if ordinal==len(receipts)+1:
                receipts.append(body["result_checksum_sha256"])
                if ordinal==1:
                    raise OSError("Simulated lost durable completion reply")
            elif receipts[ordinal-1]!=body["result_checksum_sha256"]:
                raise ValueError("Offline stream replay changed receipt")
            return {"schema_version":"videoforge-personal-worker-completion-accepted/v1","state":"SUCCEEDED",
                "next_spec":documents[1] if ordinal==1 else None}
        cleanup.append(body)
        return {"cleanup_requested":True}
    with patch.object(cloud.media,"_download",side_effect=download), patch.object(cloud.media,"_stream_put",side_effect=put), patch.object(cloud,"_control",side_effect=control):
        result=cloud.execute_batch(cloud.parse_spec(documents[0]),"offline-capability","offline-lease",
            cloud.media.ToolPaths(**{name:Path(value["path"]) for name,value in tools.items()}))
    if result!="SUCCEEDED" or len(downloads)!=1 or len(receipts)!=2 or len(uploads)!=4 or phases!=["SAVING","SAVING"] or len(cleanup)!=1:
        raise ValueError("Offline span stream acceptance failed")
    return {"clips":2,"source_downloads":1,"separate_verified_uploads":4,"cleanup_requests":1,"lost_reply_replays":1,"receipt_sha256":receipts}


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
    stage_bundle_objects(args.artifact_root)
    evidence = {}
    for kind, command in (("asr", "transcribe"), ("span", "materialize-span"), ("render", "render")):
        input_path = stage_input(args.artifact_root, getattr(args, f"{kind}_input"), kind)
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
        result = subprocess.run(arguments, capture_output=True, check=False, timeout=7200)
        if result.returncode:
            raise ValueError(f"Offline {kind} command rejected trusted configuration")
        receipt = json.loads(result.stdout)
        if receipt.get("status") != "SUCCEEDED":
            raise ValueError(f"Offline {kind} qualification failed: {failure_code(receipt)}")
        evidence[kind] = {"input_sha256": digest(input_path),
                          "receipt_sha256": "sha256:" + hashlib.sha256(canonical(receipt)).hexdigest()}
    evidence["span_stream"] = qualify_span_stream(json.loads((args.artifact_root / "qualification-inputs/span.json").read_bytes()),args.artifact_root,tools)
    files = {}
    for relative in ("packages/contracts/python", "workers/image-media/src", "workers/media-local/src"):
        for path in sorted((args.root / relative).rglob("*.py")):
            if "__pycache__" not in path.parts:
                files[str(path.relative_to(args.root))] = digest(path)
    manifest = {"schema_version": "videoforge-linux-media-runtime/v1", "platform": "linux",
                "span_batch_protocol": 2,
                "qualified": True, "tools": tools, "source_files": files,
                "required_cpu_flags": REQUIRED_CPU_FLAGS,
                "source_sha256": "sha256:" + hashlib.sha256(canonical(files)).hexdigest(),
                "opencv_version": cv2.__version__, "numpy_version": numpy.__version__,
                "offline_acceptance": evidence}
    args.output.write_bytes(canonical(manifest) + b"\n")
    runtime_sha256 = "sha256:" + hashlib.sha256(canonical(manifest)).hexdigest()
    release = {"schema_version": "videoforge-runpod-media-release/v1", "platform": "linux/amd64",
               "span_batch_protocol": 2,
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

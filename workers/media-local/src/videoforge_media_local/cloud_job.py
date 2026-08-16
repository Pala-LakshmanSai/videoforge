from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from videoforge_image_media.local_cli import cancellation_marker

_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_OBJECT_URI = re.compile(
    r"^vf-local://objects/sha256/(?P<prefix>[0-9a-f]{2})/"
    r"(?P<digest>[0-9a-f]{64})\.(?P<extension>[a-z0-9]{1,10})$"
)
_RUN_URI = re.compile(
    r"^vf-local-run://(?P<revision>[A-Za-z0-9][A-Za-z0-9._:-]{0,159})/"
    r"(?P<attempt>[A-Za-z0-9][A-Za-z0-9._:-]{0,159})/"
    r"(?P<filename>[A-Za-z0-9][A-Za-z0-9._-]{0,159})$"
)
_R2_KEY = re.compile(
    r"^tenant/[A-Za-z0-9._:-]+/workspace/[A-Za-z0-9._:-]+/project/"
    r"[A-Za-z0-9._:-]+/revision/[A-Za-z0-9._:-]+/lane/(?:input|render)/job/"
    r"[A-Za-z0-9._:-]+/artifact/[A-Za-z0-9._:-]+$"
)
_PINNED_WHISPER_VERSION = "1.8.4"
_PINNED_FFMPEG_VERSION = "8.1.2"


def _canonical(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")


def _sha256_bytes(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def _timestamp(value: object) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ValueError("Cloud job expiry must be canonical UTC")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo != timezone.utc:
        raise ValueError("Cloud job expiry must be UTC")
    return parsed


@dataclass(frozen=True)
class RemoteObject:
    uri: str
    url: str
    sha256: str
    size: int


@dataclass(frozen=True)
class RemoteOutput:
    source: str
    url: str
    content_type: str
    max_bytes: int


@dataclass(frozen=True)
class CloudJobSpec:
    attempt_id: str
    kind: str
    expires_at: datetime
    input_document: dict[str, Any]
    objects: tuple[RemoteObject, ...]
    outputs: tuple[RemoteOutput, ...]
    result_object_key: str
    result_upload_url: str
    result_max_bytes: int
    cancellation_url: str | None
    tooling: dict[str, str]


def parse_spec(value: object) -> CloudJobSpec:
    if not isinstance(value, dict) or set(value) != {
        "schema_version",
        "attempt_id",
        "kind",
        "expires_at",
        "input_document",
        "objects",
        "outputs",
        "result",
        "cancellation_url",
        "tooling",
    }:
        raise ValueError("Cloud job spec fields are not exact")
    if value["schema_version"] != "videoforge-cloud-run-job-spec/v1":
        raise ValueError("Cloud job spec version is unsupported")
    attempt_id = value["attempt_id"]
    kind = value["kind"]
    if not isinstance(attempt_id, str) or not _ID.fullmatch(attempt_id):
        raise ValueError("Cloud job attempt is invalid")
    if kind not in {"ASR", "RENDER"} or not isinstance(value["input_document"], dict):
        raise ValueError("Cloud job kind or input is invalid")

    objects: list[RemoteObject] = []
    seen_uris: set[str] = set()
    if not isinstance(value["objects"], list) or len(value["objects"]) > 4096:
        raise ValueError("Cloud job object list is invalid")
    for item in value["objects"]:
        if not isinstance(item, dict) or set(item) != {"uri", "url", "sha256", "bytes"}:
            raise ValueError("Cloud job object is malformed")
        if (
            not isinstance(item["uri"], str)
            or not _OBJECT_URI.fullmatch(item["uri"])
            or item["uri"] in seen_uris
            or not isinstance(item["url"], str)
            or not item["url"].startswith("https://")
            or not isinstance(item["sha256"], str)
            or not _SHA256.fullmatch(item["sha256"])
            or not isinstance(item["bytes"], int)
            or not 0 < item["bytes"] <= 10 * 1024**3
        ):
            raise ValueError("Cloud job object authority is invalid")
        seen_uris.add(item["uri"])
        objects.append(RemoteObject(item["uri"], item["url"], item["sha256"], item["bytes"]))

    outputs: list[RemoteOutput] = []
    if not isinstance(value["outputs"], list) or len(value["outputs"]) > 4096:
        raise ValueError("Cloud job output list is invalid")
    for item in value["outputs"]:
        if not isinstance(item, dict) or set(item) != {
            "source",
            "url",
            "content_type",
            "max_bytes",
        }:
            raise ValueError("Cloud job output is malformed")
        if (
            item["source"] not in {"PRIMARY_RESULT_OUTPUT"}
            or not isinstance(item["url"], str)
            or not item["url"].startswith("https://")
            or not isinstance(item["content_type"], str)
            or not re.fullmatch(r"[a-z0-9.+-]+/[a-z0-9.+-]+", item["content_type"])
            or not isinstance(item["max_bytes"], int)
            or not 0 < item["max_bytes"] <= 10 * 1024**3
        ):
            raise ValueError("Cloud job output authority is invalid")
        outputs.append(
            RemoteOutput(item["source"], item["url"], item["content_type"], item["max_bytes"])
        )

    result = value["result"]
    if (
        not isinstance(result, dict)
        or set(result) != {"object_key", "upload_url", "max_bytes"}
        or not isinstance(result["object_key"], str)
        or not _R2_KEY.fullmatch(result["object_key"])
        or not isinstance(result["upload_url"], str)
        or not result["upload_url"].startswith("https://")
        or not isinstance(result["max_bytes"], int)
        or not 0 < result["max_bytes"] <= 1024**2
    ):
        raise ValueError("Cloud job result authority is invalid")
    cancellation_url = value["cancellation_url"]
    if cancellation_url is not None and (
        not isinstance(cancellation_url, str) or not cancellation_url.startswith("https://")
    ):
        raise ValueError("Cloud job cancellation URL is invalid")
    tooling = value["tooling"]
    expected_tooling = {
        "whisper_model_uri",
        "whisper_version",
        "ffmpeg_version",
        "ffprobe_version",
    }
    if (
        not isinstance(tooling, dict)
        or set(tooling) != expected_tooling
        or not all(isinstance(item, str) and 0 < len(item) <= 160 for item in tooling.values())
        or tooling["whisper_version"] != _PINNED_WHISPER_VERSION
        or tooling["ffmpeg_version"] != _PINNED_FFMPEG_VERSION
        or tooling["ffprobe_version"] != _PINNED_FFMPEG_VERSION
    ):
        raise ValueError("Cloud job tooling is invalid")
    return CloudJobSpec(
        attempt_id=attempt_id,
        kind=kind,
        expires_at=_timestamp(value["expires_at"]),
        input_document=value["input_document"],
        objects=tuple(objects),
        outputs=tuple(outputs),
        result_object_key=result["object_key"],
        result_upload_url=result["upload_url"],
        result_max_bytes=result["max_bytes"],
        cancellation_url=cancellation_url,
        tooling=tooling,
    )


def _local_path(root: Path, uri: str) -> Path:
    object_match = _OBJECT_URI.fullmatch(uri)
    if object_match:
        return (
            root
            / "videoforge-private-fixture"
            / "objects"
            / "sha256"
            / object_match.group("prefix")
            / f"{object_match.group('digest')}.{object_match.group('extension')}"
        )
    run_match = _RUN_URI.fullmatch(uri)
    if run_match:
        return (
            root
            / "videoforge-private-fixture"
            / "runs"
            / run_match.group("revision")
            / run_match.group("attempt")
            / run_match.group("filename")
        )
    raise ValueError("Unsupported local artifact URI")


def _download(url: str, destination: Path, expected_size: int, expected_sha256: str) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    digest = hashlib.sha256()
    size = 0
    with urllib.request.urlopen(url, timeout=60) as response, destination.open("xb") as output:
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > expected_size:
                raise ValueError("Downloaded object exceeded its exact size")
            digest.update(chunk)
            output.write(chunk)
    if size != expected_size or f"sha256:{digest.hexdigest()}" != expected_sha256:
        raise ValueError("Downloaded object did not match durable facts")


def _put(url: str, content_type: str, payload: bytes, maximum: int) -> None:
    if not 0 < len(payload) <= maximum:
        raise ValueError("Upload exceeded its exact bound")
    request = urllib.request.Request(
        url, data=payload, method="PUT", headers={"content-type": content_type}
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        if response.status < 200 or response.status >= 300:
            raise ValueError("Artifact upload failed")


class CancellationMonitor:
    def __init__(self, url: str | None, marker: Path) -> None:
        self._url = url
        self._marker = marker
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        if self._url is not None:
            self._thread.start()

    def close(self) -> None:
        self._stop.set()
        if self._thread.is_alive():
            self._thread.join(timeout=5)

    def _run(self) -> None:
        while not self._stop.wait(2):
            try:
                with urllib.request.urlopen(self._url, timeout=5) as response:
                    state = json.loads(response.read(4096))
                if state == {"cancelled": True}:
                    self._marker.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    self._marker.write_bytes(b"cancelled")
                    return
            except (OSError, ValueError, json.JSONDecodeError):
                continue


def _callback(url: str, token: str, payload: dict[str, object]) -> None:
    request = urllib.request.Request(
        url,
        data=_canonical(payload),
        method="POST",
        headers={"authorization": f"Bearer {token}", "content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status != 202:
            raise ValueError("Cloud job callback was not accepted")


def run(spec: CloudJobSpec, callback_url: str, callback_token: str) -> int:
    if datetime.now(timezone.utc) >= spec.expires_at:
        raise ValueError("Cloud job spec expired before execution")
    scratch = Path(tempfile.mkdtemp(prefix=f"videoforge-{spec.attempt_id}-", dir="/tmp"))
    result_facts: dict[str, object] = {
        "result_object_key": None,
        "result_content_length": None,
        "result_checksum_sha256": None,
    }
    status = "FAILED"
    try:
        for item in spec.objects:
            _download(item.url, _local_path(scratch, item.uri), item.size, item.sha256)
        input_path = scratch / "job-input.json"
        input_path.write_bytes(_canonical(spec.input_document))
        cancellation_token = str(spec.input_document.get("cancellation_token", spec.attempt_id))
        monitor = CancellationMonitor(
            spec.cancellation_url, cancellation_marker(scratch, cancellation_token)
        )
        monitor.start()
        model_path = _local_path(scratch, spec.tooling["whisper_model_uri"])
        command = [
            sys.executable,
            "-m",
            "videoforge_media_local.cli",
            "transcribe" if spec.kind == "ASR" else "render",
            "--artifact-root",
            str(scratch),
            "--input",
            str(input_path),
        ]
        if spec.kind == "ASR":
            command.extend(
                [
                    "--whisper",
                    "/usr/local/bin/whisper-cli",
                    "--model",
                    str(model_path),
                    "--whisper-version",
                    spec.tooling["whisper_version"],
                    "--ffmpeg",
                    "/usr/local/bin/ffmpeg",
                    "--ffprobe",
                    "/usr/local/bin/ffprobe",
                ]
            )
        else:
            command.extend(
                [
                    "--claimed-attempt-id",
                    spec.attempt_id,
                    "--ffmpeg",
                    "/usr/local/bin/ffmpeg",
                    "--ffprobe",
                    "/usr/local/bin/ffprobe",
                    "--ffmpeg-version",
                    spec.tooling["ffmpeg_version"],
                    "--ffprobe-version",
                    spec.tooling["ffprobe_version"],
                ]
            )
        completed = subprocess.run(command, check=False, capture_output=True, timeout=86_400)
        monitor.close()
        if completed.returncode != 0:
            status = (
                "CANCELLED"
                if cancellation_marker(scratch, cancellation_token).exists()
                else "FAILED"
            )
        else:
            result = json.loads(completed.stdout)
            for output in spec.outputs:
                if output.source != "PRIMARY_RESULT_OUTPUT":
                    raise ValueError("Unsupported Cloud job output source")
                output_document = result.get("output")
                if not isinstance(output_document, dict) or not isinstance(
                    output_document.get("artifact_uri"), str
                ):
                    raise ValueError("Cloud job primary result output is missing")
                path = _local_path(scratch, output_document["artifact_uri"])
                if path.is_file():
                    _put(output.url, output.content_type, path.read_bytes(), output.max_bytes)
            payload = _canonical(result)
            _put(spec.result_upload_url, "application/json", payload, spec.result_max_bytes)
            result_facts = {
                "result_object_key": spec.result_object_key,
                "result_content_length": len(payload),
                "result_checksum_sha256": _sha256_bytes(payload),
            }
            status = "SUCCEEDED"
        _callback(
            callback_url,
            callback_token,
            {
                "schema_version": "videoforge-cloud-run-callback/v1",
                "status": status,
                "execution_name": os.environ["CLOUD_RUN_EXECUTION"],
                **result_facts,
            },
        )
        return 0 if status == "SUCCEEDED" else 1
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def main() -> int:
    spec_url = os.environ.get("VIDEOFORGE_JOB_SPEC_URL")
    callback_url = os.environ.get("VIDEOFORGE_JOB_CALLBACK_URL")
    callback_token = os.environ.get("VIDEOFORGE_JOB_CALLBACK_TOKEN")
    if not spec_url or not callback_url or not callback_token:
        print("Cloud media job rejected missing authority.", file=sys.stderr)
        return 2
    try:
        with urllib.request.urlopen(spec_url, timeout=30) as response:
            raw = response.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError("Cloud job spec exceeded its size bound")
        spec = parse_spec(json.loads(raw))
        return run(spec, callback_url, callback_token)
    except (
        OSError,
        KeyError,
        TypeError,
        ValueError,
        json.JSONDecodeError,
        subprocess.TimeoutExpired,
    ):
        print("Cloud media job rejected or failed its bounded execution.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

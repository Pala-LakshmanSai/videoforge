from __future__ import annotations

import hashlib
import http.client
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO

from videoforge_image_media.local_cli import cancellation_marker

from .cloud_job import _local_path

_SHA256 = __import__("re").compile(r"^sha256:[0-9a-f]{64}$")
_R2_KEY = __import__("re").compile(
    r"^tenant/[A-Za-z0-9._:-]+/workspace/[A-Za-z0-9._:-]+/project/"
    r"[A-Za-z0-9._:-]+/revision/[A-Za-z0-9._:-]+/lane/(?:input|render)/job/"
    r"[A-Za-z0-9._:-]+/artifact/[A-Za-z0-9._:-]+$"
)


def _canonical(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")


def _sha256_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            size += len(chunk)
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}", size


@dataclass(frozen=True)
class ToolPaths:
    ffmpeg: Path
    ffprobe: Path
    whisper: Path
    whisper_model: Path


@dataclass(frozen=True)
class PersonalJob:
    attempt_id: str
    kind: str
    expires_at: datetime
    input_document: dict[str, Any]
    objects: tuple[dict[str, Any], ...]
    outputs: tuple[dict[str, Any], ...]
    result: dict[str, Any]
    cancellation_url: str
    completion_url: str
    tooling: dict[str, str]


def parse_personal_job(value: object) -> PersonalJob:
    expected = {
        "schema_version",
        "attempt_id",
        "kind",
        "expires_at",
        "input_document",
        "objects",
        "outputs",
        "result",
        "cancellation_url",
        "completion_url",
        "tooling",
    }
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError("Personal worker job fields are not exact")
    if value["schema_version"] != "videoforge-personal-worker-job-spec/v1":
        raise ValueError("Personal worker job version is unsupported")
    attempt_id = value["attempt_id"]
    if not isinstance(attempt_id, str) or len(attempt_id) > 160:
        raise ValueError("Personal worker attempt is invalid")
    if value["kind"] not in {"ASR", "RENDER"} or not isinstance(value["input_document"], dict):
        raise ValueError("Personal worker job kind or input is invalid")
    expires_at = datetime.fromisoformat(str(value["expires_at"]).replace("Z", "+00:00"))
    if expires_at.tzinfo != timezone.utc:
        raise ValueError("Personal worker expiry must be UTC")
    if not isinstance(value["objects"], list) or len(value["objects"]) > 4096:
        raise ValueError("Personal worker input list is invalid")
    for item in value["objects"]:
        if (
            not isinstance(item, dict)
            or set(item) != {"uri", "url", "sha256", "bytes"}
            or not isinstance(item["url"], str)
            or not item["url"].startswith("https://")
            or not isinstance(item["sha256"], str)
            or not _SHA256.fullmatch(item["sha256"])
            or not isinstance(item["bytes"], int)
            or not 0 < item["bytes"] <= 10 * 1024**3
        ):
            raise ValueError("Personal worker input authority is invalid")
    if not isinstance(value["outputs"], list) or len(value["outputs"]) != 1:
        raise ValueError("Personal worker output declaration is invalid")
    for item in value["outputs"]:
        if (
            not isinstance(item, dict)
            or set(item) != {"source", "object_key", "sign_url", "content_type", "max_bytes"}
            or item["source"] != "PRIMARY_RESULT_OUTPUT"
            or not isinstance(item["object_key"], str)
            or not _R2_KEY.fullmatch(item["object_key"])
            or not isinstance(item["sign_url"], str)
            or not item["sign_url"].startswith("https://")
            or not isinstance(item["max_bytes"], int)
        ):
            raise ValueError("Personal worker output authority is invalid")
    result = value["result"]
    if (
        not isinstance(result, dict)
        or set(result) != {"object_key", "sign_url", "max_bytes"}
        or not isinstance(result["object_key"], str)
        or not _R2_KEY.fullmatch(result["object_key"])
        or not isinstance(result["sign_url"], str)
        or not result["sign_url"].startswith("https://")
    ):
        raise ValueError("Personal worker result authority is invalid")
    for key in ("cancellation_url", "completion_url"):
        if not isinstance(value[key], str) or not value[key].startswith("https://"):
            raise ValueError("Personal worker control URL is invalid")
    if (
        not isinstance(value["tooling"], dict)
        or set(value["tooling"])
        != {"whisper_model_sha256", "whisper_version", "ffmpeg_version", "ffprobe_version"}
        or not isinstance(value["tooling"].get("whisper_model_sha256"), str)
        or not _SHA256.fullmatch(value["tooling"]["whisper_model_sha256"])
        or any(
            not isinstance(value["tooling"].get(key), str) or not value["tooling"][key]
            for key in ("whisper_version", "ffmpeg_version", "ffprobe_version")
        )
    ):
        raise ValueError("Personal worker tooling is invalid")
    return PersonalJob(
        attempt_id=attempt_id,
        kind=value["kind"],
        expires_at=expires_at,
        input_document=value["input_document"],
        objects=tuple(value["objects"]),
        outputs=tuple(value["outputs"]),
        result=result,
        cancellation_url=value["cancellation_url"],
        completion_url=value["completion_url"],
        tooling={str(key): str(item) for key, item in value["tooling"].items()},
    )


def _request_json(
    url: str,
    method: str,
    headers: dict[str, str],
    body: object | None = None,
    maximum: int = 1024 * 1024,
) -> tuple[int, object | None]:
    request = urllib.request.Request(
        url,
        data=None if body is None else _canonical(body),
        method=method,
        headers={**headers, **({"content-type": "application/json"} if body is not None else {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read(maximum + 1)
            if len(data) > maximum:
                raise ValueError("Personal worker response exceeded its bound")
            return response.status, json.loads(data) if data else None
    except urllib.error.HTTPError as error:
        data = error.read(maximum + 1)
        return error.code, json.loads(data) if data else None


def _download(item: dict[str, Any], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    digest = hashlib.sha256()
    size = 0
    with urllib.request.urlopen(item["url"], timeout=60) as response, destination.open("xb") as out:
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > item["bytes"]:
                raise ValueError("Personal worker download exceeded its exact size")
            digest.update(chunk)
            out.write(chunk)
    if size != item["bytes"] or f"sha256:{digest.hexdigest()}" != item["sha256"]:
        raise ValueError("Personal worker download did not match durable facts")


def _upload_port(
    url: str,
    device_token: str,
    lease_token: str,
    source: str,
    object_key: str,
    content_type: str,
    checksum: str,
    size: int,
) -> dict[str, Any]:
    status, value = _request_json(
        url,
        "POST",
        {
            "authorization": f"Bearer {device_token}",
            "x-videoforge-lease-token": lease_token,
        },
        {
            "schema_version": "videoforge-personal-worker-upload-authority/v1",
            "source": source,
            "object_key": object_key,
            "content_type": content_type,
            "content_length": size,
            "checksum_sha256": checksum,
        },
    )
    if status != 200 or not isinstance(value, dict):
        raise ValueError("Personal worker upload authority was not accepted")
    if (
        value.get("schema_version") != "videoforge-personal-worker-upload-port/v1"
        or value.get("method") != "PUT"
        or value.get("contentLength") != size
        or value.get("contentType") != content_type
        or value.get("checksumSha256") != checksum
        or not isinstance(value.get("requiredHeaders"), dict)
    ):
        raise ValueError("Personal worker upload port did not match exact facts")
    return value


def _stream_put(port: dict[str, Any], source: BinaryIO, size: int) -> None:
    parsed = urllib.parse.urlsplit(str(port["url"]))
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("Personal worker upload URL is not HTTPS")
    headers = {str(key): str(value) for key, value in port["requiredHeaders"].items()}
    if headers.get("content-length") != str(size):
        raise ValueError("Personal worker upload length header drifted")
    connection = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=180)
    try:
        target = urllib.parse.urlunsplit(("", "", parsed.path, parsed.query, ""))
        connection.request("PUT", target, body=source, headers=headers, encode_chunked=False)
        response = connection.getresponse()
        response.read(4096)
        if response.status < 200 or response.status >= 300:
            raise ValueError("Personal worker artifact upload failed")
    finally:
        connection.close()


class _CancellationMonitor:
    def __init__(
        self,
        url: str,
        device_token: str,
        lease_token: str,
        marker: Path,
        process: subprocess.Popen[bytes],
    ) -> None:
        self._url = url
        self._headers = {
            "authorization": f"Bearer {device_token}",
            "x-videoforge-lease-token": lease_token,
        }
        self._marker = marker
        self._process = process
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def close(self) -> None:
        self._stop.set()
        self._thread.join(timeout=5)

    def _terminate(self) -> None:
        self._marker.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._marker.write_bytes(b"cancelled")
        _terminate_process(self._process)

    def _run(self) -> None:
        while not self._stop.wait(10):
            try:
                status, value = _request_json(self._url, "POST", self._headers, {})
                if status == 409 or (
                    status == 200
                    and isinstance(value, dict)
                    and value.get("cancel_requested") is True
                ):
                    self._terminate()
                    return
            except (OSError, ValueError, json.JSONDecodeError):
                continue


def _terminate_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
    except (OSError, ProcessLookupError):
        return


class _SleepAssertion:
    def __init__(self) -> None:
        self._process: subprocess.Popen[bytes] | None = None

    def __enter__(self) -> "_SleepAssertion":
        if sys.platform == "darwin":
            self._process = subprocess.Popen(
                ["/usr/bin/caffeinate", "-dimsu"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        elif os.name == "nt":
            import ctypes

            ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)
        return self

    def __exit__(self, *_: object) -> None:
        if self._process is not None:
            self._process.terminate()
            self._process.wait(timeout=5)
        elif os.name == "nt":
            import ctypes

            ctypes.windll.kernel32.SetThreadExecutionState(0x80000000)


def _primary_path(scratch: Path, result: object) -> Path:
    if not isinstance(result, dict) or not isinstance(result.get("output"), dict):
        raise ValueError("Personal worker result is malformed")
    output = result["output"]
    if not isinstance(output.get("artifact_uri"), str):
        raise ValueError("Personal worker primary output is missing")
    path = _local_path(scratch, output["artifact_uri"])
    if path.is_symlink() or not path.is_file():
        raise ValueError("Personal worker primary output is not a regular file")
    checksum, size = _sha256_file(path)
    if output.get("bytes") != size or output.get("sha256") != checksum:
        raise ValueError("Personal worker primary output facts do not match bytes")
    return path


def execute_personal_job(
    job: PersonalJob,
    device_token: str,
    lease_token: str,
    tools: ToolPaths,
) -> str:
    if datetime.now(timezone.utc) >= job.expires_at:
        raise ValueError("Personal worker job expired before execution")
    scratch = Path(tempfile.mkdtemp(prefix=f"videoforge-{job.attempt_id}-"))
    status = "FAILED"
    failure_code: str | None = "MEDIA_EXECUTION_FAILED"
    result_facts: dict[str, object] = {
        "result_object_key": None,
        "result_content_length": None,
        "result_checksum_sha256": None,
    }
    try:
        for item in job.objects:
            _download(item, _local_path(scratch, item["uri"]))
        input_path = scratch / "job-input.json"
        input_path.write_bytes(_canonical(job.input_document))
        cancellation_token = str(job.input_document.get("cancel_token", job.attempt_id))
        command = [sys.executable]
        if getattr(sys, "frozen", False):
            command.append("--execute-media")
        else:
            command.extend(["-m", "videoforge_media_local.cli"])
        command.extend(
            [
                "transcribe" if job.kind == "ASR" else "render",
                "--artifact-root",
                str(scratch),
                "--input",
                str(input_path),
            ]
        )
        if job.kind == "ASR":
            model_sha256, _ = _sha256_file(tools.whisper_model)
            expected_model_sha256 = str(job.input_document.get("model", {}).get("sha256", ""))
            if model_sha256 != expected_model_sha256:
                raise ValueError("Bundled whisper model does not match the job contract")
            command.extend(
                [
                    "--whisper",
                    str(tools.whisper),
                    "--model",
                    str(tools.whisper_model),
                    "--whisper-version",
                    job.tooling["whisper_version"],
                    "--ffmpeg",
                    str(tools.ffmpeg),
                    "--ffprobe",
                    str(tools.ffprobe),
                ]
            )
        else:
            command.extend(
                [
                    "--claimed-attempt-id",
                    job.attempt_id,
                    "--ffmpeg",
                    str(tools.ffmpeg),
                    "--ffprobe",
                    str(tools.ffprobe),
                    "--ffmpeg-version",
                    job.tooling["ffmpeg_version"],
                    "--ffprobe-version",
                    job.tooling["ffprobe_version"],
                ]
            )
        creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        with _SleepAssertion():
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                start_new_session=os.name != "nt",
                creationflags=creation_flags,
            )
            monitor = _CancellationMonitor(
                job.cancellation_url,
                device_token,
                lease_token,
                cancellation_marker(scratch, cancellation_token),
                process,
            )
            monitor.start()
            try:
                stdout, _stderr = process.communicate(timeout=86_400)
            except subprocess.TimeoutExpired:
                _terminate_process(process)
                stdout, _stderr = process.communicate()
                raise
            finally:
                monitor.close()
        if process.returncode != 0:
            if cancellation_marker(scratch, cancellation_token).exists():
                status = "CANCELLED"
                failure_code = None
        else:
            result = json.loads(stdout)
            primary = _primary_path(scratch, result)
            for output in job.outputs:
                checksum, size = _sha256_file(primary)
                if size > output["max_bytes"]:
                    raise ValueError("Personal worker primary output exceeded its bound")
                port = _upload_port(
                    output["sign_url"],
                    device_token,
                    lease_token,
                    output["source"],
                    output["object_key"],
                    output["content_type"],
                    checksum,
                    size,
                )
                with primary.open("rb") as source:
                    _stream_put(port, source, size)
            result_bytes = _canonical(result)
            result_checksum = f"sha256:{hashlib.sha256(result_bytes).hexdigest()}"
            port = _upload_port(
                job.result["sign_url"],
                device_token,
                lease_token,
                "RESULT_DOCUMENT",
                job.result["object_key"],
                "application/json",
                result_checksum,
                len(result_bytes),
            )
            with tempfile.SpooledTemporaryFile(max_size=1024 * 1024) as source:
                source.write(result_bytes)
                source.seek(0)
                _stream_put(port, source, len(result_bytes))
            status = "SUCCEEDED"
            failure_code = None
            result_facts = {
                "result_object_key": job.result["object_key"],
                "result_content_length": len(result_bytes),
                "result_checksum_sha256": result_checksum,
            }
    except subprocess.TimeoutExpired:
        status = "FAILED"
        failure_code = "MEDIA_EXECUTION_TIMEOUT"
    finally:
        completion = {
            "schema_version": "videoforge-personal-worker-completion/v1",
            "status": status,
            "failure_code": failure_code,
            **result_facts,
        }
        try:
            acknowledged = False
            completion_deadline = min(
                time.monotonic() + 240,
                time.monotonic()
                + max(0, (job.expires_at - datetime.now(timezone.utc)).total_seconds()),
            )
            attempt = 0
            while time.monotonic() < completion_deadline:
                try:
                    response_status, _response = _request_json(
                        job.completion_url,
                        "POST",
                        {
                            "authorization": f"Bearer {device_token}",
                            "x-videoforge-lease-token": lease_token,
                        },
                        completion,
                    )
                    if response_status in {200, 409}:
                        acknowledged = True
                        break
                except (OSError, ValueError, json.JSONDecodeError):
                    pass
                threading.Event().wait(min(2**attempt, 30))
                attempt += 1
            if not acknowledged:
                raise OSError("Personal worker completion could not be durably acknowledged")
        finally:
            shutil.rmtree(scratch, ignore_errors=True)
    return status

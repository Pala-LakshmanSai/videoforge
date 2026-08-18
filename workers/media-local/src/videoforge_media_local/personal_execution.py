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
from typing import Any, BinaryIO, Callable

from videoforge_image_media.local_cli import cancellation_marker

from .cloud_job import _local_path
from .personal_tls import https_context

_SHA256 = __import__("re").compile(r"^sha256:[0-9a-f]{64}$")
_UUID = __import__("re").compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
_R2_KEY = __import__("re").compile(
    r"^tenant/[A-Za-z0-9._:-]+/workspace/[A-Za-z0-9._:-]+/project/"
    r"[A-Za-z0-9._:-]+/revision/[A-Za-z0-9._:-]+/lane/(?:input|render)/job/"
    r"[A-Za-z0-9._:-]+/artifact/[A-Za-z0-9._:-]+$"
)
_FAILURE_CODE = __import__("re").compile(r"^[A-Z][A-Z0-9_]{2,63}$")


class _PersonalJobCancelled(Exception):
    """The control plane fenced this attempt while the local process was active."""


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
    if not isinstance(attempt_id, str) or not _UUID.fullmatch(attempt_id):
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
            or type(item["bytes"]) is not int
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
            or type(item["max_bytes"]) is not int
            or not 0 < item["max_bytes"] <= 10 * 1024**3
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
        or type(result["max_bytes"]) is not int
        or not 0 < result["max_bytes"] <= 1024 * 1024
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
    timeout: float = 30,
) -> tuple[int, object | None]:
    request = urllib.request.Request(
        url,
        data=None if body is None else _canonical(body),
        method=method,
        headers={**headers, **({"content-type": "application/json"} if body is not None else {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=https_context()) as response:
            data = response.read(maximum + 1)
            if len(data) > maximum:
                raise ValueError("Personal worker response exceeded its bound")
            return response.status, json.loads(data) if data else None
    except urllib.error.HTTPError as error:
        data = error.read(maximum + 1)
        return error.code, json.loads(data) if data else None


def _download(
    item: dict[str, Any], destination: Path, should_cancel: Callable[[], bool] | None = None
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    digest = hashlib.sha256()
    size = 0
    if should_cancel is not None and should_cancel():
        raise _PersonalJobCancelled
    with (
        urllib.request.urlopen(item["url"], timeout=60, context=https_context()) as response,
        destination.open("xb") as out,
    ):
        while chunk := response.read(1024 * 1024):
            if should_cancel is not None and should_cancel():
                raise _PersonalJobCancelled
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
    connection = http.client.HTTPSConnection(
        parsed.hostname,
        parsed.port or 443,
        timeout=180,
        context=https_context(),
    )
    try:
        target = urllib.parse.urlunsplit(("", "", parsed.path, parsed.query, ""))
        connection.request("PUT", target, body=source, headers=headers, encode_chunked=False)
        response = connection.getresponse()
        response.read(4096)
        if response.status < 200 or response.status >= 300:
            raise ValueError("Personal worker artifact upload failed")
    finally:
        connection.close()


def _completion_acknowledged_state(status: int, value: object) -> str | None:
    if (
        status != 200
        or not isinstance(value, dict)
        or set(value) != {"schema_version", "state"}
        or value.get("schema_version") != "videoforge-personal-worker-completion-accepted/v1"
        or value.get("state") not in {"SUCCEEDED", "FAILED", "CANCELLED"}
    ):
        return None
    return str(value["state"])


def _completion_is_acknowledged(status: int, value: object) -> bool:
    return _completion_acknowledged_state(status, value) is not None


class _CancellationMonitor:
    def __init__(
        self,
        url: str,
        device_token: str,
        lease_token: str,
        marker: Path,
        process: subprocess.Popen[bytes] | None,
    ) -> None:
        self._url = url
        self._headers = {
            "authorization": f"Bearer {device_token}",
            "x-videoforge-lease-token": lease_token,
        }
        self._marker = marker
        self._process = process
        self._process_lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def close(self) -> None:
        self._stop.set()
        self._thread.join(timeout=5)

    def attach(self, process: subprocess.Popen[bytes]) -> None:
        with self._process_lock:
            self._process = process

    def is_cancelled(self) -> bool:
        return self._marker.is_file()

    def _terminate(self) -> None:
        self._marker.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._marker.write_bytes(b"cancelled")
        with self._process_lock:
            process = self._process
        if process is not None:
            _terminate_process(process)

    def _run(self) -> None:
        while not self._stop.wait(10):
            try:
                status, value = _request_json(self._url, "POST", self._headers, {}, timeout=5)
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


def _asr_primary_path(scratch: Path, input_document: dict[str, Any]) -> Path:
    output = input_document.get("output")
    if (
        not isinstance(output, dict)
        or not isinstance(output.get("result_uri"), str)
        or not output["result_uri"].startswith("vf-local-run://")
    ):
        raise ValueError("Personal worker ASR result output is missing")
    path = _local_path(scratch, output["result_uri"])
    if path.is_symlink() or not path.is_file():
        raise ValueError("Personal worker ASR result output is not a regular file")
    return path


def _job_result_state(job: PersonalJob, result: object) -> tuple[str, str | None]:
    if not isinstance(result, dict):
        raise ValueError("Personal worker result is malformed")
    expected_schema = "asr-job-result/v1" if job.kind == "ASR" else "render-job-result/v1"
    if (
        result.get("schema_version") != expected_schema
        or result.get("attempt_id") != job.attempt_id
    ):
        raise ValueError("Personal worker result lineage is invalid")
    state = result.get("status")
    if state == "SUCCEEDED":
        return "SUCCEEDED", None
    if state == "CANCELLED":
        return "CANCELLED", None
    if state != "FAILED":
        raise ValueError("Personal worker result status is invalid")
    error = result.get("error")
    code = error.get("code") if isinstance(error, dict) else None
    return "FAILED", str(code) if isinstance(code, str) and _FAILURE_CODE.fullmatch(code) else None


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
    cancellation_token = str(job.input_document.get("cancel_token", job.attempt_id))
    cancellation_marker_path = cancellation_marker(scratch, cancellation_token)
    monitor = _CancellationMonitor(
        job.cancellation_url,
        device_token,
        lease_token,
        cancellation_marker_path,
        None,
    )
    monitor.start()
    try:
        for item in job.objects:
            _download(item, _local_path(scratch, item["uri"]), monitor.is_cancelled)
        input_path = scratch / "job-input.json"
        input_path.write_bytes(_canonical(job.input_document))
        if monitor.is_cancelled():
            raise _PersonalJobCancelled
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
            monitor.attach(process)
            try:
                stdout, _stderr = process.communicate(timeout=86_400)
            except subprocess.TimeoutExpired:
                _terminate_process(process)
                stdout, _stderr = process.communicate()
                raise
        if monitor.is_cancelled():
            status = "CANCELLED"
            failure_code = None
        elif process.returncode != 0:
            pass
        else:
            if len(stdout) > int(job.result["max_bytes"]):
                raise ValueError("Personal worker result document exceeded its bound")
            result = json.loads(stdout)
            result_status, result_failure_code = _job_result_state(job, result)
            if result_status == "CANCELLED":
                raise _PersonalJobCancelled
            if result_status == "FAILED":
                status = "FAILED"
                failure_code = result_failure_code or "MEDIA_EXECUTION_FAILED"
            else:
                primary = (
                    _asr_primary_path(scratch, job.input_document)
                    if job.kind == "ASR"
                    else _primary_path(scratch, result)
                )
                for output in job.outputs:
                    if monitor.is_cancelled():
                        raise _PersonalJobCancelled
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
                    if monitor.is_cancelled():
                        raise _PersonalJobCancelled
                result_bytes = _canonical(result)
                if len(result_bytes) > int(job.result["max_bytes"]):
                    raise ValueError("Personal worker result document exceeded its bound")
                result_checksum = f"sha256:{hashlib.sha256(result_bytes).hexdigest()}"
                if monitor.is_cancelled():
                    raise _PersonalJobCancelled
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
                if monitor.is_cancelled():
                    raise _PersonalJobCancelled
                status = "SUCCEEDED"
                failure_code = None
                result_facts = {
                    "result_object_key": job.result["object_key"],
                    "result_content_length": len(result_bytes),
                    "result_checksum_sha256": result_checksum,
                }
    except _PersonalJobCancelled:
        status = "CANCELLED"
        failure_code = None
        result_facts = {
            "result_object_key": None,
            "result_content_length": None,
            "result_checksum_sha256": None,
        }
    except subprocess.TimeoutExpired:
        status = "FAILED"
        failure_code = "MEDIA_EXECUTION_TIMEOUT"
    finally:
        monitor.close()
        completion = {
            "schema_version": "videoforge-personal-worker-completion/v1",
            "status": status,
            "failure_code": failure_code,
            **result_facts,
        }
        try:
            acknowledged_state: str | None = None
            completion_deadline = min(
                time.monotonic() + 240,
                time.monotonic()
                + max(0, (job.expires_at - datetime.now(timezone.utc)).total_seconds()),
            )
            attempt = 0
            while time.monotonic() < completion_deadline:
                try:
                    response_status, response = _request_json(
                        job.completion_url,
                        "POST",
                        {
                            "authorization": f"Bearer {device_token}",
                            "x-videoforge-lease-token": lease_token,
                        },
                        completion,
                    )
                    acknowledged_state = _completion_acknowledged_state(response_status, response)
                    if acknowledged_state is not None:
                        break
                except (OSError, ValueError, json.JSONDecodeError):
                    pass
                threading.Event().wait(min(2**attempt, 30))
                attempt += 1
            if acknowledged_state is None:
                raise OSError("Personal worker completion could not be durably acknowledged")
            status = acknowledged_state
        finally:
            shutil.rmtree(scratch, ignore_errors=True)
    return status

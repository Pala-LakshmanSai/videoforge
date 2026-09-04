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
_ASR_FAILURE_CODES = frozenset(
    {
        "ASR_INPUT_INVALID",
        "ASR_SOURCE_HASH_MISMATCH",
        "ASR_SOURCE_DECODE_FAILED",
        "ASR_TOOL_MISSING",
        "ASR_MODEL_MISSING",
        "ASR_MODEL_HASH_MISMATCH",
        "ASR_PROCESS_FAILED",
        "ASR_OUTPUT_INVALID",
        "ASR_CANCELLED",
    }
)
_RENDER_FAILURE_CODES = frozenset(
    {
        "RENDER_INPUT_INVALID",
        "RENDER_MANIFEST_HASH_MISMATCH",
        "RENDER_ASSET_MISSING",
        "RENDER_ASSET_HASH_MISMATCH",
        "RENDER_PATH_REJECTED",
        "RENDER_TOOL_MISSING",
        "RENDER_PROCESS_FAILED",
        "RENDER_PROBE_FAILED",
        "RENDER_OUTPUT_INVALID",
        "RENDER_CANCELLED",
    }
)
_MEDIA_EXECUTION_IO_FAILED = "MEDIA_EXECUTION_IO_FAILED"
_MEDIA_EXECUTION_CONTRACT_INVALID = "MEDIA_EXECUTION_CONTRACT_INVALID"
_MEDIA_EXECUTION_LEASE_STALE = "MEDIA_EXECUTION_LEASE_STALE"
_OWNER_CANCEL_REQUESTED = "OWNER_CANCEL_REQUESTED"
_LEASE_STALE_FENCE = "LEASE_STALE_FENCE"

# A media job needs its downloaded inputs and a second working copy while the
# bundled tools run. Keep a fixed amount of free space for runtime extraction,
# ffmpeg/whisper scratch files, and bounded result/upload buffers. This is a
# local safety gate only; the values are intentionally not exposed in worker
# completions or diagnostics.
_MEDIA_INPUT_WORKING_SET_MULTIPLIER = 2
_MEDIA_RUNTIME_HEADROOM_BYTES = 2 * 1024**3


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


def _is_valid_https_url(value: object) -> bool:
    if (
        not isinstance(value, str)
        or not value
        or any(character.isspace() or ord(character) < 0x20 for character in value)
    ):
        return False
    try:
        parsed = urllib.parse.urlsplit(value)
        port = parsed.port
    except ValueError:
        return False
    return (
        parsed.scheme == "https"
        and parsed.hostname is not None
        and parsed.username is None
        and parsed.password is None
        and parsed.fragment == ""
        and (port is None or 1 <= port <= 65535)
    )


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
            or not _is_valid_https_url(item["url"])
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
            or not _is_valid_https_url(item["sign_url"])
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
        or not _is_valid_https_url(result["sign_url"])
        or type(result["max_bytes"]) is not int
        or not 0 < result["max_bytes"] <= 1024 * 1024
    ):
        raise ValueError("Personal worker result authority is invalid")
    for key in ("cancellation_url", "completion_url"):
        if not _is_valid_https_url(value[key]):
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
    if not _is_valid_https_url(url):
        raise ValueError("Personal worker request URL is not a valid HTTPS URL")
    request = urllib.request.Request(
        url,
        data=None if body is None else _canonical(body),
        method=method,
        headers={
            "user-agent": "VideoForge-Worker",
            **headers,
            **({"content-type": "application/json"} if body is not None else {}),
        },
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
    if not _is_valid_https_url(item.get("url")):
        raise ValueError("Personal worker download URL is not a valid HTTPS URL")
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


def _required_free_bytes(objects: tuple[dict[str, Any], ...]) -> int:
    """Return the deterministic local free-space requirement for one job."""

    input_bytes = 0
    for item in objects:
        size = item.get("bytes")
        if type(size) is not int or size <= 0:
            raise ValueError("Personal worker input size is invalid")
        input_bytes += size
    return input_bytes * _MEDIA_INPUT_WORKING_SET_MULTIPLIER + _MEDIA_RUNTIME_HEADROOM_BYTES


def _preflight_disk_space(objects: tuple[dict[str, Any], ...], directory: Path) -> None:
    """Fail closed when the local filesystem cannot safely host the job."""

    required = _required_free_bytes(objects)
    try:
        available = shutil.disk_usage(directory).free
    except (OSError, TypeError, ValueError) as error:
        raise OSError("Personal worker local storage capacity is unknown") from error
    if type(available) is not int or available < required:
        raise OSError("Personal worker local storage capacity is insufficient")


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
    if not _is_valid_https_url(port.get("url")):
        raise ValueError("Personal worker upload URL is not HTTPS")
    parsed = urllib.parse.urlsplit(str(port["url"]))
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
        self._stop_reason: str | None = None
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

    def stop_reason(self) -> str | None:
        with self._process_lock:
            return self._stop_reason

    def _terminate(self, reason: str) -> None:
        with self._process_lock:
            if self._stop_reason is not None:
                return
            self._stop_reason = reason
            process = self._process
        self._marker.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._marker.write_bytes(b"cancelled")
        if process is not None:
            _terminate_process(process)

    def _run(self) -> None:
        while not self._stop.wait(10):
            try:
                status, value = _request_json(self._url, "POST", self._headers, {}, timeout=5)
                reason = _heartbeat_stop_reason(status, value)
                if reason is not None:
                    self._terminate(reason)
                    return
            except (OSError, ValueError, json.JSONDecodeError):
                continue


def _heartbeat_stop_reason(status: int, value: object) -> str | None:
    if status == 409:
        return _LEASE_STALE_FENCE
    if (
        status != 200
        or not isinstance(value, dict)
        or set(value) != {"schema_version", "cancel_requested", "lease_expires_in_seconds"}
        or value.get("schema_version") != "videoforge-personal-worker-lease-heartbeat/v1"
        or type(value.get("cancel_requested")) is not bool
        or type(value.get("lease_expires_in_seconds")) is not int
        or not 1 <= value["lease_expires_in_seconds"] <= 3600
    ):
        return None
    return _OWNER_CANCEL_REQUESTED if value["cancel_requested"] else None


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


def _run_media_subprocess(
    command: list[str],
    monitor: _CancellationMonitor,
    *,
    retry_once: bool,
    before_retry: Callable[[], None],
) -> tuple[int, bytes]:
    """Run one claimed job, replacing only an abnormal local child-process exit once."""

    attempts = 2 if retry_once else 1
    final_return_code = -1
    final_stdout = b""
    for ordinal in range(attempts):
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=os.name != "nt",
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
        monitor.attach(process)
        try:
            stdout, _stderr = process.communicate(timeout=86_400)
        except subprocess.TimeoutExpired:
            _terminate_process(process)
            process.communicate()
            raise
        final_return_code = int(process.returncode or 0)
        final_stdout = stdout
        if monitor.is_cancelled() or final_return_code == 0 or ordinal + 1 >= attempts:
            break
        before_retry()
    return final_return_code, final_stdout


def _clear_asr_retry_state(scratch: Path, input_document: dict[str, Any]) -> None:
    output = input_document.get("output")
    result_uri = output.get("result_uri") if isinstance(output, dict) else None
    if not isinstance(result_uri, str) or not result_uri.startswith("vf-local-run://"):
        raise ValueError("Personal worker ASR retry output is invalid")
    result_path = _local_path(scratch, result_uri)
    result_path.unlink(missing_ok=True)
    result_path.with_name("asr-work-receipt.json").unlink(missing_ok=True)
    shutil.rmtree(result_path.with_name("asr-work"), ignore_errors=True)


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

            if ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001) == 0:
                raise OSError("Windows could not prevent system sleep during media execution")
        return self

    def __exit__(self, *_: object) -> None:
        if self._process is not None:
            self._process.terminate()
            self._process.wait(timeout=5)
        elif os.name == "nt":
            import ctypes

            if ctypes.windll.kernel32.SetThreadExecutionState(0x80000000) == 0:
                raise OSError("Windows could not release its media execution sleep assertion")


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


def _child_result_failure_code(kind: str) -> str:
    """Return a bounded code for a child that did not return a usable result."""

    return "ASR_RESULT_INVALID" if kind == "ASR" else "RENDER_RESULT_INVALID"


def _reject_json_constant(value: str) -> object:
    raise ValueError(f"non-finite JSON constant {value}")


def _reject_duplicate_json_properties(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON property")
        result[key] = value
    return result


def _parse_child_result(
    job: PersonalJob, stdout: bytes, maximum: int
) -> tuple[dict[str, Any] | None, str, str | None]:
    """Decode the child result without allowing child diagnostics across the worker boundary."""

    invalid_code = _child_result_failure_code(job.kind)
    try:
        if len(stdout) > maximum:
            raise ValueError("child result exceeded its bound")
        result = json.loads(
            stdout,
            object_pairs_hook=_reject_duplicate_json_properties,
            parse_constant=_reject_json_constant,
        )
        result_status, result_failure_code = _job_result_state(job, result)
    except (TypeError, UnicodeError, ValueError, RecursionError):
        return None, "FAILED", invalid_code
    if result_status == "FAILED" and result_failure_code is None:
        return result, "FAILED", invalid_code
    return result, result_status, result_failure_code


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
    valid_codes = _ASR_FAILURE_CODES if job.kind == "ASR" else _RENDER_FAILURE_CODES
    return "FAILED", str(code) if isinstance(code, str) and code in valid_codes else None


def _stopped_completion(monitor: _CancellationMonitor) -> tuple[str, str | None]:
    if monitor.stop_reason() == _LEASE_STALE_FENCE:
        return "FAILED", _MEDIA_EXECUTION_LEASE_STALE
    return "CANCELLED", None


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
        _preflight_disk_space(job.objects, scratch)
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
        with _SleepAssertion():
            return_code, stdout = _run_media_subprocess(
                command,
                monitor,
                retry_once=job.kind == "ASR",
                before_retry=lambda: _clear_asr_retry_state(scratch, job.input_document),
            )
        if monitor.is_cancelled():
            status, failure_code = _stopped_completion(monitor)
        elif return_code != 0:
            failure_code = "MEDIA_EXECUTION_SUBPROCESS_FAILED"
        else:
            result, result_status, result_failure_code = _parse_child_result(
                job, stdout, int(job.result["max_bytes"])
            )
            if result_status == "CANCELLED":
                raise _PersonalJobCancelled
            if result_status == "FAILED":
                status = "FAILED"
                failure_code = result_failure_code or _child_result_failure_code(job.kind)
            elif result is None:
                status = "FAILED"
                failure_code = _child_result_failure_code(job.kind)
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
        status, failure_code = _stopped_completion(monitor)
        result_facts = {
            "result_object_key": None,
            "result_content_length": None,
            "result_checksum_sha256": None,
        }
    except subprocess.TimeoutExpired:
        status = "FAILED"
        failure_code = "MEDIA_EXECUTION_TIMEOUT"
    except OSError:
        status = "FAILED"
        failure_code = _MEDIA_EXECUTION_IO_FAILED
    except (KeyError, TypeError, ValueError, RecursionError):
        status = "FAILED"
        failure_code = _MEDIA_EXECUTION_CONTRACT_INVALID
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

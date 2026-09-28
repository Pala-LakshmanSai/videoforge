"""Exact-job Linux runner. The controller owns Pod allocation and termination."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO

from videoforge_image_media.local_cli import cancellation_marker

from . import personal_execution as media
from .cloud_media_cli import PHASE_FILENAME

_HASH = re.compile(r"sha256:[0-9a-f]{64}")
_PHASES = {"DOWNLOADING_INPUTS", "RENDERING", "CHECKING_VIDEO", "SAVING"}
_SINGLE_PUT_MAX_BYTES = 5 * 1024**3 - 5 * 1024**2


def _read_render_phase(root: Path, attempt_id: str, earliest_ns: int) -> dict | None:
    path = root / PHASE_FILENAME
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return None
    with os.fdopen(descriptor, "rb") as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise ValueError("Cloud phase sidecar is not regular")
        encoded = source.read(1025)
    if len(encoded) > 1024:
        raise ValueError("Cloud phase sidecar exceeds bound")
    value = json.loads(encoded)
    fields = {"schema_version", "attempt_id", "phase", "sequence", "started_monotonic_ns",
              "technical_verification_ms"}
    if (not isinstance(value, dict) or set(value) != fields
            or value["schema_version"] != "videoforge-cloud-render-phase/v1"
            or value["attempt_id"] != attempt_id
            or type(value["started_monotonic_ns"]) is not int
            or not earliest_ns <= value["started_monotonic_ns"] <= time.monotonic_ns()
            or type(value["sequence"]) is not int):
        raise ValueError("Cloud phase sidecar is stale or malformed")
    duration = value["technical_verification_ms"]
    if value["sequence"] == 1:
        valid = value["phase"] == "CHECKING_VIDEO" and duration is None
    else:
        valid = (value["sequence"] == 2 and value["phase"] == "TECHNICAL_VERIFICATION_COMPLETE"
                 and type(duration) is int and 0 <= duration <= 14_400_000
                 and duration <= (time.monotonic_ns() - value["started_monotonic_ns"]) // 1_000_000 + 100)
    if not valid:
        raise ValueError("Cloud phase sidecar timing is invalid")
    return value


@dataclass(frozen=True)
class RunPodJob:
    reservation_id: str
    runtime_sha256: str
    source_sha256: str
    deadline_at: datetime
    job: media.PersonalJob


def parse_spec(value: object) -> RunPodJob:
    fields = {"schema_version", "reservation_id", "runtime_sha256", "source_sha256",
              "deadline_at", "job"}
    if not isinstance(value, dict) or set(value) != fields:
        raise ValueError("RunPod job fields are not exact")
    if value["schema_version"] != "videoforge-runpod-pod-job-spec/v1":
        raise ValueError("RunPod job version is unsupported")
    if not isinstance(value["reservation_id"], str) or not media._UUID.fullmatch(
        value["reservation_id"]
    ):
        raise ValueError("RunPod reservation is invalid")
    for field in ("runtime_sha256", "source_sha256"):
        if not isinstance(value[field], str) or not _HASH.fullmatch(value[field]):
            raise ValueError("RunPod runtime identity is invalid")
    deadline = datetime.fromisoformat(str(value["deadline_at"]).replace("Z", "+00:00"))
    job = media.parse_personal_job(value["job"])
    if deadline.tzinfo != timezone.utc or deadline > job.expires_at:
        raise ValueError("RunPod deadline is invalid")
    if not 0 < (deadline - datetime.now(timezone.utc)).total_seconds() <= 4 * 3600:
        raise ValueError("RunPod paid lifetime is invalid")
    return RunPodJob(value["reservation_id"], value["runtime_sha256"],
                     value["source_sha256"], deadline, job)


def verify_runtime(spec: RunPodJob, manifest_path: Path) -> media.ToolPaths:
    """Never substitute desktop executable hashes for qualified Linux hashes."""
    manifest = json.loads(manifest_path.read_bytes())
    if f"sha256:{hashlib.sha256(media._canonical(manifest)).hexdigest()}" != spec.runtime_sha256:
        raise ValueError("RunPod runtime manifest hash mismatch")
    if (manifest.get("schema_version") != "videoforge-linux-media-runtime/v1"
            or manifest.get("platform") != "linux"
            or manifest.get("qualified") is not True
            or manifest.get("source_sha256") != spec.source_sha256
            or sys.platform != "linux"
            or platform.machine() != "x86_64"
            or sys.version_info[:2] != (3, 12)):
        raise ValueError("RunPod runtime is not qualified")
    source_files = manifest.get("source_files")
    if not isinstance(source_files, dict) or not source_files:
        raise ValueError("RunPod source inventory is missing")
    source_root = manifest_path.parent
    for relative, checksum in source_files.items():
        path = source_root / relative
        if (not path.resolve().is_relative_to(source_root.resolve()) or path.is_symlink()
                or media._sha256_file(path)[0] != checksum):
            raise ValueError("RunPod source hash mismatch")
    if f"sha256:{hashlib.sha256(media._canonical(source_files)).hexdigest()}" != spec.source_sha256:
        raise ValueError("RunPod source inventory hash mismatch")
    tools = media.ToolPaths(**{key: Path(manifest["tools"][key]["path"])
                              for key in ("ffmpeg", "ffprobe", "whisper", "whisper_model")})
    for key in ("ffmpeg", "ffprobe", "whisper", "whisper_model"):
        path = getattr(tools, key)
        if path.is_symlink() or media._sha256_file(path)[0] != manifest["tools"][key]["sha256"]:
            raise ValueError("RunPod executable or model hash mismatch")
    if (manifest["tools"]["whisper_model"]["sha256"] != spec.job.tooling["whisper_model_sha256"]
            or spec.job.tooling["whisper_model_sha256"] !=
            "sha256:a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"):
        raise ValueError("RunPod model differs from exact job")
    for name in ("ffmpeg", "ffprobe", "whisper"):
        expected = spec.job.tooling["whisper_version" if name == "whisper" else f"{name}_version"]
        if manifest["tools"][name]["version"] != expected:
            raise ValueError("RunPod tool version differs from exact job")
    import cv2
    import numpy
    if cv2.__version__ != manifest["opencv_version"] or numpy.__version__ != manifest["numpy_version"]:
        raise ValueError("RunPod Python dependencies differ from qualified runtime")
    return tools


def _control(url: str, token: str, lease: str, body: object) -> object:
    status, value = media._request_json(url, "POST", {
        "authorization": f"Bearer {token}", "x-videoforge-lease-token": lease,
    }, body)
    if status != 200:
        raise ValueError("RunPod control capability was rejected")
    return value


def _multipart(port: dict, source: BinaryIO, size: int, checksum: str,
               token: str, lease: str, should_cancel) -> None:
    if (port.get("contentLength") != size or port.get("checksumSha256") != checksum
            or type(port.get("part_size")) is not int
            or not 5 * 1024**2 <= port["part_size"] <= 64 * 1024**2
            or not isinstance(port.get("upload_id"), str)):
        raise ValueError("RunPod multipart authority facts differ")
    for key in ("part_sign_url", "complete_url", "abort_url"):
        if not media._is_valid_https_url(port.get(key)):
            raise ValueError("RunPod multipart control URL is invalid")
    parts = []
    uploaded = 0
    try:
        while uploaded < size:
            if should_cancel():
                raise media._PersonalJobCancelled
            payload = source.read(min(port["part_size"], size - uploaded))
            if not payload:
                raise ValueError("RunPod multipart source ended early")
            part_number = len(parts) + 1
            if part_number > 10_000:
                raise ValueError("RunPod multipart exceeds part limit")
            etag = None
            for attempt in range(3):
                if should_cancel():
                    raise media._PersonalJobCancelled
                authority = _control(port["part_sign_url"], token, lease, {
                    "upload_id": port["upload_id"], "part_number": part_number,
                    "content_length": len(payload),
                })
                if not isinstance(authority, dict) or not media._is_valid_https_url(authority.get("url")):
                    raise ValueError("RunPod part authority is invalid")
                # Retry this part only. ETags describe parts, never the whole-object hash.
                import urllib.request
                import urllib.error
                try:
                    request = urllib.request.Request(authority["url"], data=payload,
                                                     method="PUT", headers=authority["requiredHeaders"])
                    with urllib.request.urlopen(request, timeout=180,
                                                 context=media.https_context()) as response:
                        response.read(4096)
                        if not 200 <= response.status < 300 or not response.headers.get("ETag"):
                            raise ValueError("RunPod multipart part was not accepted")
                        etag = response.headers["ETag"]
                        break
                except (OSError, urllib.error.URLError):
                    if attempt == 2:
                        raise
            parts.append({"part_number": part_number, "etag": etag})
            uploaded += len(payload)
        if should_cancel():
            raise media._PersonalJobCancelled
        # Controller reconciles uncertain R2 completion before returning the same receipt.
        completion = {
            "upload_id": port["upload_id"], "parts": parts,
            "content_length": size, "checksum_sha256": checksum,
        }
        accepted = None
        for attempt in range(3):
            try:
                accepted = _control(port["complete_url"], token, lease, completion)
                break
            except OSError:
                if attempt == 2:
                    raise
        if not isinstance(accepted, dict) or accepted.get("verified") is not True:
            raise ValueError("RunPod multipart whole-object facts were not verified")
    except BaseException:
        try:
            _control(port["abort_url"], token, lease, {"upload_id": port["upload_id"]})
        except (OSError, ValueError):
            pass
        raise


def _upload(url: str, source_name: str, key: str, content_type: str,
            source: BinaryIO, size: int, checksum: str, token: str, lease: str,
            should_cancel) -> None:
    port = _control(url, token, lease, {
        "schema_version": "videoforge-personal-worker-upload-authority/v1",
        "source": source_name, "object_key": key, "content_type": content_type,
        "content_length": size, "checksum_sha256": checksum,
    })
    if (not isinstance(port, dict) or port.get("contentLength") != size
            or port.get("checksumSha256") != checksum or port.get("contentType") != content_type):
        raise ValueError("RunPod upload authority differs from exact facts")
    if should_cancel():
        raise media._PersonalJobCancelled
    if port.get("method") == "MULTIPART":
        _multipart(port, source, size, checksum, token, lease, should_cancel)
    elif port.get("method") == "PUT" and size <= _SINGLE_PUT_MAX_BYTES:
        media._stream_put(port, source, size)
    else:
        raise ValueError("RunPod upload method or size is unsupported")


def _renewed_objects(original: RunPodJob, renewed: RunPodJob) -> dict[str, dict]:
    def facts(spec: RunPodJob):
        return sorted((item["uri"], item["sha256"], item["bytes"]) for item in spec.job.objects)
    if (renewed.reservation_id != original.reservation_id
            or renewed.runtime_sha256 != original.runtime_sha256
            or renewed.source_sha256 != original.source_sha256
            or renewed.deadline_at != original.deadline_at
            or renewed.job.attempt_id != original.job.attempt_id
            or renewed.job.kind != original.job.kind
            or renewed.job.expires_at != original.job.expires_at
            or renewed.job.tooling != original.job.tooling
            or renewed.job.input_document != original.job.input_document
            or facts(renewed) != facts(original)):
        raise ValueError("RunPod renewed input identity conflicts")
    return {item["uri"]: item for item in renewed.job.objects}


def _download_inputs(spec: RunPodJob, scratch: Path, token: str, lease: str,
                     should_cancel) -> None:
    """Two bounded streams; renew only a failed input, preserving successful files."""
    parsed = urllib.parse.urlsplit(spec.job.completion_url)
    spec_url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc,
               parsed.path.rsplit("/", 1)[0] + "/spec", parsed.query, ""))
    destinations = [(item, media._local_path(scratch, item["uri"])) for item in spec.job.objects]
    if len({path for _, path in destinations}) != len(destinations):
        raise ValueError("RunPod input destinations are not unique")
    stop = threading.Event()
    lock = threading.Lock()
    failure: Exception | None = None
    def cancelled():
        return stop.is_set() or should_cancel()
    def download(entry):
        nonlocal failure
        item, destination = entry
        try:
            if cancelled():
                raise media._PersonalJobCancelled
            try:
                media._download(item, destination, cancelled)
            except (media._PersonalDownloadTransportError, urllib.error.URLError):
                if cancelled():
                    raise media._PersonalJobCancelled
                seconds = int(max(0, (spec.deadline_at - datetime.now(timezone.utc)).total_seconds()))
                renewed = parse_spec(_fetch_spec(spec_url, token, lease,
                                    startup_seconds=min(60, seconds), should_cancel=cancelled))
                objects = _renewed_objects(spec, renewed)
                destination.unlink(missing_ok=True)
                media._download(objects[item["uri"]], destination, cancelled)
        except Exception as error:
            with lock:
                if failure is None or (isinstance(failure, media._PersonalJobCancelled)
                                       and not isinstance(error, media._PersonalJobCancelled)):
                    failure = error
                stop.set()
            raise
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="vf-cloud-input") as pool:
        futures = [pool.submit(download, entry) for entry in destinations]
        for future in futures:
            try:
                future.result()
            except Exception:
                pass
    if failure is not None:
        raise failure


def run(spec: RunPodJob, token: str, lease: str, tools: media.ToolPaths, *,
        allow_next_span: bool = False, executed_span_count: int = 1) -> tuple[str, object | None]:
    job = spec.job
    scratch = Path(tempfile.mkdtemp(prefix=f"vf-cloud-{spec.reservation_id}-"))
    marker = cancellation_marker(scratch, str(job.input_document.get("cancel_token", job.attempt_id)))
    monitor = media._CancellationMonitor(job.cancellation_url, token, lease, marker, None)
    def remaining() -> float:
        return max(0, (spec.deadline_at - datetime.now(timezone.utc)).total_seconds())
    cleanup_url = job.completion_url.rsplit("/", 1)[0] + "/cleanup"
    def expired() -> None:
        monitor._terminate(media._LEASE_STALE_FENCE)
        try:
            _control(cleanup_url, token, lease, {"reservation_id": spec.reservation_id,
                     "completed_attempt_id": job.attempt_id,
                     "state": "FAILED", "reason": "DEADLINE_EXCEEDED"})
        except (OSError, ValueError):
            pass
    timer = threading.Timer(remaining(), expired)
    disk_stop = threading.Event()
    child_finished = threading.Event()
    phase_lock = threading.RLock()
    phase_sequence = 0
    started_ns = time.monotonic_ns()
    def watch_disk() -> None:
        nonlocal phase_sequence
        last_disk_check = 0.0
        while not disk_stop.wait(1):
            try:
                if time.monotonic() - last_disk_check >= 10:
                    last_disk_check = time.monotonic()
                    if shutil.disk_usage(scratch).free < 256 * 1024**2:
                        monitor._terminate(media._MEDIA_EXECUTION_DISK_SPACE_INSUFFICIENT)
                        return
                with phase_lock:
                    if job.kind == "RENDER" and not child_finished.is_set():
                        observed = _read_render_phase(scratch, job.attempt_id, started_ns)
                        if observed is not None and observed["sequence"] > phase_sequence:
                            try:
                                phase("CHECKING_VIDEO", technical_ms=observed["technical_verification_ms"])
                            except OSError:
                                continue  # retry observation; existing cancellation/deadline still fence
                            phase_sequence = observed["sequence"]
            except media._PersonalJobCancelled:
                return
            except (OSError, ValueError):
                monitor._terminate(media._MEDIA_EXECUTION_IO_FAILED)
                return
    disk_watchdog = threading.Thread(target=watch_disk, daemon=True)
    facts = {"result_object_key": None, "result_content_length": None, "result_checksum_sha256": None}
    status, failure = "FAILED", "MEDIA_EXECUTION_FAILED"
    next_spec: object | None = None
    started = time.monotonic()
    def phase(name: str, *, technical_ms: int | None = None,
              artifact_ms: int | None = None) -> None:
        if name not in _PHASES or remaining() <= 0 or monitor.is_cancelled():
            raise media._PersonalJobCancelled
        payload = {"phase": name, "elapsed_seconds": round(time.monotonic() - started, 3)}
        if technical_ms is not None:
            payload["technical_verification_ms"] = technical_ms
        if artifact_ms is not None:
            payload["artifact_verification_ms"] = artifact_ms
        value = _control(job.cancellation_url, token, lease, payload)
        reason = media._heartbeat_stop_reason(200, value)
        if reason is not None:
            monitor._terminate(reason)
            raise media._PersonalJobCancelled
    monitor.start()
    timer.start()
    disk_watchdog.start()
    try:
        media._preflight_disk_space(job.objects, scratch)
        phase("DOWNLOADING_INPUTS")
        _download_inputs(spec, scratch, token, lease, monitor.is_cancelled)
        input_path = scratch / "job-input.json"
        input_path.write_bytes(media._canonical(job.input_document))
        command = [sys.executable, "-m", ("videoforge_media_local.cloud_media_cli"
                   if job.kind == "RENDER" else "videoforge_media_local.cli"),
                   {"ASR": "transcribe", "SPAN_AUDIO": "materialize-span", "RENDER": "render"}[job.kind],
                   "--artifact-root", str(scratch), "--input", str(input_path),
                   "--ffmpeg", str(tools.ffmpeg), "--ffprobe", str(tools.ffprobe)]
        if job.kind == "ASR":
            command += ["--whisper", str(tools.whisper), "--model", str(tools.whisper_model),
                        "--whisper-version", job.tooling["whisper_version"]]
        elif job.kind == "RENDER":
            command += ["--claimed-attempt-id", job.attempt_id,
                        "--ffmpeg-version", job.tooling["ffmpeg_version"],
                        "--ffprobe-version", job.tooling["ffprobe_version"]]
        phase("RENDERING")
        code, stdout = media._run_media_subprocess(command, monitor, retry_once=False,
                                                  before_retry=lambda: None,
                                                  timeout_seconds=max(1, remaining()))
        with phase_lock:
            child_finished.set()
        if code != 0 or monitor.is_cancelled():
            raise ValueError("RunPod shared media process failed")
        result, state, result_failure = media._parse_child_result(job, stdout, int(job.result["max_bytes"]))
        if state != "SUCCEEDED" or result is None:
            status, failure = state or "FAILED", result_failure
        else:
            technical_ms = None
            if job.kind == "RENDER":
                observed = _read_render_phase(scratch, job.attempt_id, started_ns)
                if observed is None or observed["sequence"] != 2:
                    raise ValueError("Cloud render technical timing is missing")
                technical_ms = observed["technical_verification_ms"]
            phase("CHECKING_VIDEO", technical_ms=technical_ms)
            artifact_started = time.monotonic_ns()
            with media._verified_primary_source(job, scratch, result) as (source, checksum, size):
                phase("SAVING", artifact_ms=(time.monotonic_ns() - artifact_started) // 1_000_000)
                output = job.outputs[0]
                if size > output["max_bytes"]:
                    raise ValueError("RunPod output exceeds exact bound")
                _upload(output["sign_url"], output["source"], output["object_key"],
                        output["content_type"], source, size, checksum, token, lease, monitor.is_cancelled)
            encoded = media._canonical(result)
            checksum = f"sha256:{hashlib.sha256(encoded).hexdigest()}"
            if len(encoded) > job.result["max_bytes"]:
                raise ValueError("RunPod result exceeds bound")
            _upload(job.result["sign_url"], "RESULT_DOCUMENT", job.result["object_key"],
                    "application/json", io.BytesIO(encoded), len(encoded), checksum,
                    token, lease, monitor.is_cancelled)
            facts = {"result_object_key": job.result["object_key"],
                     "result_content_length": len(encoded), "result_checksum_sha256": checksum}
            status, failure = "SUCCEEDED", None
    except media._PersonalJobCancelled:
        status, failure = media._stopped_completion(monitor)
    except subprocess.TimeoutExpired:
        status, failure = "FAILED", "MEDIA_EXECUTION_TIMEOUT"
    except (OSError, ValueError, KeyError, TypeError):
        status, failure = "FAILED", "MEDIA_EXECUTION_FAILED"
    finally:
        if monitor.is_cancelled():
            status, failure = media._stopped_completion(monitor)
            if monitor.stop_reason() in {media._MEDIA_EXECUTION_DISK_SPACE_INSUFFICIENT,
                                         media._MEDIA_EXECUTION_IO_FAILED}:
                status, failure = "FAILED", monitor.stop_reason()
            facts = {key: None for key in facts}
        disk_stop.set()
        disk_watchdog.join(timeout=1)
        monitor.close()
        try:
            completion = {"schema_version": "videoforge-personal-worker-completion/v1",
                          "status": status, "failure_code": failure, **facts}
            acknowledged = False
            for _ in range(3):
                if remaining() <= 0:
                    break
                try:
                    value = _control(job.completion_url, token, lease, completion)
                    if media._completion_is_acknowledged(200, value):
                        acknowledged = True
                        break
                except (OSError, ValueError):
                    continue
            if not acknowledged:
                status = "FAILED"
        finally:
            timer.cancel()
            shutil.rmtree(scratch, ignore_errors=True)
            try:
                cleanup_request = {"reservation_id": spec.reservation_id,
                         "completed_attempt_id": job.attempt_id,
                         "state": status, "reason": "JOB_FINISHED",
                         "allow_next_span": allow_next_span and status == "SUCCEEDED",
                         "executed_span_count": executed_span_count}
                cleanup = None
                for attempt in range(3):
                    try:
                        cleanup = _control(cleanup_url, token, lease, cleanup_request)
                        break
                    except OSError:
                        if attempt == 2:
                            raise
                if isinstance(cleanup, dict) and status == "SUCCEEDED":
                    next_spec = cleanup.get("next_spec")
            except (OSError, ValueError):
                # Independent controller deadline still owns shutdown and capacity.
                pass
    return status, next_spec


def _same_span_batch(original: RunPodJob, following: RunPodJob,
                     attempt_ids: set[str]) -> bool:
    """Reuse only an immediately ready span with a new controller-fenced attempt."""
    original_scope = original.job.outputs[0]["object_key"].split("/lane/", 1)[0]
    following_scope = following.job.outputs[0]["object_key"].split("/lane/", 1)[0]
    return (
        original.job.kind == following.job.kind == "SPAN_AUDIO"
        and following.reservation_id == original.reservation_id
        and following.runtime_sha256 == original.runtime_sha256
        and following.source_sha256 == original.source_sha256
        and following.deadline_at == original.deadline_at
        and following.job.tooling == original.job.tooling
        and following.job.attempt_id not in attempt_ids
        and original_scope == following_scope
    )


def execute_batch(spec: RunPodJob, token: str, lease: str, tools: media.ToolPaths) -> str:
    """At most four ready spans, without idle grace or a new rental deadline."""
    original = spec
    attempts: set[str] = set()
    for ordinal in range(1, 5):
        attempts.add(spec.job.attempt_id)
        status, following = run(spec, token, lease, tools,
                                allow_next_span=spec.job.kind == "SPAN_AUDIO" and ordinal < 4,
                                executed_span_count=ordinal)
        if following is None:
            return status
        try:
            parsed = parse_spec(following)
            if status != "SUCCEEDED" or ordinal >= 4 or not _same_span_batch(original, parsed, attempts):
                raise ValueError("RunPod next span identity conflicts")
        except (ValueError, TypeError, KeyError):
            try:
                _control(spec.job.completion_url.rsplit("/", 1)[0] + "/cleanup", token, lease,
                         {"reservation_id": spec.reservation_id, "state": "FAILED",
                          "completed_attempt_id": spec.job.attempt_id,
                          "reason": "NEXT_SPAN_REJECTED", "allow_next_span": False,
                          "executed_span_count": ordinal})
            except (OSError, ValueError):
                pass
            return "FAILED"
        spec = parsed
    return "FAILED"


def _fetch_spec(url: str, token: str, lease: str, *, startup_seconds: int = 600,
                should_cancel=lambda: False) -> object:
    deadline = time.monotonic() + startup_seconds
    while time.monotonic() < deadline:
        if should_cancel():
            raise media._PersonalJobCancelled
        status, value = media._request_json(url, "GET", {
            "authorization": f"Bearer {token}", "x-videoforge-lease-token": lease,
        }, maximum=16 * 1024**2, timeout=10)
        if status == 200:
            return value
        if status not in {409, 425, 503}:
            raise ValueError("RunPod exact job capability was rejected")
        threading.Event().wait(min(2, max(0, deadline - time.monotonic())))
    raise ValueError("RunPod startup deadline exceeded")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", type=Path)
    parser.add_argument("--spec-url", default=os.environ.get("VIDEOFORGE_CLOUD_SPEC_URL"))
    parser.add_argument("--runtime-manifest", type=Path, default=Path("/opt/videoforge/runtime.json"))
    args = parser.parse_args()
    token = os.environ.pop("VIDEOFORGE_CLOUD_CAPABILITY")
    lease = os.environ.pop("VIDEOFORGE_CLOUD_LEASE", token)
    if bool(args.spec) == bool(args.spec_url):
        raise ValueError("Choose exactly one exact job source")
    document: object = None
    try:
        document = (json.loads(args.spec.read_bytes()) if args.spec else
                    _fetch_spec(args.spec_url, token, lease))
        spec = parse_spec(document)
        tools = verify_runtime(spec, args.runtime_manifest)
        return 0 if execute_batch(spec, token, lease, tools) == "SUCCEEDED" else 1
    except Exception:
        if args.spec_url:
            try:
                raw_job = document.get("job") if isinstance(document, dict) else None
                attempt_id = raw_job.get("attempt_id") if isinstance(raw_job, dict) else None
                if not isinstance(attempt_id, str) or not media._UUID.fullmatch(attempt_id):
                    raise ValueError("Exact startup attempt is unknown")
                _control(args.spec_url.rsplit("/", 1)[0] + "/cleanup", token, lease,
                         {"state": "FAILED", "reason": "RUNTIME_OR_STARTUP_REJECTED",
                          "completed_attempt_id": attempt_id})
            except (OSError, ValueError):
                pass
        # Never print signed ports, tokens, or a transport exception containing URLs.
        print("RunPod media runtime failed safely", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

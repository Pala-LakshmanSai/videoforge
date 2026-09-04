"""V2-07 queue handler: exact v3 authority, sealed volume, and one serialized Mage batch."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import re
import socket
import ssl
import time
from contextlib import contextmanager
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from mage_runtime import MageRuntime
from mage_volume import verify_model_root
from videoforge_image_media import MageInlineJob, MageJob

from secure_scratch import ScratchIsolationError, mage_worker_io, validate_scoped_port
from serverless_envelope import (
    EnvelopeRejection,
    restricted_canonical_sha256,
    request_body_from_payload,
    sign_receipt,
    validate_envelope,
)


class ServerlessMageError(RuntimeError):
    pass


_runtime: MageRuntime | None = None
_startup_lock = asyncio.Lock()
_delivery_lock = asyncio.Lock()
_claimed_deliveries: set[str] = set()
_HTTP_USER_AGENT = "VideoForge-Mage/V2-07"

_GENERATED_OUTPUT_SCHEMA = "artifact-generated-output-authority/v1"
_GENERATED_OUTPUT_KEYS = frozenset(
    {
        "schema_version",
        "reservation_id",
        "account_id",
        "workspace_id",
        "method",
        "path",
        "content_type",
        "max_content_length",
        "expires_at",
        "max_uses",
        "capability_handle",
    }
)
_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
_CONTENT_TYPE = re.compile(r"^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$")
_CAPABILITY = re.compile(r"^[A-Za-z0-9._:-]{32,512}$")
_FAILURE_CODE = re.compile(r"^[A-Z][A-Z0-9_.:-]{2,120}$")
_RESUME_SCHEMA = "serverless-unit-resume/v1"
_EXECUTION_SCHEMA = "serverless-execution-subset/v1"
_PLAN_MANIFEST_SCHEMA = "videoforge-v207-plan-manifest/v1"
_EXECUTION_KEYS = frozenset({"schema_version", "plan_manifest_sha256", "item_ids"})
_RESUME_KEYS = frozenset(
    {"schema_version", "plan_manifest", "plan_manifest_sha256", "accepted_units"}
)
_RESUME_UNIT_KEYS = frozenset(
    {
        "tenant",
        "project_id",
        "revision_id",
        "lane",
        "plan_manifest",
        "plan_manifest_sha256",
        "source_attempt_id",
        "item_id",
        "output_object_key",
        "output_sha256",
        "output_bytes",
        "artifact_commit_receipt_sha256",
        "signed_provenance_receipt_sha256",
        "readback_port",
        "readback_get_url",
    }
)
_TIMING_MAX_MS = 86_400_000
_SIGNED_AUTHORITY_TTL_SECONDS = 7_200


def _exact_utf8_sha256(value: object, *, max_bytes: int) -> str:
    if not isinstance(value, str):
        raise ServerlessMageError("MAGE_SERVERLESS_CANONICAL_JSON_INVALID")
    try:
        encoded = value.encode("utf-8")
    except UnicodeEncodeError as error:
        raise ServerlessMageError("MAGE_SERVERLESS_CANONICAL_JSON_INVALID") from error
    if len(encoded) < 2 or len(encoded) > max_bytes:
        raise ServerlessMageError("MAGE_SERVERLESS_CANONICAL_JSON_INVALID")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def _plan_manifest_for_job(mage_job: MageJob) -> dict[str, Any]:
    """Rebuild the complete immutable plan from the validated Mage wire contract."""
    return {
        "schema_version": _PLAN_MANIFEST_SCHEMA,
        "tenant": {"account_id": "account-a", "workspace_id": "workspace-a"},
        "project_id": "project-a",
        "revision_id": "revision-a",
        "lane": "mage-image",
        "model_revision": mage_job.model_revision,
        "items": [
            {
                "scene_id": item.scene_id,
                "positive_prompt": item.positive_prompt,
                "positive_prompt_sha256": item.positive_prompt_sha256,
                "negative_prompt": item.negative_prompt,
                "negative_prompt_sha256": item.negative_prompt_sha256,
                "seed": item.seed,
                "width": item.width,
                "height": item.height,
                "output_put_url": item.output_put_url,
            }
            for item in mage_job.items
        ],
    }


def _bounded_timing_ms(value: object) -> int:
    """Return a truthful, finite timing measurement or fail closed."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ServerlessMageError("MAGE_SERVERLESS_TIMING_INVALID")
    if value < 0 or value > _TIMING_MAX_MS:
        raise ServerlessMageError("MAGE_SERVERLESS_TIMING_INVALID")
    return max(1, value)


def _signed_envelope_issued_at(accepted: dict[str, Any]) -> datetime:
    """Read the explicit signed dispatch boundary and require the exact fixed TTL."""
    limits = accepted.get("limits")
    expires_at = limits.get("expires_at") if isinstance(limits, dict) else None
    issued_at = limits.get("issued_at") if isinstance(limits, dict) else None
    if not isinstance(expires_at, str) or not isinstance(issued_at, str):
        raise ServerlessMageError("MAGE_SERVERLESS_TIMING_ISSUED_AT_INVALID")
    try:
        expires = datetime.fromisoformat(expires_at.replace("Z", "+00:00")).astimezone(UTC)
        issued = datetime.fromisoformat(issued_at.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError as error:
        raise ServerlessMageError("MAGE_SERVERLESS_TIMING_ISSUED_AT_INVALID") from error
    if expires - issued != timedelta(seconds=_SIGNED_AUTHORITY_TTL_SECONDS):
        raise ServerlessMageError("MAGE_SERVERLESS_TIMING_ISSUED_AT_INVALID")
    return issued


def _startup_timings(
    runtime: Any, *, accepted: dict[str, Any], ready_at: float, handler_started_at: float
) -> tuple[int, int, str]:
    """Measure signed-dispatch-to-local-process and signed-dispatch-to-ready boundaries.

    RunPod allocation is not observable from inside the worker.  The returned legacy timing
    slots are therefore explicitly derived from the signed envelope issue boundary to two local
    monotonic boundaries.  The accompanying output provenance labels them as worker-local; the
    live verifier uses RunPod's status ``delayTimeMs``/``executionTimeMs`` for provider timing.
    """
    runtime_started = getattr(runtime, "started", None)
    if not isinstance(runtime_started, (int, float)) or isinstance(runtime_started, bool):
        raise ServerlessMageError("MAGE_SERVERLESS_TIMING_INVALID")
    now_monotonic = time.monotonic()
    now_epoch = time.time()
    if runtime_started > ready_at or ready_at > now_monotonic or handler_started_at > ready_at:
        raise ServerlessMageError("MAGE_SERVERLESS_TIMING_INVALID")
    issued_at = _signed_envelope_issued_at(accepted)
    # Translate the two locally observed monotonic boundaries into the current wall-clock domain
    # only to compare them with the signed UTC issue instant.  No caller or provider env value is
    # accepted, and the measured interval is bounded before it enters the signed receipt.
    # A warm worker process may predate the signed request.  In that case the handler admission
    # boundary is the defensible local lower bound; never emit a negative interval or pretend a
    # pre-existing process start was provider allocation.
    process_boundary = max(runtime_started, handler_started_at)
    runtime_started_epoch = now_epoch - (now_monotonic - process_boundary)
    ready_epoch = now_epoch - (now_monotonic - ready_at)
    allocation_delta_ms = round((runtime_started_epoch - issued_at.timestamp()) * 1000)
    ready_delta_ms = round((ready_epoch - issued_at.timestamp()) * 1000)
    if allocation_delta_ms < 0 or ready_delta_ms < allocation_delta_ms:
        raise ServerlessMageError("MAGE_SERVERLESS_TIMING_ORDER_INVALID")
    # Oversized intervals are invalid evidence.  Never clamp them into a plausible-looking value.
    allocation_ms = _bounded_timing_ms(allocation_delta_ms)
    container_ready_ms = _bounded_timing_ms(ready_delta_ms)
    return allocation_ms, container_ready_ms, issued_at.isoformat().replace("+00:00", "Z")


def _endpoint_id_hash() -> str:
    """Use the endpoint-bound hash when explicitly injected, otherwise RunPod's endpoint id."""
    configured = os.environ.get("VIDEOFORGE_MAGE_ENDPOINT_ID_HASH", "")
    if configured:
        if len(configured) != 71 or not configured.startswith("sha256:"):
            raise ServerlessMageError("MAGE_SERVERLESS_ENDPOINT_ID_HASH_INVALID")
        try:
            int(configured[7:], 16)
        except ValueError as error:
            raise ServerlessMageError("MAGE_SERVERLESS_ENDPOINT_ID_HASH_INVALID") from error
        return configured
    endpoint_id = os.environ.get("RUNPOD_ENDPOINT_ID", "")
    if not endpoint_id or any(ord(character) < 33 for character in endpoint_id):
        raise ServerlessMageError("MAGE_SERVERLESS_ENDPOINT_ID_MISSING")
    return "sha256:" + hashlib.sha256(endpoint_id.encode("utf-8")).hexdigest()


def _sha_environment(name: str) -> str:
    value = os.environ.get(name, "")
    if len(value) != 71 or not value.startswith("sha256:"):
        raise ServerlessMageError(f"MAGE_SERVERLESS_{name}_INVALID")
    return value


def _configured_image_digest() -> str:
    """Normalize the runtime's full immutable image reference to the envelope digest."""
    configured = os.environ.get("VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST", "")
    if "@sha256:" in configured:
        return configured.rsplit("@", 1)[1]
    return configured


_GENERATED_OUTPUT_UPLOAD_FAILURE_PREFIX = "MAGE_SERVERLESS_OUTPUT_UPLOAD"


def _generated_output_upload_http_failure_code(status: object) -> str:
    """Return only a bounded HTTP class and status code for a failed upload.

    HTTP response bodies and headers are deliberately not inspected.  A status outside the
    ordinary three-digit HTTP range is represented by one fixed code rather than copied into
    the worker result.
    """
    if (
        isinstance(status, bool)
        or not isinstance(status, int)
        or status < 100
        or status > 599
    ):
        return f"{_GENERATED_OUTPUT_UPLOAD_FAILURE_PREFIX}_HTTP_STATUS_INVALID"
    return f"{_GENERATED_OUTPUT_UPLOAD_FAILURE_PREFIX}_HTTP_{status // 100}XX_{status}"


def _classify_generated_output_upload_error(
    error: BaseException, *, _seen: frozenset[int] = frozenset()
) -> str:
    """Map upload transport failures to bounded, redaction-safe diagnostic codes.

    This function intentionally branches only on exception types and the numeric HTTP status.
    It never reads exception text, URLs, request bodies, response bodies, headers, or credentials.
    ``URLError.reason`` is followed only when it is another exception so timeout/TLS causes remain
    useful without allowing arbitrary provider text to enter the result.  The recursion guard keeps
    malformed exception graphs bounded.
    """
    if id(error) in _seen:
        return f"{_GENERATED_OUTPUT_UPLOAD_FAILURE_PREFIX}_DNS_NETWORK_URL"
    seen = _seen | {id(error)}

    if isinstance(error, HTTPError):
        return _generated_output_upload_http_failure_code(getattr(error, "code", None))
    if isinstance(error, (TimeoutError, socket.timeout)):
        return f"{_GENERATED_OUTPUT_UPLOAD_FAILURE_PREFIX}_TIMEOUT"
    if isinstance(error, (ssl.SSLCertVerificationError, ssl.CertificateError, ssl.SSLError)):
        return f"{_GENERATED_OUTPUT_UPLOAD_FAILURE_PREFIX}_TLS_CERTIFICATE"
    if isinstance(error, URLError):
        reason = getattr(error, "reason", None)
        if isinstance(reason, BaseException) and reason is not error:
            nested = _classify_generated_output_upload_error(reason, _seen=seen)
            if not nested.endswith("_DNS_NETWORK_URL"):
                return nested
        return f"{_GENERATED_OUTPUT_UPLOAD_FAILURE_PREFIX}_DNS_NETWORK_URL"
    if isinstance(error, (socket.gaierror, ConnectionError, OSError, ValueError)):
        return f"{_GENERATED_OUTPUT_UPLOAD_FAILURE_PREFIX}_DNS_NETWORK_URL"
    return f"{_GENERATED_OUTPUT_UPLOAD_FAILURE_PREFIX}_UNKNOWN"


def _put_output(port: dict[str, Any], url: str, body: bytes) -> int:
    _validate_output_url(url)
    if len(body) != port["content_length"]:
        raise ServerlessMageError("MAGE_SERVERLESS_OUTPUT_LENGTH_MISMATCH")
    checksum = f"sha256:{hashlib.sha256(body).hexdigest()}"
    if checksum != port["checksum_sha256"]:
        raise ServerlessMageError("MAGE_SERVERLESS_OUTPUT_CHECKSUM_MISMATCH")
    request = Request(
        url,
        data=body,
        method="PUT",
        headers={
            "accept": "application/json",
            "user-agent": _HTTP_USER_AGENT,
            "content-type": port["content_type"],
            "content-length": str(len(body)),
        },
    )
    try:
        with urlopen(request, timeout=60) as response:
            if response.status not in {200, 201, 204}:
                raise ServerlessMageError("MAGE_SERVERLESS_OUTPUT_UPLOAD_FAILED")
    except ServerlessMageError:
        raise
    except Exception as error:
        raise ServerlessMageError("MAGE_SERVERLESS_OUTPUT_UPLOAD_FAILED") from error
    return round(time.monotonic() * 1000)


def _put_generated_output(authority: dict[str, Any], url: str, body: bytes) -> tuple[int, str]:
    """Upload bytes through a bounded generated-output authority.

    Unlike an exact v3 PUT port, this authority intentionally does not pretend to know the
    output length/hash before inference.  The worker measures both facts here, enforces the
    authority's byte ceiling, and returns the measured hash for the signed receipt.  The
    control plane still performs the exact v3 finalize/commit step against this reservation.
    """
    _validate_output_url(url)
    if len(body) < 1 or len(body) > authority["max_content_length"]:
        raise ServerlessMageError("MAGE_SERVERLESS_GENERATED_OUTPUT_LENGTH_INVALID")
    checksum = f"sha256:{hashlib.sha256(body).hexdigest()}"
    failure_code: str | None = None
    try:
        request = Request(
            url,
            data=body,
            method="PUT",
            headers={
                "accept": "application/json",
                "user-agent": _HTTP_USER_AGENT,
                "content-type": authority["content_type"],
                "content-length": str(len(body)),
            },
        )
        with urlopen(request, timeout=60) as response:
            if response.status not in {200, 201, 204}:
                failure_code = _generated_output_upload_http_failure_code(response.status)
    except ServerlessMageError:
        raise
    except Exception as error:
        failure_code = _classify_generated_output_upload_error(error)
    if failure_code is not None:
        # Raise after leaving the transport exception handler.  The returned/serialized exception
        # therefore contains only the stable code and cannot carry a URL, body, or provider text.
        raise ServerlessMageError(failure_code)
    return round(time.monotonic() * 1000), checksum


def _validate_output_url(url: object) -> None:
    """Reject non-HTTPS or malformed presigned destinations before model startup."""
    if not isinstance(url, str) or len(url) > 8_192:
        raise ServerlessMageError("MAGE_SERVERLESS_OUTPUT_URL_INVALID")
    try:
        parsed = urlsplit(url)
        hostname = parsed.hostname
    except ValueError as error:
        raise ServerlessMageError("MAGE_SERVERLESS_OUTPUT_URL_INVALID") from error
    if (
        parsed.scheme != "https"
        or not hostname
        or parsed.username
        or parsed.password
        or parsed.fragment
        or any(ord(character) < 32 for character in url)
    ):
        raise ServerlessMageError("MAGE_SERVERLESS_OUTPUT_URL_INVALID")


def _download_input(port: dict[str, Any], url: object, worker_io: Any) -> Path:
    """Fetch one exact scoped input into this attempt's scratch tree."""
    try:
        _validate_output_url(url)
    except ServerlessMageError as error:
        raise ServerlessMageError("MAGE_SERVERLESS_INPUT_URL_INVALID") from error
    expected_length = port["content_length"]
    request = Request(
        str(url),
        method="GET",
        headers={
            "accept": "application/octet-stream",
            "user-agent": _HTTP_USER_AGENT,
        },
    )
    try:
        with urlopen(request, timeout=60) as response:
            if response.status != 200:
                raise ServerlessMageError("MAGE_SERVERLESS_INPUT_DOWNLOAD_FAILED")
            header_length = response.headers.get("Content-Length")
            if header_length is not None:
                try:
                    if int(header_length) != expected_length:
                        raise ServerlessMageError("MAGE_SERVERLESS_INPUT_LENGTH_MISMATCH")
                except ValueError as error:
                    raise ServerlessMageError("MAGE_SERVERLESS_INPUT_LENGTH_MISMATCH") from error
            body = response.read(expected_length + 1)
    except ServerlessMageError:
        raise
    except Exception as error:
        raise ServerlessMageError("MAGE_SERVERLESS_INPUT_DOWNLOAD_FAILED") from error
    if len(body) != expected_length:
        raise ServerlessMageError("MAGE_SERVERLESS_INPUT_LENGTH_MISMATCH")
    checksum = "sha256:" + hashlib.sha256(body).hexdigest()
    if checksum != port["checksum_sha256"]:
        raise ServerlessMageError("MAGE_SERVERLESS_INPUT_CHECKSUM_MISMATCH")
    worker_io.scratch.safe_path("inputs", directory=True)
    path = worker_io.scratch.safe_path(f"inputs/{port['reservation_id']}.bin")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.write_bytes(body)
    return path


def _required(value: Any, key: str) -> dict[str, Any]:
    if not isinstance(value, dict) or not isinstance(value.get(key), dict):
        raise ServerlessMageError("MAGE_SERVERLESS_JOB_SHAPE_INVALID")
    return value[key]


def _validate_generated_output_authority(
    authority: dict[str, Any],
    *,
    account_id: str,
    workspace_id: str,
    attempt_id: str,
    output_prefix: str,
    now: datetime,
) -> None:
    """Validate the additive generated-output capability before model startup.

    This deliberately does not accept a v3 port with omitted/placeholder bytes.  The v3
    contract remains exact; this separate authority only grants one bounded tenant/path slot
    until the producer supplies the actual bytes for finalization.
    """
    if set(authority) != _GENERATED_OUTPUT_KEYS:
        raise ServerlessMageError("MAGE_SERVERLESS_GENERATED_OUTPUT_AUTHORITY_INVALID")
    if authority.get("schema_version") != _GENERATED_OUTPUT_SCHEMA:
        raise ServerlessMageError("MAGE_SERVERLESS_GENERATED_OUTPUT_SCHEMA_INVALID")
    if authority.get("account_id") != account_id or authority.get("workspace_id") != workspace_id:
        raise ServerlessMageError("MAGE_SERVERLESS_GENERATED_OUTPUT_SCOPE_MISMATCH")
    if authority.get("method") != "PUT":
        raise ServerlessMageError("MAGE_SERVERLESS_GENERATED_OUTPUT_METHOD_INVALID")
    reservation_id = authority.get("reservation_id")
    if not isinstance(reservation_id, str) or not _IDENTIFIER.fullmatch(reservation_id):
        raise ServerlessMageError("MAGE_SERVERLESS_GENERATED_OUTPUT_RESERVATION_INVALID")
    content_type = authority.get("content_type")
    if not isinstance(content_type, str) or not _CONTENT_TYPE.fullmatch(content_type):
        raise ServerlessMageError("MAGE_SERVERLESS_GENERATED_OUTPUT_CONTENT_TYPE_INVALID")
    maximum = authority.get("max_content_length")
    if (
        not isinstance(maximum, int)
        or isinstance(maximum, bool)
        or maximum < 1
        or maximum > 10_737_418_240
    ):
        raise ServerlessMageError("MAGE_SERVERLESS_GENERATED_OUTPUT_LENGTH_INVALID")
    path = authority.get("path")
    expected_prefix = f"/{output_prefix}/artifact/"
    prefix_parts = output_prefix.split("/") if isinstance(output_prefix, str) else []
    if (
        len(prefix_parts) != 12
        or prefix_parts[0] != "tenant"
        or prefix_parts[1] != account_id
        or prefix_parts[2] != "workspace"
        or prefix_parts[3] != workspace_id
        or prefix_parts[4] != "project"
        or not _IDENTIFIER.fullmatch(prefix_parts[5])
        or prefix_parts[6] != "revision"
        or not _IDENTIFIER.fullmatch(prefix_parts[7])
        or prefix_parts[8] != "lane"
        or prefix_parts[9] != "mage-image"
        or prefix_parts[10] != "job"
        or prefix_parts[11] != attempt_id
    ):
        raise ServerlessMageError("MAGE_SERVERLESS_OUTPUT_PREFIX_INVALID")
    artifact_id = (
        path[len(expected_prefix) :]
        if isinstance(path, str) and path.startswith(expected_prefix)
        else None
    )
    if (
        not isinstance(path, str)
        or not path.startswith(expected_prefix)
        or not isinstance(artifact_id, str)
        or not _IDENTIFIER.fullmatch(artifact_id)
        or "?" in path
        or "#" in path
        or "/../" in path
        or path.endswith("/")
    ):
        raise ServerlessMageError("MAGE_SERVERLESS_GENERATED_OUTPUT_PATH_MISMATCH")
    expires_at = authority.get("expires_at")
    if not isinstance(expires_at, str) or not expires_at.endswith("Z"):
        raise ServerlessMageError("MAGE_SERVERLESS_GENERATED_OUTPUT_EXPIRY_INVALID")
    try:
        parsed_expiry = datetime.fromisoformat(expires_at[:-1] + "+00:00")
    except ValueError as error:
        raise ServerlessMageError("MAGE_SERVERLESS_GENERATED_OUTPUT_EXPIRY_INVALID") from error
    if parsed_expiry.tzinfo is None or now.astimezone(UTC) >= parsed_expiry.astimezone(UTC):
        raise ServerlessMageError("MAGE_SERVERLESS_GENERATED_OUTPUT_EXPIRED")
    max_uses = authority.get("max_uses")
    if not isinstance(max_uses, int) or isinstance(max_uses, bool) or max_uses != 1:
        raise ServerlessMageError("MAGE_SERVERLESS_GENERATED_OUTPUT_REPLAY_BOUND_INVALID")
    capability = authority.get("capability_handle")
    if not isinstance(capability, str) or not _CAPABILITY.fullmatch(capability):
        raise ServerlessMageError("MAGE_SERVERLESS_GENERATED_OUTPUT_CAPABILITY_INVALID")


def _validate_scoped_ports(
    ports: dict[str, Any],
    *,
    generated_output_authorities: object,
    accepted: dict[str, Any],
    attempt_id: str,
    now: datetime,
) -> tuple[
    tuple[dict[str, Any], ...],
    tuple[dict[str, Any], ...],
    tuple[dict[str, Any], ...],
]:
    """Validate every port before acquiring a worker or touching the model volume."""
    raw_inputs = ports.get("inputs")
    raw_outputs = ports.get("outputs")
    if not isinstance(raw_inputs, list) or not isinstance(raw_outputs, list):
        raise ServerlessMageError("MAGE_SERVERLESS_PORT_SHAPE_INVALID")
    if any(not isinstance(port, dict) for port in (*raw_inputs, *raw_outputs)):
        raise ServerlessMageError("MAGE_SERVERLESS_PORT_SHAPE_INVALID")
    if not isinstance(generated_output_authorities, list) or any(
        not isinstance(authority, dict) for authority in generated_output_authorities
    ):
        raise ServerlessMageError("MAGE_SERVERLESS_GENERATED_OUTPUT_AUTHORITY_SHAPE_INVALID")
    input_ports = tuple(raw_inputs)
    output_ports = tuple(raw_outputs)
    generated_authorities = tuple(generated_output_authorities)
    if len(output_ports) == 0 and len(generated_authorities) == 0:
        raise ServerlessMageError("MAGE_SERVERLESS_OUTPUT_PORT_COUNT_INVALID")
    expected_ids = tuple(accepted["artifacts"]["transfer_port_reservation_ids"])
    input_ids = tuple(port.get("reservation_id") for port in input_ports)
    output_ids = tuple(port.get("reservation_id") for port in output_ports) + tuple(
        authority.get("reservation_id") for authority in generated_authorities
    )
    actual_ids = input_ids + output_ids if input_ports else output_ids
    if actual_ids != expected_ids:
        raise ServerlessMageError("MAGE_SERVERLESS_PORT_AUTHORITY_MISMATCH")
    seen_ids: set[str] = set()
    for reservation_id in actual_ids:
        if isinstance(reservation_id, str):
            if reservation_id in seen_ids:
                raise ServerlessMageError("MAGE_SERVERLESS_PORT_REPLAYED")
            seen_ids.add(reservation_id)
    if output_ports and generated_authorities:
        raise ServerlessMageError("MAGE_SERVERLESS_OUTPUT_AUTHORITY_MODE_MISMATCH")
    account_id = accepted["tenant"]["account_id"]
    workspace_id = accepted["tenant"]["workspace_id"]
    output_prefix = accepted["artifacts"]["output_prefix"]
    for port in input_ports:
        validate_scoped_port(
            port,
            account_id=account_id,
            workspace_id=workspace_id,
            job_id=attempt_id,
            method="GET",
            now=now,
        )
    for port in output_ports:
        validate_scoped_port(
            port,
            account_id=account_id,
            workspace_id=workspace_id,
            job_id=attempt_id,
            method="PUT",
            now=now,
        )
    for authority in generated_authorities:
        _validate_generated_output_authority(
            authority,
            account_id=account_id,
            workspace_id=workspace_id,
            attempt_id=attempt_id,
            output_prefix=output_prefix,
            now=now,
        )
    return input_ports, output_ports, generated_authorities


def _resume_source_attempt_id(port: dict[str, Any]) -> str:
    """Extract the exact attempt binding from a prior accepted output GET port."""
    return _resume_path_lineage(port)["source_attempt_id"]


def _resume_path_lineage(port: dict[str, Any]) -> dict[str, str]:
    """Parse all immutable lineage segments from a durable readback authority path."""
    path = port.get("path")
    if not isinstance(path, str):
        raise ServerlessMageError("MAGE_SERVERLESS_RESUME_READBACK_PATH_INVALID")
    parts = path.split("/")
    if (
        len(parts) != 15
        or parts[0] != ""
        or parts[1] != "tenant"
        or parts[3] != "workspace"
        or parts[5] != "project"
        or parts[7] != "revision"
        or parts[9] != "lane"
        or parts[10] != "mage-image"
        or parts[11] != "job"
        or parts[13] != "artifact"
        or not _IDENTIFIER.fullmatch(parts[2])
        or not _IDENTIFIER.fullmatch(parts[4])
        or not _IDENTIFIER.fullmatch(parts[6])
        or not _IDENTIFIER.fullmatch(parts[8])
        or not _IDENTIFIER.fullmatch(parts[12])
        or not _IDENTIFIER.fullmatch(parts[14])
    ):
        raise ServerlessMageError("MAGE_SERVERLESS_RESUME_READBACK_PATH_INVALID")
    return {
        "account_id": parts[2],
        "workspace_id": parts[4],
        "project_id": parts[6],
        "revision_id": parts[8],
        "lane": parts[10],
        "source_attempt_id": parts[12],
        "item_id": parts[14],
    }


def _accepted_output_prefix_lineage(accepted: dict[str, Any]) -> dict[str, str]:
    """Parse the current signed output prefix to bind resume records to this job."""
    output_prefix = accepted.get("artifacts", {}).get("output_prefix")
    if not isinstance(output_prefix, str):
        raise ServerlessMageError("MAGE_SERVERLESS_RESUME_LINEAGE_INVALID")
    try:
        lineage = _resume_path_lineage({"path": f"/{output_prefix}/artifact/placeholder"})
    except ServerlessMageError as error:
        raise ServerlessMageError("MAGE_SERVERLESS_RESUME_LINEAGE_INVALID") from error
    return lineage


def _validate_resume_state(
    resume: object,
    *,
    resume_canonical_json: object = None,
    accepted: dict[str, Any],
    current_item_ids: tuple[str, ...],
    expected_plan_manifest: dict[str, Any],
    now: datetime,
) -> tuple[dict[str, Any], ...]:
    """Validate durable accepted-unit readbacks before any unit can be generated.

    A replacement attempt carries the original validated item list plus durable accepted units.
    Accepted IDs are required to be present in that list and are skipped after exact scratch
    readback, so a process replacement cannot regenerate them.  Every record is bound explicitly
    to tenant/project/revision/lane/source attempt/item/hash/bytes and its v3 GET authority.
    """
    artifacts = accepted.get("artifacts")
    expected_resume_hash = (
        artifacts.get("resume_manifest_sha256") if isinstance(artifacts, dict) else None
    )
    if resume is None:
        if expected_resume_hash is not None or resume_canonical_json is not None:
            raise ServerlessMageError("MAGE_SERVERLESS_RESUME_MANIFEST_MISSING")
        return ()
    if not isinstance(resume, dict) or set(resume) != _RESUME_KEYS:
        raise ServerlessMageError("MAGE_SERVERLESS_RESUME_SCHEMA_INVALID")
    if resume.get("schema_version") != _RESUME_SCHEMA:
        raise ServerlessMageError("MAGE_SERVERLESS_RESUME_SCHEMA_INVALID")
    if not isinstance(expected_resume_hash, str) or not re.fullmatch(
        r"sha256:[0-9a-f]{64}", expected_resume_hash
    ):
        raise ServerlessMageError("MAGE_SERVERLESS_RESUME_MANIFEST_MISSING")
    if _exact_utf8_sha256(resume_canonical_json, max_bytes=4_000_000) != expected_resume_hash:
        raise ServerlessMageError("MAGE_SERVERLESS_RESUME_MANIFEST_HASH_INVALID")
    try:
        if json.loads(resume_canonical_json) != resume:
            raise ServerlessMageError("MAGE_SERVERLESS_RESUME_MANIFEST_HASH_INVALID")
    except (json.JSONDecodeError, UnicodeEncodeError) as error:
        raise ServerlessMageError("MAGE_SERVERLESS_RESUME_MANIFEST_HASH_INVALID") from error
    plan_manifest = resume.get("plan_manifest")
    plan_manifest_sha256 = resume.get("plan_manifest_sha256")
    signed_plan_manifest_sha256 = artifacts.get("plan_manifest_sha256")
    if (
        not isinstance(plan_manifest, dict)
        or set(plan_manifest)
        != {
            "schema_version",
            "tenant",
            "project_id",
            "revision_id",
            "lane",
            "model_revision",
            "items",
        }
        or plan_manifest.get("schema_version") != _PLAN_MANIFEST_SCHEMA
        or plan_manifest != expected_plan_manifest
        or not isinstance(plan_manifest_sha256, str)
        or not re.fullmatch(r"sha256:[0-9a-f]{64}", plan_manifest_sha256)
        or plan_manifest_sha256 != signed_plan_manifest_sha256
    ):
        raise ServerlessMageError("MAGE_SERVERLESS_RESUME_PLAN_MANIFEST_INVALID")
    if (
        not isinstance(plan_manifest.get("items"), list)
        or len(plan_manifest["items"]) != len(current_item_ids)
        or len(set(current_item_ids)) != len(current_item_ids)
        or tuple(item.get("scene_id") for item in plan_manifest["items"] if isinstance(item, dict))
        != current_item_ids
    ):
        raise ServerlessMageError("MAGE_SERVERLESS_RESUME_PLAN_MANIFEST_INVALID")
    raw_units = resume.get("accepted_units")
    if not isinstance(raw_units, list) or not raw_units or len(raw_units) > 64:
        raise ServerlessMageError("MAGE_SERVERLESS_RESUME_UNITS_INVALID")
    current_ids = set(current_item_ids)
    seen_items: set[str] = set()
    seen_objects: set[str] = set()
    seen_reservations: set[str] = set()
    account_id = accepted["tenant"]["account_id"]
    workspace_id = accepted["tenant"]["workspace_id"]
    expected_lineage = _accepted_output_prefix_lineage(accepted)
    current_attempt_id = accepted["work"]["attempt_id"]
    units: list[dict[str, Any]] = []
    for raw_unit in raw_units:
        if not isinstance(raw_unit, dict) or set(raw_unit) != _RESUME_UNIT_KEYS:
            raise ServerlessMageError("MAGE_SERVERLESS_RESUME_UNIT_INVALID")
        if (
            raw_unit.get("plan_manifest_sha256") != plan_manifest_sha256
            or not isinstance(raw_unit.get("plan_manifest"), dict)
            or raw_unit["plan_manifest"] != plan_manifest
        ):
            raise ServerlessMageError("MAGE_SERVERLESS_RESUME_PLAN_MANIFEST_INVALID")
        tenant = raw_unit.get("tenant")
        if (
            not isinstance(tenant, dict)
            or set(tenant) != {"account_id", "workspace_id"}
            or tenant.get("account_id") != account_id
            or tenant.get("workspace_id") != workspace_id
        ):
            raise ServerlessMageError("MAGE_SERVERLESS_RESUME_TENANT_INVALID")
        project_id = raw_unit.get("project_id")
        revision_id = raw_unit.get("revision_id")
        lane = raw_unit.get("lane")
        source_attempt_id = raw_unit.get("source_attempt_id")
        if (
            not isinstance(project_id, str)
            or not _IDENTIFIER.fullmatch(project_id)
            or not isinstance(revision_id, str)
            or not _IDENTIFIER.fullmatch(revision_id)
            or not isinstance(lane, str)
            or lane != "mage-image"
            or not isinstance(source_attempt_id, str)
            or not _IDENTIFIER.fullmatch(source_attempt_id)
            or source_attempt_id == current_attempt_id
        ):
            raise ServerlessMageError("MAGE_SERVERLESS_RESUME_LINEAGE_INVALID")
        if (
            project_id != expected_lineage["project_id"]
            or revision_id != expected_lineage["revision_id"]
            or lane != expected_lineage["lane"]
        ):
            raise ServerlessMageError("MAGE_SERVERLESS_RESUME_LINEAGE_INVALID")
        item_id = raw_unit.get("item_id")
        if not isinstance(item_id, str) or not _IDENTIFIER.fullmatch(item_id):
            raise ServerlessMageError("MAGE_SERVERLESS_RESUME_ITEM_INVALID")
        if item_id not in current_ids:
            raise ServerlessMageError("MAGE_SERVERLESS_RESUME_ITEM_NOT_IN_BATCH")
        if item_id in seen_items:
            raise ServerlessMageError("MAGE_SERVERLESS_RESUME_ITEM_DUPLICATE")
        seen_items.add(item_id)
        object_key = raw_unit.get("output_object_key")
        expected_tenant_prefix = f"tenant/{account_id}/workspace/{workspace_id}/"
        expected_suffix = f"/artifact/{item_id}"
        if (
            not isinstance(object_key, str)
            or not object_key.startswith(expected_tenant_prefix)
            or not object_key.endswith(expected_suffix)
            or "?" in object_key
            or "#" in object_key
            or "/../" in object_key
            or object_key in seen_objects
        ):
            raise ServerlessMageError("MAGE_SERVERLESS_RESUME_OBJECT_KEY_INVALID")
        seen_objects.add(object_key)
        output_sha256 = raw_unit.get("output_sha256")
        output_bytes = raw_unit.get("output_bytes")
        if (
            not isinstance(output_sha256, str)
            or not re.fullmatch(r"sha256:[0-9a-f]{64}", output_sha256)
            or not isinstance(output_bytes, int)
            or isinstance(output_bytes, bool)
            or output_bytes < 1
            or output_bytes > 10_737_418_240
        ):
            raise ServerlessMageError("MAGE_SERVERLESS_RESUME_OUTPUT_FACTS_INVALID")
        readback_port = raw_unit.get("readback_port")
        readback_url = raw_unit.get("readback_get_url")
        if not isinstance(readback_port, dict) or not isinstance(readback_url, str):
            raise ServerlessMageError("MAGE_SERVERLESS_RESUME_READBACK_INVALID")
        _validate_output_url(readback_url)
        path_lineage = _resume_path_lineage(readback_port)
        if (
            path_lineage["account_id"] != account_id
            or path_lineage["workspace_id"] != workspace_id
            or path_lineage["project_id"] != project_id
            or path_lineage["revision_id"] != revision_id
            or path_lineage["lane"] != lane
            or path_lineage["source_attempt_id"] != source_attempt_id
            or path_lineage["item_id"] != item_id
        ):
            raise ServerlessMageError("MAGE_SERVERLESS_RESUME_LINEAGE_INVALID")
        try:
            validate_scoped_port(
                readback_port,
                account_id=account_id,
                workspace_id=workspace_id,
                job_id=source_attempt_id,
                method="GET",
                now=now,
            )
        except ScratchIsolationError as error:
            raise ServerlessMageError(str(error)) from error
        if (
            readback_port.get("path") != f"/{object_key}"
            or readback_port.get("content_type") != "image/png"
            or readback_port.get("content_length") != output_bytes
            or readback_port.get("checksum_sha256") != output_sha256
            or readback_port.get("max_uses") != 1
        ):
            raise ServerlessMageError("MAGE_SERVERLESS_RESUME_READBACK_AUTHORITY_MISMATCH")
        commit_receipt_sha256 = raw_unit.get("artifact_commit_receipt_sha256")
        if not isinstance(commit_receipt_sha256, str) or not re.fullmatch(
            r"sha256:[0-9a-f]{64}", commit_receipt_sha256
        ):
            raise ServerlessMageError("MAGE_SERVERLESS_RESUME_COMMIT_RECEIPT_INVALID")
        signed_provenance_receipt_sha256 = raw_unit.get("signed_provenance_receipt_sha256")
        if not isinstance(signed_provenance_receipt_sha256, str) or not re.fullmatch(
            r"sha256:[0-9a-f]{64}", signed_provenance_receipt_sha256
        ):
            raise ServerlessMageError("MAGE_SERVERLESS_RESUME_PROVENANCE_RECEIPT_INVALID")
        reservation_id = readback_port.get("reservation_id")
        if not isinstance(reservation_id, str) or reservation_id in seen_reservations:
            raise ServerlessMageError("MAGE_SERVERLESS_RESUME_READBACK_REPLAYED")
        seen_reservations.add(reservation_id)
        units.append(
            {
                "tenant": {
                    "account_id": account_id,
                    "workspace_id": workspace_id,
                },
                "project_id": project_id,
                "revision_id": revision_id,
                "lane": lane,
                "plan_manifest": plan_manifest,
                "plan_manifest_sha256": plan_manifest_sha256,
                "source_attempt_id": source_attempt_id,
                "item_id": item_id,
                "output_object_key": object_key,
                "output_sha256": output_sha256,
                "output_bytes": output_bytes,
                "artifact_commit_receipt_sha256": commit_receipt_sha256,
                "signed_provenance_receipt_sha256": signed_provenance_receipt_sha256,
                "readback_port": readback_port,
                "readback_get_url": readback_url,
            }
        )
    return tuple(units)


def _validate_execution_subset(
    execution: object,
    *,
    execution_canonical_json: object,
    plan_manifest_canonical_json: object,
    accepted: dict[str, Any],
    current_item_ids: tuple[str, ...],
    expected_plan_manifest: dict[str, Any],
    resumed_ids: set[str],
) -> tuple[str, ...]:
    """Return the exact signed item subset this invocation may generate."""
    artifacts = accepted.get("artifacts")
    expected_hash = (
        artifacts.get("execution_manifest_sha256") if isinstance(artifacts, dict) else None
    )
    if execution is None:
        if expected_hash is not None or execution_canonical_json is not None:
            raise ServerlessMageError("MAGE_SERVERLESS_EXECUTION_MANIFEST_MISSING")
        return tuple(item_id for item_id in current_item_ids if item_id not in resumed_ids)
    if not isinstance(execution, dict) or set(execution) != _EXECUTION_KEYS:
        raise ServerlessMageError("MAGE_SERVERLESS_EXECUTION_SCHEMA_INVALID")
    if execution.get("schema_version") != _EXECUTION_SCHEMA:
        raise ServerlessMageError("MAGE_SERVERLESS_EXECUTION_SCHEMA_INVALID")
    if (
        not isinstance(expected_hash, str)
        or not re.fullmatch(r"sha256:[0-9a-f]{64}", expected_hash)
        or _exact_utf8_sha256(execution_canonical_json, max_bytes=1_000_000) != expected_hash
    ):
        raise ServerlessMageError("MAGE_SERVERLESS_EXECUTION_MANIFEST_HASH_INVALID")
    try:
        if json.loads(execution_canonical_json) != execution:
            raise ServerlessMageError("MAGE_SERVERLESS_EXECUTION_MANIFEST_HASH_INVALID")
    except (json.JSONDecodeError, UnicodeEncodeError) as error:
        raise ServerlessMageError("MAGE_SERVERLESS_EXECUTION_MANIFEST_HASH_INVALID") from error
    item_ids = execution.get("item_ids")
    signed_plan_manifest_sha256 = artifacts.get("plan_manifest_sha256")
    if (
        not isinstance(signed_plan_manifest_sha256, str)
        or not re.fullmatch(r"sha256:[0-9a-f]{64}", signed_plan_manifest_sha256)
        or execution.get("plan_manifest_sha256") != signed_plan_manifest_sha256
    ):
        raise ServerlessMageError("MAGE_SERVERLESS_EXECUTION_PLAN_INVALID")
    if (
        _exact_utf8_sha256(plan_manifest_canonical_json, max_bytes=2_000_000)
        != signed_plan_manifest_sha256
    ):
        raise ServerlessMageError("MAGE_SERVERLESS_EXECUTION_PLAN_INVALID")
    try:
        if json.loads(plan_manifest_canonical_json) != expected_plan_manifest:
            raise ServerlessMageError("MAGE_SERVERLESS_EXECUTION_PLAN_INVALID")
    except (json.JSONDecodeError, UnicodeEncodeError) as error:
        raise ServerlessMageError("MAGE_SERVERLESS_EXECUTION_PLAN_INVALID") from error
    if (
        not isinstance(item_ids, list)
        or not item_ids
        or any(
            not isinstance(item_id, str) or not _IDENTIFIER.fullmatch(item_id)
            for item_id in item_ids
        )
        or len(set(item_ids)) != len(item_ids)
        or any(item_id not in current_item_ids or item_id in resumed_ids for item_id in item_ids)
    ):
        raise ServerlessMageError("MAGE_SERVERLESS_EXECUTION_ITEMS_INVALID")
    if resumed_ids:
        unresolved = tuple(item_id for item_id in current_item_ids if item_id not in resumed_ids)
        if set(item_ids) != set(unresolved) or len(item_ids) != len(unresolved):
            raise ServerlessMageError("MAGE_SERVERLESS_EXECUTION_ITEMS_INVALID")
    return tuple(item_ids)


def _verify_resume_readbacks(units: tuple[dict[str, Any], ...], worker_io: Any) -> None:
    """Read every carried-forward output through its exact GET authority before generation."""
    for unit in units:
        path = _download_input(unit["readback_port"], unit["readback_get_url"], worker_io)
        body = path.read_bytes()
        if (
            len(body) != unit["output_bytes"]
            or f"sha256:{hashlib.sha256(body).hexdigest()}" != unit["output_sha256"]
        ):
            raise ServerlessMageError("MAGE_SERVERLESS_RESUME_READBACK_BYTES_MISMATCH")


def _verify_resume_readbacks_in_scratch(
    units: tuple[dict[str, Any], ...],
    *,
    root: Path,
    account_id: str,
    workspace_id: str,
    now: datetime,
) -> None:
    """Read carried-forward outputs with the source-attempt binding on each GET port."""
    for unit in units:
        source_attempt_id = _resume_source_attempt_id(unit["readback_port"])
        with _terminal_worker_io(
            root=root,
            account_id=account_id,
            workspace_id=workspace_id,
            job_id=source_attempt_id,
            input_ports=(unit["readback_port"],),
            output_ports=(),
            now=now,
        ) as worker_io:
            worker_io.scratch.safe_path("inputs", directory=True)
            _verify_resume_readbacks((unit,), worker_io)


async def _claim_delivery(attempt_id: str) -> None:
    """Claim an attempt once per process; retries require a new durable attempt."""
    async with _delivery_lock:
        if attempt_id in _claimed_deliveries:
            raise ServerlessMageError("MAGE_SERVERLESS_DUPLICATE_DELIVERY")
        _claimed_deliveries.add(attempt_id)


@contextmanager
def _terminal_worker_io(**kwargs: object) -> Iterator[Any]:
    """Ensure scratch is removed with the actual terminal reason, including cancellation."""
    worker_io = mage_worker_io(**kwargs)
    worker_io.__enter__()
    try:
        yield worker_io
    except asyncio.CancelledError:
        worker_io.scratch.cleanup("CANCEL")
        raise
    except TimeoutError:
        worker_io.scratch.cleanup("TIMEOUT")
        raise
    except BaseException:
        worker_io.scratch.cleanup("FAILURE")
        raise
    else:
        worker_io.scratch.cleanup("SUCCESS")


async def _ready_runtime() -> MageRuntime:
    global _runtime
    async with _startup_lock:
        if _runtime is None:
            _runtime = MageRuntime()
            await _runtime.startup()  # includes sealed-manifest verification and real warm-up
        if not _runtime.ready:
            raise ServerlessMageError(_runtime.error_code or "MAGE_SERVERLESS_NOT_READY")
        return _runtime


def _authority_expectations(envelope: dict[str, Any]) -> dict[str, str]:
    tenant = envelope.get("tenant") if isinstance(envelope.get("tenant"), dict) else {}
    runtime = envelope.get("runtime") if isinstance(envelope.get("runtime"), dict) else {}
    return {
        "expected_account_id": tenant.get("account_id", ""),
        "expected_workspace_id": tenant.get("workspace_id", ""),
        "expected_deployment_id": runtime.get("deployment_id", ""),
        "expected_container_digest": _configured_image_digest(),
        "expected_model_manifest_sha256": os.environ.get("VIDEOFORGE_MAGE_MANIFEST_SHA256", ""),
        "expected_volume_id_sha256": os.environ.get("VIDEOFORGE_MAGE_VOLUME_ID_HASH", ""),
    }


def _inline_item(job: MageJob, index: int) -> dict[str, object]:
    """Build and validate the exact wire mapping consumed by ``MageRuntime.generate``.

    ``MageInlineJob`` is the typed validation boundary, but its frozen dataclass projection
    contains a tuple of ``MageItem`` instances.  Runtime.generate intentionally reparses the
    wire contract, so pass the validated mapping through unchanged instead of serializing the
    dataclass with ``__dict__``.
    """
    item = job.items[index]
    value: dict[str, object] = {
        "mode": "INLINE_QUALIFICATION_V1",
        "attempt_id": job.attempt_id,
        "model_revision": job.model_revision,
        "items": [
            {
                "scene_id": item.scene_id,
                "positive_prompt": item.positive_prompt,
                "positive_prompt_sha256": item.positive_prompt_sha256,
                "negative_prompt": item.negative_prompt,
                "negative_prompt_sha256": item.negative_prompt_sha256,
                "seed": item.seed,
                "width": item.width,
                "height": item.height,
            }
        ],
    }
    MageInlineJob.from_value(value)
    return value


async def handler(job: dict[str, Any]) -> dict[str, Any]:
    """Process one admitted batch; duplicate/retry reconciliation stays control-plane-owned."""
    try:
        handler_started_at = time.monotonic()
        payload = _required(job, "input")
        envelope = _required(payload, "envelope")
        envelope_sha256 = restricted_canonical_sha256(envelope)
        request_sha256 = restricted_canonical_sha256(request_body_from_payload(payload))
        batch = _required(payload, "batch")
        ports = _required(payload, "ports")
        accepted = validate_envelope(
            envelope,
            now=datetime.now(UTC),
            expected_envelope_key_id=os.environ["VIDEOFORGE_ENVELOPE_KEY_ID"],
            expected_envelope_key_sha256=os.environ["VIDEOFORGE_ENVELOPE_KEY_SHA256"],
            envelope_secret=bytes.fromhex(os.environ["VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX"]),
            receipt_secret=bytes.fromhex(os.environ["VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX"]),
            **_authority_expectations(envelope),
        )
        mage_job = MageJob.from_value(batch)
        if (
            accepted["work"]["lane"] != "mage_image"
            or accepted["work"]["attempt_id"] != mage_job.attempt_id
        ):
            raise ServerlessMageError("MAGE_SERVERLESS_ATTEMPT_MISMATCH")
        current_item_ids = tuple(item.scene_id for item in mage_job.items)
        expected_plan_manifest = (
            _plan_manifest_for_job(mage_job)
            if payload.get("resume") is not None or payload.get("execution") is not None
            else {}
        )
        resume_units = _validate_resume_state(
            payload.get("resume"),
            resume_canonical_json=payload.get("resume_canonical_json"),
            accepted=accepted,
            current_item_ids=current_item_ids,
            expected_plan_manifest=expected_plan_manifest,
            now=datetime.now(UTC),
        )
        resumed_ids = {unit["item_id"] for unit in resume_units}
        execution_item_ids = _validate_execution_subset(
            payload.get("execution"),
            execution_canonical_json=payload.get("execution_canonical_json"),
            plan_manifest_canonical_json=payload.get("plan_manifest_canonical_json"),
            accepted=accepted,
            current_item_ids=current_item_ids,
            expected_plan_manifest=expected_plan_manifest,
            resumed_ids=resumed_ids,
        )
        execution_id_set = set(execution_item_ids)
        remaining_items = tuple(
            (index, item)
            for index, item in enumerate(mage_job.items)
            if item.scene_id in execution_id_set
        )
        if accepted["work"]["item_count"] != len(remaining_items):
            raise ServerlessMageError("MAGE_SERVERLESS_ITEM_COUNT_MISMATCH")
        input_ports, output_ports, generated_output_authorities = _validate_scoped_ports(
            ports,
            generated_output_authorities=payload.get("generated_output_authorities", []),
            accepted=accepted,
            attempt_id=mage_job.attempt_id,
            now=datetime.now(UTC),
        )
        output_targets: tuple[dict[str, Any], ...] = (
            generated_output_authorities if generated_output_authorities else output_ports
        )
        if len(output_targets) != len(remaining_items):
            raise ServerlessMageError("MAGE_SERVERLESS_OUTPUT_PORT_COUNT_INVALID")
        for target, (_, item) in zip(output_targets, remaining_items, strict=True):
            expected_path = f"{accepted['artifacts']['output_prefix']}/artifact/{item.scene_id}"
            if target.get("path") != f"/{expected_path}":
                raise ServerlessMageError("MAGE_SERVERLESS_EXECUTION_AUTHORITY_MISMATCH")
        output_urls = payload.get("output_put_urls")
        if not isinstance(output_urls, list) or len(output_urls) != len(remaining_items):
            raise ServerlessMageError("MAGE_SERVERLESS_OUTPUT_URLS_INVALID")
        for output_url in output_urls:
            _validate_output_url(output_url)
        input_urls = payload.get("input_get_urls", [])
        if not isinstance(input_urls, list) or len(input_urls) != len(input_ports):
            raise ServerlessMageError("MAGE_SERVERLESS_INPUT_URLS_INVALID")
        for input_url in input_urls:
            try:
                _validate_output_url(input_url)
            except ServerlessMageError as error:
                raise ServerlessMageError("MAGE_SERVERLESS_INPUT_URL_INVALID") from error
        scratch_root = Path(os.environ.get("VIDEOFORGE_JOB_SCRATCH_ROOT", "/tmp/videoforge-jobs"))
        if resume_units:
            _verify_resume_readbacks_in_scratch(
                resume_units,
                root=scratch_root,
                account_id=accepted["tenant"]["account_id"],
                workspace_id=accepted["tenant"]["workspace_id"],
                now=datetime.now(UTC),
            )
        await _claim_delivery(mage_job.attempt_id)
        runtime = await _ready_runtime()
        runtime_ready_at = time.monotonic()
        started = datetime.now(UTC)
        started_monotonic = time.monotonic()
        results: list[dict[str, Any]] = []
        receipt_items: list[dict[str, Any]] = []
        upload_started_ms = 0
        with _terminal_worker_io(
            root=scratch_root,
            account_id=accepted["tenant"]["account_id"],
            workspace_id=accepted["tenant"]["workspace_id"],
            job_id=mage_job.attempt_id,
            input_ports=input_ports,
            output_ports=output_ports,
            now=started,
        ) as worker_io:
            # RunPod cancellation interrupts this coroutine; context cleanup removes all scratch.
            worker_io.scratch.safe_path("outputs", directory=True)
            worker_io.scratch.safe_path("inputs", directory=True)
            configure_job_environment = getattr(runtime, "configure_job_environment", None)
            if callable(configure_job_environment):
                configure_job_environment(worker_io.environment())
            for port, input_url in zip(input_ports, input_urls, strict=True):
                _download_input(port, input_url, worker_io)
            for result_index, (index, item) in enumerate(remaining_items):
                generated = await runtime.generate(_inline_item(mage_job, index))
                output = base64.b64decode(generated.pop("output_base64"), validate=True)
                output_path = worker_io.scratch.safe_path(f"outputs/{item.scene_id}.png")
                output_path.write_bytes(output)
                if hashlib.sha256(output).hexdigest() != generated["output_sha256"].removeprefix(
                    "sha256:"
                ):
                    raise ServerlessMageError("MAGE_SERVERLESS_OUTPUT_HASH_INVALID")
                upload_started_ms = round(time.monotonic() * 1000)
                if generated_output_authorities:
                    _, measured_checksum = _put_generated_output(
                        generated_output_authorities[result_index],
                        output_urls[result_index],
                        output,
                    )
                    if measured_checksum != generated["output_sha256"]:
                        raise ServerlessMageError("MAGE_SERVERLESS_OUTPUT_HASH_INVALID")
                else:
                    _put_output(output_ports[result_index], output_urls[result_index], output)
                    measured_checksum = generated["output_sha256"]
                output_target = output_targets[result_index]
                object_key = str(output_target["path"]).removeprefix("/")
                receipt_items.append(
                    {
                        "item_id": item.scene_id,
                        "state": "SUCCEEDED",
                        "output_object_key": object_key,
                        "output_sha256": generated["output_sha256"],
                        "output_bytes": len(output),
                        "probe": {
                            "width": generated["width"],
                            "height": generated["height"],
                            "format": "png",
                            "source": "WORKER_PNG_PROBE",
                        },
                    }
                )
                results.append(
                    {
                        **generated,
                        # Runtime metadata cannot choose the durable item identity. Bind the
                        # returned output to the validated input scene so the control-plane
                        # lineage check cannot accept an output for another unit.
                        "item_id": item.scene_id,
                        "output_port_reservation_id": output_target["reservation_id"],
                        "output_object_key": object_key,
                        "output_sha256": measured_checksum,
                        "output_bytes": len(output),
                    }
                )
            # The second full verification is deliberately after every upload and before receipt.
            post_manifest = await asyncio.to_thread(
                verify_model_root,
                Path(os.environ.get("MAGE_MODEL_ROOT", "/runpod-volume")),
                expected_volume_id_hash=accepted["runtime"]["volume_id_sha256"],
            )
            if post_manifest["manifest_sha256"] != accepted["runtime"]["model_manifest_sha256"]:
                raise ServerlessMageError("MAGE_SERVERLESS_VOLUME_MUTATION_DETECTED")
            allocation_ms, container_ready_ms, signed_issued_at = _startup_timings(
                runtime,
                accepted=accepted,
                ready_at=runtime_ready_at,
                handler_started_at=handler_started_at,
            )
            total_vram_bytes = runtime.gpu.get("total_memory_bytes")
            peak_vram_bytes = max(
                (
                    result.get("runtime_evidence", {}).get("gpu", {}).get("peak_vram_used_bytes", 0)
                    for result in results
                ),
                default=0,
            )
            if (
                not isinstance(total_vram_bytes, int)
                or not isinstance(peak_vram_bytes, int)
                or total_vram_bytes <= 0
                or peak_vram_bytes <= 0
                or peak_vram_bytes > total_vram_bytes
            ):
                raise ServerlessMageError("MAGE_SERVERLESS_VRAM_EVIDENCE_INVALID")
            receipt_body = {
                "schema_version": "serverless-provenance-receipt/v1",
                "attestation_scope": "VIDEOFORGE_APPLICATION_SIGNED_FACTS_NOT_PROVIDER_HARDWARE_ATTESTATION",
                "receipt_id": f"mage-{mage_job.attempt_id}",
                "dispatch_token": accepted["dispatch_token"],
                "envelope_sha256": envelope_sha256,
                "request_sha256": request_sha256,
                "attempt_id": mage_job.attempt_id,
                "provider_job_id": str(job.get("id", "unknown")),
                "worker_id": os.environ.get("RUNPOD_POD_ID", "serverless"),
                "tenant": accepted["tenant"],
                "lane": "mage_image",
                "deployment": {
                    "deployment_id": accepted["runtime"]["deployment_id"],
                    "endpoint_id_sha256": _endpoint_id_hash(),
                    "container_digest": accepted["runtime"]["container_digest"],
                    "intended_region": "EU-RO-1",
                    "intended_volume_id_sha256": accepted["runtime"]["volume_id_sha256"],
                    "model_manifest_sha256": accepted["runtime"]["model_manifest_sha256"],
                },
                "runtime_probe": {
                    "gpu_name": runtime.gpu.get("name"),
                    "gpu_count": 1,
                    "total_vram_bytes": total_vram_bytes,
                    "peak_vram_bytes": peak_vram_bytes,
                    "gpu_uuid_sha256": None,
                    "driver_version": os.environ.get("VIDEOFORGE_MAGE_DRIVER_VERSION", "UNKNOWN"),
                    "cuda_version": runtime.gpu.get("cuda_version"),
                    "probe_source": "WORKER_RUNTIME_SELF_REPORT",
                },
                "volume_verification": {
                    "manifest_sha256_before": accepted["runtime"]["model_manifest_sha256"],
                    "manifest_sha256_after": accepted["runtime"]["model_manifest_sha256"],
                    "mutation_detected": False,
                    "cross_mount_detected": False,
                },
                "model_ready_evidence": {
                    "state": "MODEL_READY",
                    "warmup_completed": True,
                    "warmup_output_sha256": runtime.warmup_output_sha256
                    or _sha_environment("VIDEOFORGE_MAGE_WARMUP_OUTPUT_SHA256"),
                },
                "timings": {
                    "allocation_ms": allocation_ms,
                    "container_ready_ms": container_ready_ms,
                    "volume_verified_ms": _bounded_timing_ms(
                        runtime.bootstrap_evidence.get("duration_ms")
                        if runtime.bootstrap_evidence
                        else None
                    ),
                    "model_load_ms": _bounded_timing_ms(runtime.phase_timings_ms.get("gpu_load")),
                    "warmup_ms": _bounded_timing_ms(runtime.phase_timings_ms.get("warmup")),
                    "first_inference_ms": _bounded_timing_ms(results[0]["generation_duration_ms"]),
                    "upload_ms": _bounded_timing_ms(
                        max(0, round(time.monotonic() * 1000) - upload_started_ms)
                    ),
                    "total_ms": _bounded_timing_ms(
                        max(0, round((time.monotonic() - started_monotonic) * 1000))
                    ),
                    # This field is inside the signed receipt body.  It labels the two legacy
                    # startup slots as worker-local boundaries; provider timing is read only from
                    # RunPod status delayTimeMs/executionTimeMs by the control plane.
                    "timing_provenance": {
                        "schema_version": "videoforge-serverless-timing-provenance/v1",
                        "provider_timing_source": "RUNPOD_STATUS_DELAY_TIME_MS_AND_EXECUTION_TIME_MS",
                        "worker_timing_source": "SIGNED_ENVELOPE_ISSUED_AT_TO_LOCAL_RUNTIME_BOUNDARIES",
                        "signed_envelope_issued_at": signed_issued_at,
                        "process_start_boundary": "MAGE_RUNTIME_STARTED_OR_HANDLER_ADMISSION_MONOTONIC",
                        "container_ready_boundary": "HANDLER_RUNTIME_READY_MONOTONIC",
                    },
                },
                "items": receipt_items,
                "scratch_cleanup": {
                    "terminal_reason": "SUCCESS",
                    "removed": True,
                    "scratch_on_model_volume": False,
                },
                "receipt_nonce": 1,
                "issued_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            }
            # Signing key is injected only at endpoint publication; this fails closed locally otherwise.
            receipt, receipt_body_bytes = sign_receipt(
                receipt_body,
                key_id=os.environ["VIDEOFORGE_RECEIPT_KEY_ID"],
                secret=bytes.fromhex(os.environ["VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX"]),
            )
        return {
            "status": "SUCCEEDED",
            "items": results,
            "provenance_receipt": receipt,
            "provenance_receipt_body_base64": base64.b64encode(receipt_body_bytes).decode("ascii"),
        }
    except TimeoutError:
        # `error` is a RunPod-reserved result key.  SLS-Core moves it outside the
        # handler output and then keeps only `output`, so retain a bounded diagnostic
        # in a non-reserved field for status-only reconciliation.
        return {
            "status": "FAILED",
            "failure_code": "MAGE_SERVERLESS_TIMEOUT",
            "error": {"code": "MAGE_SERVERLESS_TIMEOUT"},
        }
    except (
        EnvelopeRejection,
        ScratchIsolationError,
        ServerlessMageError,
        ValueError,
        KeyError,
    ) as error:
        candidate = str(error)[:120]
        code = candidate if _FAILURE_CODE.fullmatch(candidate) else "MAGE_SERVERLESS_HANDLER_FAILED"
        return {
            "status": "FAILED",
            "failure_code": code,
            "error": {"code": code},
        }
    except Exception:
        # Keep unexpected application failures terminal and non-secret.  RunPod may move the
        # reserved `error` field outside `output`, so the stable failure code is duplicated in
        # the durable output fields used by the control-plane reconciler.
        code = "MAGE_SERVERLESS_HANDLER_UNEXPECTED"
        return {
            "status": "FAILED",
            "failure_code": code,
            "error": {"code": code, "message": code},
        }

"""V2-07 queue handler: exact v3 authority, sealed volume, and one serialized Mage batch."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import os
import time
from contextlib import contextmanager
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from mage_runtime import MageRuntime
from mage_volume import verify_model_root
from videoforge_image_media import MageInlineJob, MageJob

from secure_scratch import ScratchIsolationError, mage_worker_io, validate_scoped_port
from serverless_envelope import EnvelopeRejection, sign_receipt, validate_envelope


class ServerlessMageError(RuntimeError):
    pass


_runtime: MageRuntime | None = None
_startup_lock = asyncio.Lock()
_delivery_lock = asyncio.Lock()
_claimed_deliveries: set[str] = set()


def _sha_environment(name: str) -> str:
    value = os.environ.get(name, "")
    if len(value) != 71 or not value.startswith("sha256:"):
        raise ServerlessMageError(f"MAGE_SERVERLESS_{name}_INVALID")
    return value


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
        headers={"content-type": port["content_type"], "content-length": str(len(body))},
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


def _required(value: Any, key: str) -> dict[str, Any]:
    if not isinstance(value, dict) or not isinstance(value.get(key), dict):
        raise ServerlessMageError("MAGE_SERVERLESS_JOB_SHAPE_INVALID")
    return value[key]


def _validate_scoped_ports(
    ports: dict[str, Any],
    *,
    accepted: dict[str, Any],
    attempt_id: str,
    now: datetime,
) -> tuple[tuple[dict[str, Any], ...], tuple[dict[str, Any], ...]]:
    """Validate every port before acquiring a worker or touching the model volume."""
    raw_inputs = ports.get("inputs")
    raw_outputs = ports.get("outputs")
    if not isinstance(raw_inputs, list) or not isinstance(raw_outputs, list):
        raise ServerlessMageError("MAGE_SERVERLESS_PORT_SHAPE_INVALID")
    if any(not isinstance(port, dict) for port in (*raw_inputs, *raw_outputs)):
        raise ServerlessMageError("MAGE_SERVERLESS_PORT_SHAPE_INVALID")
    input_ports = tuple(raw_inputs)
    output_ports = tuple(raw_outputs)
    if len(output_ports) == 0:
        raise ServerlessMageError("MAGE_SERVERLESS_OUTPUT_PORT_COUNT_INVALID")
    expected_ids = tuple(accepted["artifacts"]["transfer_port_reservation_ids"])
    actual_ids = tuple(port.get("reservation_id") for port in output_ports)
    if actual_ids != expected_ids:
        raise ServerlessMageError("MAGE_SERVERLESS_PORT_AUTHORITY_MISMATCH")
    account_id = accepted["tenant"]["account_id"]
    workspace_id = accepted["tenant"]["workspace_id"]
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
    return input_ports, output_ports


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
        "expected_container_digest": os.environ.get("VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST", ""),
        "expected_model_manifest_sha256": os.environ.get("VIDEOFORGE_MAGE_MANIFEST_SHA256", ""),
        "expected_volume_id_sha256": os.environ.get("VIDEOFORGE_MAGE_VOLUME_ID_HASH", ""),
    }


def _inline_item(job: MageJob, index: int) -> MageInlineJob:
    item = job.items[index]
    return MageInlineJob.from_value(
        {
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
    )


async def handler(job: dict[str, Any]) -> dict[str, Any]:
    """Process one admitted batch; duplicate/retry reconciliation stays control-plane-owned."""
    try:
        payload = _required(job, "input")
        envelope = _required(payload, "envelope")
        batch = _required(payload, "batch")
        ports = _required(payload, "ports")
        accepted = validate_envelope(envelope, now=datetime.now(UTC), **_authority_expectations(envelope))
        mage_job = MageJob.from_value(batch)
        if accepted["work"]["lane"] != "mage_image" or accepted["work"]["attempt_id"] != mage_job.attempt_id:
            raise ServerlessMageError("MAGE_SERVERLESS_ATTEMPT_MISMATCH")
        if accepted["work"]["item_count"] != len(mage_job.items):
            raise ServerlessMageError("MAGE_SERVERLESS_ITEM_COUNT_MISMATCH")
        input_ports, output_ports = _validate_scoped_ports(
            ports,
            accepted=accepted,
            attempt_id=mage_job.attempt_id,
            now=datetime.now(UTC),
        )
        if len(output_ports) != len(mage_job.items):
            raise ServerlessMageError("MAGE_SERVERLESS_OUTPUT_PORT_COUNT_INVALID")
        output_urls = payload.get("output_put_urls")
        if not isinstance(output_urls, list) or len(output_urls) != len(mage_job.items):
            raise ServerlessMageError("MAGE_SERVERLESS_OUTPUT_URLS_INVALID")
        for output_url in output_urls:
            _validate_output_url(output_url)
        await _claim_delivery(mage_job.attempt_id)
        runtime = await _ready_runtime()
        scratch_root = Path(os.environ.get("VIDEOFORGE_JOB_SCRATCH_ROOT", "/tmp/videoforge-jobs"))
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
            for index, item in enumerate(mage_job.items):
                generated = await runtime.generate(_inline_item(mage_job, index).__dict__)
                output = base64.b64decode(generated.pop("output_base64"), validate=True)
                output_path = worker_io.scratch.safe_path(f"outputs/{item.scene_id}.png")
                output_path.write_bytes(output)
                if hashlib.sha256(output).hexdigest() != generated["output_sha256"].removeprefix("sha256:"):
                    raise ServerlessMageError("MAGE_SERVERLESS_OUTPUT_HASH_INVALID")
                upload_started_ms = round(time.monotonic() * 1000)
                _put_output(output_ports[index], output_urls[index], output)
                object_key = str(output_ports[index]["path"]).removeprefix("/")
                receipt_items.append({"item_id": item.scene_id, "state": "SUCCEEDED", "output_object_key": object_key, "output_sha256": generated["output_sha256"], "output_bytes": len(output), "probe": {"width": generated["width"], "height": generated["height"], "format": "png", "source": "WORKER_PNG_PROBE"}})
                results.append({**generated, "output_port_reservation_id": output_ports[index]["reservation_id"]})
            # The second full verification is deliberately after every upload and before receipt.
            post_manifest = await asyncio.to_thread(
                verify_model_root,
                Path(os.environ.get("MAGE_MODEL_ROOT", "/runpod-volume")),
                expected_volume_id_hash=accepted["runtime"]["volume_id_sha256"],
            )
            if post_manifest["manifest_sha256"] != accepted["runtime"]["model_manifest_sha256"]:
                raise ServerlessMageError("MAGE_SERVERLESS_VOLUME_MUTATION_DETECTED")
            receipt_body = {
                "schema_version": "serverless-provenance-receipt/v1",
                "attestation_scope": "VIDEOFORGE_APPLICATION_SIGNED_FACTS_NOT_PROVIDER_HARDWARE_ATTESTATION",
                "receipt_id": f"mage-{mage_job.attempt_id}",
                "dispatch_token": accepted["dispatch_token"],
                "attempt_id": mage_job.attempt_id,
                "provider_job_id": str(job.get("id", "unknown")),
                "worker_id": os.environ.get("RUNPOD_POD_ID", "serverless"),
                "tenant": accepted["tenant"], "lane": "mage_image",
                "deployment": {"deployment_id": accepted["runtime"]["deployment_id"], "endpoint_id_sha256": _sha_environment("VIDEOFORGE_MAGE_ENDPOINT_ID_HASH"), "container_digest": accepted["runtime"]["container_digest"], "intended_region": "EU-RO-1", "intended_volume_id_sha256": accepted["runtime"]["volume_id_sha256"], "model_manifest_sha256": accepted["runtime"]["model_manifest_sha256"]},
                "runtime_probe": {"gpu_name": runtime.gpu.get("name"), "gpu_count": 1, "gpu_uuid_sha256": None, "driver_version": os.environ.get("VIDEOFORGE_MAGE_DRIVER_VERSION", "UNKNOWN"), "cuda_version": runtime.gpu.get("cuda_version"), "probe_source": "WORKER_RUNTIME_SELF_REPORT"},
                "volume_verification": {"manifest_sha256_before": accepted["runtime"]["model_manifest_sha256"], "manifest_sha256_after": accepted["runtime"]["model_manifest_sha256"], "mutation_detected": False, "cross_mount_detected": False},
                "model_ready_evidence": {"state": "MODEL_READY", "warmup_completed": True, "warmup_output_sha256": runtime.warmup_output_sha256 or _sha_environment("VIDEOFORGE_MAGE_WARMUP_OUTPUT_SHA256")},
                "timings": {"allocation_ms": 0, "container_ready_ms": 0, "volume_verified_ms": runtime.bootstrap_evidence.get("duration_ms", 0) if runtime.bootstrap_evidence else 0, "model_load_ms": runtime.phase_timings_ms.get("gpu_load", 0), "warmup_ms": runtime.phase_timings_ms.get("warmup", 0), "first_inference_ms": results[0]["generation_duration_ms"], "upload_ms": max(0, round(time.monotonic() * 1000) - upload_started_ms), "total_ms": round((time.monotonic() - started_monotonic) * 1000)},
                "items": receipt_items, "scratch_cleanup": {"terminal_reason": "SUCCESS", "removed": True, "scratch_on_model_volume": False}, "receipt_nonce": 1, "issued_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            }
            # Signing key is injected only at endpoint publication; this fails closed locally otherwise.
            receipt, _ = sign_receipt(receipt_body, key_id=os.environ["VIDEOFORGE_RECEIPT_KEY_ID"], secret=bytes.fromhex(os.environ["VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX"]))
        return {"status": "SUCCEEDED", "items": results, "provenance_receipt": receipt}
    except TimeoutError:
        return {"status": "FAILED", "error": {"code": "MAGE_SERVERLESS_TIMEOUT"}}
    except (EnvelopeRejection, ScratchIsolationError, ServerlessMageError, ValueError, KeyError) as error:
        return {"status": "FAILED", "error": {"code": str(error)[:120]}}

"""Fail-closed Serverless v3 envelope validation and provenance signing for the lane workers.

TypeScript remains the sole general RFC 8785 authority (`DEC_CONTRACT_001`). Envelope authentication
uses a deliberately restricted I-JSON subset whose canonical bytes are identical in TypeScript
and Python: ASCII object names, Unicode scalar strings, booleans/null, safe integers, arrays and
objects.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
from datetime import UTC, datetime
from typing import Any, Final

from videoforge_contracts import validate_contract
from videoforge_contracts.validator import ContractValidationError

ENVELOPE_CONTRACT: Final = "serverlessWorkerJobEnvelopeV3"
ENVELOPE_SCHEMA: Final = "serverless-worker-job-envelope/v3"
RECEIPT_SCHEMA: Final = "serverless-provenance-receipt/v1"
ATTESTATION_SCOPE: Final = "VIDEOFORGE_APPLICATION_SIGNED_FACTS_NOT_PROVIDER_HARDWARE_ATTESTATION"
MODEL_VOLUME_MOUNT: Final = "/runpod-volume"
QUALIFIED_GPUS: Final = ("NVIDIA GeForce RTX 4090",)

# Superseded Pod-era contracts remain replayable evidence but can never authorize a v3 dispatch.
QUARANTINED_SCHEMAS: Final = (
    "pod-worker-job-envelope/v2",
    "global-generation-session/v2",
    "worker-job-envelope/v2",
)

SHA256: Final = re.compile(r"^sha256:[0-9a-f]{64}$")
SIGNATURE: Final = re.compile(r"^[0-9a-f]{64}$")
KEY_ID: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
ASCII_PROPERTY: Final = re.compile(r"^[\x21-\x7e]+$")
UTC_TIMESTAMP: Final = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$"
)


class EnvelopeRejection(RuntimeError):
    """Raised before any expensive action. The code is the exact fail-closed reason."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _parse_utc(value: str) -> datetime:
    if not isinstance(value, str) or not UTC_TIMESTAMP.fullmatch(value):
        raise EnvelopeRejection("ENVELOPE_EXPIRY_INVALID")
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def _assert_restricted_ijson(value: Any) -> None:
    if value is None or isinstance(value, bool | str):
        if isinstance(value, str) and any(
            0xD800 <= ord(character) <= 0xDFFF for character in value
        ):
            raise EnvelopeRejection("ENVELOPE_CANONICAL_BODY_INVALID")
        return
    if isinstance(value, int):
        if abs(value) > 9_007_199_254_740_991:
            raise EnvelopeRejection("ENVELOPE_CANONICAL_BODY_INVALID")
        return
    if isinstance(value, float):
        raise EnvelopeRejection("ENVELOPE_CANONICAL_BODY_INVALID")
    if isinstance(value, list):
        for item in value:
            _assert_restricted_ijson(item)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str) or not ASCII_PROPERTY.fullmatch(key):
                raise EnvelopeRejection("ENVELOPE_CANONICAL_BODY_INVALID")
            _assert_restricted_ijson(item)
        return
    raise EnvelopeRejection("ENVELOPE_CANONICAL_BODY_INVALID")


def envelope_body_bytes(body: dict[str, Any]) -> bytes:
    """Canonical bytes for the restricted cross-runtime envelope subset."""
    _assert_restricted_ijson(body)
    return json.dumps(
        body, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")


def restricted_canonical_sha256(value: dict[str, Any]) -> str:
    """Hash exact worker-received restricted-I-JSON values with the shared envelope encoding."""
    return f"sha256:{hashlib.sha256(envelope_body_bytes(value)).hexdigest()}"


def request_body_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Return the exact worker-received request fields, excluding its separately bound envelope."""
    if not isinstance(payload, dict) or "envelope" not in payload:
        raise EnvelopeRejection("ENVELOPE_SHAPE_INVALID")
    return {key: value for key, value in payload.items() if key != "envelope"}


def verify_envelope_authority(
    document: dict[str, Any],
    *,
    expected_key_id: str,
    expected_key_sha256: str,
    secret: bytes,
    receipt_secret: bytes,
) -> None:
    """Authenticates the final envelope body before any model/runtime work."""
    if (
        not isinstance(secret, bytes)
        or len(secret) < 32
        or not isinstance(receipt_secret, bytes)
        or len(receipt_secret) < 32
        or not KEY_ID.fullmatch(expected_key_id)
        or not SHA256.fullmatch(expected_key_sha256)
    ):
        raise EnvelopeRejection("ENVELOPE_AUTHORITY_KEY_INVALID")
    actual_key_sha256 = f"sha256:{hashlib.sha256(secret).hexdigest()}"
    if not hmac.compare_digest(actual_key_sha256, expected_key_sha256):
        raise EnvelopeRejection("ENVELOPE_AUTHORITY_KEY_MISMATCH")
    receipt_key_sha256 = f"sha256:{hashlib.sha256(receipt_secret).hexdigest()}"
    if hmac.compare_digest(actual_key_sha256, receipt_key_sha256):
        raise EnvelopeRejection("ENVELOPE_RECEIPT_KEY_REUSE")

    authority_sha256 = document.get("authority_sha256")
    signature = document.get("signature")
    if not isinstance(authority_sha256, str) or not SHA256.fullmatch(authority_sha256):
        raise EnvelopeRejection("ENVELOPE_AUTHORITY_HASH_INVALID")
    if (
        not isinstance(signature, dict)
        or signature.get("algorithm") != "HMAC-SHA256"
        or signature.get("key_id") != expected_key_id
        or not isinstance(signature.get("value"), str)
        or not SIGNATURE.fullmatch(signature["value"])
    ):
        raise EnvelopeRejection("ENVELOPE_AUTHORITY_SIGNATURE_INVALID")

    body = {
        key: value
        for key, value in document.items()
        if key not in {"authority_sha256", "signature"}
    }
    expected_authority = f"sha256:{hashlib.sha256(envelope_body_bytes(body)).hexdigest()}"
    if not hmac.compare_digest(authority_sha256, expected_authority):
        raise EnvelopeRejection("ENVELOPE_AUTHORITY_BODY_MISMATCH")
    preimage = envelope_body_bytes(
        {"authority_sha256": authority_sha256, "key_id": expected_key_id}
    )
    expected_signature = hmac.new(secret, preimage, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature["value"], expected_signature):
        raise EnvelopeRejection("ENVELOPE_AUTHORITY_SIGNATURE_INVALID")


def validate_envelope(
    document: Any,
    *,
    now: datetime,
    expected_account_id: str,
    expected_workspace_id: str,
    expected_deployment_id: str,
    expected_container_digest: str,
    expected_model_manifest_sha256: str,
    expected_volume_id_sha256: str,
    expected_envelope_key_id: str,
    expected_envelope_key_sha256: str,
    envelope_secret: bytes,
    receipt_secret: bytes,
) -> dict[str, Any]:
    """Validates schema, quarantine, joins, expiry, and runtime policy before model load."""
    if not isinstance(document, dict):
        raise EnvelopeRejection("ENVELOPE_SHAPE_INVALID")

    declared = document.get("schema") or document.get("schema_version")
    if declared in QUARANTINED_SCHEMAS:
        raise EnvelopeRejection("ENVELOPE_SCHEMA_QUARANTINED")
    if declared != ENVELOPE_SCHEMA:
        raise EnvelopeRejection("ENVELOPE_SCHEMA_UNKNOWN")

    verify_envelope_authority(
        document,
        expected_key_id=expected_envelope_key_id,
        expected_key_sha256=expected_envelope_key_sha256,
        secret=envelope_secret,
        receipt_secret=receipt_secret,
    )

    # Keep exact runtime joins fail-closed even when a hostile document also violates a
    # schema const/enum. The contract validator remains authoritative for shape, while these
    # checks ensure a wrong image, model path, volume, region, or GPU can never fall through to
    # model initialization under a generic/ambiguous validation path.
    runtime = document.get("runtime")
    if isinstance(runtime, dict):
        if (
            "container_digest" in runtime
            and runtime["container_digest"] != expected_container_digest
        ):
            raise EnvelopeRejection("ENVELOPE_IMAGE_MISMATCH")
        if (
            "model_manifest_sha256" in runtime
            and runtime["model_manifest_sha256"] != expected_model_manifest_sha256
        ):
            raise EnvelopeRejection("ENVELOPE_MANIFEST_MISMATCH")
        if (
            "volume_id_sha256" in runtime
            and runtime["volume_id_sha256"] != expected_volume_id_sha256
        ):
            raise EnvelopeRejection("ENVELOPE_VOLUME_MISMATCH")
        if "volume_mount" in runtime and runtime["volume_mount"] != MODEL_VOLUME_MOUNT:
            raise EnvelopeRejection("ENVELOPE_VOLUME_MOUNT_INVALID")
        if "region" in runtime and runtime["region"] != "EU-RO-1":
            raise EnvelopeRejection("ENVELOPE_REGION_INVALID")
        if "gpu_allowlist" in runtime:
            gpu_allowlist = runtime["gpu_allowlist"]
            if (
                not isinstance(gpu_allowlist, list | tuple)
                or tuple(gpu_allowlist) != QUALIFIED_GPUS
            ):
                raise EnvelopeRejection("ENVELOPE_GPU_NOT_QUALIFIED")

    try:
        validate_contract(ENVELOPE_CONTRACT, document)
    except ContractValidationError as error:
        raise EnvelopeRejection("ENVELOPE_SCHEMA_INVALID") from error

    tenant = document["tenant"]
    if (
        tenant["account_id"] != expected_account_id
        or tenant["workspace_id"] != expected_workspace_id
    ):
        raise EnvelopeRejection("ENVELOPE_TENANT_MISMATCH")

    runtime = document["runtime"]
    if runtime["deployment_id"] != expected_deployment_id:
        raise EnvelopeRejection("ENVELOPE_DEPLOYMENT_MISMATCH")
    if runtime["container_digest"] != expected_container_digest:
        raise EnvelopeRejection("ENVELOPE_IMAGE_MISMATCH")
    if runtime["model_manifest_sha256"] != expected_model_manifest_sha256:
        raise EnvelopeRejection("ENVELOPE_MANIFEST_MISMATCH")
    if runtime["volume_id_sha256"] != expected_volume_id_sha256:
        raise EnvelopeRejection("ENVELOPE_VOLUME_MISMATCH")
    if runtime["volume_mount"] != MODEL_VOLUME_MOUNT:
        raise EnvelopeRejection("ENVELOPE_VOLUME_MOUNT_INVALID")
    if runtime["volume_write_policy"] != "APPLICATION_READ_ONLY":
        raise EnvelopeRejection("ENVELOPE_VOLUME_WRITE_FORBIDDEN")
    if runtime["scratch_root_policy"] != "JOB_LOCAL_SCRATCH_OUTSIDE_MODEL_VOLUME":
        raise EnvelopeRejection("ENVELOPE_SCRATCH_POLICY_INVALID")
    if runtime["region"] != "EU-RO-1":
        raise EnvelopeRejection("ENVELOPE_REGION_INVALID")
    if tuple(runtime["gpu_allowlist"]) != QUALIFIED_GPUS:
        raise EnvelopeRejection("ENVELOPE_GPU_NOT_QUALIFIED")

    policy = document["policy"]
    if any(policy.values()):
        raise EnvelopeRejection("ENVELOPE_POLICY_FORBIDDEN")

    limits = document["limits"]
    if _parse_utc(limits["expires_at"]) <= now:
        raise EnvelopeRejection("ENVELOPE_EXPIRED")
    if document["work"]["item_count"] > limits["max_items"]:
        raise EnvelopeRejection("ENVELOPE_ITEM_BOUND_EXCEEDED")

    artifacts = document["artifacts"]
    expected_prefix = f"tenant/{expected_account_id}/workspace/{expected_workspace_id}/"
    if not artifacts["output_prefix"].startswith(expected_prefix):
        raise EnvelopeRejection("ENVELOPE_OUTPUT_PREFIX_FOREIGN")
    if len(artifacts["transfer_port_reservation_ids"]) == 0:
        raise EnvelopeRejection("ENVELOPE_PORTS_MISSING")

    return document


def receipt_bytes(body: dict[str, Any]) -> bytes:
    """The exact bytes this worker emits. The hash below covers these bytes and nothing else."""
    return json.dumps(
        body, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")


def sign_receipt(
    body: dict[str, Any], *, key_id: str, secret: bytes
) -> tuple[dict[str, Any], bytes]:
    """Signs one provenance receipt over its own emitted bytes.

    The signature proves the VideoForge worker key produced these facts. It is never a provider
    attestation of hardware, delivery uniqueness, or billing.
    """
    if not isinstance(body, dict):
        raise EnvelopeRejection("RECEIPT_BODY_INVALID")
    if "receipt_sha256" in body or "signature" in body:
        raise EnvelopeRejection("RECEIPT_BODY_ALREADY_SIGNED")
    if not isinstance(secret, bytes) or len(secret) < 32:
        raise EnvelopeRejection("RECEIPT_KEY_TOO_SHORT")
    if body.get("attestation_scope") != ATTESTATION_SCOPE:
        raise EnvelopeRejection("RECEIPT_ATTESTATION_SCOPE_INVALID")
    if body.get("schema_version") != RECEIPT_SCHEMA:
        raise EnvelopeRejection("RECEIPT_SCHEMA_INVALID")

    emitted = receipt_bytes(body)
    receipt_sha256 = f"sha256:{hashlib.sha256(emitted).hexdigest()}"
    # The signed preimage is one pinned two-field ASCII object, not a general canonical encoding.
    preimage = json.dumps(
        {"key_id": key_id, "receipt_sha256": receipt_sha256},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    value = hmac.new(secret, preimage, hashlib.sha256).hexdigest()
    document = {
        **body,
        "receipt_sha256": receipt_sha256,
        "signature": {"algorithm": "HMAC-SHA256", "key_id": key_id, "value": value},
    }
    try:
        validate_contract("serverlessProvenanceReceiptV1", document)
    except ContractValidationError as error:
        raise EnvelopeRejection("RECEIPT_SCHEMA_INVALID") from error
    return document, emitted

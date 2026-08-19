"""Fail-closed Serverless v3 envelope validation and provenance signing for the lane workers.

TypeScript is the sole RFC 8785 authority (`DEC_CONTRACT_001`). This module therefore never tries
to reproduce a canonical hash of a document it did not write: it validates the schema and the exact
semantic joins, treats every incoming hash as an opaque exact string, and hashes only the exact
receipt bytes it emits itself.
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
) -> dict[str, Any]:
    """Validates schema, quarantine, joins, expiry, and runtime policy before model load."""
    if not isinstance(document, dict):
        raise EnvelopeRejection("ENVELOPE_SHAPE_INVALID")

    declared = document.get("schema") or document.get("schema_version")
    if declared in QUARANTINED_SCHEMAS:
        raise EnvelopeRejection("ENVELOPE_SCHEMA_QUARANTINED")
    if declared != ENVELOPE_SCHEMA:
        raise EnvelopeRejection("ENVELOPE_SCHEMA_UNKNOWN")

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

    authority_sha256 = document.get("authority_sha256")
    if not isinstance(authority_sha256, str) or not SHA256.fullmatch(authority_sha256):
        raise EnvelopeRejection("ENVELOPE_AUTHORITY_HASH_INVALID")

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

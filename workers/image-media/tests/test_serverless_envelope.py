import copy
import hashlib
import hmac
import json
import sys
import unittest
from datetime import UTC, datetime
from pathlib import Path

COMMON = Path(__file__).resolve().parents[2] / "common"
sys.path.insert(0, str(COMMON))

from serverless_envelope import (  # noqa: E402
    ATTESTATION_SCOPE,
    ENVELOPE_SCHEMA,
    QUARANTINED_SCHEMAS,
    EnvelopeRejection,
    receipt_bytes,
    sign_receipt,
    validate_envelope,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPOSITORY_ROOT / "packages/contracts/generated/fixtures"
NOW = datetime(2026, 8, 16, 7, 0, 0, tzinfo=UTC)
SECRET = bytes([7]) * 32

EXPECTED = {
    "expected_account_id": "account-a",
    "expected_workspace_id": "workspace-a",
    "expected_deployment_id": "deployment-mage-1",
    "expected_container_digest": "sha256:" + ("3" * 64),
    "expected_model_manifest_sha256": "sha256:" + ("4" * 64),
    "expected_volume_id_sha256": "sha256:" + ("5" * 64),
}


def load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def envelope() -> dict:
    return load("serverless_worker_job_envelope_v3.valid.json")


def receipt_body() -> dict:
    document = load("serverless_provenance_receipt_v1.valid.json")
    document.pop("receipt_sha256")
    document.pop("signature")
    return document


class ValidateEnvelopeTest(unittest.TestCase):
    def test_accepts_the_exact_v3_envelope(self) -> None:
        accepted = validate_envelope(envelope(), now=NOW, **EXPECTED)
        self.assertEqual(accepted["schema"], ENVELOPE_SCHEMA)

    def test_rejects_every_superseded_pod_era_schema(self) -> None:
        for schema in QUARANTINED_SCHEMAS:
            document = envelope()
            document["schema"] = schema
            with self.assertRaises(EnvelopeRejection) as raised:
                validate_envelope(document, now=NOW, **EXPECTED)
            self.assertEqual(raised.exception.code, "ENVELOPE_SCHEMA_QUARANTINED")

    def test_rejects_a_real_pod_envelope_fixture(self) -> None:
        with self.assertRaises(EnvelopeRejection) as raised:
            validate_envelope(load("pod_worker_job_envelope.valid.json"), now=NOW, **EXPECTED)
        self.assertEqual(raised.exception.code, "ENVELOPE_SCHEMA_QUARANTINED")

    def test_fails_closed_on_every_binding_mismatch(self) -> None:
        cases = {
            "ENVELOPE_TENANT_MISMATCH": lambda d: d["tenant"].update({"account_id": "account-b"}),
            "ENVELOPE_DEPLOYMENT_MISMATCH": lambda d: d["runtime"].update(
                {"deployment_id": "deployment-soulx-1"}
            ),
            "ENVELOPE_IMAGE_MISMATCH": lambda d: d["runtime"].update(
                {"container_digest": "sha256:" + ("9" * 64)}
            ),
            "ENVELOPE_MANIFEST_MISMATCH": lambda d: d["runtime"].update(
                {"model_manifest_sha256": "sha256:" + ("9" * 64)}
            ),
            "ENVELOPE_VOLUME_MISMATCH": lambda d: d["runtime"].update(
                {"volume_id_sha256": "sha256:" + ("9" * 64)}
            ),
            "ENVELOPE_OUTPUT_PREFIX_FOREIGN": lambda d: d["artifacts"].update(
                {"output_prefix": "tenant/account-b/workspace/workspace-b/project/p"}
            ),
        }
        for code, mutate in cases.items():
            document = envelope()
            mutate(document)
            with self.assertRaises(EnvelopeRejection) as raised:
                validate_envelope(document, now=NOW, **EXPECTED)
            self.assertEqual(raised.exception.code, code)

    def test_rejects_wrong_runtime_path_region_and_gpu_before_schema_acceptance(self) -> None:
        cases = {
            "ENVELOPE_VOLUME_MOUNT_INVALID": lambda d: d["runtime"].update(
                {"volume_mount": "/workspace/models"}
            ),
            "ENVELOPE_REGION_INVALID": lambda d: d["runtime"].update({"region": "US-KS-2"}),
            "ENVELOPE_GPU_NOT_QUALIFIED": lambda d: d["runtime"].update(
                {"gpu_allowlist": ["NVIDIA GeForce RTX 5090"]}
            ),
        }
        for code, mutate in cases.items():
            document = envelope()
            mutate(document)
            with self.assertRaises(EnvelopeRejection) as raised:
                validate_envelope(document, now=NOW, **EXPECTED)
            self.assertEqual(raised.exception.code, code)

    def test_rejects_malformed_authority_hash_before_any_runtime_action(self) -> None:
        for authority_hash in (
            "",
            "sha256:" + ("a" * 63),
            "SHA256:" + ("a" * 64),
            "sha256:" + ("a" * 64) + "\n",
        ):
            document = envelope()
            document["authority_sha256"] = authority_hash
            with self.assertRaises(EnvelopeRejection) as raised:
                validate_envelope(document, now=NOW, **EXPECTED)
            self.assertEqual(raised.exception.code, "ENVELOPE_AUTHORITY_HASH_INVALID")

    def test_rejects_volume_writes_pod_lifecycle_and_queue_purge(self) -> None:
        writable = envelope()
        writable["runtime"]["volume_write_policy"] = "READ_WRITE"
        with self.assertRaises(EnvelopeRejection) as raised:
            validate_envelope(writable, now=NOW, **EXPECTED)
        self.assertEqual(raised.exception.code, "ENVELOPE_SCHEMA_INVALID")

        for flag in (
            "model_download_permitted",
            "volume_mutation_permitted",
            "pod_lifecycle_permitted",
            "queue_purge_permitted",
        ):
            document = envelope()
            document["policy"][flag] = True
            with self.assertRaises(EnvelopeRejection) as raised:
                validate_envelope(document, now=NOW, **EXPECTED)
            self.assertEqual(raised.exception.code, "ENVELOPE_SCHEMA_INVALID")

    def test_rejects_an_unqualified_gpu_class(self) -> None:
        document = envelope()
        document["runtime"]["gpu_allowlist"] = ["NVIDIA GeForce RTX 5090"]
        with self.assertRaises(EnvelopeRejection) as raised:
            validate_envelope(document, now=NOW, **EXPECTED)
        self.assertEqual(raised.exception.code, "ENVELOPE_GPU_NOT_QUALIFIED")

    def test_rejects_an_expired_envelope_before_model_load(self) -> None:
        with self.assertRaises(EnvelopeRejection) as raised:
            validate_envelope(
                envelope(),
                now=datetime(2026, 8, 17, tzinfo=UTC),
                **EXPECTED,
            )
        self.assertEqual(raised.exception.code, "ENVELOPE_EXPIRED")


class SignReceiptTest(unittest.TestCase):
    def test_signs_over_its_own_emitted_bytes(self) -> None:
        body = receipt_body()
        document, emitted = sign_receipt(body, key_id="worker-key-1", secret=SECRET)

        # The hash covers exactly the bytes the worker wrote; nothing re-serializes them.
        self.assertEqual(
            document["receipt_sha256"],
            "sha256:" + hashlib.sha256(emitted).hexdigest(),
        )
        preimage = json.dumps(
            {"key_id": "worker-key-1", "receipt_sha256": document["receipt_sha256"]},
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        self.assertEqual(
            document["signature"]["value"],
            hmac.new(SECRET, preimage, hashlib.sha256).hexdigest(),
        )
        self.assertEqual(document["signature"]["algorithm"], "HMAC-SHA256")

    def test_signing_is_deterministic_and_tamper_evident(self) -> None:
        body = receipt_body()
        first, first_bytes = sign_receipt(body, key_id="worker-key-1", secret=SECRET)
        second, second_bytes = sign_receipt(
            copy.deepcopy(body), key_id="worker-key-1", secret=SECRET
        )
        self.assertEqual(first_bytes, second_bytes)
        self.assertEqual(first["receipt_sha256"], second["receipt_sha256"])

        tampered = copy.deepcopy(body)
        tampered["items"][0]["output_sha256"] = "sha256:" + ("b" * 64)
        third, _ = sign_receipt(tampered, key_id="worker-key-1", secret=SECRET)
        self.assertNotEqual(first["receipt_sha256"], third["receipt_sha256"])
        self.assertNotEqual(first["signature"]["value"], third["signature"]["value"])

    def test_refuses_to_claim_provider_hardware_attestation(self) -> None:
        body = receipt_body()
        body["attestation_scope"] = "RUNPOD_PROVIDER_HARDWARE_ATTESTATION"
        with self.assertRaises(EnvelopeRejection) as raised:
            sign_receipt(body, key_id="worker-key-1", secret=SECRET)
        self.assertEqual(raised.exception.code, "RECEIPT_ATTESTATION_SCOPE_INVALID")

        body["attestation_scope"] = ATTESTATION_SCOPE
        document, _ = sign_receipt(body, key_id="worker-key-1", secret=SECRET)
        self.assertEqual(document["attestation_scope"], ATTESTATION_SCOPE)

    def test_refuses_a_short_signing_key(self) -> None:
        with self.assertRaises(EnvelopeRejection) as raised:
            sign_receipt(receipt_body(), key_id="worker-key-1", secret=b"short")
        self.assertEqual(raised.exception.code, "RECEIPT_KEY_TOO_SHORT")

    def test_refuses_non_dict_or_already_signed_receipt_body(self) -> None:
        with self.assertRaises(EnvelopeRejection) as raised:
            sign_receipt([], key_id="worker-key-1", secret=SECRET)  # type: ignore[arg-type]
        self.assertEqual(raised.exception.code, "RECEIPT_BODY_INVALID")

        already_signed = receipt_body()
        already_signed["receipt_sha256"] = "sha256:" + ("a" * 64)
        with self.assertRaises(EnvelopeRejection) as raised:
            sign_receipt(already_signed, key_id="worker-key-1", secret=SECRET)
        self.assertEqual(raised.exception.code, "RECEIPT_BODY_ALREADY_SIGNED")

    def test_converts_malformed_receipt_identity_to_fail_closed_rejection(self) -> None:
        with self.assertRaises(EnvelopeRejection) as raised:
            sign_receipt(receipt_body(), key_id="", secret=SECRET)
        self.assertEqual(raised.exception.code, "RECEIPT_SCHEMA_INVALID")

    def test_receipt_bytes_are_stable_across_key_ordering(self) -> None:
        body = receipt_body()
        reordered = {key: body[key] for key in reversed(list(body))}
        self.assertEqual(receipt_bytes(body), receipt_bytes(reordered))


if __name__ == "__main__":
    unittest.main()

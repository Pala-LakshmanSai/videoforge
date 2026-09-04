import asyncio
import base64
import hashlib
import hmac
import json
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src"), str(ROOT.parents[0] / "common")]

import mage_serverless  # noqa: E402


def canonical_json(document: object) -> str:
    return json.dumps(
        document,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def canonical_json_sha256(document: object) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(document).encode("utf-8")).hexdigest()


class MageServerlessBoundaryTest(unittest.TestCase):
    def setUp(self) -> None:
        mage_serverless._runtime = None
        mage_serverless._claimed_deliveries.clear()
        envelope_secret = bytes.fromhex("cd" * 32)
        self.envelope_environment = patch.dict(
            mage_serverless.os.environ,
            {
                "VIDEOFORGE_ENVELOPE_KEY_ID": "envelope-key-v1",
                "VIDEOFORGE_ENVELOPE_KEY_SHA256": "sha256:"
                + hashlib.sha256(envelope_secret).hexdigest(),
                "VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX": envelope_secret.hex(),
                "VIDEOFORGE_RECEIPT_KEY_ID": "receipt-key-v1",
                "VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX": "ab" * 32,
            },
            clear=False,
        )
        self.envelope_environment.start()

    def tearDown(self) -> None:
        self.envelope_environment.stop()

    @staticmethod
    def _accepted(attempt_id: str = "attempt-a") -> dict[str, object]:
        issued_at = datetime.now(UTC)
        return {
            "dispatch_token": "dispatch-token-0123456789abcdef0123456789abcdef",
            "tenant": {"account_id": "account-a", "workspace_id": "workspace-a"},
            "work": {
                "lane": "mage_image",
                "attempt_id": attempt_id,
                "item_count": 1,
            },
            "limits": {
                "issued_at": issued_at.isoformat().replace("+00:00", "Z"),
                "expires_at": (issued_at + timedelta(seconds=7200))
                .isoformat()
                .replace("+00:00", "Z"),
            },
            "runtime": {
                "deployment_id": "deployment-a",
                "volume_id_sha256": "sha256:" + "5" * 64,
                "model_manifest_sha256": "sha256:" + "4" * 64,
                "container_digest": "sha256:" + "3" * 64,
            },
            "artifacts": {
                "output_prefix": (
                    "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/"
                    f"lane/mage-image/job/{attempt_id}"
                ),
                "transfer_port_reservation_ids": ["reservation-output"],
            },
        }

    @staticmethod
    def _plan_manifest(item_ids: tuple[str, ...]) -> dict[str, object]:
        negative = "negative-" + "|".join(item_ids)
        items = [
            {
                "scene_id": item_id,
                "positive_prompt": "positive-" + item_id,
                "positive_prompt_sha256": "sha256:"
                + hashlib.sha256(("positive-" + item_id).encode()).hexdigest(),
                "negative_prompt": negative,
                "negative_prompt_sha256": "sha256:" + hashlib.sha256(negative.encode()).hexdigest(),
                "seed": 2_000_000 + index,
                "width": 1280,
                "height": 720,
                "output_put_url": "https://unused.example/placeholder",
            }
            for index, item_id in enumerate(item_ids)
        ]
        return {
            "schema_version": "videoforge-v207-plan-manifest/v1",
            "tenant": {"account_id": "account-a", "workspace_id": "workspace-a"},
            "project_id": "project-a",
            "revision_id": "revision-a",
            "lane": "mage-image",
            "model_revision": "revision-a",
            "items": items,
        }

    @staticmethod
    def _port(*, method: str = "PUT", attempt_id: str = "attempt-a") -> dict[str, object]:
        return {
            "schema_version": "artifact-transfer-port/v3",
            "reservation_id": "reservation-output",
            "account_id": "account-a",
            "workspace_id": "workspace-a",
            "method": method,
            "path": (
                "/tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/"
                f"lane/mage-image/job/{attempt_id}/artifact/scene-a"
            ),
            "content_type": "image/png",
            "content_length": 1,
            "checksum_sha256": "sha256:" + "2" * 64,
            "expires_at": "2099-01-01T00:00:00Z",
            "max_uses": 1,
            "capability_handle": "a" * 64,
        }

    @staticmethod
    def _input_port(attempt_id: str = "attempt-a", body: bytes = b"in") -> dict[str, object]:
        port = MageServerlessBoundaryTest._port(method="GET", attempt_id=attempt_id)
        port["reservation_id"] = "reservation-input"
        port["path"] = port["path"].replace("artifact/scene-a", "artifact/input-a")
        port["content_length"] = len(body)
        port["checksum_sha256"] = "sha256:" + hashlib.sha256(body).hexdigest()
        return port

    @staticmethod
    def _generated_authority(
        *,
        attempt_id: str = "attempt-a",
        reservation_id: str = "reservation-generated",
        scene_id: str = "scene-a",
        expires_at: str = "2099-01-01T00:00:00Z",
    ) -> dict[str, object]:
        return {
            "schema_version": "artifact-generated-output-authority/v1",
            "reservation_id": reservation_id,
            "account_id": "account-a",
            "workspace_id": "workspace-a",
            "method": "PUT",
            "path": (
                "/tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/"
                f"lane/mage-image/job/{attempt_id}/artifact/{scene_id}"
            ),
            "content_type": "image/png",
            "max_content_length": 8,
            "expires_at": expires_at,
            "max_uses": 1,
            "capability_handle": "b" * 64,
        }

    @staticmethod
    def _resume_unit(
        *,
        item_id: str = "scene-accepted",
        source_attempt_id: str = "attempt-prior",
        body: bytes = b"accepted-output",
        plan_manifest: dict[str, object] | None = None,
    ) -> dict[str, object]:
        plan_manifest = plan_manifest or MageServerlessBoundaryTest._plan_manifest(
            ("scene-accepted", "scene-unresolved")
        )
        object_key = (
            "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/"
            f"lane/mage-image/job/{source_attempt_id}/artifact/{item_id}"
        )
        port = MageServerlessBoundaryTest._port(method="GET", attempt_id=source_attempt_id)
        port.update(
            {
                "reservation_id": f"reservation-readback-{item_id}",
                "path": f"/{object_key}",
                "content_length": len(body),
                "checksum_sha256": "sha256:" + hashlib.sha256(body).hexdigest(),
                "max_uses": 1,
            }
        )
        return {
            "tenant": {"account_id": "account-a", "workspace_id": "workspace-a"},
            "project_id": "project-a",
            "revision_id": "revision-a",
            "lane": "mage-image",
            "plan_manifest": plan_manifest,
            "plan_manifest_sha256": canonical_json_sha256(plan_manifest),
            "source_attempt_id": source_attempt_id,
            "item_id": item_id,
            "output_object_key": object_key,
            "output_sha256": port["checksum_sha256"],
            "output_bytes": len(body),
            "artifact_commit_receipt_sha256": "sha256:" + "c" * 64,
            "signed_provenance_receipt_sha256": "sha256:" + "d" * 64,
            "readback_port": port,
            "readback_get_url": "https://r2.example.test/accepted-output",
        }

    @staticmethod
    def _resume_document(
        plan_manifest: dict[str, object],
        units: list[dict[str, object]],
        accepted: dict[str, object] | None = None,
    ) -> dict[str, object]:
        document: dict[str, object] = {
            "schema_version": "serverless-unit-resume/v1",
            "plan_manifest": plan_manifest,
            "plan_manifest_sha256": canonical_json_sha256(plan_manifest),
            "accepted_units": units,
        }
        if accepted is not None:
            artifacts = accepted["artifacts"]
            assert isinstance(artifacts, dict)
            artifacts["plan_manifest_sha256"] = document["plan_manifest_sha256"]
            artifacts["resume_manifest_sha256"] = canonical_json_sha256(document)
        return document

    @staticmethod
    def _canonical_json(document: object) -> str:
        return canonical_json(document)

    @staticmethod
    def _execution_document(
        plan_manifest: dict[str, object],
        item_ids: list[str],
        accepted: dict[str, object],
    ) -> dict[str, object]:
        plan_sha256 = canonical_json_sha256(plan_manifest)
        document: dict[str, object] = {
            "schema_version": "serverless-execution-subset/v1",
            "plan_manifest_sha256": plan_sha256,
            "item_ids": item_ids,
        }
        artifacts = accepted["artifacts"]
        assert isinstance(artifacts, dict)
        artifacts["plan_manifest_sha256"] = plan_sha256
        artifacts["execution_manifest_sha256"] = canonical_json_sha256(document)
        return document

    @staticmethod
    def _job(
        *,
        attempt_id: str = "attempt-a",
        ports: dict[str, object] | None = None,
        output_url: object = "https://r2.example.test/presigned",
        generated_output_authorities: list[dict[str, object]] | None = None,
    ) -> dict[str, object]:
        envelope = {"tenant": {"account_id": "account-a", "workspace_id": "workspace-a"}}
        batch = {"attempt_id": attempt_id}
        input_payload: dict[str, object] = {
            "envelope": envelope,
            "batch": batch,
            "ports": ports
            or {
                "inputs": [],
                "outputs": [MageServerlessBoundaryTest._port(attempt_id=attempt_id)],
            },
            "output_put_urls": [output_url],
        }
        if generated_output_authorities is not None:
            input_payload["generated_output_authorities"] = generated_output_authorities
        return {"id": "provider-job-a", "input": input_payload}

    @staticmethod
    def _fake_mage_job(attempt_id: str = "attempt-a") -> SimpleNamespace:
        return SimpleNamespace(
            attempt_id=attempt_id,
            model_revision="revision-a",
            items=(SimpleNamespace(scene_id="scene-a"),),
        )

    @staticmethod
    def _fake_two_item_mage_job(attempt_id: str = "attempt-a") -> SimpleNamespace:
        negative = "negative-scene-a|scene-b"

        def item(scene_id: str, index: int) -> SimpleNamespace:
            positive = "positive-" + scene_id
            return SimpleNamespace(
                scene_id=scene_id,
                positive_prompt=positive,
                positive_prompt_sha256="sha256:" + hashlib.sha256(positive.encode()).hexdigest(),
                negative_prompt=negative,
                negative_prompt_sha256="sha256:" + hashlib.sha256(negative.encode()).hexdigest(),
                seed=2_000_000 + index,
                width=1280,
                height=720,
                output_put_url="https://unused.example/placeholder",
            )

        return SimpleNamespace(
            attempt_id=attempt_id,
            model_revision="revision-a",
            items=(
                item("scene-a", 0),
                item("scene-b", 1),
            ),
        )

    @staticmethod
    def _inline_source_job(*, width: int = 1280) -> SimpleNamespace:
        positive_prompt = "A quiet documentary portrait in a neutral studio"
        negative_prompt = "text, letters, logo, watermark"
        return SimpleNamespace(
            attempt_id="attempt-a",
            model_revision="a" * 40,
            items=(
                SimpleNamespace(
                    scene_id="scene-a",
                    positive_prompt=positive_prompt,
                    positive_prompt_sha256="sha256:"
                    + hashlib.sha256(positive_prompt.encode()).hexdigest(),
                    negative_prompt=negative_prompt,
                    negative_prompt_sha256="sha256:"
                    + hashlib.sha256(negative_prompt.encode()).hexdigest(),
                    seed=1,
                    width=width,
                    height=720,
                ),
            ),
        )

    def test_inline_item_returns_exact_runtime_wire_mapping(self) -> None:
        value = mage_serverless._inline_item(self._inline_source_job(), 0)
        self.assertEqual(set(value), {"mode", "attempt_id", "model_revision", "items"})
        self.assertEqual(value["mode"], "INLINE_QUALIFICATION_V1")
        self.assertIsInstance(value["items"], list)
        self.assertIsInstance(value["items"][0], dict)
        mage_serverless.MageInlineJob.from_value(value)

    def test_inline_item_rejects_invalid_native_size_before_runtime(self) -> None:
        with self.assertRaisesRegex(ValueError, "MAGE_INLINE_SIZE_INVALID"):
            mage_serverless._inline_item(self._inline_source_job(width=1296), 0)

    def test_inline_dataclass_projection_is_rejected_by_wire_validator(self) -> None:
        value = mage_serverless._inline_item(self._inline_source_job(), 0)
        parsed = mage_serverless.MageInlineJob.from_value(value)
        with self.assertRaisesRegex(ValueError, "MAGE_INLINE_SCOPE_INVALID"):
            mage_serverless.MageInlineJob.from_value(parsed.__dict__)

    def test_rejects_malformed_authority_before_runtime_startup(self) -> None:
        result = asyncio.run(mage_serverless.handler({"input": {}}))
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["failure_code"], "MAGE_SERVERLESS_JOB_SHAPE_INVALID")
        self.assertEqual(result["error"]["code"], "MAGE_SERVERLESS_JOB_SHAPE_INVALID")

    def test_failure_code_survives_runpod_reserved_error_stripping(self) -> None:
        """SLS-Core keeps output fields but moves/removes the reserved `error` field."""
        result = asyncio.run(mage_serverless.handler({"input": {}}))
        stripped = {key: value for key, value in result.items() if key != "error"}
        self.assertEqual(
            stripped,
            {
                "status": "FAILED",
                "failure_code": "MAGE_SERVERLESS_JOB_SHAPE_INVALID",
            },
        )

    def test_unexpected_handler_exceptions_return_stable_non_secret_failure(self) -> None:
        for unexpected in (OSError("private path secret"), TypeError("private type secret")):
            with (
                self.subTest(exception=type(unexpected).__name__),
                patch.object(mage_serverless, "_required", side_effect=unexpected),
            ):
                result = asyncio.run(mage_serverless.handler({"input": {}}))
            self.assertEqual(result["status"], "FAILED")
            self.assertEqual(result["failure_code"], "MAGE_SERVERLESS_HANDLER_UNEXPECTED")
            self.assertEqual(
                result["error"],
                {
                    "code": "MAGE_SERVERLESS_HANDLER_UNEXPECTED",
                    "message": "MAGE_SERVERLESS_HANDLER_UNEXPECTED",
                },
            )
            self.assertNotIn("private", str(result))

    def test_endpoint_identity_fails_closed_without_bound_runtime_identity(self) -> None:
        with patch.dict(
            mage_serverless.os.environ,
            {"VIDEOFORGE_MAGE_ENDPOINT_ID_HASH": "", "RUNPOD_ENDPOINT_ID": ""},
            clear=False,
        ):
            with self.assertRaisesRegex(
                mage_serverless.ServerlessMageError, "MAGE_SERVERLESS_ENDPOINT_ID_MISSING"
            ):
                mage_serverless._endpoint_id_hash()

    def test_malformed_authority_is_failure_before_runtime_startup(self) -> None:
        job = self._job()
        job["input"]["envelope"] = {"tenant": None, "runtime": []}
        with patch.object(
            mage_serverless, "_ready_runtime", new=AsyncMock(side_effect=AssertionError)
        ):
            result = asyncio.run(mage_serverless.handler(job))
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["error"]["code"], "ENVELOPE_SCHEMA_UNKNOWN")

    def test_rejects_envelope_receipt_key_reuse_before_runtime_startup(self) -> None:
        fixture_path = (
            ROOT.parents[1]
            / "packages/contracts/generated/fixtures/serverless_worker_job_envelope_v3.valid.json"
        )
        envelope = json.loads(fixture_path.read_text(encoding="utf-8"))
        envelope["limits"]["expires_at"] = "2099-01-01T00:00:00Z"
        body = {
            key: value
            for key, value in envelope.items()
            if key not in {"authority_sha256", "signature"}
        }
        authority = canonical_json_sha256(body)
        secret = bytes.fromhex("cd" * 32)
        envelope["authority_sha256"] = authority
        envelope["signature"] = {
            "algorithm": "HMAC-SHA256",
            "key_id": "envelope-key-v1",
            "value": hmac.new(
                secret,
                canonical_json(
                    {"authority_sha256": authority, "key_id": "envelope-key-v1"}
                ).encode(),
                hashlib.sha256,
            ).hexdigest(),
        }
        job = self._job()
        job["input"]["envelope"] = envelope
        ready = AsyncMock(side_effect=AssertionError("runtime must remain untouched"))
        with (
            patch.dict(
                mage_serverless.os.environ,
                {"VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX": secret.hex()},
                clear=False,
            ),
            patch.object(mage_serverless, "_ready_runtime", ready),
        ):
            result = asyncio.run(mage_serverless.handler(job))
        self.assertEqual(result["failure_code"], "ENVELOPE_RECEIPT_KEY_REUSE")
        ready.assert_not_awaited()

    def test_scoped_port_shape_is_rejected_before_runtime_startup(self) -> None:
        accepted = self._accepted()
        job = self._job(ports={"inputs": []})
        with (
            patch.object(mage_serverless, "validate_envelope", return_value=accepted),
            patch.object(mage_serverless.MageJob, "from_value", return_value=self._fake_mage_job()),
            patch.object(
                mage_serverless, "_ready_runtime", new=AsyncMock(side_effect=AssertionError)
            ) as ready,
        ):
            result = asyncio.run(mage_serverless.handler(job))
        self.assertEqual(result["error"]["code"], "MAGE_SERVERLESS_PORT_SHAPE_INVALID")
        ready.assert_not_awaited()

    def test_mismatched_scoped_port_authority_is_rejected_before_runtime(self) -> None:
        accepted = self._accepted()
        forged = self._port()
        forged["reservation_id"] = "reservation-forged"
        job = self._job(ports={"inputs": [], "outputs": [forged]})
        with (
            patch.object(mage_serverless, "validate_envelope", return_value=accepted),
            patch.object(mage_serverless.MageJob, "from_value", return_value=self._fake_mage_job()),
            patch.object(
                mage_serverless, "_ready_runtime", new=AsyncMock(side_effect=AssertionError)
            ) as ready,
        ):
            result = asyncio.run(mage_serverless.handler(job))
        self.assertEqual(result["error"]["code"], "MAGE_SERVERLESS_PORT_AUTHORITY_MISMATCH")
        ready.assert_not_awaited()

    def test_foreign_scoped_port_is_rejected_before_runtime(self) -> None:
        accepted = self._accepted()
        forged = self._port()
        forged["account_id"] = "account-foreign"
        job = self._job(ports={"inputs": [], "outputs": [forged]})
        with (
            patch.object(mage_serverless, "validate_envelope", return_value=accepted),
            patch.object(mage_serverless.MageJob, "from_value", return_value=self._fake_mage_job()),
            patch.object(
                mage_serverless, "_ready_runtime", new=AsyncMock(side_effect=AssertionError)
            ) as ready,
        ):
            result = asyncio.run(mage_serverless.handler(job))
        self.assertEqual(result["error"]["code"], "WORKER_ARTIFACT_SCOPE_MISMATCH")
        ready.assert_not_awaited()

    def test_output_url_is_rejected_before_runtime_startup(self) -> None:
        accepted = self._accepted()
        job = self._job(output_url="http://not-r2.example.test/object")
        with (
            patch.object(mage_serverless, "validate_envelope", return_value=accepted),
            patch.object(mage_serverless.MageJob, "from_value", return_value=self._fake_mage_job()),
            patch.object(
                mage_serverless, "_ready_runtime", new=AsyncMock(side_effect=AssertionError)
            ) as ready,
        ):
            result = asyncio.run(mage_serverless.handler(job))
        self.assertEqual(result["error"]["code"], "MAGE_SERVERLESS_OUTPUT_URL_INVALID")
        ready.assert_not_awaited()

    def test_generated_authority_rejects_scope_path_expiry_and_replay(self) -> None:
        accepted = self._accepted()
        accepted["artifacts"]["transfer_port_reservation_ids"] = ["reservation-generated"]
        cases = (
            ("account_id", "account-foreign", "MAGE_SERVERLESS_GENERATED_OUTPUT_SCOPE_MISMATCH"),
            (
                "path",
                "/tenant/account-a/workspace/workspace-a/job/foreign/artifact/scene-a",
                "MAGE_SERVERLESS_GENERATED_OUTPUT_PATH_MISMATCH",
            ),
            (
                "path",
                "/tenant/account-a/workspace/workspace-a/project/project-foreign/revision/revision-a/"
                "lane/mage-image/job/attempt-a/artifact/scene-a",
                "MAGE_SERVERLESS_GENERATED_OUTPUT_PATH_MISMATCH",
            ),
            ("expires_at", "2020-01-01T00:00:00Z", "MAGE_SERVERLESS_GENERATED_OUTPUT_EXPIRED"),
            ("max_uses", 0, "MAGE_SERVERLESS_GENERATED_OUTPUT_REPLAY_BOUND_INVALID"),
            ("max_uses", 2, "MAGE_SERVERLESS_GENERATED_OUTPUT_REPLAY_BOUND_INVALID"),
        )
        for field, value, expected_code in cases:
            with self.subTest(field=field):
                authority = self._generated_authority()
                authority[field] = value
                with self.assertRaisesRegex(mage_serverless.ServerlessMageError, expected_code):
                    mage_serverless._validate_scoped_ports(
                        {"inputs": [], "outputs": []},
                        generated_output_authorities=[authority],
                        accepted=accepted,
                        attempt_id="attempt-a",
                        now=datetime(2026, 8, 19, tzinfo=UTC),
                    )

    def test_generated_authority_requires_exact_batch_prefix_and_artifact_id(self) -> None:
        accepted = self._accepted()
        accepted["artifacts"]["transfer_port_reservation_ids"] = ["reservation-generated"]
        authority = self._generated_authority()
        authority["path"] = authority["path"] + "/nested"
        with self.assertRaisesRegex(
            mage_serverless.ServerlessMageError,
            "MAGE_SERVERLESS_GENERATED_OUTPUT_PATH_MISMATCH",
        ):
            mage_serverless._validate_scoped_ports(
                {"inputs": [], "outputs": []},
                generated_output_authorities=[authority],
                accepted=accepted,
                attempt_id="attempt-a",
                now=datetime(2026, 8, 19, tzinfo=UTC),
            )

        accepted["artifacts"]["output_prefix"] = accepted["artifacts"]["output_prefix"].replace(
            "/lane/mage-image/", "/lane/render/"
        )
        authority["path"] = f"/{accepted['artifacts']['output_prefix']}/artifact/scene-a"
        with self.assertRaisesRegex(
            mage_serverless.ServerlessMageError,
            "MAGE_SERVERLESS_OUTPUT_PREFIX_INVALID",
        ):
            mage_serverless._validate_scoped_ports(
                {"inputs": [], "outputs": []},
                generated_output_authorities=[authority],
                accepted=accepted,
                attempt_id="attempt-a",
                now=datetime(2026, 8, 19, tzinfo=UTC),
            )

    def test_generated_authority_duplicate_reservation_is_rejected(self) -> None:
        accepted = self._accepted()
        accepted["artifacts"]["transfer_port_reservation_ids"] = [
            "reservation-generated",
            "reservation-generated",
        ]
        authority = self._generated_authority()
        with self.assertRaisesRegex(
            mage_serverless.ServerlessMageError, "MAGE_SERVERLESS_PORT_REPLAYED"
        ):
            mage_serverless._validate_scoped_ports(
                {"inputs": [], "outputs": []},
                generated_output_authorities=[authority, dict(authority)],
                accepted=accepted,
                attempt_id="attempt-a",
                now=datetime(2026, 8, 19, tzinfo=UTC),
            )

    def test_generated_output_upload_binds_actual_length_and_hash(self) -> None:
        body = b"png"
        authority = self._generated_authority()
        checksum = "sha256:" + hashlib.sha256(body).hexdigest()
        with patch.object(mage_serverless, "urlopen") as urlopen:
            response = urlopen.return_value.__enter__.return_value
            response.status = 204
            timestamp, measured = mage_serverless._put_generated_output(
                authority, "https://r2.example.test/presigned", body
            )
        self.assertGreater(timestamp, 0)
        self.assertEqual(measured, checksum)
        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_header("Accept"), "application/json")
        self.assertEqual(request.get_header("User-agent"), mage_serverless._HTTP_USER_AGENT)
        self.assertEqual(request.get_header("Content-length"), str(len(body)))
        self.assertEqual(request.get_header("Content-type"), "image/png")

    def test_exact_output_upload_identifies_mage_to_cloudflare(self) -> None:
        body = b"png"
        port = self._port()
        port["content_length"] = len(body)
        port["checksum_sha256"] = "sha256:" + hashlib.sha256(body).hexdigest()
        with patch.object(mage_serverless, "urlopen") as urlopen:
            response = urlopen.return_value.__enter__.return_value
            response.status = 204
            mage_serverless._put_output(port, "https://r2.example.test/presigned", body)
        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_header("Accept"), "application/json")
        self.assertEqual(request.get_header("User-agent"), mage_serverless._HTTP_USER_AGENT)
        self.assertEqual(request.get_header("Content-length"), str(len(body)))
        self.assertEqual(request.get_header("Content-type"), "image/png")

    def test_generated_output_upload_classifies_http_status_without_response_details(self) -> None:
        body = b"png"
        authority = self._generated_authority()
        for status, expected in (
            (400, "MAGE_SERVERLESS_OUTPUT_UPLOAD_HTTP_4XX_400"),
            (503, "MAGE_SERVERLESS_OUTPUT_UPLOAD_HTTP_5XX_503"),
        ):
            with self.subTest(status=status), patch.object(mage_serverless, "urlopen") as urlopen:
                response = urlopen.return_value.__enter__.return_value
                response.status = status
                with self.assertRaisesRegex(mage_serverless.ServerlessMageError, expected) as raised:
                    mage_serverless._put_generated_output(
                        authority, "https://r2.example.test/presigned", body
                    )
            self.assertEqual(urlopen.call_count, 1)
            self.assertEqual(str(raised.exception), expected)
            self.assertNotIn("https://r2.example.test", str(raised.exception))

    def test_generated_output_upload_classifies_http_error_status_without_body_or_url(self) -> None:
        body = b"png"
        authority = self._generated_authority()
        secret_url = "https://secret.example.test/presigned?token=do-not-leak"
        secret_body = "provider-body-do-not-leak"
        failure = HTTPError(secret_url, 403, secret_body, {"x-secret": "do-not-leak"}, None)
        with patch.object(mage_serverless, "urlopen", side_effect=failure) as urlopen:
            with self.assertRaisesRegex(
                mage_serverless.ServerlessMageError,
                "MAGE_SERVERLESS_OUTPUT_UPLOAD_HTTP_4XX_403",
            ) as raised:
                mage_serverless._put_generated_output(
                    authority, "https://r2.example.test/presigned", body
                )
        self.assertEqual(urlopen.call_count, 1)
        self.assertEqual(
            str(raised.exception), "MAGE_SERVERLESS_OUTPUT_UPLOAD_HTTP_4XX_403"
        )
        for secret in (secret_url, secret_body, "do-not-leak"):
            self.assertNotIn(secret, str(raised.exception))

    def test_generated_output_upload_classifies_timeout_tls_and_network_without_exception_text(self) -> None:
        body = b"png"
        authority = self._generated_authority()
        secret = "https://secret.example.test/presigned?token=do-not-leak"
        cases = (
            (
                TimeoutError(secret),
                "MAGE_SERVERLESS_OUTPUT_UPLOAD_TIMEOUT",
            ),
            (
                URLError(ssl.SSLCertVerificationError("certificate-do-not-leak")),
                "MAGE_SERVERLESS_OUTPUT_UPLOAD_TLS_CERTIFICATE",
            ),
            (
                socket.gaierror(-2, "dns-do-not-leak"),
                "MAGE_SERVERLESS_OUTPUT_UPLOAD_DNS_NETWORK_URL",
            ),
            (
                URLError(secret),
                "MAGE_SERVERLESS_OUTPUT_UPLOAD_DNS_NETWORK_URL",
            ),
            (
                ValueError(secret),
                "MAGE_SERVERLESS_OUTPUT_UPLOAD_DNS_NETWORK_URL",
            ),
        )
        for failure, expected in cases:
            with self.subTest(expected=expected), patch.object(
                mage_serverless, "urlopen", side_effect=failure
            ) as urlopen:
                with self.assertRaisesRegex(mage_serverless.ServerlessMageError, expected) as raised:
                    mage_serverless._put_generated_output(
                        authority, "https://r2.example.test/presigned", body
                    )
            self.assertEqual(urlopen.call_count, 1)
            self.assertEqual(str(raised.exception), expected)
            self.assertNotIn(secret, str(raised.exception))

    def test_generated_output_upload_preserves_unknown_failure_as_bounded_code(self) -> None:
        body = b"png"
        authority = self._generated_authority()
        failure = RuntimeError("unknown-provider-detail-do-not-leak")
        with patch.object(mage_serverless, "urlopen", side_effect=failure) as urlopen:
            with self.assertRaisesRegex(
                mage_serverless.ServerlessMageError,
                "MAGE_SERVERLESS_OUTPUT_UPLOAD_UNKNOWN",
            ) as raised:
                mage_serverless._put_generated_output(
                    authority, "https://r2.example.test/presigned", body
                )
        self.assertEqual(urlopen.call_count, 1)
        self.assertEqual(str(raised.exception), "MAGE_SERVERLESS_OUTPUT_UPLOAD_UNKNOWN")
        self.assertNotIn("unknown-provider-detail-do-not-leak", str(raised.exception))

    def test_resume_accepts_exact_carried_forward_readback_for_unresolved_batch(self) -> None:
        accepted = self._accepted()
        unit = self._resume_unit()
        plan = self._plan_manifest(("scene-accepted", "scene-unresolved"))
        resume = self._resume_document(plan, [unit], accepted)
        result = mage_serverless._validate_resume_state(
            resume,
            resume_canonical_json=self._canonical_json(resume),
            accepted=accepted,
            current_item_ids=("scene-accepted", "scene-unresolved"),
            expected_plan_manifest=plan,
            now=datetime(2026, 8, 19, tzinfo=UTC),
        )
        self.assertEqual(result[0]["item_id"], "scene-accepted")
        self.assertEqual(result[0]["output_bytes"], len(b"accepted-output"))

    def test_resume_skips_an_already_accepted_item_after_process_replacement(self) -> None:
        # Clearing the process-local delivery fence models a fresh worker process.  The durable
        # accepted-unit contract carries the prior item in the replacement batch and the handler
        # will generate only the unresolved item IDs.
        mage_serverless._claimed_deliveries.clear()
        accepted = self._accepted()
        plan = self._plan_manifest(("scene-a", "scene-b"))
        unit = self._resume_unit(item_id="scene-a", plan_manifest=plan)
        resume = self._resume_document(plan, [unit], accepted)
        result = mage_serverless._validate_resume_state(
            resume,
            resume_canonical_json=self._canonical_json(resume),
            accepted=accepted,
            current_item_ids=("scene-a", "scene-b"),
            expected_plan_manifest=plan,
            now=datetime(2026, 8, 19, tzinfo=UTC),
        )
        self.assertEqual(result[0]["item_id"], "scene-a")

    def test_resume_manifest_survives_an_actual_process_replacement(self) -> None:
        accepted = self._accepted()
        plan = self._plan_manifest(("scene-a", "scene-b"))
        resume = self._resume_document(
            plan,
            [self._resume_unit(item_id="scene-a", plan_manifest=plan)],
            accepted,
        )
        payload = json.dumps(
            {
                "accepted": accepted,
                "plan": plan,
                "resume": resume,
                "resume_canonical_json": self._canonical_json(resume),
            }
        )
        script = """
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

root = Path.cwd()
sys.path[:0] = [str(root), str(root / "src"), str(root.parent / "common")]
import mage_serverless

payload = json.loads(sys.stdin.read())
units = mage_serverless._validate_resume_state(
    payload["resume"],
    resume_canonical_json=payload["resume_canonical_json"],
    accepted=payload["accepted"],
    current_item_ids=("scene-a", "scene-b"),
    expected_plan_manifest=payload["plan"],
    now=datetime.now(UTC),
)
print(json.dumps({"accepted": [unit["item_id"] for unit in units], "claimed": len(mage_serverless._claimed_deliveries)}))
"""
        completed = subprocess.run(
            [sys.executable, "-c", script],
            cwd=ROOT,
            input=payload,
            text=True,
            capture_output=True,
            check=True,
        )
        self.assertEqual(
            json.loads(completed.stdout),
            {"accepted": ["scene-a"], "claimed": 0},
        )

    def test_resume_rejects_accepted_item_missing_from_replacement_batch(self) -> None:
        accepted = self._accepted()
        plan = self._plan_manifest(("scene-b",))
        unit = self._resume_unit(item_id="scene-a", plan_manifest=plan)
        resume = self._resume_document(plan, [unit], accepted)
        with self.assertRaisesRegex(
            mage_serverless.ServerlessMageError, "MAGE_SERVERLESS_RESUME_ITEM_NOT_IN_BATCH"
        ):
            mage_serverless._validate_resume_state(
                resume,
                resume_canonical_json=self._canonical_json(resume),
                accepted=accepted,
                current_item_ids=("scene-b",),
                expected_plan_manifest=plan,
                now=datetime(2026, 8, 19, tzinfo=UTC),
            )

    def test_resume_rejects_tampered_or_cross_authority_readback(self) -> None:
        accepted = self._accepted()
        for mutation, expected in (
            (
                lambda unit: unit["readback_port"].update(
                    {"checksum_sha256": "sha256:" + "f" * 64}
                ),
                "MAGE_SERVERLESS_RESUME_READBACK_AUTHORITY_MISMATCH",
            ),
            (
                lambda unit: unit["readback_port"].update({"account_id": "account-foreign"}),
                "WORKER_ARTIFACT_SCOPE_MISMATCH",
            ),
            (
                lambda unit: unit.update(
                    {
                        "output_object_key": unit["output_object_key"].replace(
                            "scene-accepted", "scene-foreign"
                        )
                    }
                ),
                "MAGE_SERVERLESS_RESUME_OBJECT_KEY_INVALID",
            ),
        ):
            with self.subTest(expected=expected):
                unit = self._resume_unit()
                mutation(unit)
                plan = self._plan_manifest(("scene-accepted", "scene-unresolved"))
                resume = self._resume_document(plan, [unit], accepted)
                with self.assertRaisesRegex(mage_serverless.ServerlessMageError, expected):
                    mage_serverless._validate_resume_state(
                        resume,
                        resume_canonical_json=self._canonical_json(resume),
                        accepted=accepted,
                        current_item_ids=("scene-accepted", "scene-unresolved"),
                        expected_plan_manifest=plan,
                        now=datetime(2026, 8, 19, tzinfo=UTC),
                    )

    def test_resume_readback_uses_get_authority_and_removes_scratch(self) -> None:
        unit = self._resume_unit()
        with tempfile.TemporaryDirectory() as temporary:
            with patch.object(mage_serverless, "urlopen") as urlopen:
                response = urlopen.return_value.__enter__.return_value
                response.status = 200
                response.headers = {"Content-Length": str(unit["output_bytes"])}
                response.read.return_value = b"accepted-output"
                mage_serverless._verify_resume_readbacks_in_scratch(
                    (unit,),
                    root=Path(temporary).resolve(),
                    account_id="account-a",
                    workspace_id="workspace-a",
                    now=datetime(2026, 8, 19, tzinfo=UTC),
                )
            self.assertFalse((Path(temporary) / "jobs" / "attempt-prior").exists())
            request = urlopen.call_args.args[0]
            self.assertEqual(request.get_method(), "GET")
            self.assertEqual(request.get_header("Accept"), "application/octet-stream")
            self.assertEqual(request.get_header("User-agent"), mage_serverless._HTTP_USER_AGENT)

    def test_resume_readback_rejects_wrong_bytes(self) -> None:
        unit = self._resume_unit()
        with (
            tempfile.TemporaryDirectory() as temporary,
            patch.object(mage_serverless, "urlopen") as urlopen,
        ):
            response = urlopen.return_value.__enter__.return_value
            response.status = 200
            response.headers = {"Content-Length": str(unit["output_bytes"])}
            response.read.return_value = b"tampered-output"
            with self.assertRaisesRegex(
                mage_serverless.ServerlessMageError,
                "MAGE_SERVERLESS_INPUT_CHECKSUM_MISMATCH",
            ):
                mage_serverless._verify_resume_readbacks_in_scratch(
                    (unit,),
                    root=Path(temporary).resolve(),
                    account_id="account-a",
                    workspace_id="workspace-a",
                    now=datetime(2026, 8, 19, tzinfo=UTC),
                )

    def test_replacement_handler_generates_only_unresolved_units(self) -> None:
        body = b"png"
        checksum = "sha256:" + hashlib.sha256(body).hexdigest()
        accepted = self._accepted()
        accepted["artifacts"]["transfer_port_reservation_ids"] = ["reservation-generated"]
        authority = self._generated_authority(scene_id="scene-b")
        job = self._job(
            ports={"inputs": [], "outputs": []},
            generated_output_authorities=[authority],
        )
        plan = self._plan_manifest(("scene-a", "scene-b"))
        accepted["work"]["items_manifest_sha256"] = canonical_json_sha256(plan["items"])
        resume = self._resume_document(
            plan,
            [self._resume_unit(item_id="scene-a", plan_manifest=plan)],
            accepted,
        )
        execution = self._execution_document(plan, ["scene-b"], accepted)
        job["input"]["resume"] = resume
        job["input"]["resume_canonical_json"] = self._canonical_json(resume)
        job["input"]["plan_manifest_canonical_json"] = self._canonical_json(plan)
        job["input"]["execution"] = execution
        job["input"]["execution_canonical_json"] = self._canonical_json(execution)
        generated = {
            "output_base64": base64.b64encode(body).decode("ascii"),
            "item_id": "runtime-item-id-must-not-override-input",
            "output_sha256": checksum,
            "bytes": len(body),
            "width": 1280,
            "height": 720,
            "seed": 1,
            "positive_prompt_sha256": "sha256:" + "1" * 64,
            "negative_prompt_sha256": "sha256:" + "2" * 64,
            "source_revision": "a" * 40,
            "model_revision": "b" * 40,
            "renderer_source_profile": "mage-landscape-native-1280x720-v1",
            "generation_duration_ms": 12,
            "runtime_evidence": {"gpu": {"peak_vram_used_bytes": 12 * 1024**3}},
        }
        runtime = SimpleNamespace(
            started=time.monotonic() - 0.001,
            ready=True,
            gpu={
                "name": "NVIDIA GeForce RTX 4090",
                "cuda_version": "12",
                "total_memory_bytes": 24 * 1024**3,
            },
            warmup_output_sha256="sha256:" + "3" * 64,
            bootstrap_evidence={"duration_ms": 1},
            phase_timings_ms={"gpu_load": 2, "warmup": 3},
            generate=AsyncMock(return_value=generated),
        )
        inline_indexes: list[int] = []

        def inline(job_value: object, index: int) -> SimpleNamespace:
            inline_indexes.append(index)
            return SimpleNamespace()

        with tempfile.TemporaryDirectory() as temporary:
            with (
                patch.object(mage_serverless, "validate_envelope", return_value=accepted),
                patch.object(
                    mage_serverless.MageJob,
                    "from_value",
                    return_value=self._fake_two_item_mage_job(),
                ),
                patch.object(mage_serverless, "_inline_item", side_effect=inline),
                patch.object(
                    mage_serverless, "_ready_runtime", new=AsyncMock(return_value=runtime)
                ),
                patch.object(mage_serverless, "urlopen") as urlopen,
                patch.object(
                    mage_serverless, "_put_generated_output", return_value=(123, checksum)
                ),
                patch.object(
                    mage_serverless,
                    "verify_model_root",
                    return_value={"manifest_sha256": accepted["runtime"]["model_manifest_sha256"]},
                ),
                patch.dict(
                    mage_serverless.os.environ,
                    {
                        "RUNPOD_ENDPOINT_ID": "endpoint-a",
                        "VIDEOFORGE_RECEIPT_KEY_ID": "key-a",
                        "VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX": "4" * 64,
                        "VIDEOFORGE_JOB_SCRATCH_ROOT": str(Path(temporary).resolve()),
                    },
                ),
            ):
                response = urlopen.return_value.__enter__.return_value
                response.status = 200
                response.headers = {"Content-Length": str(len(b"accepted-output"))}
                response.read.return_value = b"accepted-output"
                result = asyncio.run(mage_serverless.handler(job))
        self.assertEqual(result["status"], "SUCCEEDED")
        self.assertEqual(inline_indexes, [1])
        runtime.generate.assert_awaited_once()
        self.assertEqual(result["items"][0]["output_object_key"], authority["path"].lstrip("/"))

    def test_execution_subset_rejects_tampered_bytes_and_resumed_ids(self) -> None:
        accepted = self._accepted()
        plan = self._plan_manifest(("scene-a", "scene-b"))
        execution = self._execution_document(plan, ["scene-b"], accepted)
        selected = mage_serverless._validate_execution_subset(
            execution,
            execution_canonical_json=self._canonical_json(execution),
            plan_manifest_canonical_json=self._canonical_json(plan),
            accepted=accepted,
            current_item_ids=("scene-a", "scene-b"),
            expected_plan_manifest=plan,
            resumed_ids={"scene-a"},
        )
        self.assertEqual(selected, ("scene-b",))
        with self.assertRaisesRegex(
            mage_serverless.ServerlessMageError,
            "MAGE_SERVERLESS_EXECUTION_MANIFEST_HASH_INVALID",
        ):
            mage_serverless._validate_execution_subset(
                execution,
                execution_canonical_json=self._canonical_json(execution) + " ",
                plan_manifest_canonical_json=self._canonical_json(plan),
                accepted=accepted,
                current_item_ids=("scene-a", "scene-b"),
                expected_plan_manifest=plan,
                resumed_ids={"scene-a"},
            )

        replayed = self._execution_document(plan, ["scene-a"], accepted)
        with self.assertRaisesRegex(
            mage_serverless.ServerlessMageError,
            "MAGE_SERVERLESS_EXECUTION_ITEMS_INVALID",
        ):
            mage_serverless._validate_execution_subset(
                replayed,
                execution_canonical_json=self._canonical_json(replayed),
                plan_manifest_canonical_json=self._canonical_json(plan),
                accepted=accepted,
                current_item_ids=("scene-a", "scene-b"),
                expected_plan_manifest=plan,
                resumed_ids={"scene-a"},
            )

    def test_startup_timings_are_signed_boundary_derived_and_bounded(self) -> None:
        now = time.monotonic()
        runtime = SimpleNamespace(started=now - 0.5)
        accepted = self._accepted()
        issued_at = datetime.now(UTC) - timedelta(seconds=1)
        accepted["limits"]["issued_at"] = issued_at.isoformat().replace("+00:00", "Z")
        accepted["limits"]["expires_at"] = (
            (issued_at + timedelta(seconds=7200)).isoformat().replace("+00:00", "Z")
        )
        allocation_ms, container_ready_ms, issued_at = mage_serverless._startup_timings(
            runtime, accepted=accepted, ready_at=now, handler_started_at=now - 0.25
        )
        self.assertGreaterEqual(allocation_ms, 1)
        self.assertGreaterEqual(container_ready_ms, allocation_ms)
        self.assertLessEqual(container_ready_ms, 86_400_000)
        self.assertTrue(issued_at.endswith("Z"))
        with patch.dict(
            mage_serverless.os.environ,
            {
                "VIDEOFORGE_MAGE_ALLOCATION_MS": "999",
                "VIDEOFORGE_MAGE_CONTAINER_READY_MS": "999",
            },
        ):
            measured = mage_serverless._startup_timings(
                runtime, accepted=accepted, ready_at=now, handler_started_at=now - 0.25
            )
        self.assertEqual(measured[0], allocation_ms)
        self.assertEqual(measured[1], container_ready_ms)

    def test_input_get_download_binds_exact_length_hash_and_scratch(self) -> None:
        body = b"input-bytes"
        port = self._input_port(body=body)
        with tempfile.TemporaryDirectory() as temporary:
            with mage_serverless._terminal_worker_io(
                root=Path(temporary).resolve(),
                account_id="account-a",
                workspace_id="workspace-a",
                job_id="attempt-a",
                input_ports=(port,),
                output_ports=(),
                now=datetime(2026, 8, 19, tzinfo=UTC),
            ) as worker_io:
                with patch.object(mage_serverless, "urlopen") as urlopen:
                    response = urlopen.return_value.__enter__.return_value
                    response.status = 200
                    response.headers = {"Content-Length": str(len(body))}
                    response.read.return_value = body
                    path = mage_serverless._download_input(
                        port, "https://r2.example.test/input", worker_io
                    )
                    request = urlopen.call_args.args[0]
                    self.assertEqual(request.get_header("Accept"), "application/octet-stream")
                    self.assertEqual(
                        request.get_header("User-agent"), mage_serverless._HTTP_USER_AGENT
                    )
                self.assertEqual(path.read_bytes(), body)
                self.assertTrue(path.is_relative_to(worker_io.scratch.path))
            self.assertFalse(path.exists())

    def test_input_get_download_rejects_wrong_bytes(self) -> None:
        body = b"expected"
        port = self._input_port(body=body)
        with tempfile.TemporaryDirectory() as temporary:
            with mage_serverless._terminal_worker_io(
                root=Path(temporary).resolve(),
                account_id="account-a",
                workspace_id="workspace-a",
                job_id="attempt-a",
                input_ports=(port,),
                output_ports=(),
                now=datetime(2026, 8, 19, tzinfo=UTC),
            ) as worker_io:
                with patch.object(mage_serverless, "urlopen") as urlopen:
                    response = urlopen.return_value.__enter__.return_value
                    response.status = 200
                    response.headers = {"Content-Length": str(len(body))}
                    response.read.return_value = b"tampered"
                    with self.assertRaisesRegex(
                        mage_serverless.ServerlessMageError,
                        "MAGE_SERVERLESS_INPUT_CHECKSUM_MISMATCH",
                    ):
                        mage_serverless._download_input(
                            port, "https://r2.example.test/input", worker_io
                        )

    def test_generated_output_handler_emits_actual_metadata_in_receipt(self) -> None:
        body = b"png"
        checksum = "sha256:" + hashlib.sha256(body).hexdigest()
        accepted = self._accepted()
        accepted["artifacts"]["transfer_port_reservation_ids"] = ["reservation-generated"]
        authority = self._generated_authority()
        job = self._job(
            ports={"inputs": [], "outputs": []},
            generated_output_authorities=[authority],
        )
        generated = {
            "output_base64": base64.b64encode(body).decode("ascii"),
            "output_sha256": checksum,
            "bytes": len(body),
            "width": 1280,
            "height": 720,
            "seed": 1,
            "positive_prompt_sha256": "sha256:" + "1" * 64,
            "negative_prompt_sha256": "sha256:" + "2" * 64,
            "source_revision": "a" * 40,
            "model_revision": "b" * 40,
            "renderer_source_profile": "mage-landscape-native-1280x720-v1",
            "generation_duration_ms": 12,
            "runtime_evidence": {"gpu": {"peak_vram_used_bytes": 12 * 1024**3}},
        }
        runtime = SimpleNamespace(
            started=time.monotonic() - 0.001,
            ready=True,
            gpu={
                "name": "NVIDIA GeForce RTX 4090",
                "cuda_version": "12",
                "total_memory_bytes": 24 * 1024**3,
            },
            warmup_output_sha256="sha256:" + "3" * 64,
            bootstrap_evidence={"duration_ms": 1},
            phase_timings_ms={"gpu_load": 2, "warmup": 3},
            generate=AsyncMock(return_value=generated),
        )
        with tempfile.TemporaryDirectory() as temporary:
            with (
                patch.object(mage_serverless, "validate_envelope", return_value=accepted),
                patch.object(
                    mage_serverless.MageJob, "from_value", return_value=self._fake_mage_job()
                ),
                patch.object(
                    mage_serverless,
                    "_inline_item",
                    return_value=mage_serverless._inline_item(self._inline_source_job(), 0),
                ),
                patch.object(
                    mage_serverless, "_ready_runtime", new=AsyncMock(return_value=runtime)
                ),
                patch.object(
                    mage_serverless, "_put_generated_output", return_value=(123, checksum)
                ),
                patch.object(
                    mage_serverless,
                    "verify_model_root",
                    return_value={"manifest_sha256": accepted["runtime"]["model_manifest_sha256"]},
                ),
                patch.object(
                    mage_serverless, "sign_receipt", side_effect=lambda body, **_: (body, b"")
                ),
                patch.dict(
                    mage_serverless.os.environ,
                    {
                        "RUNPOD_ENDPOINT_ID": "endpoint-a",
                        "VIDEOFORGE_RECEIPT_KEY_ID": "key-a",
                        "VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX": "4" * 64,
                        "VIDEOFORGE_JOB_SCRATCH_ROOT": str(Path(temporary).resolve()),
                    },
                ),
            ):
                result = asyncio.run(mage_serverless.handler(job))
        runtime.generate.assert_awaited_once_with(
            mage_serverless._inline_item(self._inline_source_job(), 0)
        )
        self.assertEqual(result["status"], "SUCCEEDED")
        self.assertEqual(result["items"][0]["item_id"], "scene-a")
        self.assertEqual(result["items"][0]["output_port_reservation_id"], "reservation-generated")
        self.assertEqual(result["items"][0]["output_sha256"], checksum)
        self.assertEqual(result["items"][0]["output_bytes"], len(body))
        self.assertEqual(result["provenance_receipt"]["items"][0]["output_sha256"], checksum)
        self.assertEqual(result["provenance_receipt"]["items"][0]["output_bytes"], len(body))
        self.assertEqual(
            result["provenance_receipt"]["envelope_sha256"],
            mage_serverless.restricted_canonical_sha256(job["input"]["envelope"]),
        )
        self.assertEqual(
            result["provenance_receipt"]["request_sha256"],
            mage_serverless.restricted_canonical_sha256(
                mage_serverless.request_body_from_payload(job["input"])
            ),
        )
        timings = result["provenance_receipt"]["timings"]
        self.assertGreaterEqual(timings["allocation_ms"], 1)
        self.assertGreaterEqual(timings["container_ready_ms"], timings["allocation_ms"])
        self.assertEqual(
            timings["timing_provenance"]["schema_version"],
            "videoforge-serverless-timing-provenance/v1",
        )
        self.assertEqual(
            timings["timing_provenance"]["provider_timing_source"],
            "RUNPOD_STATUS_DELAY_TIME_MS_AND_EXECUTION_TIME_MS",
        )
        self.assertNotIn("timing_provenance", result)

    def test_handler_detects_model_volume_manifest_mutation_before_receipt(self) -> None:
        body = b"png"
        checksum = "sha256:" + hashlib.sha256(body).hexdigest()
        accepted = self._accepted()
        accepted["artifacts"]["transfer_port_reservation_ids"] = ["reservation-generated"]
        authority = self._generated_authority()
        job = self._job(
            ports={"inputs": [], "outputs": []},
            generated_output_authorities=[authority],
        )
        generated = {
            "output_base64": base64.b64encode(body).decode("ascii"),
            "output_sha256": checksum,
            "bytes": len(body),
            "width": 1280,
            "height": 720,
            "seed": 1,
            "positive_prompt_sha256": "sha256:" + "1" * 64,
            "negative_prompt_sha256": "sha256:" + "2" * 64,
            "source_revision": "a" * 40,
            "model_revision": "b" * 40,
            "renderer_source_profile": "mage-landscape-native-1280x720-v1",
            "generation_duration_ms": 12,
        }
        runtime = SimpleNamespace(ready=True, generate=AsyncMock(return_value=generated))
        with (
            tempfile.TemporaryDirectory() as temporary,
            patch.dict(
                mage_serverless.os.environ,
                {"VIDEOFORGE_JOB_SCRATCH_ROOT": str(Path(temporary).resolve())},
            ),
            patch.object(mage_serverless, "validate_envelope", return_value=accepted),
            patch.object(mage_serverless.MageJob, "from_value", return_value=self._fake_mage_job()),
            patch.object(mage_serverless, "_inline_item", return_value=SimpleNamespace()),
            patch.object(mage_serverless, "_ready_runtime", new=AsyncMock(return_value=runtime)),
            patch.object(mage_serverless, "_put_generated_output", return_value=(123, checksum)),
            patch.object(
                mage_serverless,
                "verify_model_root",
                return_value={"manifest_sha256": "sha256:" + "9" * 64},
            ),
        ):
            result = asyncio.run(mage_serverless.handler(job))
        self.assertEqual(result["failure_code"], "MAGE_SERVERLESS_VOLUME_MUTATION_DETECTED")
        self.assertFalse((Path(temporary) / "jobs" / "attempt-a").exists())

    def test_duplicate_delivery_fails_closed_without_second_runtime_start(self) -> None:
        accepted = self._accepted()
        job = self._job()
        with (
            patch.object(mage_serverless, "validate_envelope", return_value=accepted),
            patch.object(mage_serverless.MageJob, "from_value", return_value=self._fake_mage_job()),
            patch.object(
                mage_serverless,
                "_ready_runtime",
                new=AsyncMock(
                    side_effect=mage_serverless.ServerlessMageError("MAGE_SERVERLESS_NOT_READY")
                ),
            ) as ready,
        ):
            first = asyncio.run(mage_serverless.handler(job))
            second = asyncio.run(mage_serverless.handler(job))
        self.assertEqual(first["error"]["code"], "MAGE_SERVERLESS_NOT_READY")
        self.assertEqual(second["error"]["code"], "MAGE_SERVERLESS_DUPLICATE_DELIVERY")
        self.assertEqual(ready.await_count, 1)

    def test_cancel_and_timeout_cleanup_remove_job_scratch(self) -> None:
        port = self._port()
        for terminal_error, reason in (
            (asyncio.CancelledError(), "CANCEL"),
            (TimeoutError(), "TIMEOUT"),
        ):
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary).resolve()
                with self.assertRaises(type(terminal_error)):
                    with mage_serverless._terminal_worker_io(
                        root=root,
                        account_id="account-a",
                        workspace_id="workspace-a",
                        job_id="attempt-a",
                        input_ports=(),
                        output_ports=(port,),
                        now=datetime(2026, 8, 19, tzinfo=UTC),
                    ) as worker_io:
                        scratch_path = worker_io.scratch.path
                        raise terminal_error
                self.assertFalse(scratch_path.exists())
                self.assertFalse((root / "jobs" / "attempt-a").exists())

    def test_handler_timeout_cleans_attempt_scratch(self) -> None:
        accepted = self._accepted()
        job = self._job()
        with (
            tempfile.TemporaryDirectory() as temporary,
            patch.dict(
                mage_serverless.os.environ,
                {"VIDEOFORGE_JOB_SCRATCH_ROOT": str(Path(temporary).resolve())},
            ),
            patch.object(mage_serverless, "validate_envelope", return_value=accepted),
            patch.object(mage_serverless.MageJob, "from_value", return_value=self._fake_mage_job()),
            patch.object(mage_serverless, "_inline_item", return_value=SimpleNamespace()),
            patch.object(
                mage_serverless,
                "_ready_runtime",
                new=AsyncMock(
                    return_value=SimpleNamespace(
                        ready=True,
                        generate=AsyncMock(side_effect=TimeoutError()),
                    )
                ),
            ),
        ):
            result = asyncio.run(mage_serverless.handler(job))
        self.assertEqual(result["failure_code"], "MAGE_SERVERLESS_TIMEOUT")
        self.assertFalse((Path(temporary) / "jobs" / "attempt-a").exists())

    def test_handler_cancel_propagates_and_cleans_attempt_scratch(self) -> None:
        accepted = self._accepted()
        job = self._job()
        with (
            tempfile.TemporaryDirectory() as temporary,
            patch.dict(
                mage_serverless.os.environ,
                {"VIDEOFORGE_JOB_SCRATCH_ROOT": str(Path(temporary).resolve())},
            ),
            patch.object(mage_serverless, "validate_envelope", return_value=accepted),
            patch.object(mage_serverless.MageJob, "from_value", return_value=self._fake_mage_job()),
            patch.object(mage_serverless, "_inline_item", return_value=SimpleNamespace()),
            patch.object(
                mage_serverless,
                "_ready_runtime",
                new=AsyncMock(
                    return_value=SimpleNamespace(
                        ready=True,
                        generate=AsyncMock(side_effect=asyncio.CancelledError()),
                    )
                ),
            ),
        ):
            with self.assertRaises(asyncio.CancelledError):
                asyncio.run(mage_serverless.handler(job))
        self.assertFalse((Path(temporary) / "jobs" / "attempt-a").exists())

    def test_two_independent_readers_use_distinct_scratch_and_authorities(self) -> None:
        async def reader(attempt_id: str) -> tuple[Path, dict[str, str]]:
            port = self._port(attempt_id=attempt_id)
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                with mage_serverless._terminal_worker_io(
                    root=root.resolve(),
                    account_id="account-a",
                    workspace_id="workspace-a",
                    job_id=attempt_id,
                    input_ports=(),
                    output_ports=(port,),
                    now=datetime(2026, 8, 19, tzinfo=UTC),
                ) as worker_io:
                    worker_io.scratch.safe_path("outputs", directory=True)
                    output = worker_io.scratch.safe_path(f"outputs/{attempt_id}.png")
                    output.write_bytes(attempt_id.encode())
                    environment = worker_io.environment()
                    await asyncio.sleep(0)
                    self.assertTrue(output.is_file())
                    self.assertNotIn("/runpod-volume", str(output))
                self.assertFalse(output.exists())
                return output, environment

        async def run_readers() -> tuple[tuple[Path, dict[str, str]], tuple[Path, dict[str, str]]]:
            return await asyncio.gather(reader("reader-a"), reader("reader-b"))

        first, second = asyncio.run(run_readers())
        self.assertNotEqual(first[0], second[0])
        self.assertNotEqual(first[1]["VIDEOFORGE_OUTPUT_ROOT"], second[1]["VIDEOFORGE_OUTPUT_ROOT"])

    def test_handler_is_serialized_through_one_runtime_instance(self) -> None:
        self.assertIsNone(mage_serverless._runtime)


if __name__ == "__main__":
    unittest.main()

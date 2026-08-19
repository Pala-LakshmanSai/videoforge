import asyncio
import base64
import hashlib
import sys
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src"), str(ROOT.parents[0] / "common")]

import mage_serverless  # noqa: E402


class MageServerlessBoundaryTest(unittest.TestCase):
    def setUp(self) -> None:
        mage_serverless._runtime = None
        mage_serverless._claimed_deliveries.clear()

    @staticmethod
    def _accepted(attempt_id: str = "attempt-a") -> dict[str, object]:
        return {
            "dispatch_token": "dispatch-token-0123456789abcdef0123456789abcdef",
            "tenant": {"account_id": "account-a", "workspace_id": "workspace-a"},
            "work": {"lane": "mage_image", "attempt_id": attempt_id, "item_count": 1},
            "runtime": {
                "deployment_id": "deployment-a",
                "volume_id_sha256": "sha256:" + "5" * 64,
                "model_manifest_sha256": "sha256:" + "4" * 64,
                "container_digest": "sha256:" + "3" * 64,
            },
            "artifacts": {"transfer_port_reservation_ids": ["reservation-output"]},
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
    def _generated_authority(
        *,
        attempt_id: str = "attempt-a",
        reservation_id: str = "reservation-generated",
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
                f"lane/mage-image/job/{attempt_id}/artifact/scene-a"
            ),
            "content_type": "image/png",
            "max_content_length": 8,
            "expires_at": expires_at,
            "max_uses": 1,
            "capability_handle": "b" * 64,
        }

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

    def test_rejects_malformed_authority_before_runtime_startup(self) -> None:
        result = asyncio.run(mage_serverless.handler({"input": {}}))
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["error"]["code"], "MAGE_SERVERLESS_JOB_SHAPE_INVALID")

    def test_malformed_authority_is_failure_before_runtime_startup(self) -> None:
        job = self._job()
        job["input"]["envelope"] = {"tenant": None, "runtime": []}
        with patch.object(
            mage_serverless, "_ready_runtime", new=AsyncMock(side_effect=AssertionError)
        ):
            result = asyncio.run(mage_serverless.handler(job))
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["error"]["code"], "ENVELOPE_SCHEMA_UNKNOWN")

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
        accepted["artifacts"] = {"transfer_port_reservation_ids": ["reservation-generated"]}
        cases = (
            ("account_id", "account-foreign", "MAGE_SERVERLESS_GENERATED_OUTPUT_SCOPE_MISMATCH"),
            (
                "path",
                "/tenant/account-a/workspace/workspace-a/job/foreign/artifact/scene-a",
                "MAGE_SERVERLESS_GENERATED_OUTPUT_PATH_MISMATCH",
            ),
            ("expires_at", "2020-01-01T00:00:00Z", "MAGE_SERVERLESS_GENERATED_OUTPUT_EXPIRED"),
            ("max_uses", 0, "MAGE_SERVERLESS_GENERATED_OUTPUT_REPLAY_BOUND_INVALID"),
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

    def test_generated_authority_duplicate_reservation_is_rejected(self) -> None:
        accepted = self._accepted()
        accepted["artifacts"] = {
            "transfer_port_reservation_ids": ["reservation-generated", "reservation-generated"]
        }
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
        self.assertEqual(request.get_header("Content-length"), str(len(body)))
        self.assertEqual(request.get_header("Content-type"), "image/png")

    def test_generated_output_handler_emits_actual_metadata_in_receipt(self) -> None:
        body = b"png"
        checksum = "sha256:" + hashlib.sha256(body).hexdigest()
        accepted = self._accepted()
        accepted["artifacts"] = {"transfer_port_reservation_ids": ["reservation-generated"]}
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
        runtime = SimpleNamespace(
            ready=True,
            gpu={"name": "NVIDIA GeForce RTX 4090", "cuda_version": "12"},
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
                patch.object(mage_serverless, "_inline_item", return_value=SimpleNamespace()),
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
        self.assertEqual(result["status"], "SUCCEEDED")
        self.assertEqual(result["items"][0]["output_port_reservation_id"], "reservation-generated")
        self.assertEqual(result["items"][0]["output_sha256"], checksum)
        self.assertEqual(result["items"][0]["output_bytes"], len(body))
        self.assertEqual(result["provenance_receipt"]["items"][0]["output_sha256"], checksum)
        self.assertEqual(result["provenance_receipt"]["items"][0]["output_bytes"], len(body))

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

    def test_handler_is_serialized_through_one_runtime_instance(self) -> None:
        self.assertIsNone(mage_serverless._runtime)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import asyncio
import copy
import hashlib
import hmac
import json
import os
import sys
import tempfile
import types
import unittest
import wave
from array import array
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = ROOT.parents[1]
sys.path[:0] = [str(ROOT), str(REPOSITORY / "workers/common")]

# The desktop's bare Python intentionally has no package environment.  Keep these stdlib-focused
# tests runnable there while CI/the image use the real generated-contract validator.
try:
    import jsonschema  # noqa: F401
except ModuleNotFoundError:
    contracts = types.ModuleType("videoforge_contracts")
    contracts.validate_contract = lambda _name, _document: None
    validator = types.ModuleType("videoforge_contracts.validator")

    class ContractValidationError(ValueError):
        pass

    validator.ContractValidationError = ContractValidationError
    sys.modules["videoforge_contracts"] = contracts
    sys.modules["videoforge_contracts.validator"] = validator

# SoulX's heavyweight runtime imports are unavailable in the provider-free local interpreter.
if "soulx_runtime" not in sys.modules:
    runtime_module = types.ModuleType("soulx_runtime")

    class SoulXRuntime:  # pragma: no cover - replaced by the test fake
        pass

    runtime_module.SoulXRuntime = SoulXRuntime
    sys.modules["soulx_runtime"] = runtime_module

import soulx_serverless  # noqa: E402


def digest(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


ENVELOPE_SECRET = bytes.fromhex("cd" * 32)
ENVELOPE_KEY_ID = "envelope-key-v1"
ENVELOPE_KEY_SHA256 = digest(ENVELOPE_SECRET)


def sign_envelope(document: dict[str, object]) -> None:
    body = {
        key: value
        for key, value in document.items()
        if key not in {"authority_sha256", "signature"}
    }
    authority_sha256 = digest(canonical(body).encode())
    preimage = canonical(
        {"authority_sha256": authority_sha256, "key_id": ENVELOPE_KEY_ID}
    ).encode()
    document["authority_sha256"] = authority_sha256
    document["signature"] = {
        "algorithm": "HMAC-SHA256",
        "key_id": ENVELOPE_KEY_ID,
        "value": hmac.new(ENVELOPE_SECRET, preimage, hashlib.sha256).hexdigest(),
    }


def wav48(seconds: int) -> bytes:
    samples = array("h", ((index % 401) - 200 for index in range(48_000 * seconds)))
    with tempfile.NamedTemporaryFile(suffix=".wav") as handle:
        with wave.open(handle.name, "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(48_000)
            output.writeframes(samples.tobytes())
        return Path(handle.name).read_bytes()


class FakeRuntime:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def _generate(self, source_b64: str, audio_b64: str) -> dict[str, object]:
        self.calls.append((source_b64, audio_b64))
        body = b"padded-native-mp4-" + str(len(self.calls)).encode()
        return {"output_base64": __import__("base64").b64encode(body).decode()}

    def health(self) -> dict[str, object]:
        return {
            "state": "ready",
            "gpu": {"name": "NVIDIA GeForce RTX 4090", "count": 1},
            "timings": {
                "manifest_verify_ms": 2,
                "model_load_ms": 3,
                "compile_warmup_ms": 4,
                "model_ready_ms": 9,
            },
        }


class FakeHttpResponse:
    def __init__(self, body: bytes, status: int = 200) -> None:
        self.body = body
        self.status = status

    def __enter__(self) -> FakeHttpResponse:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self, size: int) -> bytes:
        return self.body[:size]


class Fixture:
    def __init__(self, durations: tuple[int, ...] = (2, 4, 6, 10)) -> None:
        self.attempt = "attempt-soulx-001"
        self.source = b"owned-avatar-source"
        self.audio = {f"span-{value}": wav48(max(3, value)) for value in durations}
        self.batch = {
            "schema_version": "videoforge-soulx-span-batch/v1",
            "attempt_id": self.attempt,
            "avatar_source": {
                "asset_id": "asset-avatar-source",
                "sha256": digest(self.source),
                "port_reservation_id": "port-source",
            },
            "spans": [
                {
                    "item_id": f"span-{duration}",
                    "audio_asset_id": f"asset-audio-{duration}",
                    "audio_sha256": digest(self.audio[f"span-{duration}"]),
                    "audio_port_reservation_id": f"port-audio-{duration}",
                    "output_reservation_id": f"port-output-{duration}",
                    "padded_samples_48k": 48_000 * max(3, duration),
                    "trim_start_sample_48k": 0,
                    "trim_end_sample_exclusive_48k": 48_000 * duration,
                }
                for duration in durations
            ],
        }
        self.plan_hash = digest(canonical(self.batch).encode())
        self.envelope = {
            "schema": "serverless-worker-job-envelope/v3",
            "dispatch_token": "dispatch-token-0123456789abcdef0123456789abcdef",
            "tenant": {"account_id": "account-a", "workspace_id": "workspace-a"},
            "work": {
                "project_revision_id": "revision-a",
                "generation_request_id": "request-a",
                "task_id": "task-a",
                "attempt_id": self.attempt,
                "lane": "soulx_avatar",
                "items_manifest_sha256": self.plan_hash,
                "item_count": len(durations),
            },
            "runtime": {
                "endpoint_profile_id": "soulx-serverless-v1",
                "deployment_id": "deployment-soulx-1",
                "container_digest": "sha256:" + "3" * 64,
                "model_manifest_sha256": "sha256:" + "4" * 64,
                "volume_id_sha256": "sha256:" + "5" * 64,
                "volume_mount": "/runpod-volume",
                "volume_write_policy": "APPLICATION_READ_ONLY",
                "scratch_root_policy": "JOB_LOCAL_SCRATCH_OUTSIDE_MODEL_VOLUME",
                "gpu_allowlist": ["NVIDIA GeForce RTX 4090"],
                "region": "EU-RO-1",
            },
            "artifacts": {
                "input_manifest_sha256": "sha256:" + "6" * 64,
                "output_prefix": (
                    "tenant/account-a/workspace/workspace-a/project/project-a/revision/"
                    f"revision-a/lane/soulx-avatar/job/{self.attempt}"
                ),
                "plan_manifest_sha256": self.plan_hash,
                "transfer_port_reservation_ids": [
                    "port-source",
                    *(f"port-audio-{duration}" for duration in durations),
                    *(f"port-output-{duration}" for duration in durations),
                ],
            },
            "limits": {
                "issued_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
                "expires_at": "2099-01-01T00:00:00Z",
                "max_items": len(durations),
                "max_input_bytes": 512 * 1024 * 1024,
                "max_output_bytes": 512 * 1024 * 1024,
                "execution_timeout_seconds": 1800,
                "init_timeout_seconds": 800,
            },
            "policy": {
                "model_download_permitted": False,
                "volume_mutation_permitted": False,
                "pod_lifecycle_permitted": False,
                "queue_purge_permitted": False,
            },
            "authority_sha256": "sha256:" + "7" * 64,
            "signature": {
                "algorithm": "HMAC-SHA256",
                "key_id": "key-a",
                "value": "a" * 64,
            },
        }
        sign_envelope(self.envelope)
        self.inputs = [
            self._port("port-source", digest(self.source), len(self.source), "image/png")
        ]
        for duration in durations:
            item_id = f"span-{duration}"
            body = self.audio[item_id]
            self.inputs.append(
                self._port(f"port-audio-{duration}", digest(body), len(body), "audio/wav")
            )
        self.outputs = [self._authority(duration) for duration in durations]
        self.payload = {
            "envelope": self.envelope,
            "batch": self.batch,
            "ports": {"inputs": self.inputs},
            "input_get_urls": [
                f"https://private.example/input/{index}" for index in range(len(self.inputs))
            ],
            "generated_output_authorities": self.outputs,
            "output_put_urls": [f"https://private.example/output/{value}" for value in durations],
        }

    def _port(
        self, reservation: str, checksum: str, size: int, content_type: str
    ) -> dict[str, object]:
        return {
            "schema_version": "artifact-transfer-port/v3",
            "reservation_id": reservation,
            "account_id": "account-a",
            "workspace_id": "workspace-a",
            "method": "GET",
            "path": (
                "/tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/"
                f"lane/soulx-avatar/job/{self.attempt}/artifact/{reservation}"
            ),
            "content_type": content_type,
            "content_length": size,
            "checksum_sha256": checksum,
            "expires_at": "2099-01-01T00:00:00Z",
            "max_uses": 1,
            "capability_handle": "capability-0123456789abcdef0123456789abcdef",
        }

    def _authority(self, duration: int) -> dict[str, object]:
        return {
            "schema_version": "artifact-generated-output-authority/v1",
            "reservation_id": f"port-output-{duration}",
            "account_id": "account-a",
            "workspace_id": "workspace-a",
            "method": "PUT",
            "path": f"/{self.envelope['artifacts']['output_prefix']}/artifact/span-{duration}",
            "content_type": "video/mp4",
            "max_content_length": 64 * 1024 * 1024,
            "expires_at": "2099-01-01T00:00:00Z",
            "max_uses": 1,
            "capability_handle": "capability-0123456789abcdef0123456789abcdef",
        }

    def fetch(self, port: dict[str, object], _url: str, worker_io: object) -> Path:
        body = self.source if port["reservation_id"] == "port-source" else self.audio[
            str(port["reservation_id"]).replace("port-audio-", "span-")
        ]
        path = worker_io.scratch.safe_path(f"inputs/{port['reservation_id']}.bin")
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        path.write_bytes(body)
        return path


class SoulXServerlessTest(unittest.TestCase):
    def setUp(self) -> None:
        soulx_serverless._runtime = None
        soulx_serverless._claimed_deliveries.clear()
        self.environment = patch.dict(
            os.environ,
            {
                "VIDEOFORGE_SOULX_DEPLOYMENT_ID": "deployment-soulx-1",
                "VIDEOFORGE_SOULX_CONTAINER_DIGEST": "sha256:" + "3" * 64,
                "VIDEOFORGE_SOULX_MODEL_MANIFEST_SHA256": "sha256:" + "4" * 64,
                "VIDEOFORGE_SOULX_VOLUME_ID_SHA256": "sha256:" + "5" * 64,
                "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256": "sha256:" + "8" * 64,
                "VIDEOFORGE_SOULX_WARMUP_OUTPUT_SHA256": "sha256:" + "9" * 64,
                "VIDEOFORGE_RECEIPT_KEY_ID": "worker-key-a",
                "VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX": "ab" * 32,
                "VIDEOFORGE_ENVELOPE_KEY_ID": ENVELOPE_KEY_ID,
                "VIDEOFORGE_ENVELOPE_KEY_SHA256": ENVELOPE_KEY_SHA256,
                "VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX": ENVELOPE_SECRET.hex(),
            },
            clear=False,
        )
        self.environment.start()

    def tearDown(self) -> None:
        self.environment.stop()

    def test_prepares_exact_48k_pcm_as_16k_and_preserves_trim_math(self) -> None:
        span = Fixture((2,)).batch["spans"][0]
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "source.wav"
            output = Path(root) / "output.wav"
            source.write_bytes(wav48(3))
            facts = soulx_serverless._prepare_audio_16k(source, output, span)
            with wave.open(str(output), "rb") as prepared:
                self.assertEqual((prepared.getframerate(), prepared.getnchannels()), (16_000, 1))
                self.assertEqual(prepared.getnframes(), 48_000)
            self.assertEqual(facts["trim_end_frame_exclusive_25fps"], 50)
            self.assertEqual(facts["trim_end_sample_exclusive_48k"], 96_000)

    def test_resume_readback_requires_exact_durable_bytes(self) -> None:
        body = b"durable-native"
        unit = {
            "readback_get_url": "https://private.example/native",
            "output_bytes": len(body),
            "output_sha256": digest(body),
        }
        with patch.object(soulx_serverless, "urlopen", return_value=FakeHttpResponse(body)):
            soulx_serverless._verify_resume_readbacks((unit,))
        with patch.object(
            soulx_serverless, "urlopen", return_value=FakeHttpResponse(b"wrong-native")
        ), self.assertRaisesRegex(
            soulx_serverless.ServerlessSoulXError,
            "SOULX_SERVERLESS_RESUME_READBACK_MISMATCH",
        ):
            soulx_serverless._verify_resume_readbacks((unit,))

    def test_rejects_envelope_receipt_key_reuse_before_runtime_startup(self) -> None:
        fixture = Fixture((2,))
        ready = AsyncMock(side_effect=AssertionError("runtime must remain untouched"))
        with patch.dict(
            os.environ,
            {"VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX": ENVELOPE_SECRET.hex()},
            clear=False,
        ), patch.object(soulx_serverless, "_ready_runtime", ready):
            result = asyncio.run(
                soulx_serverless.handler({"id": "job-key-reuse", "input": fixture.payload})
            )
        self.assertEqual(result["failure_code"], "ENVELOPE_RECEIPT_KEY_REUSE")
        ready.assert_not_awaited()

    def test_tenant_scope_comes_from_each_signed_envelope_not_endpoint_environment(self) -> None:
        fixture = Fixture((2,))
        fixture.envelope["tenant"] = {
            "account_id": "account-another",
            "workspace_id": "workspace-another",
        }
        expected = soulx_serverless._authority_expectations(fixture.envelope)
        self.assertEqual(expected["expected_account_id"], "account-another")
        self.assertEqual(expected["expected_workspace_id"], "workspace-another")
        self.assertNotIn("VIDEOFORGE_SOULX_ACCOUNT_ID", os.environ)
        self.assertNotIn("VIDEOFORGE_SOULX_WORKSPACE_ID", os.environ)

    def test_native_probe_uses_observed_media_and_rejects_declared_fact_drift(self) -> None:
        document = {
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 512,
                    "height": 512,
                    "avg_frame_rate": "25/1",
                    "nb_read_frames": "50",
                    "duration": "2.000000",
                },
                {
                    "codec_type": "audio",
                    "codec_name": "aac",
                    "sample_rate": "16000",
                    "channels": 1,
                    "duration": "2.000000",
                },
            ],
            "format": {"duration": "2.000000"},
        }
        observed = soulx_serverless._parse_native_probe(
            document, expected_frames=50, expected_duration_ms=2_000
        )
        self.assertEqual(
            (observed["width"], observed["fps_num"], observed["frame_count"]),
            (512, 25, 50),
        )
        drifted = copy.deepcopy(document)
        drifted["streams"][0]["width"] = 640
        with self.assertRaisesRegex(
            soulx_serverless.ServerlessSoulXError,
            "SOULX_SERVERLESS_MEDIA_CONTRACT_INVALID",
        ):
            soulx_serverless._parse_native_probe(
                drifted, expected_frames=50, expected_duration_ms=2_000
            )

    def test_runs_ordered_2_4_6_10_batch_and_signs_one_native_clip_per_span(self) -> None:
        fixture = Fixture()
        runtime = FakeRuntime()

        def trim(_body: bytes, path: Path, _span: dict[str, object]) -> bytes:
            body = b"native-" + path.stem.encode()
            path.write_bytes(body)
            return body

        def probe(
            _path: Path, *, expected_frames: int, expected_duration_ms: int
        ) -> dict[str, object]:
            return {
                "format": "mp4",
                "video_codec": "h264",
                "audio_codec": "aac",
                "width": 512,
                "height": 512,
                "fps_num": 25,
                "fps_den": 1,
                "frame_count": expected_frames,
                "duration_ms": expected_duration_ms,
                "video_duration_ms": expected_duration_ms,
                "audio_duration_ms": expected_duration_ms,
                "av_delta_ms": 0,
                "audio_sample_rate_hz": 16_000,
                "audio_channels": 1,
            }

        with tempfile.TemporaryDirectory() as root, patch.dict(
            os.environ, {"VIDEOFORGE_JOB_SCRATCH_ROOT": str(Path(root).resolve())}
        ), patch.object(soulx_serverless, "verify_volume", return_value={
            "manifest_sha256": "sha256:" + "4" * 64
        }), patch.object(
            soulx_serverless, "_ready_runtime", AsyncMock(return_value=runtime)
        ), patch.object(
            soulx_serverless, "_fetch_exact", side_effect=fixture.fetch
        ), patch.object(
            soulx_serverless,
            "_trim_native_mp4",
            side_effect=trim,
        ), patch.object(
            soulx_serverless, "_probe_native_mp4", side_effect=probe
        ), patch.object(
            soulx_serverless, "_put_generated", side_effect=lambda _a, _u, body: digest(body)
        ):
            result = asyncio.run(
                soulx_serverless.handler({"id": "job-a", "input": fixture.payload})
            )
            self.assertEqual(result["status"], "SUCCEEDED", result)
            self.assertEqual(
                [item["item_id"] for item in result["items"]],
                ["span-2", "span-4", "span-6", "span-10"],
            )
            self.assertEqual(
                [item["probe"]["duration_ms"] for item in result["items"]],
                [2_000, 4_000, 6_000, 10_000],
            )
            self.assertTrue(
                all(
                    item["probe"]["native_clip_reused_for_full_and_split"]
                    for item in result["items"]
                )
            )
            self.assertEqual(result["provenance_receipt"]["lane"], "soulx_avatar")
            self.assertEqual(len(runtime.calls), 4)
            self.assertFalse((Path(root) / "jobs" / fixture.attempt).exists())

    def test_resume_verifies_readback_and_dispatches_only_unresolved_spans(self) -> None:
        fixture = Fixture((2, 4))
        accepted_body = b"prior-native"
        resume = {
            "schema_version": "serverless-unit-resume/v1",
            "plan_manifest_sha256": fixture.plan_hash,
            "accepted_units": [
                {
                    "item_id": "span-2",
                    "output_sha256": digest(accepted_body),
                    "output_bytes": len(accepted_body),
                    "artifact_commit_receipt_sha256": "sha256:" + "a" * 64,
                    "signed_provenance_receipt_sha256": "sha256:" + "b" * 64,
                    "readback_port": fixture._port(
                        "prior-readback",
                        digest(accepted_body),
                        len(accepted_body),
                        "video/mp4",
                    ),
                    "readback_get_url": "https://private.example/prior",
                }
            ],
        }
        fixture.payload["resume"] = resume
        fixture.payload["resume_canonical_json"] = canonical(resume)
        fixture.envelope["artifacts"]["resume_manifest_sha256"] = digest(canonical(resume).encode())
        fixture.envelope["work"]["item_count"] = 1
        fixture.payload["ports"]["inputs"] = [fixture.inputs[0], fixture.inputs[2]]
        fixture.payload["input_get_urls"] = [
            "https://private.example/source",
            "https://private.example/audio-4",
        ]
        fixture.payload["generated_output_authorities"] = [fixture.outputs[1]]
        fixture.payload["output_put_urls"] = ["https://private.example/output-4"]
        fixture.envelope["artifacts"]["transfer_port_reservation_ids"] = [
            "port-source",
            "port-audio-4",
            "port-output-4",
        ]
        resume["accepted_units"][0]["readback_port"]["path"] = (
            "/tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/"
            "lane/soulx-avatar/job/attempt-soulx-prior/artifact/span-2"
        )
        fixture.payload["resume_canonical_json"] = canonical(resume)
        fixture.envelope["artifacts"]["resume_manifest_sha256"] = digest(canonical(resume).encode())
        sign_envelope(fixture.envelope)
        runtime = FakeRuntime()

        def trim(_body: bytes, path: Path, _span: dict[str, object]) -> bytes:
            path.write_bytes(b"native-4")
            return b"native-4"

        with tempfile.TemporaryDirectory() as root, patch.dict(
            os.environ, {"VIDEOFORGE_JOB_SCRATCH_ROOT": str(Path(root).resolve())}
        ), patch.object(soulx_serverless, "verify_volume", return_value={
            "manifest_sha256": "sha256:" + "4" * 64
        }), patch.object(
            soulx_serverless, "_verify_resume_readbacks"
        ) as verify_readback, patch.object(
            soulx_serverless, "_ready_runtime", AsyncMock(return_value=runtime)
        ), patch.object(
            soulx_serverless, "_fetch_exact", side_effect=fixture.fetch
        ), patch.object(
            soulx_serverless, "_trim_native_mp4", side_effect=trim
        ), patch.object(
            soulx_serverless,
            "_probe_native_mp4",
            return_value={
                "format": "mp4",
                "video_codec": "h264",
                "audio_codec": "aac",
                "width": 512,
                "height": 512,
                "fps_num": 25,
                "fps_den": 1,
                "frame_count": 100,
                "duration_ms": 4_000,
                "video_duration_ms": 4_000,
                "audio_duration_ms": 4_000,
                "av_delta_ms": 0,
                "audio_sample_rate_hz": 16_000,
                "audio_channels": 1,
            },
        ), patch.object(
            soulx_serverless, "_put_generated", return_value=digest(b"native-4")
        ):
            result = asyncio.run(
                soulx_serverless.handler({"id": "job-b", "input": fixture.payload})
            )
            self.assertEqual(result["status"], "SUCCEEDED", result)
            self.assertEqual(result["carried_forward_item_ids"], ["span-2"])
            self.assertEqual([item["item_id"] for item in result["items"]], ["span-4"])
            verify_readback.assert_called_once()
            self.assertEqual(len(runtime.calls), 1)

    def test_missing_or_drifted_gpu_fails_before_inference(self) -> None:
        for observed_gpu in (
            {},
            {"name": "NVIDIA GeForce RTX 5090", "count": 1},
            {"name": "NVIDIA GeForce RTX 4090", "count": 2},
        ):
            fixture = Fixture((2,))
            runtime = FakeRuntime()
            health = runtime.health()
            health["gpu"] = observed_gpu
            runtime.health = lambda value=health: value  # type: ignore[method-assign]
            with patch.object(
                soulx_serverless,
                "verify_volume",
                return_value={"manifest_sha256": "sha256:" + "4" * 64},
            ), patch.object(
                soulx_serverless, "_ready_runtime", AsyncMock(return_value=runtime)
            ), patch.object(soulx_serverless, "_generate", AsyncMock()) as generate:
                result = asyncio.run(
                    soulx_serverless.handler({"id": "job-gpu", "input": fixture.payload})
                )
            self.assertEqual(result["failure_code"], "SOULX_SERVERLESS_GPU_NOT_QUALIFIED")
            generate.assert_not_awaited()
            soulx_serverless._claimed_deliveries.clear()

    def test_wrong_lane_fails_before_runtime(self) -> None:
        fixture = Fixture((2,))
        fixture.envelope["work"]["lane"] = "mage_image"
        sign_envelope(fixture.envelope)
        runtime = AsyncMock()
        with patch.object(soulx_serverless, "_ready_runtime", runtime):
            result = asyncio.run(
                soulx_serverless.handler({"id": "job-c", "input": fixture.payload})
            )
        self.assertEqual(result["failure_code"], "SOULX_SERVERLESS_LANE_INVALID")
        runtime.assert_not_awaited()

    def test_runtime_failure_scrubs_attempt_scratch(self) -> None:
        fixture = Fixture((2,))
        with tempfile.TemporaryDirectory() as root, patch.dict(
            os.environ, {"VIDEOFORGE_JOB_SCRATCH_ROOT": str(Path(root).resolve())}
        ), patch.object(soulx_serverless, "verify_volume", return_value={
            "manifest_sha256": "sha256:" + "4" * 64
        }), patch.object(
            soulx_serverless, "_ready_runtime", AsyncMock(return_value=FakeRuntime())
        ), patch.object(
            soulx_serverless, "_fetch_exact", side_effect=fixture.fetch
        ), patch.object(
            soulx_serverless, "_generate", AsyncMock(side_effect=RuntimeError("secret detail"))
        ):
            result = asyncio.run(
                soulx_serverless.handler({"id": "job-d", "input": fixture.payload})
            )
            self.assertEqual(result["failure_code"], "SOULX_SERVERLESS_HANDLER_UNEXPECTED")
            self.assertFalse((Path(root) / "jobs" / fixture.attempt).exists())
            self.assertNotIn("secret detail", json.dumps(result))

    def test_cancellation_propagates_after_scrubbing_attempt_scratch(self) -> None:
        fixture = Fixture((2,))
        with tempfile.TemporaryDirectory() as root, patch.dict(
            os.environ, {"VIDEOFORGE_JOB_SCRATCH_ROOT": str(Path(root).resolve())}
        ), patch.object(
            soulx_serverless,
            "verify_volume",
            return_value={"manifest_sha256": "sha256:" + "4" * 64},
        ), patch.object(
            soulx_serverless, "_ready_runtime", AsyncMock(return_value=FakeRuntime())
        ), patch.object(
            soulx_serverless, "_fetch_exact", side_effect=fixture.fetch
        ):
            entered = asyncio.Event()
            release = asyncio.Event()

            async def blocked_generate(*_args: object) -> dict[str, object]:
                entered.set()
                await release.wait()
                raise AssertionError("cancelled generation resumed")

            async def scenario() -> None:
                with patch.object(soulx_serverless, "_generate", blocked_generate):
                    task = asyncio.create_task(
                        soulx_serverless.handler({"id": "job-e", "input": fixture.payload})
                    )
                    await entered.wait()
                    task.cancel()
                    with self.assertRaises(asyncio.CancelledError):
                        await task

            asyncio.run(scenario())
            self.assertFalse((Path(root) / "jobs" / fixture.attempt).exists())


if __name__ == "__main__":
    unittest.main()

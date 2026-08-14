from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]

import echo_volume as volume  # noqa: E402


class _FakeFastApi:
    def __init__(self, **_kwargs: object) -> None:
        pass

    def on_event(self, _event: str):
        return lambda function: function

    def get(self, _path: str):
        return lambda function: function


sys.modules.setdefault("fastapi", types.SimpleNamespace(FastAPI=_FakeFastApi))
import echo_prepare_service as prepare_service  # noqa: E402
from echo_job import EchoQualificationJob  # noqa: E402
from echo_runtime import SUPPORTED_GPU_NAMES, EchoRuntime  # noqa: E402
from prepare_echo_volume import (  # noqa: E402
    CONFIRMATION,
    preparation_download_environment,
    prepare,
)
from prepare_fp8_artifact import require_fp8_preparation_device  # noqa: E402
from scratch import create_scratch  # noqa: E402
from span_contract import EchoSpanJob, inference_frame_count, trim_filter, validate_output_probe  # noqa: E402


def valid_span(duration_ms: int = 4_000) -> dict[str, object]:
    return {
        "schema_version": "videoforge.echo-span-job/v1",
        "project_revision_id": "revision_cp07_001",
        "span_id": f"span_{duration_ms}",
        "task_key": f"avatar:span_{duration_ms}",
        "attempt_id": f"attempt_{duration_ms}",
        "timeline_composition": "AVATAR_FULL",
        "source_url": "https://objects.example/source.png?signature=redacted",
        "source_sha256": "sha256:" + "1" * 64,
        "span_audio_url": "https://objects.example/span.wav?signature=redacted",
        "span_audio_sha256": "sha256:" + "2" * 64,
        "output_put_url": "https://objects.example/output.mp4?signature=redacted",
        "prompt": "A presenter speaks naturally to the camera.",
        "selected_start_ms": 1_000,
        "selected_end_ms_exclusive": 1_000 + duration_ms,
        "padded_start_ms": 500,
        "padded_end_ms_exclusive": 1_500 + duration_ms,
        "trim_start_ms": 500,
        "trim_end_ms_exclusive": 500 + duration_ms,
        "audio_sample_rate_hz": 16_000,
        "audio_channels": 1,
        "full_voiceover_dispatched": False,
    }


def make_volume(root: Path, *, lane: str = volume.ECHO_LANE) -> dict[str, object]:
    files: list[dict[str, object]] = []
    for item in volume.ECHO_REQUIRED_SOURCE_FILES:
        path = root / item.path
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("wb") as stream:
            stream.truncate(item.bytes)
        files.append(
            {"path": item.path, "bytes": item.bytes, "sha256": item.sha256, "role": "source"}
        )
    prepared = root / volume.ECHO_PREPARED_STATE_PATH
    prepared.parent.mkdir(parents=True, exist_ok=True)
    prepared.write_bytes(b"prepared-fp8")
    prepared_hash = hashlib.sha256(prepared.read_bytes()).hexdigest()
    report = root / volume.ECHO_PREPARATION_REPORT_PATH
    report.write_bytes(b"{}")
    files.extend(
        [
            {
                "path": volume.ECHO_PREPARED_STATE_PATH,
                "bytes": prepared.stat().st_size,
                "sha256": prepared_hash,
                "role": "prepared",
            },
            {
                "path": volume.ECHO_PREPARATION_REPORT_PATH,
                "bytes": report.stat().st_size,
                "sha256": hashlib.sha256(report.read_bytes()).hexdigest(),
                "role": "prepared",
            },
        ]
    )
    body = volume.manifest_body(
        volume_id_hash="sha256:" + hashlib.sha256(b"echo-volume").hexdigest(),
        prepared_at="2026-08-14T00:00:00Z",
        files=files,
        prepared_state_sha256=prepared_hash,
        prepared_state_bytes=prepared.stat().st_size,
        quantized_linear_count=10,
        actual_source_bytes=volume.ECHO_SELECTED_RUNTIME_BLOB_BYTES,
    )
    body["lane"] = lane
    manifest = volume.seal_manifest(body)
    (root / volume.ECHO_MANIFEST_NAME).write_text(json.dumps(manifest), encoding="utf-8")
    (root / volume.ECHO_MARKER_NAME).write_text(
        json.dumps(
            {
                "schema_version": "videoforge.echo-flash-turbo-fp8-volume-completion/v1",
                "manifest_sha256": manifest["manifest_sha256"],
            }
        ),
        encoding="utf-8",
    )
    return manifest


class Cp07WorkerTest(unittest.TestCase):
    def test_l4_runtime_identity_is_exact_and_bounded(self) -> None:
        self.assertEqual(SUPPORTED_GPU_NAMES["NVIDIA L4"], ("NVIDIA L4", 22_000, (8, 9)))

    def test_fp8_preparation_requires_cuda_89_or_newer(self) -> None:
        class FakeCuda:
            available = True
            capability = (8, 9)

            @classmethod
            def is_available(cls) -> bool:
                return cls.available

            @classmethod
            def get_device_capability(cls, _device: object) -> tuple[int, int]:
                return cls.capability

        fake_torch = types.SimpleNamespace(cuda=FakeCuda, device=lambda value: value)
        self.assertEqual(require_fp8_preparation_device(fake_torch), "cuda")
        FakeCuda.capability = (8, 6)
        with self.assertRaisesRegex(RuntimeError, "ECHO_PREPARATION_GPU_FP8_UNSUPPORTED"):
            require_fp8_preparation_device(fake_torch)
        FakeCuda.available = False
        with self.assertRaisesRegex(RuntimeError, "ECHO_PREPARATION_CUDA_REQUIRED"):
            require_fp8_preparation_device(fake_torch)

    def test_fp8_preparation_moves_transformer_to_cuda_before_quantization(self) -> None:
        source = (ROOT / "prepare_fp8_artifact.py").read_text(encoding="utf-8")
        move = source.index("transformer.to(device=preparation_device, dtype=torch.bfloat16)")
        synchronize = source.index("torch.cuda.synchronize(preparation_device)")
        quantize = source.index("quantize_(transformer, float8_dynamic_activation_float8_weight())")
        self.assertLess(move, synchronize)
        self.assertLess(synchronize, quantize)

    def test_exact_pinned_lineage_bytes_and_derived_capacity(self) -> None:
        self.assertEqual(
            sum(item.bytes for item in volume.ECHO_REQUIRED_SOURCE_FILES),
            volume.ECHO_SELECTED_RUNTIME_BLOB_BYTES,
        )
        self.assertEqual(volume.ECHO_VOLUME_SIZE_GB, 50)
        self.assertEqual(volume.ECHO_PINNED_SMALL_CONFIG_MAX_BYTES, 50_000_000)
        self.assertEqual(volume.ECHO_MINIMUM_POST_PREPARATION_HEADROOM_BYTES, 22_027_682_265)
        self.assertEqual(volume.ECHO_TORCH_VERSION, "2.7.1")
        self.assertEqual(volume.ECHO_TORCHAO_VERSION, "0.11.0")
        self.assertEqual(volume.ECHO_UPSTREAM_MODEL_ID, "EchoMimicV3-Flash")
        self.assertEqual(volume.ECHO_RUNTIME_PROFILE_LABEL, "EchoMimicV3-Flash Turbo FP8")
        self.assertEqual(volume.ECHO_RUNTIME_PROFILE_ID, "videoforge_echo_v3_flash_turbo_fp8_v1")

    def test_volume_verifies_exact_manifest_and_weights_only_policy(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = make_volume(root)
            hashes = {str(item["path"]): str(item["sha256"]) for item in manifest["files"]}
            with patch.object(
                volume,
                "sha256_file",
                side_effect=lambda path: hashes[path.relative_to(root).as_posix()],
            ):
                observed = volume.verify_model_root(
                    root, expected_volume_id_hash=manifest["volume_id_hash"]
                )
            self.assertEqual(observed["toolchain"]["load_policy"], "weights_only_true")
            self.assertFalse(observed["runtime"]["first_request_quantization"])
            self.assertEqual(observed["upstream_model_id"], "EchoMimicV3-Flash")
            self.assertEqual(observed["model_id"], "EchoMimicV3-Flash Turbo FP8")

    def test_missing_cross_lane_extra_and_mutated_volumes_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_volume(root, lane="mage_image")
            with self.assertRaisesRegex(volume.EchoVolumeError, "ECHO_VOLUME_LANE_MISMATCH"):
                volume.verify_model_root(root)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_volume(root)
            (root / volume.ECHO_REQUIRED_SOURCE_FILES[0].path).unlink()
            with self.assertRaisesRegex(volume.EchoVolumeError, "ECHO_VOLUME_FILE_SET_MISMATCH"):
                volume.verify_model_root(root)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_volume(root)
            (root / "prepared/foreign.pkl").write_bytes(b"unsafe")
            with self.assertRaisesRegex(volume.EchoVolumeError, "ECHO_VOLUME_FILE_SET_MISMATCH"):
                volume.verify_model_root(root)

    def test_preparation_requires_mode_confirmation_and_exact_volume(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(RuntimeError, "ECHO_PREPARATION_CONFIRMATION_INVALID"):
                prepare(
                    Path(temporary),
                    volume_id="echo_volume",
                    volume_size_gb=50,
                    confirmation=CONFIRMATION + "_WRONG",
                )
        with tempfile.TemporaryDirectory() as temporary:
            with patch.dict(os.environ, {}, clear=True):
                with self.assertRaisesRegex(RuntimeError, "ECHO_PREPARATION_MODE_REQUIRED"):
                    prepare(
                        Path(temporary),
                        volume_id="echo_volume",
                        volume_size_gb=50,
                        confirmation=CONFIRMATION,
                    )

    def test_preparation_clears_import_time_offline_flags_only_inside_exact_mode(self) -> None:
        names = ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "DIFFUSERS_OFFLINE")
        with patch.dict(
            os.environ,
            {
                "VIDEOFORGE_ECHO_PREPARATION": "1",
                **{name: "1" for name in names},
            },
            clear=True,
        ):
            with preparation_download_environment():
                for name in names:
                    self.assertNotIn(name, os.environ)
            for name in names:
                self.assertEqual(os.environ[name], "1")
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "ECHO_PREPARATION_MODE_REQUIRED"):
                with preparation_download_environment():
                    pass

    def test_preparation_service_exposes_only_hashed_volume_identity(self) -> None:
        marker = {"manifest_sha256": "sha256:" + "f" * 64}
        with (
            patch.dict(
                os.environ,
                {
                    "VIDEOFORGE_ECHO_VOLUME_ID": "private-volume-id",
                    "VIDEOFORGE_ECHO_DOWNLOAD_CONFIRMATION": CONFIRMATION,
                },
                clear=True,
            ),
            patch("echo_prepare_service.prepare", return_value=marker),
        ):
            prepare_service._run()
            health = asyncio.run(prepare_service.health())
        self.assertEqual(health["phase"], "ready")
        self.assertEqual(health["volume"]["requested_size_gb"], 50)
        self.assertNotIn("private-volume-id", json.dumps(health))

    def test_ordinary_image_is_offline_immutable_and_not_serverless(self) -> None:
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
        workflow = (ROOT.parents[1] / ".github/workflows/avatar-primary-image.yml").read_text(
            encoding="utf-8"
        )
        active = "\n".join(
            (ROOT / name).read_text(encoding="utf-8")
            for name in (
                "echo-entrypoint.py",
                "echo_api.py",
                "echo_bootstrap.py",
                "echo_prepare_service.py",
                "echo_runtime.py",
                "echo_backend.py",
            )
        )
        self.assertIn(
            "@sha256:c16f4c749e2d9e96878875cdf6cc45cddda1d1a36fddd371dd6f2360f1b6e2a2", dockerfile
        )
        self.assertIn("HF_HUB_OFFLINE=1", dockerfile)
        self.assertIn("enable_preparation_downloads()", active)
        self.assertIn(
            "PYTHONPATH=/opt/videoforge:/opt/videoforge/src:/opt/echomimic_v3", dockerfile
        )
        self.assertIn("default: false", workflow)
        self.assertIn("videoforge-echo-flash-turbo-cp07", workflow)
        self.assertNotIn("runpod.serverless", active)
        self.assertNotIn("snapshot_download", active)
        self.assertNotIn("hf_hub_download", active)
        self.assertNotIn("quantize_", active)
        self.assertIn("weights_only=True", active)

    def test_exact_two_four_six_second_padding_trim_and_frames(self) -> None:
        for duration in (2_000, 4_000, 6_000):
            job = EchoSpanJob.from_value(valid_span(duration))
            self.assertEqual(job.core_duration_ms, duration)
            self.assertEqual(job.padded_duration_ms, duration + 1_000)
            self.assertEqual(job.inference_frames, inference_frame_count(duration + 1_000))
            self.assertIn("trim=start=0.500", trim_filter(job))

    def test_full_voiceover_padding_audio_and_unknown_fields_fail(self) -> None:
        candidates: list[dict[str, object]] = []
        for key, value in (
            ("full_voiceover_dispatched", True),
            ("selected_end_ms_exclusive", 20_000),
            ("padded_start_ms", 0),
            ("audio_sample_rate_hz", 48_000),
        ):
            candidate = valid_span()
            candidate[key] = value
            candidates.append(candidate)
        unknown = valid_span()
        unknown["num_output_frames"] = 253
        candidates.append(unknown)
        for candidate in candidates:
            with self.assertRaises(ValueError):
                EchoSpanJob.from_value(candidate)

    def test_qualification_accepts_only_owned_two_four_six_contract(self) -> None:
        value = valid_span(2_000)
        for key in ("source_url", "span_audio_url", "output_put_url"):
            value.pop(key)
        value.update(
            {
                "mode": "OWNED_CP07_QUALIFICATION_V1",
                "source_base64": base64.b64encode(b"source").decode(),
                "span_audio_base64": base64.b64encode(b"audio").decode(),
            }
        )
        value["source_sha256"] = "sha256:" + hashlib.sha256(b"source").hexdigest()
        value["span_audio_sha256"] = "sha256:" + hashlib.sha256(b"audio").hexdigest()
        self.assertEqual(EchoQualificationJob.from_value(value).span_job().core_duration_ms, 2_000)

    def test_project_isolated_scratch_rejects_cross_mount_and_collision(self) -> None:
        job = EchoSpanJob.from_value(valid_span())
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model = root / "model"
            model.mkdir()
            scratch = create_scratch(job, scratch_root=root / "scratch", model_root=model)
            with self.assertRaises(FileExistsError):
                create_scratch(job, scratch_root=root / "scratch", model_root=model)
            scratch.cleanup()
            self.assertFalse(scratch.root.exists())
            with self.assertRaisesRegex(ValueError, "ECHO_SCRATCH_CROSS_MOUNT_FORBIDDEN"):
                create_scratch(job, scratch_root=model / "scratch", model_root=model)

    def test_output_contract_allows_one_native_frame_tolerance_only(self) -> None:
        job = EchoSpanJob.from_value(valid_span())
        validate_output_probe(
            duration_ms=4_040,
            fps=25,
            width=768,
            height=768,
            has_video=True,
            has_audio=True,
            job=job,
        )
        with self.assertRaisesRegex(ValueError, "ECHO_SPAN_OUTPUT_INVALID"):
            validate_output_probe(
                duration_ms=4_041,
                fps=25,
                width=768,
                height=768,
                has_video=True,
                has_audio=True,
                job=job,
            )

    def test_model_ready_requires_real_warmup_after_load(self) -> None:
        events: list[str] = []

        class FakeBackend:
            def __init__(self, _root: Path) -> None:
                events.append("construct")

            def load(self) -> dict[str, object]:
                events.append("load")
                return {"prepared_state_loaded": True}

            def warm_up(self, root: Path) -> dict[str, object]:
                events.append("warmup")
                (root / "proof").write_bytes(b"ok")
                return {"real_inference_path": True, "frames": 5}

        with tempfile.TemporaryDirectory() as temporary:
            runtime = EchoRuntime(backend_factory=FakeBackend)
            with (
                patch.object(runtime, "verify_runtime_identity"),
                patch.object(runtime, "verify_gpu"),
                patch.object(runtime, "device_vram_used_bytes", return_value=1),
                patch("echo_runtime.bootstrap", return_value={"downloaded_model_bytes": 0}),
                patch.dict(
                    os.environ,
                    {
                        "ECHO_MODEL_ROOT": str(Path(temporary) / "model"),
                        "ECHO_SCRATCH_ROOT": str(Path(temporary) / "scratch"),
                    },
                    clear=False,
                ),
            ):
                asyncio.run(runtime.startup())
            self.assertTrue(runtime.ready)
            self.assertEqual(events, ["construct", "load", "warmup"])
            self.assertEqual(runtime.health()["model"]["status"], "ready")


if __name__ == "__main__":
    unittest.main()

import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from videoforge_avatar_quality.production import (  # noqa: E402
    SKYREELS_MODEL_REVISION,
    SKYREELS_SOURCE_REVISION,
    SkyReelsInlineJob,
    SkyReelsJob,
    build_command,
    classify_failure,
    run_inline_job,
)
from videoforge_avatar_quality import production  # noqa: E402


def digest(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


class ProductionContractTest(unittest.TestCase):
    def remote_value(self) -> dict[str, object]:
        return {
            "attempt_id": "attempt_skyreels_001",
            "original_source_url": "https://objects.example/source.png?signature=secret",
            "original_source_sha256": "sha256:" + "1" * 64,
            "span_audio_url": "https://objects.example/audio.wav?signature=secret",
            "span_audio_sha256": "sha256:" + "2" * 64,
            "output_put_url": "https://objects.example/output.mp4?signature=secret",
            "duration_seconds": 5,
        }

    def test_accepts_only_exact_original_source_contract(self) -> None:
        job = SkyReelsJob.from_value(self.remote_value())
        self.assertEqual(job.duration_seconds, 5)
        for key in ["avatarforcing_url", "failed_candidate_url", "prompt", "layout"]:
            value = self.remote_value()
            value[key] = "forbidden"
            with self.assertRaisesRegex(ValueError, "SKYREELS_JOB_SHAPE_INVALID"):
                SkyReelsJob.from_value(value)

    def test_rejects_hostile_urls_digests_duration_and_identity(self) -> None:
        mutations = [
            ("original_source_url", "file:///etc/passwd", "SKYREELS_SIGNED_URL_INVALID"),
            ("span_audio_sha256", "sha256:xyz", "SKYREELS_DIGEST_INVALID"),
            ("duration_seconds", 201, "SKYREELS_DURATION_INVALID"),
            ("attempt_id", "../escape", "SKYREELS_ATTEMPT_ID_INVALID"),
        ]
        for key, replacement, code in mutations:
            value = self.remote_value()
            value[key] = replacement
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, code):
                SkyReelsJob.from_value(value)

    def test_command_is_pinned_static_and_shell_free(self) -> None:
        with patch.dict(
            os.environ,
            {"SKYREELS_ROOT": "/opt/skyreels-v3", "SKYREELS_MODEL_ROOT": "/models/pinned"},
        ):
            command = build_command(Path("/safe/original.png"), Path("/safe/span.wav"), 5)
        self.assertEqual(command[0], "python")
        self.assertIn("talking_avatar", command)
        self.assertIn("/models/pinned", command)
        self.assertIn("720P", command)
        self.assertIn("--offload", command)
        self.assertNotIn("--low_vram", command)
        self.assertNotIn("--use_usp", command)
        self.assertFalse(any("http" in item or "secret" in item for item in command))

    def test_failure_classifier_retains_only_safe_codes(self) -> None:
        self.assertEqual(
            classify_failure(b"torch.OutOfMemoryError secret"), "SKYREELS_INFERENCE_CUDA_OOM"
        )
        self.assertEqual(
            classify_failure(b"ModuleNotFoundError: token"), "SKYREELS_INFERENCE_DEPENDENCY_MISSING"
        )
        self.assertEqual(
            classify_failure(b"provider raw private value"), "SKYREELS_INFERENCE_PROCESS_FAILED"
        )

    def test_inline_scope_and_hashes_fail_closed_before_model_activity(self) -> None:
        image = b"owned-image"
        audio = b"owned-audio"
        value = {
            "mode": "INLINE_QUALIFICATION_V1",
            "attempt_id": "attempt_skyreels_002",
            "original_source_base64": base64.b64encode(image).decode(),
            "original_source_sha256": digest(image),
            "span_audio_base64": base64.b64encode(audio).decode(),
            "span_audio_sha256": digest(audio),
            "duration_seconds": 5,
        }
        job = SkyReelsInlineJob.from_value(value)
        with (
            tempfile.TemporaryDirectory() as temporary,
            patch.dict(os.environ, {"SKYREELS_MODEL_ROOT": temporary}),
        ):
            with self.assertRaisesRegex(ValueError, "SKYREELS_MODEL_NOT_READY"):
                run_inline_job(job)
        broken = dict(value)
        broken["original_source_sha256"] = "sha256:" + "0" * 64
        with (
            tempfile.TemporaryDirectory() as temporary,
            patch.dict(os.environ, {"SKYREELS_MODEL_ROOT": temporary}),
        ):
            with self.assertRaisesRegex(ValueError, "SKYREELS_INPUT_CHECKSUM_MISMATCH"):
                run_inline_job(SkyReelsInlineJob.from_value(broken))

    def test_lineage_revisions_are_exact(self) -> None:
        self.assertEqual(SKYREELS_SOURCE_REVISION, "28c771e8456341be6a213e3d1133ed1fd19bf75d")
        self.assertEqual(SKYREELS_MODEL_REVISION, "fdad4053f492aba389b5a8c3c6982118c6a1ecf3")

    def test_timeout_retains_only_diagnostic_hash(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model = root / "model"
            model.mkdir()
            (model / "config.json").write_text("{}")
            with (
                patch.dict(os.environ, {"SKYREELS_MODEL_ROOT": str(model)}),
                patch.object(
                    production.subprocess,
                    "run",
                    side_effect=subprocess.TimeoutExpired("private", 1),
                ),
            ):
                with self.assertRaises(production.SkyReelsInferenceFailure) as raised:
                    production._execute(
                        "attempt_1", root / "source.png", root / "audio.wav", 5, 1, root
                    )
            self.assertEqual(str(raised.exception), "SKYREELS_INFERENCE_TIMEOUT")
            self.assertRegex(raised.exception.diagnostic_sha256, r"^sha256:[0-9a-f]{64}$")
            self.assertNotIn("private", raised.exception.diagnostic_sha256)

    def test_success_returns_exact_probe_hash_and_lineage(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model = root / "model"
            model.mkdir()
            (model / "config.json").write_text("{}")

            def fake_run(command, **kwargs):
                if command[0] == "python":
                    output = root / "result" / "talking_avatar" / "42_with_audio.mp4"
                    output.parent.mkdir(parents=True)
                    output.write_bytes(b"valid-mp4")
                    return subprocess.CompletedProcess(command, 0)
                return subprocess.CompletedProcess(
                    command,
                    0,
                    stdout=json.dumps(
                        {
                            "streams": [
                                {
                                    "codec_type": "video",
                                    "width": 960,
                                    "height": 960,
                                    "r_frame_rate": "25/1",
                                },
                                {"codec_type": "audio"},
                            ],
                            "format": {"duration": "5.000"},
                        }
                    ),
                    stderr="",
                )

            with (
                patch.dict(os.environ, {"SKYREELS_MODEL_ROOT": str(model)}),
                patch.object(production.subprocess, "run", side_effect=fake_run),
            ):
                result, output = production._execute(
                    "attempt_2", root / "source.png", root / "audio.wav", 5, 10, root
                )
            self.assertEqual(result["output_sha256"], digest(b"valid-mp4"))
            self.assertEqual(result["duration_ms"], 5000)
            self.assertEqual(result["renderer_source_profile"], "skyreels-centered-960x960p25-v2")
            self.assertEqual(output.read_bytes(), b"valid-mp4")


if __name__ == "__main__":
    unittest.main()

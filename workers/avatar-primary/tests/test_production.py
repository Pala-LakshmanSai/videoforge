import base64
import hashlib
import importlib
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from videoforge_avatar_primary import (  # noqa: E402
    AvatarPrimaryInlineJob,
    AvatarPrimaryJob,
    classify_inference_failure,
)
from videoforge_avatar_primary.production import (  # noqa: E402
    AVATAR_SOURCE_REVISION,
    AVATAR_WEIGHTS_REVISION,
    WAN_REVISION,
    WAV2VEC_REVISION,
    _encode_inline_output,
)


def valid_job() -> dict[str, object]:
    return {
        "attempt_id": "attempt_001",
        "source_url": "https://objects.example/source.jpg?signature=redacted",
        "source_sha256": f"sha256:{'1' * 64}",
        "span_audio_url": "https://objects.example/span.wav?signature=redacted",
        "span_audio_sha256": f"sha256:{'2' * 64}",
        "output_put_url": "https://objects.example/output.mp4?signature=redacted",
        "prompt": "A presenter speaks naturally to the camera.",
        "layout": "AVATAR_FULL",
        "num_output_frames": 25,
    }


class ProductionContractTest(unittest.TestCase):
    def test_classifies_failure_without_exposing_diagnostic_text(self) -> None:
        cases = {
            b"torch.cuda.OutOfMemoryError: CUDA out of memory": "AVATAR_INFERENCE_CUDA_OOM",
            b"torch.OutOfMemoryError: allocation failed": "AVATAR_INFERENCE_CUDA_OOM",
            b"ModuleNotFoundError: No module named x": "AVATAR_INFERENCE_DEPENDENCY_MISSING",
            b"FileNotFoundError: No such file or directory": "AVATAR_INFERENCE_ASSET_MISSING",
            b"ffmpeg: Invalid data found when processing input": "AVATAR_INFERENCE_MEDIA_INVALID",
            b"unrecognized upstream traceback": "AVATAR_INFERENCE_PROCESS_FAILED",
        }
        for diagnostic, expected in cases.items():
            self.assertEqual(classify_inference_failure(diagnostic), expected)

    def test_handler_starts_before_model_bootstrap(self) -> None:
        worker_root = Path(__file__).resolve().parents[1]
        entrypoint = (worker_root / "entrypoint.sh").read_text(encoding="utf-8")
        bootstrap = (worker_root / "bootstrap_models.py").read_text(encoding="utf-8")
        self.assertNotIn("bootstrap_models.py", entrypoint)
        self.assertIn("exec python /opt/videoforge/handler.py", entrypoint)
        for revision in [
            AVATAR_WEIGHTS_REVISION,
            WAN_REVISION,
            WAV2VEC_REVISION,
        ]:
            self.assertIn(revision, bootstrap)

    def test_handler_registers_exact_callable_without_bootstrapping_models(self) -> None:
        worker_root = Path(__file__).resolve().parents[1]
        sys.path.insert(0, str(worker_root))
        observed: list[dict[str, object]] = []
        fake_runpod = types.SimpleNamespace(
            serverless=types.SimpleNamespace(
                start=lambda config: observed.append(config),
                progress_update=lambda _event, _progress: None,
            )
        )
        previous = sys.modules.get("runpod")
        previous_bootstrap = sys.modules.get("bootstrap_models")
        sys.modules["runpod"] = fake_runpod  # type: ignore[assignment]
        sys.modules["bootstrap_models"] = types.SimpleNamespace(
            bootstrap_models=lambda _progress: None
        )  # type: ignore[assignment]
        try:
            module = importlib.import_module("handler")
            module.start_worker()
            self.assertEqual(len(observed), 1)
            self.assertIs(observed[0]["handler"], module.handler)
        finally:
            sys.modules.pop("handler", None)
            if previous is None:
                sys.modules.pop("runpod", None)
            else:
                sys.modules["runpod"] = previous
            if previous_bootstrap is None:
                sys.modules.pop("bootstrap_models", None)
            else:
                sys.modules["bootstrap_models"] = previous_bootstrap
            sys.path.remove(str(worker_root))

    def test_accepts_exact_short_span_and_pins_every_upstream_revision(self) -> None:
        job = AvatarPrimaryJob.from_value(valid_job())
        self.assertEqual(job.num_output_frames, 25)
        self.assertEqual(AVATAR_SOURCE_REVISION, "63b73e6c0f7bb42180ca6d7e1bf11c1de1a80b39")
        self.assertEqual(AVATAR_WEIGHTS_REVISION, "e2448919a7b535c29f34e07892884ae1a43c6ace")
        self.assertEqual(WAN_REVISION, "37ec512624d61f7aa208f7ea8140a131f93afc9a")
        self.assertEqual(WAV2VEC_REVISION, "22aad52d435eb6dbaf354bdad9b0da84ce7d6156")

    def test_rejects_full_voiceover_oversize_frames_layout_and_unknown_fields(self) -> None:
        cases = []
        for key, value in [
            ("num_output_frames", 254),
            ("num_output_frames", 24),
            ("layout", "IMAGE_FULL"),
            ("source_url", "file:///private/source.jpg"),
        ]:
            candidate = valid_job()
            candidate[key] = value
            cases.append(candidate)
        unknown = valid_job()
        unknown["full_voiceover_url"] = "https://objects.example/full.wav"
        cases.append(unknown)
        for candidate in cases:
            with self.assertRaises(ValueError):
                AvatarPrimaryJob.from_value(candidate)

    def test_inline_qualification_is_checksum_bound_and_bounded(self) -> None:
        source = b"owned-source"
        audio = b"owned-audio"
        value = {
            "mode": "INLINE_QUALIFICATION_V1",
            "attempt_id": "qualification_001",
            "source_base64": base64.b64encode(source).decode("ascii"),
            "source_sha256": f"sha256:{hashlib.sha256(source).hexdigest()}",
            "span_audio_base64": base64.b64encode(audio).decode("ascii"),
            "span_audio_sha256": f"sha256:{hashlib.sha256(audio).hexdigest()}",
            "prompt": "An owned synthetic presenter speaks naturally.",
            "layout": "AVATAR_FULL",
            "num_output_frames": 5,
        }
        self.assertEqual(AvatarPrimaryInlineJob.from_value(value).num_output_frames, 5)
        value["num_output_frames"] = 253
        self.assertEqual(AvatarPrimaryInlineJob.from_value(value).num_output_frames, 253)
        for invalid in (4, 6, 254):
            value["num_output_frames"] = invalid
            with self.assertRaisesRegex(ValueError, "AVATAR_INLINE_SCOPE_INVALID"):
                AvatarPrimaryInlineJob.from_value(value)

    def test_inline_output_is_loss_light_and_response_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source.mp4"
            destination = Path(temporary) / "inline.mp4"
            source.write_bytes(b"source")

            def encode(arguments: list[str], **_kwargs: object) -> object:
                destination.write_bytes(b"encoded")
                self.assertIn("20", arguments)
                self.assertIn("+faststart", arguments)
                return object()

            with (
                patch(
                    "videoforge_avatar_primary.production.subprocess.run",
                    side_effect=encode,
                ),
                patch(
                    "videoforge_avatar_primary.production._probe",
                    return_value=(10_120, 25, 832, 480),
                ),
            ):
                _encode_inline_output(source, destination)

            self.assertEqual(destination.read_bytes(), b"encoded")


if __name__ == "__main__":
    unittest.main()

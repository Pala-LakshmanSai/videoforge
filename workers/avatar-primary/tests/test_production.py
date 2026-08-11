import base64
import hashlib
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from videoforge_avatar_primary import AvatarPrimaryInlineJob, AvatarPrimaryJob  # noqa: E402
from videoforge_avatar_primary.production import (  # noqa: E402
    AVATAR_SOURCE_REVISION,
    AVATAR_WEIGHTS_REVISION,
    WAN_REVISION,
    WAV2VEC_REVISION,
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
            ("num_output_frames", 226),
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

    def test_inline_qualification_is_checksum_bound_and_exactly_five_frames(self) -> None:
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
        value["num_output_frames"] = 9
        with self.assertRaisesRegex(ValueError, "AVATAR_INLINE_SCOPE_INVALID"):
            AvatarPrimaryInlineJob.from_value(value)


if __name__ == "__main__":
    unittest.main()

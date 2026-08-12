import importlib.util
import json
import sys
import threading
import types
import unittest
from pathlib import Path
from unittest.mock import patch

WORKER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_ROOT))
sys.path.insert(0, str(WORKER_ROOT / "src"))
sys.modules.setdefault(
    "runpod",
    types.SimpleNamespace(
        serverless=types.SimpleNamespace(progress_update=lambda *_: None, start=lambda *_: None)
    ),
)
SPEC = importlib.util.spec_from_file_location(
    "mage_worker_handler", WORKER_ROOT / "mage_handler.py"
)
assert SPEC and SPEC.loader
handler = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(handler)


class MageWorkerImageTest(unittest.TestCase):
    def test_dockerfile_and_workflow_pin_exact_candidate(self) -> None:
        dockerfile = (WORKER_ROOT / "Dockerfile.mage").read_text(encoding="utf-8")
        flash_dockerfile = (WORKER_ROOT / "Dockerfile.mage-flash").read_text(encoding="utf-8")
        workflow = (WORKER_ROOT.parents[1] / ".github/workflows/mage-image.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("395402ba3ef110c96e70d01abe4d178dbe4e01a5", dockerfile)
        self.assertIn(
            "6df47df3d7efc9ebdad075b87b3e9e4f74d09dca672d592271788f0ee27ab97d", dockerfile
        )
        self.assertIn("mage-no-watermark.patch", dockerfile)
        self.assertIn("HF_HUB_OFFLINE=1", dockerfile)
        self.assertIn(
            "1e71dd64a9e0280e0447b8a0c2541bad4bf6ac65bdeaa2f90e51a9e57de0370d",
            flash_dockerfile,
        )
        self.assertIn("MAX_JOBS=2", flash_dockerfile)
        self.assertIn("needs: flash-wheel", workflow)
        self.assertIn("Dockerfile.mage", workflow)

    def test_embedded_model_marker_is_exact(self) -> None:
        import tempfile

        from mage_bootstrap import REQUIRED_FILES, verify_embedded_model
        from videoforge_image_media import (
            MAGE_MODEL_ID,
            MAGE_MODEL_REVISION,
            MAGE_REPOSITORY_BYTE_CEILING,
            MAGE_TRANSFORMER_BYTES,
            MAGE_TRANSFORMER_SHA256,
        )

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for relative in REQUIRED_FILES:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            marker = {
                "model_id": MAGE_MODEL_ID,
                "model_revision": MAGE_MODEL_REVISION,
                "repository_byte_ceiling": MAGE_REPOSITORY_BYTE_CEILING,
                "transformer_bytes": MAGE_TRANSFORMER_BYTES,
                "transformer_sha256": MAGE_TRANSFORMER_SHA256,
            }
            (root / ".videoforge-model.json").write_text(json.dumps(marker), encoding="utf-8")
            verify_embedded_model(root)
            marker["model_revision"] = "1" * 40
            (root / ".videoforge-model.json").write_text(json.dumps(marker), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "MAGE_MODEL_MARKER_MISMATCH"):
                verify_embedded_model(root)

    def test_cancel_and_unknown_failure_are_fail_closed(self) -> None:
        with patch.object(handler, "ensure_model") as ensure:
            self.assertEqual(
                handler.handler({"input": {"cancel_requested": True}}),
                {"ok": False, "error_code": "MAGE_INFERENCE_CANCELLED"},
            )
        ensure.assert_not_called()
        self.assertEqual(
            handler.handler({"input": {}}),
            {"ok": False, "error_code": "MAGE_INLINE_JOB_SHAPE_INVALID"},
        )

    def test_progress_heartbeat_is_best_effort_and_ordered(self) -> None:
        phases: list[str] = []
        heartbeat_seen = threading.Event()

        def progress(_event, phase: str) -> None:
            phases.append(phase)
            if phase.startswith("inference_mage_heartbeat_"):
                heartbeat_seen.set()

        def operation() -> str:
            self.assertTrue(heartbeat_seen.wait(timeout=1))
            return "accepted"

        with patch.object(handler.runpod.serverless, "progress_update", side_effect=progress):
            result = handler.run_with_heartbeat({}, operation, interval_seconds=0.01)
        self.assertEqual(result, "accepted")
        self.assertEqual(phases[0], "inference_mage_started")
        self.assertEqual(phases[-1], "output_mage_validated")


if __name__ == "__main__":
    unittest.main()

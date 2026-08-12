import importlib.util
import json
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]
sys.modules.setdefault(
    "runpod",
    types.SimpleNamespace(
        serverless=types.SimpleNamespace(progress_update=lambda *_: None, start=lambda *_: None)
    ),
)
spec = importlib.util.spec_from_file_location("mage_worker_handler", ROOT / "mage_handler.py")
assert spec and spec.loader
handler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(handler)


class MageWorkerImageTest(unittest.TestCase):
    def test_image_is_pinned_comfy_bf16_without_flash_route(self) -> None:
        dockerfile = (ROOT / "Dockerfile.mage").read_text(encoding="utf-8")
        workflow = (ROOT.parents[1] / ".github/workflows/mage-image.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            "7b324d212a4450795b49edba9949b7cdc72429148a64e974334bfe5774d51385", dockerfile
        )
        self.assertIn("1108f2ac5e412b27accb0e5d51c90ef2ba39784d", dockerfile)
        self.assertIn("Comfy-Org/ComfyUI", dockerfile)
        self.assertNotIn("flash_attn", dockerfile + workflow)
        self.assertNotIn("microsoft/Mage", dockerfile)
        self.assertIn(
            "--disable-metadata", (ROOT / "mage-entrypoint.py").read_text(encoding="utf-8")
        )
        self.assertFalse((ROOT / "Dockerfile.mage-flash").exists())
        self.assertFalse((ROOT / "mage-no-watermark.patch").exists())

    def test_model_marker_and_hashes_fail_closed(self) -> None:
        from mage_bootstrap import FILES, verify_model_root
        from videoforge_image_media import MAGE_MODEL_ID, MAGE_MODEL_REVISION

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker = {
                "model_id": MAGE_MODEL_ID,
                "model_revision": MAGE_MODEL_REVISION,
                "files": [{"path": p, "bytes": s, "sha256": d} for p, s, d in FILES],
            }
            (root / ".videoforge-model.json").write_text(json.dumps(marker), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "MAGE_MODEL_FILE_INVALID"):
                verify_model_root(root)

    def test_cancel_and_unknown_failure_fail_closed(self) -> None:
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

    def test_progress_heartbeat_is_ordered(self) -> None:
        phases: list[str] = []
        seen = threading.Event()

        def progress(_event, phase: str) -> None:
            phases.append(phase)
            if "heartbeat" in phase:
                seen.set()

        def operation() -> str:
            self.assertTrue(seen.wait(timeout=1))
            return "accepted"

        with patch.object(handler.runpod.serverless, "progress_update", side_effect=progress):
            result = handler.run_with_heartbeat({}, operation, interval_seconds=0.01)
        self.assertEqual(result, "accepted")
        self.assertEqual(phases[0], "inference_mage_started")
        self.assertEqual(phases[-1], "output_mage_validated")


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import importlib.util
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
bootstrap_module = types.ModuleType("bootstrap_models")
bootstrap_module.bootstrap_models = lambda *_: {}
sys.modules.setdefault("bootstrap_models", bootstrap_module)
spec = importlib.util.spec_from_file_location("avatar_primary_handler", WORKER_ROOT / "handler.py")
assert spec and spec.loader
handler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(handler)


class HandlerProgressTest(unittest.TestCase):
    def test_inference_progress_is_ordered(self) -> None:
        stages: list[str] = []
        heartbeat_seen = threading.Event()

        def progress(_event, stage: str) -> None:
            stages.append(stage)
            if stage.startswith("inference_echomimic_heartbeat_"):
                heartbeat_seen.set()

        def operation() -> str:
            self.assertTrue(heartbeat_seen.wait(timeout=1))
            return "accepted"

        with patch.object(handler.runpod.serverless, "progress_update", side_effect=progress):
            result = handler._run_with_heartbeat({}, operation, interval_seconds=0.01)
        self.assertEqual(result, "accepted")
        self.assertEqual(stages[0], "inference_echomimic_started")
        self.assertTrue(stages[1].startswith("inference_echomimic_heartbeat_"))
        self.assertEqual(stages[-1], "output_echomimic_validated")

    def test_progress_transport_failure_does_not_break_inference(self) -> None:
        with patch.object(
            handler.runpod.serverless, "progress_update", side_effect=RuntimeError("private")
        ):
            self.assertEqual(handler._run_with_heartbeat({}, lambda: "accepted"), "accepted")


if __name__ == "__main__":
    unittest.main()

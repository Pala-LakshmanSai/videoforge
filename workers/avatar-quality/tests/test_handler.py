import importlib.util
import sys
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
bootstrap_module.bootstrap_models = lambda *_: None
sys.modules.setdefault("bootstrap_models", bootstrap_module)
SPEC = importlib.util.spec_from_file_location("avatar_quality_handler", WORKER_ROOT / "handler.py")
assert SPEC and SPEC.loader
handler = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(handler)


class HandlerContractTest(unittest.TestCase):
    def test_cancellation_stops_before_bootstrap_or_model_activity(self) -> None:
        with patch.object(handler, "ensure_models") as ensure:
            result = handler.handler({"input": {"cancel_requested": True}})
        self.assertEqual(result, {"ok": False, "error_code": "SKYREELS_CANCELLED"})
        ensure.assert_not_called()

    def test_unknown_exception_is_redacted(self) -> None:
        with patch.object(
            handler.SkyReelsJob, "from_value", side_effect=RuntimeError("private token")
        ):
            result = handler.handler({"input": {}})
        self.assertEqual(result, {"ok": False, "error_code": "SKYREELS_WORKER_FAILED"})
        self.assertNotIn("private", str(result))


if __name__ == "__main__":
    unittest.main()

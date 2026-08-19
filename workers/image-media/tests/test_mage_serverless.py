import asyncio
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src"), str(ROOT.parents[0] / "common")]

import mage_serverless  # noqa: E402


class MageServerlessBoundaryTest(unittest.TestCase):
    def test_rejects_malformed_authority_before_runtime_startup(self) -> None:
        result = asyncio.run(mage_serverless.handler({"input": {}}))
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["error"]["code"], "MAGE_SERVERLESS_JOB_SHAPE_INVALID")

    def test_handler_is_serialized_through_one_runtime_instance(self) -> None:
        self.assertIsNone(mage_serverless._runtime)


if __name__ == "__main__":
    unittest.main()

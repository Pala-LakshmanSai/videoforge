import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from videoforge_avatar_quality import health_payload  # noqa: E402


class HealthContractTest(unittest.TestCase):
    def test_fixture_health_never_claims_model_or_provider_readiness(self) -> None:
        health = health_payload()
        self.assertEqual(health["schema_version"], "worker-health/v1")
        self.assertEqual(health["worker_id"], "avatar-quality")
        self.assertEqual(health["process_state"], "ready")
        self.assertEqual(health["model_state"], "not_loaded")
        self.assertEqual(health["provider_mode"], "fixture")
        self.assertTrue(health["synthetic"])
        self.assertFalse(health["provider_calls_authorized"])
        self.assertEqual(health["external_spend_usd"], 0)


if __name__ == "__main__":
    unittest.main()

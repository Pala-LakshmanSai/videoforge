import sys
import unittest
from pathlib import Path

WORKER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_ROOT))

import soulx_volume  # noqa: E402


class SoulXContractTest(unittest.TestCase):
    def test_exact_lineage_and_pro_settings_are_pinned(self) -> None:
        manifest = soulx_volume.expected_manifest()
        self.assertEqual(
            manifest["source"]["revision"],
            "9bc03de06bb0de82cd6bc477804512ae06144bf2",
        )
        self.assertEqual(
            manifest["model"]["revision"],
            "59119b6c681230c3eeee157e224ae1941746711e",
        )
        self.assertEqual(manifest["model_type"], "pro")
        self.assertEqual(manifest["precision"], "bfloat16")
        self.assertEqual(manifest["settings"]["sampling_steps"], 4)
        self.assertEqual(manifest["settings"]["new_frames_per_chunk"], 28)
        self.assertEqual(manifest["settings"]["color_correction_strength"], 1.0)
        self.assertEqual(manifest["total_bytes"], 6_916_084_703)

    def test_manifest_hash_is_deterministic(self) -> None:
        first = soulx_volume.expected_manifest_sha256()
        second = soulx_volume.expected_manifest_sha256()
        self.assertRegex(first, r"^[0-9a-f]{64}$")
        self.assertEqual(first, second)

    def test_runtime_is_offline_and_echo_is_not_in_active_image(self) -> None:
        dockerfile = (WORKER_ROOT / "Dockerfile").read_text()
        self.assertIn("HF_HUB_OFFLINE=1", dockerfile)
        self.assertIn("build-essential", dockerfile)
        self.assertIn("CC=/usr/bin/gcc", dockerfile)
        self.assertIn("SoulX-FlashHead.git", dockerfile)
        self.assertIn("weights_only=True", (WORKER_ROOT / "soulx-single-gpu.patch").read_text())
        self.assertNotIn("echomimic", dockerfile.lower())
        self.assertFalse(any(WORKER_ROOT.glob("echo*.py")))


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import hashlib
import runpy
import tempfile
import unittest
from pathlib import Path

build = runpy.run_path(str(Path(__file__).parents[1] / "prepare_runpod_build.py"))


class RunPodBuildTests(unittest.TestCase):
    def test_wheel_lock_accepts_linux_cp312_and_rejects_wrong_platform_or_hash(self):
        payload = b"locked wheel bytes"
        checksum = hashlib.sha256(payload).hexdigest()
        lock = f"numpy==2.5.3 --hash=sha256:{checksum}"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            accepted = root / "numpy-2.5.3-cp312-cp312-manylinux_2_28_x86_64.whl"
            accepted.write_bytes(payload)
            self.assertEqual(build["validate_wheels"](root, lock), [accepted])
            accepted.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "hash differs"):
                build["validate_wheels"](root, lock)
            accepted.unlink()
            (root / "numpy-2.5.3-cp311-cp311-manylinux_2_28_x86_64.whl").write_bytes(payload)
            with self.assertRaisesRegex(ValueError, "exactly one"):
                build["validate_wheels"](root, lock)
            (root / "numpy-2.5.3-cp312-cp312-macosx_11_0_arm64.whl").write_bytes(payload)
            with self.assertRaisesRegex(ValueError, "exactly one"):
                build["validate_wheels"](root, lock)

    def test_missing_linux_identity_or_changed_model_fail_before_build(self):
        with self.assertRaisesRegex(ValueError, "Linux amd64"):
            build["validate_tools"](Path("/missing"), Path("/missing"), {"platform": "windows"})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            header = b"\x7fELF\x02\x01" + b"\0" * 12 + b"\x3e\x00"
            checksum = "sha256:" + hashlib.sha256(header).hexdigest()
            provenance = {"platform": "linux/amd64"}
            for key, filename, version in (("ffmpeg", "ffmpeg", "8.1.2"), ("ffprobe", "ffprobe", "8.1.2"), ("whisper", "whisper-cli", "1.8.4")):
                (root / filename).write_bytes(header)
                provenance[key] = {"version": version, "sha256": checksum}
            provenance["whisper"]["source_sha256"] = build["WHISPER_SOURCE_SHA256"]
            model = root / "model.bin"
            model.write_bytes(b"wrong model")
            with self.assertRaisesRegex(ValueError, "accepted base.en"):
                build["validate_tools"](root, model, provenance)
            provenance["whisper"]["source_sha256"] = "sha256:" + "a" * 64
            with self.assertRaisesRegex(ValueError, "pinned 1.8.4"):
                build["validate_tools"](root, model, provenance)


if __name__ == "__main__":
    unittest.main()

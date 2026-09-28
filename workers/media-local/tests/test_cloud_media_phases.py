from __future__ import annotations

import io
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from videoforge_media_local import runpod_job as cloud
from videoforge_media_local.cloud_media_cli import PHASE_FILENAME, render_observer
from test_runpod_job import spec


class CloudMediaPhaseTests(unittest.TestCase):
    def test_atomic_sidecar_has_exact_attempt_and_bounded_monotonic_timing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            earliest = time.monotonic_ns()
            observer = render_observer(root, "attempt")
            observer("CHECKING_VIDEO", None)
            first = cloud._read_render_phase(root, "attempt", earliest)
            self.assertEqual(first["sequence"], 1)
            self.assertIsNone(first["technical_verification_ms"])
            observer("TECHNICAL_VERIFICATION_COMPLETE", 0)
            self.assertEqual(cloud._read_render_phase(root, "attempt", earliest)["sequence"], 2)
            self.assertFalse((root / (PHASE_FILENAME + ".tmp")).exists())
            self.assertEqual((root / PHASE_FILENAME).stat().st_mode & 0o777, 0o600)

    def test_stale_oversize_symlink_and_impossible_duration_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            earliest = time.monotonic_ns()
            render_observer(root, "attempt")("CHECKING_VIDEO", None)
            path = root / PHASE_FILENAME
            original = json.loads(path.read_bytes())
            mutations = [dict(original, attempt_id="old-attempt"),
                         dict(original, started_monotonic_ns=earliest - 1),
                         dict(original, started_monotonic_ns=time.monotonic_ns() + 10**12),
                         dict(original, sequence=True),
                         dict(original, phase="TECHNICAL_VERIFICATION_COMPLETE", sequence=2,
                              technical_verification_ms=14_400_001),
                         dict(original, phase="TECHNICAL_VERIFICATION_COMPLETE", sequence=2,
                              technical_verification_ms=100_000)]
            for value in mutations:
                path.write_text(json.dumps(value))
                with self.assertRaises(ValueError):
                    cloud._read_render_phase(root, "attempt", earliest)
            path.write_bytes(b"x" * 1025)
            with self.assertRaises(ValueError):
                cloud._read_render_phase(root, "attempt", earliest)
            target = root / "private"
            path.unlink()
            target.write_text(json.dumps(original))
            path.symlink_to(target)
            with self.assertRaises(OSError):
                cloud._read_render_phase(root, "attempt", earliest)

    def test_checking_is_forwarded_during_child_and_timings_do_not_change_result(self):
        parsed = cloud.parse_spec(spec())
        requests = []
        returned = False
        checking_seen = threading.Event()
        def control(_url, _token, _lease, body):
            requests.append((dict(body), returned))
            if body.get("phase") == "CHECKING_VIDEO" and not returned:
                checking_seen.set()
            return {"schema_version": "videoforge-personal-worker-lease-heartbeat/v1",
                    "cancel_requested": False, "lease_expires_in_seconds": 300}
        def child(command, *_args, **_kwargs):
            nonlocal returned
            self.assertIn("videoforge_media_local.cloud_media_cli", command)
            root = Path(command[command.index("--artifact-root") + 1])
            observer = render_observer(root, parsed.job.attempt_id)
            observer("CHECKING_VIDEO", None)
            self.assertTrue(checking_seen.wait(5), "Checking must be observed while child runs")
            observer("TECHNICAL_VERIFICATION_COMPLETE", 0)
            returned = True
            return 0, b"{}"
        source = MagicMock()
        source.__enter__.return_value = (io.BytesIO(b"video"), "sha256:" + "a" * 64, 5)
        tools = MagicMock()
        with patch.object(cloud, "_control", side_effect=control), \
                patch.object(cloud, "_download_inputs"), patch.object(cloud, "_upload"), \
                patch.object(cloud.shutil, "disk_usage", return_value=MagicMock(free=10 * 1024**3)), \
                patch.object(cloud.media, "_preflight_disk_space"), \
                patch.object(cloud.media, "_run_media_subprocess", side_effect=child), \
                patch.object(cloud.media, "_parse_child_result", return_value=({}, "SUCCEEDED", None)), \
                patch.object(cloud.media, "_verified_primary_source", return_value=source), \
                patch.object(cloud.media, "_completion_is_acknowledged", return_value=True):
            self.assertEqual(cloud.run(parsed, "capability", "lease", tools)[0], "SUCCEEDED")
        self.assertTrue(any(body.get("phase") == "CHECKING_VIDEO" and not finished
                            for body, finished in requests))
        self.assertTrue(any(body.get("technical_verification_ms") == 0 for body, _ in requests))
        self.assertTrue(any(body.get("phase") == "SAVING" and
                            type(body.get("artifact_verification_ms")) is int for body, _ in requests))


if __name__ == "__main__":
    unittest.main()

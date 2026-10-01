from __future__ import annotations

import io
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from videoforge_media_local import runpod_job as cloud
from videoforge_media_local.cloud_media_cli import PHASE_FILENAME, render_observer
from test_runpod_job import spec


@unittest.skipIf(os.name == "nt", "Cloud runtime requires Unix descriptor and no-follow guards")
class CloudMediaPhaseTests(unittest.TestCase):
    def test_disk_samples_preserve_high_water_after_transient_cleanup(self):
        samples = [SimpleNamespace(total=1000, used=100, free=850),
                   SimpleNamespace(total=1000, used=700, free=250),
                   SimpleNamespace(total=1000, used=200, free=750)]
        with patch.object(cloud.shutil, "disk_usage", side_effect=samples):
            metrics = cloud._DiskMetrics(Path("scratch"))
            metrics.sample()
            metrics.sample()
        self.assertEqual(metrics.snapshot(), {"filesystem_total_bytes": 1000,
                         "initial_used_bytes": 100, "peak_used_bytes": 700,
                         "min_free_bytes": 250, "sample_count": 3})
        detached = metrics.snapshot()
        detached["peak_used_bytes"] = 0
        self.assertEqual(metrics.snapshot()["peak_used_bytes"], 700)

    def test_invalid_or_failed_disk_telemetry_cannot_change_valid_facts(self):
        valid = SimpleNamespace(total=1000, used=100, free=850)
        invalid = [SimpleNamespace(total=True, used=0, free=0),
                   SimpleNamespace(total=0, used=0, free=0),
                   SimpleNamespace(total=2**53, used=0, free=0),
                   SimpleNamespace(total=1000, used=-1, free=900),
                   SimpleNamespace(total=1000, used=100.0, free=850),
                   SimpleNamespace(total=1000, used=700, free=800),
                   SimpleNamespace(total=2000, used=100, free=1850), OSError("gone")]
        with patch.object(cloud.shutil, "disk_usage", side_effect=[valid, *invalid]):
            metrics = cloud._DiskMetrics(Path("scratch"))
            before = metrics.snapshot()
            for _ in invalid:
                metrics.sample()
        self.assertEqual(metrics.snapshot(), before)
        with patch.object(cloud.shutil, "disk_usage", side_effect=OSError("gone")):
            self.assertIsNone(cloud._DiskMetrics(Path("scratch")).snapshot())

    def test_disk_telemetry_does_not_change_cancel_fencing(self):
        parsed = cloud.parse_spec(spec())
        requests = []
        def control(_url, _token, _lease, body):
            requests.append(dict(body))
            return {"schema_version": "videoforge-personal-worker-lease-heartbeat/v1",
                    "cancel_requested": True, "lease_expires_in_seconds": 300}
        with patch.object(cloud, "_control", side_effect=control), \
                patch.object(cloud.shutil, "disk_usage", side_effect=OSError("telemetry unavailable")), \
                patch.object(cloud.media, "_preflight_disk_space"), \
                patch.object(cloud.media, "_run_media_subprocess") as child, \
                patch.object(cloud, "_download_inputs") as download, \
                patch.object(cloud, "_upload") as upload, \
                patch.object(cloud.media, "_completion_is_acknowledged", return_value=True):
            self.assertEqual(cloud.run(parsed, "capability", "lease", MagicMock())[0], "CANCELLED")
        child.assert_not_called()
        download.assert_not_called()
        upload.assert_not_called()
        self.assertTrue(any(body.get("status") == "CANCELLED" for body in requests))
        self.assertFalse(any("disk_metrics" in body for body in requests))

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
                patch.object(cloud.shutil, "disk_usage", return_value=SimpleNamespace(
                    total=100 * 1024**3, used=20 * 1024**3, free=80 * 1024**3)), \
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
        self.assertTrue(all("disk_metrics" in body for body, _ in requests if "phase" in body))
        completion = next(body for body, _ in requests if body.get("status") == "SUCCEEDED")
        self.assertGreaterEqual(completion["disk_metrics"]["sample_count"], 3)


if __name__ == "__main__":
    unittest.main()

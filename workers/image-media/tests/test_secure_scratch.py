import os
import sys
import tempfile
import unittest
from pathlib import Path

COMMON = Path(__file__).resolve().parents[2] / "common"
sys.path.insert(0, str(COMMON))

from secure_scratch import (  # noqa: E402
    JobScratch,
    ScratchIsolationError,
    cleanup_stale_jobs,
    model_volume_policy,
)


class SecureScratchTest(unittest.TestCase):
    def test_both_lanes_pin_application_read_only_model_mount(self) -> None:
        for lane in ("MAGE_IMAGE", "SOULX_AVATAR"):
            policy = model_volume_policy(lane)
            self.assertEqual(policy["mount"], "/runpod-volume")
            self.assertTrue(policy["application_read_only"])
            self.assertFalse(policy["mutable_cache_allowed"])
            self.assertFalse(policy["cross_mount_allowed"])

    def test_every_mutable_environment_path_is_job_local_and_cleanup_covers_terminal_paths(
        self,
    ) -> None:
        for reason in ("SUCCESS", "FAILURE", "CANCEL", "TIMEOUT", "SIGNAL", "REFRESH"):
            with tempfile.TemporaryDirectory() as temporary:
                scratch = JobScratch(Path(temporary), f"job-{reason.lower()}", "MAGE_IMAGE")
                scratch.__enter__()
                environment = scratch.environment()
                for value in environment.values():
                    self.assertTrue(Path(value).is_relative_to(scratch.path))
                    self.assertFalse(Path(value).is_relative_to(Path("/runpod-volume")))
                scratch.safe_path("outputs/result.png").write_bytes(b"fixture")
                scratch.cleanup(reason)
                self.assertFalse(scratch.path.exists())
                self.assertEqual(scratch.cleanup_reason, reason)

    def test_context_cleanup_runs_on_success_and_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with JobScratch(Path(temporary), "job-success", "SOULX_AVATAR") as scratch:
                path = scratch.path
            self.assertFalse(path.exists())

            failed_path = Path(temporary) / "jobs" / "job-failure"
            with self.assertRaisesRegex(RuntimeError, "boom"):
                with JobScratch(Path(temporary), "job-failure", "SOULX_AVATAR"):
                    raise RuntimeError("boom")
            self.assertFalse(failed_path.exists())

    def test_traversal_symlink_and_model_mount_escape_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with JobScratch(Path(temporary), "job-adversarial", "MAGE_IMAGE") as scratch:
                with self.assertRaisesRegex(
                    ScratchIsolationError, "SCRATCH_PATH_TRAVERSAL_FORBIDDEN"
                ):
                    scratch.safe_path("../foreign")
                foreign = Path(temporary) / "foreign"
                foreign.mkdir()
                os.symlink(foreign, scratch.path / "escape")
                with self.assertRaisesRegex(ScratchIsolationError, "SCRATCH_SYMLINK_FORBIDDEN"):
                    scratch.safe_path("escape/tenant.bin")

        with self.assertRaisesRegex(ScratchIsolationError, "SCRATCH_ON_MODEL_VOLUME_FORBIDDEN"):
            JobScratch(Path("/runpod-volume/cache"), "job-wrong-mount", "MAGE_IMAGE").__enter__()

    def test_refresh_erases_crash_leftovers_without_following_symlinks(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            jobs = root / "jobs"
            (jobs / "crashed-a").mkdir(parents=True)
            (jobs / "crashed-a" / "partial.bin").write_bytes(b"partial")
            outside = root / "outside"
            outside.mkdir()
            (outside / "keep.bin").write_bytes(b"keep")
            os.symlink(outside, jobs / "crashed-link")
            self.assertEqual(cleanup_stale_jobs(root), 2)
            self.assertTrue((outside / "keep.bin").exists())
            self.assertEqual(list(jobs.iterdir()), [])


if __name__ == "__main__":
    unittest.main()

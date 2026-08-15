import os
import sys
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

COMMON = Path(__file__).resolve().parents[2] / "common"
sys.path.insert(0, str(COMMON))

import secure_scratch  # noqa: E402
from secure_scratch import (  # noqa: E402
    JobScratch,
    ScratchIsolationError,
    cleanup_stale_jobs,
    mage_worker_io,
    model_volume_policy,
    soulx_worker_io,
)


class SecureScratchTest(unittest.TestCase):
    def scoped_port(self, method: str, job_id: str = "job-scoped") -> dict[str, object]:
        return {
            "schema_version": "artifact-transfer-port/v3",
            "reservation_id": f"reservation-{method.lower()}",
            "account_id": "account-a",
            "workspace_id": "workspace-a",
            "method": method,
            "path": (
                "/tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/"
                f"lane/input/job/{job_id}/artifact/artifact-{method.lower()}"
            ),
            "content_type": "application/octet-stream",
            "content_length": 8,
            "checksum_sha256": f"sha256:{'0' * 64}",
            "expires_at": "2099-01-01T00:00:00Z",
            "max_uses": 1,
            "capability_handle": "a" * 64,
        }

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
                scratch = JobScratch(
                    Path(temporary).resolve(), f"job-{reason.lower()}", "MAGE_IMAGE"
                )
                scratch.__enter__()
                environment = scratch.environment()
                for value in environment.values():
                    self.assertTrue(Path(value).is_relative_to(scratch.path))
                    self.assertFalse(Path(value).is_relative_to(Path("/runpod-volume")))
                scratch.safe_path("outputs/result.png").write_bytes(b"fixture")
                scratch.cleanup(reason)
                self.assertFalse(scratch.path.exists())
                self.assertEqual(scratch.cleanup_reason, reason)

    def test_both_lane_io_bind_only_exact_scoped_ports_and_job_scratch(self) -> None:
        now = datetime(2026, 8, 16, tzinfo=UTC)
        for factory in (mage_worker_io, soulx_worker_io):
            with tempfile.TemporaryDirectory() as temporary:
                with factory(
                    root=Path(temporary).resolve(),
                    account_id="account-a",
                    workspace_id="workspace-a",
                    job_id="job-scoped",
                    input_ports=(self.scoped_port("GET"),),
                    output_ports=(self.scoped_port("PUT"),),
                    now=now,
                ) as worker_io:
                    self.assertTrue(worker_io.scratch.path.exists())
                    self.assertTrue(
                        all(
                            Path(value).is_relative_to(worker_io.scratch.path)
                            for value in worker_io.environment().values()
                        )
                    )

        forged = self.scoped_port("GET")
        forged["path"] = str(forged["path"]).replace("account-a", "account-b", 1)
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ScratchIsolationError, "WORKER_ARTIFACT_PATH_MISMATCH"):
                mage_worker_io(
                    root=Path(temporary).resolve(),
                    account_id="account-a",
                    workspace_id="workspace-a",
                    job_id="job-scoped",
                    input_ports=(forged,),
                    output_ports=(self.scoped_port("PUT"),),
                    now=now,
                )

        for field, value in (
            ("content_length", -1),
            ("checksum_sha256", "sha256:not-a-digest"),
            ("max_uses", 4),
        ):
            malformed = self.scoped_port("GET")
            malformed[field] = value
            with tempfile.TemporaryDirectory() as temporary:
                with self.assertRaisesRegex(ScratchIsolationError, "WORKER_ARTIFACT_PORT_INVALID"):
                    mage_worker_io(
                        root=Path(temporary).resolve(),
                        account_id="account-a",
                        workspace_id="workspace-a",
                        job_id="job-scoped",
                        input_ports=(malformed,),
                        output_ports=(self.scoped_port("PUT"),),
                        now=now,
                    )

    def test_context_cleanup_runs_on_success_and_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            with JobScratch(root, "job-success", "SOULX_AVATAR") as scratch:
                path = scratch.path
            self.assertFalse(path.exists())

            failed_path = root / "jobs" / "job-failure"
            with self.assertRaisesRegex(RuntimeError, "boom"):
                with JobScratch(root, "job-failure", "SOULX_AVATAR"):
                    raise RuntimeError("boom")
            self.assertFalse(failed_path.exists())

    def test_traversal_symlink_and_model_mount_escape_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            with JobScratch(root, "job-adversarial", "MAGE_IMAGE") as scratch:
                with self.assertRaisesRegex(
                    ScratchIsolationError, "SCRATCH_PATH_TRAVERSAL_FORBIDDEN"
                ):
                    scratch.safe_path("../foreign")
                foreign = Path(temporary) / "foreign"
                foreign.mkdir()
                os.symlink(foreign, scratch.path / "escape")
                with self.assertRaisesRegex(ScratchIsolationError, "SCRATCH_SYMLINK_FORBIDDEN"):
                    scratch.safe_path("escape/tenant.bin")

                mounted = scratch.safe_path("mounted", directory=True)
                actual_device = secure_scratch._device_id(scratch.path)

                def device(path: Path) -> int:
                    return actual_device + 1 if path == mounted else actual_device

                with patch("secure_scratch._device_id", side_effect=device):
                    with self.assertRaisesRegex(
                        ScratchIsolationError, "SCRATCH_CROSS_MOUNT_FORBIDDEN"
                    ):
                        scratch.safe_path("mounted/tenant.bin")

            outside = root / "outside-root"
            outside.mkdir()
            linked = root / "linked-root"
            linked.symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(
                ScratchIsolationError, "SCRATCH_ANCESTOR_SYMLINK_FORBIDDEN"
            ):
                JobScratch(linked / "cache", "job-ancestor-link", "MAGE_IMAGE")

        with self.assertRaisesRegex(ScratchIsolationError, "SCRATCH_ON_MODEL_VOLUME_FORBIDDEN"):
            JobScratch(Path("/runpod-volume/cache"), "job-wrong-mount", "MAGE_IMAGE").__enter__()

    def test_refresh_erases_crash_leftovers_without_following_symlinks(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
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

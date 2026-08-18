from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path, PurePosixPath
from unittest.mock import patch

from videoforge_media_local.personal_execution import _CancellationMonitor, parse_personal_job
from videoforge_media_local.personal_worker import (
    _build_configuration,
    _is_external_macos_bundle,
    _open_approval_url,
)


def job() -> dict[str, object]:
    digest = "a" * 64
    key = (
        "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/"
        "lane/render/job/job-a/artifact/output-a"
    )
    return {
        "schema_version": "videoforge-personal-worker-job-spec/v1",
        "attempt_id": "11111111-1111-4111-8111-111111111111",
        "kind": "RENDER",
        "expires_at": "2026-08-18T00:00:00.000Z",
        "input_document": {"schema_version": "render-job-input/v1"},
        "objects": [
            {
                "uri": f"vf-local://objects/sha256/aa/{digest}.png",
                "url": "https://objects.example.test/input",
                "sha256": f"sha256:{digest}",
                "bytes": 128,
            }
        ],
        "outputs": [
            {
                "source": "PRIMARY_RESULT_OUTPUT",
                "object_key": key,
                "sign_url": "https://app.example.test/api/v2/media-worker/leases/lease/upload-port",
                "content_type": "video/mp4",
                "max_bytes": 1024,
            }
        ],
        "result": {
            "object_key": key.replace("output-a", "result-a"),
            "sign_url": "https://app.example.test/api/v2/media-worker/leases/lease/upload-port",
            "max_bytes": 1024,
        },
        "cancellation_url": "https://app.example.test/api/v2/media-worker/leases/lease/heartbeat",
        "completion_url": "https://app.example.test/api/v2/media-worker/leases/lease/complete",
        "tooling": {
            "whisper_model_sha256": f"sha256:{digest}",
            "whisper_version": "1.8.4",
            "ffmpeg_version": "8.1.2",
            "ffprobe_version": "8.1.2",
        },
    }


class PersonalWorkerContractTests(unittest.TestCase):
    def test_cancellation_monitor_has_a_runnable_poll_loop(self) -> None:
        self.assertTrue(callable(getattr(_CancellationMonitor, "_run", None)))

    def test_accepts_only_exact_outbound_https_job_authority(self) -> None:
        parsed = parse_personal_job(job())
        self.assertEqual(parsed.kind, "RENDER")
        self.assertEqual(len(parsed.outputs), 1)

        extra = {**job(), "cloud_run_execution": "forbidden"}
        with self.assertRaisesRegex(ValueError, "fields are not exact"):
            parse_personal_job(extra)

        insecure = job()
        insecure["completion_url"] = "http://localhost/complete"
        with self.assertRaisesRegex(ValueError, "control URL"):
            parse_personal_job(insecure)

    def test_source_mode_requires_an_explicit_https_origin(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing.json"
            with (
                patch(
                    "videoforge_media_local.personal_worker._bundle_root",
                    return_value=missing.parent,
                ),
                patch.dict("os.environ", {}, clear=True),
            ):
                with self.assertRaisesRegex(RuntimeError, "no pinned control-plane origin"):
                    _build_configuration()

    def test_build_configuration_contains_no_credential(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            document = root / "media-worker-release-config.json"
            document.write_text(
                json.dumps(
                    {
                        "schema_version": "videoforge-personal-worker-build/v1",
                        "control_plane_origin": "https://app.example.test",
                        "execution_bundle_sha256": f"sha256:{'b' * 64}",
                        "whisper_model_sha256": f"sha256:{'c' * 64}",
                        "tools_root": "resources/bin",
                    }
                ),
                encoding="utf-8",
            )
            with patch("videoforge_media_local.personal_worker._bundle_root", return_value=root):
                value = _build_configuration()
            self.assertEqual(value["control_plane_origin"], "https://app.example.test")
            self.assertNotIn("token", json.dumps(value).lower())

    def test_macos_install_detects_dmg_and_app_translocation_paths(self) -> None:
        self.assertTrue(
            _is_external_macos_bundle(
                PurePosixPath("/Volumes/VideoForge Worker/VideoForge Worker.app")
            )
        )
        self.assertTrue(
            _is_external_macos_bundle(
                PurePosixPath(
                    "/private/var/folders/ab/cd/T/AppTranslocation/9A1B2C3D/VideoForge Worker.app"
                )
            )
        )
        self.assertFalse(
            _is_external_macos_bundle(PurePosixPath("/Applications/VideoForge Worker.app"))
        )

    def test_macos_pairing_uses_launch_services(self) -> None:
        with (
            patch("videoforge_media_local.personal_worker.sys.platform", "darwin"),
            patch("videoforge_media_local.personal_worker.subprocess.run") as run,
            patch("videoforge_media_local.personal_worker.webbrowser.open") as browser,
        ):
            _open_approval_url("https://app.example.test/settings?enrollment=abc")
        run.assert_called_once_with(
            ["/usr/bin/open", "https://app.example.test/settings?enrollment=abc"],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        browser.assert_not_called()

    def test_pairing_falls_back_to_webbrowser_when_launch_services_fails(self) -> None:
        with (
            patch("videoforge_media_local.personal_worker.sys.platform", "darwin"),
            patch(
                "videoforge_media_local.personal_worker.subprocess.run",
                side_effect=OSError("open unavailable"),
            ),
            patch(
                "videoforge_media_local.personal_worker.webbrowser.open",
                return_value=True,
            ) as browser,
        ):
            _open_approval_url("https://app.example.test/settings?enrollment=abc")
        browser.assert_called_once_with("https://app.example.test/settings?enrollment=abc", new=2)


if __name__ == "__main__":
    unittest.main()

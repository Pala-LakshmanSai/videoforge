from __future__ import annotations

import io
import json
import ssl
import subprocess
import tempfile
import unittest
from pathlib import Path, PurePosixPath
from unittest.mock import Mock, patch

from videoforge_media_local.cloud_job import _local_path
from videoforge_media_local.personal_execution import (
    _CancellationMonitor,
    _asr_primary_path,
    _completion_is_acknowledged,
    _stream_put,
    parse_personal_job,
)
from videoforge_media_local.personal_worker import (
    _build_configuration,
    _is_external_macos_bundle,
    _json_request,
    _open_approval_url,
    _USER_AGENT,
)
from videoforge_media_local.personal_tls import https_context


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
    def test_https_context_uses_bundled_certificate_authorities(self) -> None:
        context = https_context()
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)

    def test_requests_identify_the_worker_to_cloudflare(self) -> None:
        response = Mock(status=200)
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b"{}"
        with patch(
            "videoforge_media_local.personal_worker.urllib.request.urlopen",
            return_value=response,
        ) as urlopen:
            status, body = _json_request("https://app.example.test/health", "GET")
        self.assertEqual((status, body), (200, {}))
        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_header("User-agent"), _USER_AGENT)
        self.assertEqual(request.get_header("Accept"), "application/json")

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

        invalid_attempt = job()
        invalid_attempt["attempt_id"] = "attempt-without-a-uuid"
        with self.assertRaisesRegex(ValueError, "attempt"):
            parse_personal_job(invalid_attempt)

        oversized_result = job()
        oversized_result["result"]["max_bytes"] = 1_048_577  # type: ignore[index]
        with self.assertRaisesRegex(ValueError, "result authority"):
            parse_personal_job(oversized_result)

    def test_stream_upload_uses_the_bundled_certificate_authority(self) -> None:
        response = Mock(status=204)
        response.read.return_value = b""
        connection = Mock()
        connection.getresponse.return_value = response
        with (
            patch(
                "videoforge_media_local.personal_execution.http.client.HTTPSConnection",
                return_value=connection,
            ) as https_connection,
            patch(
                "videoforge_media_local.personal_execution.https_context",
                return_value=object(),
            ) as bundled_context,
        ):
            _stream_put(
                {
                    "url": "https://objects.example.test/upload?signature=redacted",
                    "requiredHeaders": {"content-length": "7"},
                },
                io.BytesIO(b"payload"),
                7,
            )
        https_connection.assert_called_once_with(
            "objects.example.test", 443, timeout=180, context=bundled_context.return_value
        )
        connection.request.assert_called_once()

    def test_completion_requires_the_exact_accepted_response(self) -> None:
        self.assertTrue(
            _completion_is_acknowledged(
                200,
                {
                    "schema_version": "videoforge-personal-worker-completion-accepted/v1",
                    "state": "CANCELLED",
                },
            )
        )
        self.assertFalse(_completion_is_acknowledged(409, {"error": {"code": "STALE"}}))
        self.assertFalse(_completion_is_acknowledged(200, {"state": "SUCCEEDED"}))

    def test_asr_primary_path_uses_the_declared_result_uri(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            uri = "vf-local-run://revision-a/attempt-a/asr-result.json"
            path = _local_path(root, uri)
            path.parent.mkdir(parents=True)
            path.write_bytes(b'{"schema_version":"asr-job-result/v1"}')
            self.assertEqual(_asr_primary_path(root, {"output": {"result_uri": uri}}), path)
            with self.assertRaisesRegex(ValueError, "result output"):
                _asr_primary_path(root, {"output": {"result_uri": "https://example.test/out"}})

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

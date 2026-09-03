from __future__ import annotations

import io
import json
import os
import plistlib
import ssl
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from pathlib import Path, PurePosixPath
from unittest.mock import MagicMock, Mock, patch

import videoforge_media_local.personal_execution as personal_execution
from videoforge_media_local.cloud_job import _local_path
from videoforge_media_local.personal_execution import (
    _CancellationMonitor,
    _SleepAssertion,
    _asr_primary_path,
    _child_result_failure_code,
    _completion_is_acknowledged,
    _is_valid_https_url,
    _job_result_state,
    _parse_child_result,
    _run_media_subprocess,
    _stream_put,
    ToolPaths,
    execute_personal_job,
    parse_personal_job,
)
from videoforge_media_local.personal_worker import (
    _build_configuration,
    _enroll,
    _ensure_autostart,
    _is_external_macos_bundle,
    _json_request,
    _launch_agent_document,
    _platform_facts,
    _remove_local_installation,
    _remove_autostart,
    _validated_control_plane_origin,
    _open_approval_url,
    _SERVICE,
    _USER_AGENT,
    run_forever,
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
    def test_preserves_valid_asr_child_failure_codes(self) -> None:
        asr = job()
        asr["kind"] = "ASR"
        parsed = parse_personal_job(asr)
        result = {
            "schema_version": "asr-job-result/v1",
            "attempt_id": parsed.attempt_id,
            "status": "FAILED",
            "error": {"code": "ASR_PROCESS_FAILED"},
        }
        self.assertEqual(_job_result_state(parsed, result), ("FAILED", "ASR_PROCESS_FAILED"))
        self.assertEqual(
            _parse_child_result(parsed, json.dumps(result).encode("utf-8"), 1024),
            (result, "FAILED", "ASR_PROCESS_FAILED"),
        )

    def test_maps_malformed_child_result_to_bounded_code_without_child_text(self) -> None:
        asr = job()
        asr["kind"] = "ASR"
        parsed = parse_personal_job(asr)
        private_child_output = b"Traceback: /private/token=secret path\n"
        result, state, code = _parse_child_result(parsed, private_child_output, 1024)
        self.assertIsNone(result)
        self.assertEqual((state, code), ("FAILED", "ASR_RESULT_INVALID"))
        self.assertNotIn(b"secret", json.dumps({"state": state, "code": code}).encode())

    def test_maps_invalid_child_failure_code_to_bounded_code(self) -> None:
        asr = job()
        asr["kind"] = "ASR"
        parsed = parse_personal_job(asr)
        result = {
            "schema_version": "asr-job-result/v1",
            "attempt_id": parsed.attempt_id,
            "status": "FAILED",
            "error": {"code": "MEDIA_EXECUTION_FAILED"},
        }
        self.assertEqual(
            _parse_child_result(parsed, json.dumps(result).encode("utf-8"), 1024)[1:],
            ("FAILED", "ASR_RESULT_INVALID"),
        )
        self.assertEqual(_child_result_failure_code(parsed.kind), "ASR_RESULT_INVALID")

    def test_malformed_child_result_completion_is_single_safe_failure(self) -> None:
        asr = job()
        asr["kind"] = "ASR"
        asr["expires_at"] = "2099-01-01T00:00:00.000Z"
        asr["objects"] = []
        model_fd, model_name = tempfile.mkstemp()
        os.close(model_fd)
        model_path = Path(model_name)
        try:
            model_path.write_bytes(b"model")
            model_sha256 = personal_execution._sha256_file(model_path)[0]
            asr["input_document"] = {
                "schema_version": "asr-job-input/v1",
                "model": {"sha256": model_sha256},
                "output": {"result_uri": "vf-local-run://revision-a/attempt-a/asr-result.json"},
            }
            parsed = parse_personal_job(asr)
            monitor = MagicMock()
            monitor.is_cancelled.return_value = False
            sleep_assertion = MagicMock()
            tools = ToolPaths(model_path, model_path, model_path, model_path)
            with (
                patch(
                    "videoforge_media_local.personal_execution._CancellationMonitor",
                    return_value=monitor,
                ),
                patch(
                    "videoforge_media_local.personal_execution._SleepAssertion",
                    return_value=sleep_assertion,
                ),
                patch(
                    "videoforge_media_local.personal_execution._run_media_subprocess",
                    return_value=(0, b"not-json"),
                ),
                patch(
                    "videoforge_media_local.personal_execution._request_json",
                    return_value=(
                        200,
                        {
                            "schema_version": "videoforge-personal-worker-completion-accepted/v1",
                            "state": "FAILED",
                        },
                    ),
                ) as request_json,
            ):
                self.assertEqual(execute_personal_job(parsed, "device", "lease", tools), "FAILED")
            request_json.assert_called_once()
            completion = request_json.call_args.args[3]
            self.assertEqual(completion["status"], "FAILED")
            self.assertEqual(completion["failure_code"], "ASR_RESULT_INVALID")
            self.assertNotIn(b"not-json", json.dumps(completion).encode("utf-8"))
        finally:
            model_path.unlink(missing_ok=True)

    def test_outer_io_failure_is_bounded_and_completion_is_still_once(self) -> None:
        asr = job()
        asr["kind"] = "ASR"
        asr["expires_at"] = "2099-01-01T00:00:00.000Z"
        asr["objects"] = []
        model_fd, model_name = tempfile.mkstemp()
        os.close(model_fd)
        model_path = Path(model_name)
        try:
            model_path.write_bytes(b"model")
            asr["input_document"] = {
                "schema_version": "asr-job-input/v1",
                "model": {"sha256": personal_execution._sha256_file(model_path)[0]},
                "output": {"result_uri": "vf-local-run://revision-a/attempt-a/asr-result.json"},
            }
            parsed = parse_personal_job(asr)
            monitor = MagicMock()
            monitor.is_cancelled.return_value = False
            sleep_assertion = MagicMock()
            tools = ToolPaths(model_path, model_path, model_path, model_path)
            with (
                patch(
                    "videoforge_media_local.personal_execution._CancellationMonitor",
                    return_value=monitor,
                ),
                patch(
                    "videoforge_media_local.personal_execution._SleepAssertion",
                    return_value=sleep_assertion,
                ),
                patch(
                    "videoforge_media_local.personal_execution._run_media_subprocess",
                    side_effect=OSError("/private/path/token=secret disk full"),
                ),
                patch(
                    "videoforge_media_local.personal_execution._request_json",
                    return_value=(
                        200,
                        {
                            "schema_version": "videoforge-personal-worker-completion-accepted/v1",
                            "state": "FAILED",
                        },
                    ),
                ) as request_json,
            ):
                self.assertEqual(execute_personal_job(parsed, "device", "lease", tools), "FAILED")
            request_json.assert_called_once()
            completion = request_json.call_args.args[3]
            self.assertEqual(completion["failure_code"], "MEDIA_EXECUTION_IO_FAILED")
            self.assertNotIn(b"secret", json.dumps(completion).encode("utf-8"))
        finally:
            model_path.unlink(missing_ok=True)

    def test_insufficient_disk_fails_before_download_or_subprocess(self) -> None:
        asr = job()
        asr["kind"] = "ASR"
        asr["expires_at"] = "2099-01-01T00:00:00.000Z"
        asr["input_document"] = {
            "schema_version": "asr-job-input/v1",
            "model": {"sha256": "sha256:" + "a" * 64},
            "output": {"result_uri": "vf-local-run://revision-a/attempt-a/asr-result.json"},
        }
        parsed = parse_personal_job(asr)
        monitor = MagicMock()
        monitor.is_cancelled.return_value = False
        required = personal_execution._required_free_bytes(parsed.objects)
        completion_response = {
            "schema_version": "videoforge-personal-worker-completion-accepted/v1",
            "state": "FAILED",
        }
        with (
            patch(
                "videoforge_media_local.personal_execution._CancellationMonitor",
                return_value=monitor,
            ),
            patch("videoforge_media_local.personal_execution._download") as download,
            patch("videoforge_media_local.personal_execution._run_media_subprocess") as run_media,
            patch.object(
                personal_execution.shutil,
                "disk_usage",
                return_value=SimpleNamespace(free=required - 1),
            ) as disk_usage,
            patch(
                "videoforge_media_local.personal_execution._request_json",
                return_value=(200, completion_response),
            ) as request_json,
        ):
            self.assertEqual(
                execute_personal_job(
                    parsed,
                    "device",
                    "lease",
                    ToolPaths(Path("ffmpeg"), Path("ffprobe"), Path("whisper"), Path("model")),
                ),
                "FAILED",
            )
        disk_usage.assert_called_once()
        download.assert_not_called()
        run_media.assert_not_called()
        request_json.assert_called_once()
        self.assertEqual(
            request_json.call_args.args[3]["failure_code"], "MEDIA_EXECUTION_IO_FAILED"
        )

    def test_disk_preflight_maps_capacity_syscall_failure_to_io_error(self) -> None:
        parsed = parse_personal_job(job())
        with patch.object(
            personal_execution.shutil,
            "disk_usage",
            side_effect=OSError("private disk path secret"),
        ) as disk_usage:
            with self.assertRaisesRegex(OSError, "capacity is unknown") as raised:
                personal_execution._preflight_disk_space(parsed.objects, Path("/tmp"))
        disk_usage.assert_called_once()
        self.assertNotIn("secret", str(raised.exception))

    def test_asr_replaces_one_abnormally_exited_local_subprocess(self) -> None:
        first = Mock(returncode=9)
        first.communicate.return_value = (b"", b"private crash detail")
        second = Mock(returncode=0)
        second.communicate.return_value = (b'{"status":"SUCCEEDED"}', b"")
        monitor = Mock()
        monitor.is_cancelled.return_value = False
        reset = Mock()
        with patch(
            "videoforge_media_local.personal_execution.subprocess.Popen",
            side_effect=[first, second],
        ) as popen:
            result = _run_media_subprocess(
                ["worker", "--execute-media"],
                monitor,
                retry_once=True,
                before_retry=reset,
            )
        self.assertEqual(result, (0, b'{"status":"SUCCEEDED"}'))
        self.assertEqual(popen.call_count, 2)
        self.assertEqual(monitor.attach.call_count, 2)
        reset.assert_called_once_with()

    def test_render_does_not_replace_an_abnormally_exited_local_subprocess(self) -> None:
        process = Mock(returncode=7)
        process.communicate.return_value = (b"", b"private crash detail")
        monitor = Mock()
        monitor.is_cancelled.return_value = False
        reset = Mock()
        with patch(
            "videoforge_media_local.personal_execution.subprocess.Popen", return_value=process
        ) as popen:
            result = _run_media_subprocess(
                ["worker", "--execute-media"],
                monitor,
                retry_once=False,
                before_retry=reset,
            )
        self.assertEqual(result, (7, b""))
        popen.assert_called_once()
        reset.assert_not_called()

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

    def test_lease_requests_identify_the_worker_to_cloudflare(self) -> None:
        response = Mock(status=200)
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b"{}"
        with patch(
            "videoforge_media_local.personal_execution.urllib.request.urlopen",
            return_value=response,
        ) as urlopen:
            status, body = personal_execution._request_json(
                "https://app.example.test/api/v2/media-worker/leases/lease/heartbeat",
                "POST",
                {"authorization": "Bearer redacted"},
                {},
            )
        self.assertEqual((status, body), (200, {}))
        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_header("User-agent"), "VideoForge-Worker")

    def test_requests_reject_non_https_urls_before_network_access(self) -> None:
        with patch("videoforge_media_local.personal_worker.urllib.request.urlopen") as urlopen:
            with self.assertRaisesRegex(ValueError, "HTTPS"):
                _json_request("http://app.example.test/health", "GET")
        urlopen.assert_not_called()

    def test_https_job_authorities_reject_ambiguous_or_malformed_hosts(self) -> None:
        for value in (
            "https://user:password@app.example.test/object",
            "https://app.example.test:invalid/object",
            "https:///missing-host/object",
            "https://app.example.test/object#fragment",
            "https://app.example.test/object\nredirect",
        ):
            self.assertFalse(_is_valid_https_url(value), value)

    def test_windows_sleep_assertion_fails_closed_when_api_cannot_assert_sleep(self) -> None:
        kernel = Mock()
        kernel.SetThreadExecutionState.return_value = 0
        with (
            patch.object(personal_execution.os, "name", "nt"),
            patch.object(personal_execution.sys, "platform", "win32"),
            patch("ctypes.windll", SimpleNamespace(kernel32=kernel), create=True),
        ):
            with self.assertRaisesRegex(OSError, "prevent system sleep"):
                _SleepAssertion().__enter__()

    def test_windows_sleep_assertion_checks_release_api(self) -> None:
        kernel = Mock()
        kernel.SetThreadExecutionState.side_effect = [1, 0]
        with (
            patch.object(personal_execution.os, "name", "nt"),
            patch.object(personal_execution.sys, "platform", "win32"),
            patch("ctypes.windll", SimpleNamespace(kernel32=kernel), create=True),
        ):
            assertion = _SleepAssertion()
            assertion.__enter__()
            with self.assertRaisesRegex(OSError, "release"):
                assertion.__exit__(None, None, None)

    def test_platform_facts_reject_windows_arm_and_support_both_universal2_slices(self) -> None:
        with (
            patch("videoforge_media_local.personal_worker.platform.system", return_value="Windows"),
            patch("videoforge_media_local.personal_worker.platform.machine", return_value="ARM64"),
        ):
            with self.assertRaisesRegex(RuntimeError, "Windows x64"):
                _platform_facts()
        for machine, expected in (("arm64", ("MACOS", "AARCH64")), ("x86_64", ("MACOS", "X86_64"))):
            with (
                patch(
                    "videoforge_media_local.personal_worker.platform.system", return_value="Darwin"
                ),
                patch(
                    "videoforge_media_local.personal_worker.platform.machine", return_value=machine
                ),
            ):
                self.assertEqual(_platform_facts(), expected)

    def test_control_plane_origin_is_credential_free_and_normalized(self) -> None:
        self.assertEqual(
            _validated_control_plane_origin("https://app.example.test/"),
            "https://app.example.test",
        )
        for value in (
            "http://app.example.test",
            "https://user:password@app.example.test",
            "https://app.example.test?token=secret",
            "https://app.example.test#fragment",
        ):
            self.assertIsNone(_validated_control_plane_origin(value))

    def test_pairing_requires_exact_same_origin_response_and_token(self) -> None:
        created = {
            "schema_version": "videoforge-media-worker-enrollment-created/v1",
            "enrollment_id": "11111111-1111-4111-8111-111111111111",
            "poll_token": "a" * 64,
            "approval_url": "https://app.example.test/settings?enrollment=abc",
            "expires_in_seconds": 600,
        }
        approved = {
            "schema_version": "videoforge-media-worker-token/v1",
            "state": "APPROVED",
            "device_token": "b" * 64,
        }
        store = Mock()
        with (
            patch(
                "videoforge_media_local.personal_worker._json_request",
                side_effect=[
                    (201, created),
                    (
                        202,
                        {"schema_version": "videoforge-media-worker-token/v1", "state": "PENDING"},
                    ),
                    (200, approved),
                ],
            ),
            patch("videoforge_media_local.personal_worker._open_approval_url") as open_url,
            patch("videoforge_media_local.personal_worker.time.sleep"),
        ):
            self.assertEqual(
                _enroll("https://app.example.test", "installation", "sha256:" + "c" * 64, store),
                "b" * 64,
            )
        open_url.assert_called_once_with("https://app.example.test/settings?enrollment=abc")
        store.set.assert_called_once_with("installation", "b" * 64)

        created["approval_url"] = "https://other.example.test/settings?enrollment=abc"
        with patch(
            "videoforge_media_local.personal_worker._json_request", return_value=(201, created)
        ):
            with self.assertRaisesRegex(RuntimeError, "did not match"):
                _enroll("https://app.example.test", "installation", "sha256:" + "c" * 64, store)

    def test_update_required_exits_to_release_the_old_executable(self) -> None:
        state = {"installation_id": "11111111-1111-4111-8111-111111111111"}
        order: list[str] = []
        with (
            patch("videoforge_media_local.personal_worker.sys.argv", ["worker", "--background"]),
            patch(
                "videoforge_media_local.personal_worker._install_macos_if_needed",
                side_effect=lambda: order.append("install") or False,
            ),
            patch(
                "videoforge_media_local.personal_worker._build_configuration",
                side_effect=lambda: order.append("configuration")
                or {
                    "control_plane_origin": "https://app.example.test",
                    "execution_bundle_sha256": "sha256:" + "c" * 64,
                },
            ),
            patch(
                "videoforge_media_local.personal_worker._tool_paths",
                side_effect=lambda _configuration: order.append("tools") or Mock(),
            ),
            patch(
                "videoforge_media_local.personal_worker._state", return_value=(Path("state"), state)
            ),
            patch("videoforge_media_local.personal_worker._credential_store") as credential_store,
            patch("videoforge_media_local.personal_worker._ensure_autostart"),
            patch(
                "videoforge_media_local.personal_worker._platform_facts",
                return_value=("MACOS", "AARCH64"),
            ),
            patch(
                "videoforge_media_local.personal_worker._json_request",
                return_value=(200, {"status": "UPDATE_REQUIRED"}),
            ),
        ):
            credential_store.return_value.get.return_value = "b" * 64
            self.assertEqual(run_forever(), 0)
        self.assertEqual(order[:3], ["configuration", "tools", "install"])

    def test_mac_autostart_repairs_a_missing_loaded_launchagent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            executable = Path(
                "/Applications/VideoForge Worker.app/Contents/MacOS/VideoForge Worker"
            )
            target = (
                home / "Library" / "LaunchAgents" / "com.videoforge.personal-media-worker.plist"
            )
            target.parent.mkdir(parents=True)
            with (
                patch("videoforge_media_local.personal_worker.sys.platform", "darwin"),
                patch.object(sys, "frozen", True, create=True),
                patch.object(sys, "executable", str(executable)),
                patch("videoforge_media_local.personal_worker.Path.home", return_value=home),
                patch(
                    "videoforge_media_local.personal_worker.os.getuid",
                    return_value=501,
                    create=True,
                ),
            ):
                target.write_bytes(_launch_agent_document())
                with patch(
                    "videoforge_media_local.personal_worker.subprocess.run",
                    side_effect=[Mock(returncode=1), Mock(returncode=0)],
                ) as run:
                    _ensure_autostart()
            self.assertEqual(run.call_count, 2)
            self.assertEqual(
                run.call_args_list[0].args[0],
                ["/bin/launchctl", "print", "gui/501/com.videoforge.personal-media-worker"],
            )
            self.assertEqual(
                run.call_args_list[1].args[0],
                ["/bin/launchctl", "bootstrap", "gui/501", str(target)],
            )
            self.assertEqual(plistlib.loads(target.read_bytes())["RunAtLoad"], True)

    def test_mac_uninstall_verifies_launchagent_is_unloaded_before_removing_plist(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            target = home / "Library" / "LaunchAgents" / f"{_SERVICE}.plist"
            target.parent.mkdir(parents=True)
            target.write_bytes(_launch_agent_document())
            with (
                patch("videoforge_media_local.personal_worker.sys.platform", "darwin"),
                patch.object(sys, "frozen", True, create=True),
                patch("videoforge_media_local.personal_worker.Path.home", return_value=home),
                patch(
                    "videoforge_media_local.personal_worker.os.getuid",
                    return_value=501,
                    create=True,
                ),
                patch(
                    "videoforge_media_local.personal_worker._launchctl",
                    side_effect=[Mock(returncode=0), Mock(returncode=0), Mock(returncode=1)],
                ) as launchctl,
            ):
                _remove_autostart()
            self.assertFalse(target.exists())
            self.assertEqual(launchctl.call_count, 3)

    def test_mac_uninstall_keeps_plist_when_launchagent_will_not_unload(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            target = home / "Library" / "LaunchAgents" / f"{_SERVICE}.plist"
            target.parent.mkdir(parents=True)
            target.write_bytes(_launch_agent_document())
            with (
                patch("videoforge_media_local.personal_worker.sys.platform", "darwin"),
                patch("videoforge_media_local.personal_worker.Path.home", return_value=home),
                patch(
                    "videoforge_media_local.personal_worker.os.getuid",
                    return_value=501,
                    create=True,
                ),
                patch(
                    "videoforge_media_local.personal_worker._launchctl",
                    side_effect=[Mock(returncode=0), Mock(returncode=1)],
                ),
            ):
                with self.assertRaisesRegex(RuntimeError, "unload"):
                    _remove_autostart()
            self.assertTrue(target.exists())

    def test_uninstall_removes_state_credential_and_local_installation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state_path = root / "installation.json"
            state_path.write_text(
                json.dumps({"installation_id": "11111111-1111-4111-8111-111111111111"}),
                encoding="utf-8",
            )
            store = Mock()
            with (
                patch("videoforge_media_local.personal_worker._data_root", return_value=root),
                patch(
                    "videoforge_media_local.personal_worker._credential_store", return_value=store
                ),
                patch(
                    "videoforge_media_local.personal_worker._remove_autostart"
                ) as remove_autostart,
            ):
                self.assertEqual(_remove_local_installation(), 0)
            store.delete.assert_called_once_with("11111111-1111-4111-8111-111111111111")
            remove_autostart.assert_called_once_with()
            self.assertFalse(root.exists())

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

from __future__ import annotations

import copy
import errno
import io
import threading
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
    _download,
    _heartbeat_stop_reason,
    _is_valid_https_url,
    _job_result_state,
    _parse_child_result,
    _run_media_subprocess,
    _span_audio_primary_path,
    _stream_put,
    ToolPaths,
    execute_personal_job,
    parse_personal_job,
)
from videoforge_media_local.personal_worker import (
    _execute_claim_response,
    _build_configuration,
    _enroll,
    connect_from_file,
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
    def test_render_download_pool_verifies_every_object_with_two_streams(self) -> None:
        payloads = {
            f"https://objects.example.test/{index}": f"input-{index}".encode() for index in range(6)
        }
        objects = []
        for url, payload in payloads.items():
            digest = personal_execution.hashlib.sha256(payload).hexdigest()
            objects.append(
                {
                    "uri": f"vf-local://objects/sha256/{digest[:2]}/{digest}.png",
                    "url": url,
                    "bytes": len(payload),
                    "sha256": f"sha256:{digest}",
                }
            )
        barrier = threading.Barrier(2, timeout=5)
        lock = threading.Lock()
        active = peak = opened = 0

        class Response(io.BytesIO):
            def __exit__(self, *args):
                nonlocal active
                with lock:
                    active -= 1
                return super().__exit__(*args)

        def urlopen(url, **_kwargs):
            nonlocal active, peak, opened
            with lock:
                active += 1
                peak = max(peak, active)
                opened += 1
                first_pair = opened <= 2
            if first_pair:
                barrier.wait()
            return Response(payloads[url])

        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(
                personal_execution.urllib.request, "urlopen", side_effect=urlopen
            ) as requests,
        ):
            scratch = Path(directory)
            personal_execution._download_render_inputs(tuple(objects), scratch, lambda: False)
            for item in objects:
                self.assertEqual(
                    _local_path(scratch, item["uri"]).read_bytes(), payloads[item["url"]]
                )
        self.assertEqual(peak, 2)
        self.assertEqual(active, 0)
        self.assertEqual(requests.call_count, len(objects))
        self.assertCountEqual([call.args[0] for call in requests.call_args_list], list(payloads))

    def test_render_download_failure_stops_queue_and_drains_sibling(self) -> None:
        for original in (ValueError("checksum mismatch"), OSError(errno.ENOSPC, "disk full")):
            with self.subTest(error=type(original).__name__), tempfile.TemporaryDirectory() as root:
                objects = tuple(
                    {
                        **job()["objects"][0],
                        "uri": f"vf-local-run://revision/attempt/input-{index}.png",
                        "index": index,
                    }
                    for index in range(8)
                )
                sibling_started = threading.Event()
                sibling_stopped = threading.Event()
                started = []
                lock = threading.Lock()

                def download(item, _destination, cancelled):
                    with lock:
                        started.append(item["index"])
                    if item["index"] == 0:
                        self.assertTrue(sibling_started.wait(5))
                        raise original
                    sibling_started.set()
                    for _ in range(1000):
                        if cancelled():
                            sibling_stopped.set()
                            raise personal_execution._PersonalJobCancelled
                        sibling_stopped.wait(0.005)
                    raise AssertionError("sibling did not receive the failure fence")

                with patch.object(personal_execution, "_download", side_effect=download):
                    with self.assertRaises(type(original)) as raised:
                        personal_execution._download_render_inputs(
                            objects, Path(root), lambda: False
                        )
                self.assertIs(raised.exception, original)
                self.assertTrue(sibling_stopped.is_set())
                self.assertCountEqual(started, [0, 1])

    def test_render_download_pool_owner_cancel_never_starts_queued_objects(self) -> None:
        objects = tuple(
            {**job()["objects"][0], "uri": f"vf-local-run://revision/attempt/input-{index}.png"}
            for index in range(8)
        )
        with (
            tempfile.TemporaryDirectory() as root,
            patch.object(personal_execution, "_download") as run,
        ):
            with self.assertRaises(personal_execution._PersonalJobCancelled):
                personal_execution._download_render_inputs(objects, Path(root), lambda: True)
            run.assert_not_called()
        cancelled = threading.Event()
        barrier = threading.Barrier(2, timeout=5)

        def download(_item, _path, should_cancel):
            barrier.wait()
            cancelled.set()
            self.assertTrue(should_cancel())
            raise personal_execution._PersonalJobCancelled

        with (
            tempfile.TemporaryDirectory() as root,
            patch.object(personal_execution, "_download", side_effect=download) as run,
        ):
            with self.assertRaises(personal_execution._PersonalJobCancelled):
                personal_execution._download_render_inputs(objects, Path(root), cancelled.is_set)
            self.assertEqual(run.call_count, 2)

    def test_render_download_pool_rejects_duplicate_destinations_before_request(self) -> None:
        item = job()["objects"][0]
        with (
            tempfile.TemporaryDirectory() as root,
            patch.object(personal_execution, "_download") as run,
        ):
            with self.assertRaisesRegex(ValueError, "not unique"):
                personal_execution._download_render_inputs((item, item), Path(root), lambda: False)
            run.assert_not_called()

    def test_verified_primary_upload_hashes_once_and_keeps_the_verified_descriptor(self) -> None:
        payload = b"verified primary"
        checksum = "sha256:" + personal_execution.hashlib.sha256(payload).hexdigest()
        parsed = parse_personal_job(job())
        uri = "vf-local-run://revision/attempt/output.mp4"
        result = {"output": {"artifact_uri": uri, "sha256": checksum, "bytes": len(payload)}}
        with tempfile.TemporaryDirectory() as root:
            scratch = Path(root)
            path = _local_path(scratch, uri)
            path.parent.mkdir(parents=True)
            path.write_bytes(payload)
            with patch.object(
                personal_execution, "_sha256_source", wraps=personal_execution._sha256_source
            ) as hash_source:
                with personal_execution._verified_primary_source(parsed, scratch, result) as facts:
                    source, digest, size = facts
                    self.assertEqual((digest, size), (checksum, len(payload)))
                    replacement = path.with_name("replacement.mp4")
                    replacement.write_bytes(b"unverified replacement")
                    try:
                        replacement.replace(path)
                    except PermissionError:
                        # Windows may disallow replacing an open file. Both outcomes keep
                        # this upload bound to the descriptor whose bytes were validated.
                        pass
                    self.assertEqual(source.read(), payload)
                self.assertTrue(source.closed)
                hash_source.assert_called_once()

    def test_verified_primary_upload_rejects_mismatched_render_and_span_facts(self) -> None:
        for kind in ("RENDER", "SPAN_AUDIO"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as root:
                value = job()
                value["kind"] = kind
                if kind == "SPAN_AUDIO":
                    value["input_document"] = {
                        "schema_version": "selected-span-audio-job/v1",
                        "output_profile": "SOULX_PCM16_48K_MONO",
                    }
                parsed = parse_personal_job(value)
                scratch = Path(root)
                uri = "vf-local-run://revision/attempt/output.wav"
                path = _local_path(scratch, uri)
                path.parent.mkdir(parents=True)
                path.write_bytes(b"corrupted")
                result = (
                    {"output": {"artifact_uri": uri, "sha256": "sha256:" + "a" * 64, "bytes": 9}}
                    if kind == "RENDER"
                    else {
                        "audio": {
                            "artifact_uri": uri,
                            "sha256": "sha256:" + "a" * 64,
                            "byte_size": 9,
                            "content_type": "audio/wav",
                            "sample_rate_hz": 48000,
                            "channels": 1,
                        }
                    }
                )
                with self.assertRaisesRegex(ValueError, "facts do not match bytes"):
                    with personal_execution._verified_primary_source(parsed, scratch, result):
                        self.fail("corrupted output must never reach upload")

    def test_verified_primary_upload_rejects_in_place_changes(self) -> None:
        payload = b"verified primary"
        checksum = "sha256:" + personal_execution.hashlib.sha256(payload).hexdigest()
        uri = "vf-local-run://revision/attempt/output.mp4"
        result = {"output": {"artifact_uri": uri, "sha256": checksum, "bytes": len(payload)}}
        with tempfile.TemporaryDirectory() as root:
            scratch = Path(root)
            path = _local_path(scratch, uri)
            path.parent.mkdir(parents=True)
            path.write_bytes(payload)
            with self.assertRaisesRegex(ValueError, "changed during upload"):
                with personal_execution._verified_primary_source(
                    parse_personal_job(job()), scratch, result
                ):
                    path.write_bytes(b"different size and content")

    def test_verified_primary_upload_rejects_same_size_change_during_hash(self) -> None:
        payload = b"verified primary"
        checksum = "sha256:" + personal_execution.hashlib.sha256(payload).hexdigest()
        uri = "vf-local-run://revision/attempt/output.mp4"
        result = {"output": {"artifact_uri": uri, "sha256": checksum, "bytes": len(payload)}}
        with tempfile.TemporaryDirectory() as root:
            scratch = Path(root)
            path = _local_path(scratch, uri)
            path.parent.mkdir(parents=True)
            path.write_bytes(payload)
            before = path.stat()
            hash_source = personal_execution._sha256_source

            def hash_then_change(source):
                facts = hash_source(source)
                path.write_bytes(b"unverified bytes")
                os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns + 1_000_000))
                return facts

            with patch.object(personal_execution, "_sha256_source", side_effect=hash_then_change):
                with self.assertRaisesRegex(ValueError, "changed during validation"):
                    with personal_execution._verified_primary_source(
                        parse_personal_job(job()), scratch, result
                    ):
                        self.fail("changed output must never reach upload")

    def test_successful_render_transfer_retries_lost_ack_without_reupload_or_render(self) -> None:
        value = job()
        value["objects"] = []
        value["expires_at"] = "2099-01-01T00:00:00.000Z"
        parsed = parse_personal_job(value)
        payload = b"verified primary"
        result = {
            "schema_version": "render-job-result/v1",
            "attempt_id": parsed.attempt_id,
            "status": "SUCCEEDED",
            "output": {
                "artifact_uri": "vf-local-run://revision/attempt/output.mp4",
                "sha256": "sha256:" + personal_execution.hashlib.sha256(payload).hexdigest(),
                "bytes": len(payload),
            },
        }
        monitor = MagicMock()
        monitor.is_cancelled.return_value = False
        uploaded = []

        def run(command, *_args, **_kwargs):
            scratch = Path(command[command.index("--artifact-root") + 1])
            path = _local_path(scratch, result["output"]["artifact_uri"])
            path.parent.mkdir(parents=True)
            path.write_bytes(payload)
            return 0, json.dumps(result).encode()

        def put(_port, source, size):
            body = source.read()
            self.assertEqual(size, len(body))
            uploaded.append(body)

        with (
            patch.object(personal_execution, "_CancellationMonitor", return_value=monitor),
            patch.object(personal_execution, "_SleepAssertion"),
            patch.object(personal_execution, "_preflight_disk_space"),
            patch.object(personal_execution, "_run_media_subprocess", side_effect=run) as render,
            patch.object(personal_execution, "_upload_port", return_value={}) as sign,
            patch.object(personal_execution, "_stream_put", side_effect=put) as transfer,
            patch.object(
                personal_execution,
                "_request_json",
                side_effect=[
                    TimeoutError("ack response lost"),
                    (
                        200,
                        {
                            "schema_version": "videoforge-personal-worker-completion-accepted/v1",
                            "state": "SUCCEEDED",
                        },
                    ),
                ],
            ) as complete,
            self.assertLogs(personal_execution._LOGGER, level="INFO") as diagnostics,
        ):
            self.assertEqual(
                execute_personal_job(parsed, "device-secret", "lease-secret", Mock()), "SUCCEEDED"
            )
        render.assert_called_once()
        self.assertEqual(sign.call_count, 2)
        self.assertEqual(transfer.call_count, 2)
        self.assertEqual(complete.call_count, 2)
        self.assertEqual(uploaded, [payload, personal_execution._canonical(result)])
        self.assertEqual(complete.call_args_list[0].args[3], complete.call_args_list[1].args[3])
        for line in diagnostics.output:
            self.assertNotIn("secret", line)
            self.assertNotIn("https:", line)
            self.assertNotIn(parsed.attempt_id, line)

    def test_cancellation_while_signing_output_prevents_put_and_clears_result_facts(self) -> None:
        value = job()
        value["objects"] = []
        value["expires_at"] = "2099-01-01T00:00:00.000Z"
        parsed = parse_personal_job(value)
        payload = b"verified primary"
        result = {
            "schema_version": "render-job-result/v1",
            "attempt_id": parsed.attempt_id,
            "status": "SUCCEEDED",
            "output": {
                "artifact_uri": "vf-local-run://revision/attempt/output.mp4",
                "sha256": "sha256:" + personal_execution.hashlib.sha256(payload).hexdigest(),
                "bytes": len(payload),
            },
        }
        monitor = MagicMock()
        monitor.is_cancelled.return_value = False

        def run(command, *_args, **_kwargs):
            scratch = Path(command[command.index("--artifact-root") + 1])
            path = _local_path(scratch, result["output"]["artifact_uri"])
            path.parent.mkdir(parents=True)
            path.write_bytes(payload)
            return 0, json.dumps(result).encode()

        def sign(*_args):
            monitor.is_cancelled.return_value = True
            return {}

        with (
            patch.object(personal_execution, "_CancellationMonitor", return_value=monitor),
            patch.object(personal_execution, "_SleepAssertion"),
            patch.object(personal_execution, "_preflight_disk_space"),
            patch.object(personal_execution, "_run_media_subprocess", side_effect=run),
            patch.object(personal_execution, "_upload_port", side_effect=sign),
            patch.object(personal_execution, "_stream_put") as put,
            patch.object(
                personal_execution,
                "_request_json",
                return_value=(
                    200,
                    {
                        "schema_version": "videoforge-personal-worker-completion-accepted/v1",
                        "state": "CANCELLED",
                    },
                ),
            ) as complete,
        ):
            self.assertEqual(execute_personal_job(parsed, "device", "lease", Mock()), "CANCELLED")
        put.assert_not_called()
        completion = complete.call_args.args[3]
        self.assertEqual(completion["status"], "CANCELLED")
        self.assertIsNone(completion["result_object_key"])
        self.assertIsNone(completion["result_checksum_sha256"])

    def test_span_batch_runs_together_and_drains_successful_siblings(self) -> None:
        claims = []
        for index in range(4):
            value = copy.deepcopy(job())
            value["attempt_id"] = f"11111111-1111-4111-8111-{index:012d}"
            value["kind"] = "SPAN_AUDIO"
            value["input_document"] = {
                "schema_version": "selected-span-audio-job/v1",
                "output_profile": "SOULX_PCM16_48K_MONO",
                "project_revision_id": "revision",
                "timeline_plan_id": "timeline",
                "transcript_id": "transcript",
                "source_voiceover": {"sha256": "same"},
            }
            claims.append(
                {
                    "job": value,
                    "lease_id": f"22222222-2222-4222-8222-{index:012d}",
                    "lease_token": "a" * 64,
                }
            )
        batch = {"schema_version": "videoforge-personal-worker-claim-batch/v1", "claims": claims}
        barrier = threading.Barrier(4, timeout=5)
        finished = []

        def execute(value, *_args):
            barrier.wait()
            finished.append(value.attempt_id)
            if value.attempt_id.endswith("000000000000"):
                raise OSError("one span failed")
            return "SUCCEEDED"

        with patch(
            "videoforge_media_local.personal_worker.execute_personal_job", side_effect=execute
        ):
            with self.assertRaises(OSError):
                _execute_claim_response(batch, "token", Mock())
        self.assertEqual(len(finished), 4)
        with patch("videoforge_media_local.personal_worker.execute_personal_job") as run:
            claims[3]["job"]["input_document"]["project_revision_id"] = "other"
            with self.assertRaises(ValueError):
                _execute_claim_response(batch, "token", Mock())
            run.assert_not_called()
            claims.append(claims[0])
            with self.assertRaises(ValueError):
                _execute_claim_response(batch, "token", Mock())
            run.assert_not_called()

    def test_span_source_cache_reuses_verified_bytes_and_rejects_corruption(self) -> None:
        import hashlib

        content = b"voiceover source"
        item = {
            "uri": "vf-local://source",
            "sha256": "sha256:" + hashlib.sha256(content).hexdigest(),
            "bytes": len(content),
        }
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as cache:

            def download(_item, destination, _cancel):
                destination.write_bytes(content)

            with (
                patch.object(personal_execution, "_span_source_cache", SimpleNamespace(name=cache)),
                patch.object(personal_execution, "_span_source_cache_key", None),
                patch.object(personal_execution, "_download", side_effect=download) as fetch,
            ):
                for ordinal in range(2):
                    destination = Path(root) / str(ordinal)
                    personal_execution._download_span_source(item, destination, lambda: False)
                    self.assertEqual(destination.read_bytes(), content)
                fetch.assert_called_once()
                (Path(cache) / "source").write_bytes(b"corrupted")
                personal_execution._download_span_source(
                    item, Path(root) / "repaired", lambda: False
                )
                self.assertEqual(fetch.call_count, 2)
                self.assertEqual((Path(root) / "repaired").read_bytes(), content)
                different_source = {**item, "uri": "vf-local://another-source"}
                personal_execution._download_span_source(
                    different_source, Path(root) / "other", lambda: False
                )
                self.assertEqual(fetch.call_count, 3)

    def test_download_retries_transient_response_read_and_revalidates_exact_bytes(self) -> None:
        content = b"verified input bytes"
        item = {
            "url": "https://objects.example.test/input",
            "bytes": len(content),
            "sha256": "sha256:" + personal_execution.hashlib.sha256(content).hexdigest(),
        }

        class Response:
            def __init__(self, *reads: object) -> None:
                self._reads = list(reads)

            def __enter__(self) -> "Response":
                return self

            def __exit__(self, *_: object) -> None:
                return None

            def read(self, _maximum: int) -> bytes:
                value = self._reads.pop(0)
                if isinstance(value, BaseException):
                    raise value
                assert isinstance(value, bytes)
                return value

        first = Response(b"partial", ConnectionResetError(errno.ECONNRESET, "reset"))
        second = Response(content, b"")
        with (
            tempfile.TemporaryDirectory() as root,
            patch(
                "videoforge_media_local.personal_execution.urllib.request.urlopen",
                side_effect=[first, second],
            ) as urlopen,
        ):
            destination = Path(root) / "input"
            _download(item, destination, lambda: False)
            self.assertEqual(destination.read_bytes(), content)
        self.assertEqual(urlopen.call_count, 2)

    def test_download_does_not_retry_local_disk_write_failure(self) -> None:
        content = b"input"
        item = {
            "url": "https://objects.example.test/input",
            "bytes": len(content),
            "sha256": "sha256:" + personal_execution.hashlib.sha256(content).hexdigest(),
        }

        class Response:
            def __enter__(self) -> "Response":
                return self

            def __exit__(self, *_: object) -> None:
                return None

            def read(self, _maximum: int) -> bytes:
                return content

        class FailingOutput:
            def __enter__(self) -> "FailingOutput":
                return self

            def __exit__(self, *_: object) -> None:
                return None

            def write(self, _chunk: bytes) -> None:
                raise OSError(errno.ENOSPC, "disk full")

        with tempfile.TemporaryDirectory() as root:
            with patch(
                "videoforge_media_local.personal_execution.urllib.request.urlopen",
                return_value=Response(),
            ) as urlopen:
                with patch.object(Path, "open", return_value=FailingOutput()):
                    with self.assertRaises(OSError) as raised:
                        _download(item, Path(root) / "input", lambda: False)
        self.assertEqual(raised.exception.errno, errno.ENOSPC)
        urlopen.assert_called_once()

    def test_accepts_only_explicit_soulx_48k_span_audio_jobs(self) -> None:
        span = job()
        span["kind"] = "SPAN_AUDIO"
        span["input_document"] = {
            "schema_version": "selected-span-audio-job/v1",
            "output_profile": "SOULX_PCM16_48K_MONO",
        }
        parsed = parse_personal_job(span)
        self.assertEqual(parsed.kind, "SPAN_AUDIO")
        result = {
            "schema_version": "selected-span-audio-result/v1",
            "attempt_id": parsed.attempt_id,
            "status": "FAILED",
            "error": {"code": "SPAN_PROCESS_FAILED"},
        }
        self.assertEqual(_job_result_state(parsed, result), ("FAILED", "SPAN_PROCESS_FAILED"))
        self.assertEqual(_child_result_failure_code(parsed.kind), "SPAN_RESULT_INVALID")

        span["input_document"]["output_profile"] = "LOCAL_PCM16_16K_MONO"
        with self.assertRaisesRegex(ValueError, "span-audio profile"):
            parse_personal_job(span)

    def test_span_audio_primary_requires_48k_metadata_and_exact_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            payload = b"RIFF-span-audio"
            digest = personal_execution.hashlib.sha256(payload).hexdigest()
            uri = f"vf-local://objects/sha256/{digest[:2]}/{digest}.wav"
            path = _local_path(root, uri)
            path.parent.mkdir(parents=True)
            path.write_bytes(payload)
            result = {
                "audio": {
                    "artifact_uri": uri,
                    "content_type": "audio/wav",
                    "sample_rate_hz": 48000,
                    "channels": 1,
                    "byte_size": len(payload),
                    "sha256": f"sha256:{digest}",
                }
            }
            self.assertEqual(_span_audio_primary_path(root, result), path)
            result["audio"]["sample_rate_hz"] = 16000
            with self.assertRaisesRegex(ValueError, "primary output"):
                _span_audio_primary_path(root, result)

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
                patch.object(
                    personal_execution.shutil,
                    "disk_usage",
                    return_value=SimpleNamespace(
                        free=personal_execution._required_free_bytes(parsed.objects)
                    ),
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
        self._assert_outer_io_failure(
            OSError("/private/path/token=secret disk full"), "MEDIA_EXECUTION_IO_FAILED"
        )

    def test_outer_enospc_is_bounded_and_completion_is_still_once(self) -> None:
        self._assert_outer_io_failure(
            OSError(errno.ENOSPC, "/private/path/token=secret"),
            "MEDIA_EXECUTION_DISK_SPACE_INSUFFICIENT",
        )

    def _assert_outer_io_failure(self, error: OSError, expected_code: str) -> None:
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
                    side_effect=error,
                ),
                patch("videoforge_media_local.personal_execution._preflight_disk_space"),
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
            self.assertEqual(completion["failure_code"], expected_code)
            self.assertNotIn(b"secret", json.dumps(completion).encode("utf-8"))
        finally:
            model_path.unlink(missing_ok=True)

    def test_owner_cancel_and_stale_lease_have_distinct_terminal_completions(self) -> None:
        for reason, expected_status, expected_code in (
            ("OWNER_CANCEL_REQUESTED", "CANCELLED", None),
            ("LEASE_STALE_FENCE", "FAILED", "MEDIA_EXECUTION_LEASE_STALE"),
        ):
            with self.subTest(reason=reason):
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
                        "output": {
                            "result_uri": "vf-local-run://revision-a/attempt-a/asr-result.json"
                        },
                    }
                    parsed = parse_personal_job(asr)
                    monitor = MagicMock()
                    monitor.is_cancelled.return_value = True
                    monitor.stop_reason.return_value = reason
                    completion_response = {
                        "schema_version": "videoforge-personal-worker-completion-accepted/v1",
                        "state": expected_status,
                    }
                    with (
                        patch(
                            "videoforge_media_local.personal_execution._CancellationMonitor",
                            return_value=monitor,
                        ),
                        patch("videoforge_media_local.personal_execution._preflight_disk_space"),
                        patch(
                            "videoforge_media_local.personal_execution._run_media_subprocess"
                        ) as run_media,
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
                                ToolPaths(model_path, model_path, model_path, model_path),
                            ),
                            expected_status,
                        )
                    run_media.assert_not_called()
                    completion = request_json.call_args.args[3]
                    self.assertEqual(completion["status"], expected_status)
                    self.assertEqual(completion["failure_code"], expected_code)
                    self.assertIsNone(completion["result_object_key"])
                finally:
                    model_path.unlink(missing_ok=True)

    def test_insufficient_disk_fails_before_download_or_subprocess(self) -> None:
        asr = job()
        assert isinstance(asr["objects"], list)
        asr["objects"][0]["bytes"] = 43366609
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
        self.assertEqual(required, 2234216866)
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
                return_value=SimpleNamespace(free=2003607552),
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
            request_json.call_args.args[3]["failure_code"],
            "MEDIA_EXECUTION_DISK_SPACE_INSUFFICIENT",
        )
        self.assertIsNone(request_json.call_args.args[3]["result_object_key"])
        monitor.close.assert_called_once()

    def test_disk_preflight_preserves_exact_safety_boundary(self) -> None:
        objects = parse_personal_job(job()).objects
        required = personal_execution._required_free_bytes(objects)
        for available in (required - 1, required, required + 1):
            with (
                self.subTest(available=available),
                patch.object(
                    personal_execution.shutil,
                    "disk_usage",
                    return_value=SimpleNamespace(free=available),
                ),
            ):
                if available < required:
                    with self.assertRaises(OSError) as raised:
                        personal_execution._preflight_disk_space(objects, Path("/tmp"))
                    self.assertEqual(raised.exception.errno, errno.ENOSPC)
                    self.assertIn("Free up disk space", str(raised.exception))
                else:
                    personal_execution._preflight_disk_space(objects, Path("/tmp"))

    def test_disk_preflight_invalid_capacity_stays_unknown(self) -> None:
        objects = parse_personal_job(job()).objects
        for available in (None, True, "0", -1):
            with (
                self.subTest(available=available),
                patch.object(
                    personal_execution.shutil,
                    "disk_usage",
                    return_value=SimpleNamespace(free=available),
                ),
            ):
                with self.assertRaisesRegex(OSError, "capacity is unknown") as raised:
                    personal_execution._preflight_disk_space(objects, Path("/tmp"))
                self.assertNotEqual(raised.exception.errno, errno.ENOSPC)

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

    def test_command_pairing_keeps_pkce_and_skips_browser(self) -> None:
        created = {
            "schema_version": "videoforge-media-worker-enrollment-created/v1",
            "enrollment_id": "11111111-1111-4111-8111-111111111111",
            "poll_token": "a" * 64,
            "approval_url": "https://app.example.test/settings?enrollment=abc",
            "expires_in_seconds": 600,
        }
        approved = {"schema_version": "videoforge-media-worker-token/v1", "state": "APPROVED", "device_token": "b" * 64}
        store = Mock()
        with (patch("videoforge_media_local.personal_worker._json_request", side_effect=[(201, created), (200, approved)]) as request,
              patch("videoforge_media_local.personal_worker._open_approval_url") as browser):
            self.assertEqual(_enroll("https://app.example.test", "installation", "sha256:" + "c" * 64, store, "d" * 64), "b" * 64)
        browser.assert_not_called()
        self.assertEqual(request.call_args_list[0].kwargs["headers"], {"x-videoforge-connect-token": "d" * 64})
        self.assertIn("x-videoforge-pkce-verifier", request.call_args_list[1].kwargs["headers"])
        store.set.assert_called_once_with("installation", "b" * 64)

    def test_invalid_command_file_is_erased_before_connection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            token_file = Path(directory) / "token"
            token_file.write_text("invalid")
            with self.assertRaisesRegex(RuntimeError, "invalid"):
                connect_from_file(token_file)
            self.assertFalse(token_file.exists())

    def test_existing_pairing_is_not_replaced_by_a_different_account(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            token_file = Path(directory) / "token"
            token_file.write_text("d" * 64)
            store = Mock()
            store.get.return_value = "b" * 64
            with (patch("videoforge_media_local.personal_worker._build_configuration", return_value={"control_plane_origin": "https://app.example.test", "execution_bundle_sha256": "sha256:" + "c" * 64}),
                  patch("videoforge_media_local.personal_worker._tool_paths"),
                  patch("videoforge_media_local.personal_worker._state", return_value=(Path(directory) / "state", {"installation_id": "installation"})),
                  patch("videoforge_media_local.personal_worker._credential_store", return_value=store),
                  patch("videoforge_media_local.personal_worker._json_request", return_value=(409, {})),
                  patch("videoforge_media_local.personal_worker._enroll") as enroll):
                with self.assertRaisesRegex(RuntimeError, "another account"):
                    connect_from_file(token_file)
            self.assertFalse(token_file.exists())
            enroll.assert_not_called()
            store.set.assert_not_called()

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

    def test_completed_claim_polls_again_without_idle_delay(self) -> None:
        state = {"installation_id": "11111111-1111-4111-8111-111111111111"}
        with (
            patch("videoforge_media_local.personal_worker.sys.argv", ["worker", "--background"]),
            patch(
                "videoforge_media_local.personal_worker._install_macos_if_needed",
                return_value=False,
            ),
            patch(
                "videoforge_media_local.personal_worker._build_configuration",
                return_value={
                    "control_plane_origin": "https://app.example.test",
                    "execution_bundle_sha256": "sha256:" + "c" * 64,
                },
            ),
            patch("videoforge_media_local.personal_worker._tool_paths", return_value=Mock()),
            patch(
                "videoforge_media_local.personal_worker._state", return_value=(Path("state"), state)
            ),
            patch("videoforge_media_local.personal_worker._credential_store") as credentials,
            patch("videoforge_media_local.personal_worker._ensure_autostart"),
            patch(
                "videoforge_media_local.personal_worker._platform_facts",
                return_value=("MACOS", "AARCH64"),
            ),
            patch(
                "videoforge_media_local.personal_worker._json_request",
                side_effect=[
                    (200, {"status": "ONLINE"}),
                    (200, {"job": {}, "lease_token": "lease"}),
                    (200, {"status": "UPDATE_REQUIRED"}),
                ],
            ),
            patch("videoforge_media_local.personal_worker.parse_personal_job", return_value=Mock()),
            patch(
                "videoforge_media_local.personal_worker.execute_personal_job",
                return_value="SUCCEEDED",
            ) as execute,
            patch("videoforge_media_local.personal_worker.time.sleep") as sleep,
        ):
            credentials.return_value.get.return_value = "a" * 64
            self.assertEqual(run_forever(), 0)
            execute.assert_called_once()
            sleep.assert_not_called()

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
            self.assertEqual(plistlib.loads(target.read_bytes())["ProcessType"], "Standard")

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

    def test_cancellation_heartbeat_response_matrix_distinguishes_owner_from_stale_lease(
        self,
    ) -> None:
        heartbeat = {
            "schema_version": "videoforge-personal-worker-lease-heartbeat/v1",
            "cancel_requested": False,
            "lease_expires_in_seconds": 300,
        }
        self.assertIsNone(_heartbeat_stop_reason(200, heartbeat))
        self.assertEqual(
            _heartbeat_stop_reason(200, {**heartbeat, "cancel_requested": True}),
            "OWNER_CANCEL_REQUESTED",
        )
        self.assertEqual(
            _heartbeat_stop_reason(409, {"error": {"code": "MEDIA_WORKER_LEASE_STALE"}}),
            "LEASE_STALE_FENCE",
        )
        self.assertIsNone(_heartbeat_stop_reason(200, {"cancel_requested": True}))
        self.assertIsNone(_heartbeat_stop_reason(503, heartbeat))

    def test_owner_cancel_and_stale_lease_both_create_the_local_stop_fence(self) -> None:
        responses = (
            (
                200,
                {
                    "schema_version": "videoforge-personal-worker-lease-heartbeat/v1",
                    "cancel_requested": True,
                    "lease_expires_in_seconds": 300,
                },
                "OWNER_CANCEL_REQUESTED",
            ),
            (409, {"error": {"code": "MEDIA_WORKER_LEASE_STALE"}}, "LEASE_STALE_FENCE"),
        )
        for status, response, reason in responses:
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as directory:
                marker = Path(directory) / "cancelled"
                monitor = _CancellationMonitor(
                    "https://app.example.test/heartbeat", "device", "lease", marker, None
                )
                with (
                    patch(
                        "videoforge_media_local.personal_execution._request_json",
                        return_value=(status, response),
                    ),
                    patch.object(monitor._stop, "wait", return_value=False),
                ):
                    monitor._run()
                self.assertTrue(marker.is_file())
                self.assertEqual(monitor.stop_reason(), reason)

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

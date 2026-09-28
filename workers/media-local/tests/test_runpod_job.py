from __future__ import annotations

import io
import copy
import hashlib
import json
import tempfile
import urllib.error
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
from pathlib import Path

from videoforge_media_local import runpod_job as cloud
from test_personal_worker import job


def spec():
    now = datetime.now(timezone.utc)
    document = job()
    document["expires_at"] = (now + timedelta(hours=3)).isoformat()
    return {"schema_version": "videoforge-runpod-pod-job-spec/v1",
            "reservation_id": "22222222-2222-4222-8222-222222222222",
            "runtime_sha256": "sha256:" + "a" * 64,
            "source_sha256": "sha256:" + "b" * 64,
            "deadline_at": (now + timedelta(hours=2)).isoformat(), "job": document}


def port(size):
    return {"method": "MULTIPART", "contentLength": size,
            "checksumSha256": "sha256:" + "a" * 64, "part_size": 5 * 1024**2,
            "upload_id": "exact-upload", "part_sign_url": "https://app.test/part",
            "complete_url": "https://app.test/complete", "abort_url": "https://app.test/abort"}


def span_specs(count=4):
    base = spec()
    base["job"]["kind"] = "SPAN_AUDIO"
    base["job"]["input_document"] = {
        "schema_version": "selected-span-audio-job/v1", "output_profile": "SOULX_PCM16_48K_MONO"
    }
    documents = []
    for ordinal in range(count):
        document = copy.deepcopy(base)
        document["job"]["attempt_id"] = f"11111111-1111-4111-8111-{ordinal + 1:012d}"
        documents.append(document)
    return documents


class RunPodJobTests(unittest.TestCase):
    def test_cpu_runtime_rejection_requests_exact_cleanup_without_starting_job(self):
        document = spec()
        manifest = {"schema_version": "videoforge-linux-media-runtime/v1", "platform": "linux",
                    "qualified": True, "source_sha256": document["source_sha256"],
                    "required_cpu_flags": []}
        document["runtime_sha256"] = "sha256:" + hashlib.sha256(cloud.media._canonical(manifest)).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            runtime = Path(directory) / "runtime.json"
            runtime.write_text(json.dumps(manifest))
            with patch("sys.argv", ["runpod", "--spec-url", "https://app.test/reservation/spec",
                                    "--runtime-manifest", str(runtime)]), \
                    patch.dict("os.environ", {"VIDEOFORGE_CLOUD_CAPABILITY": "private-capability"}), \
                    patch.object(cloud, "_fetch_spec", return_value=document), \
                    patch.object(cloud.sys, "platform", "linux"), \
                    patch.object(cloud.platform, "machine", return_value="x86_64"), \
                    patch.object(cloud, "execute_batch") as execute, \
                    patch.object(cloud, "_control") as control, patch("sys.stderr", io.StringIO()):
                self.assertEqual(cloud.main(), 1)
            execute.assert_not_called()
            self.assertEqual(control.call_args.args[0], "https://app.test/reservation/cleanup")
            self.assertEqual(control.call_args.args[3], {
                "state": "FAILED", "reason": "RUNTIME_OR_STARTUP_REJECTED",
                "completed_attempt_id": document["job"]["attempt_id"]})

    def test_cpu_inventory_checks_every_processor_before_media_work(self):
        with tempfile.TemporaryDirectory() as directory:
            inventory = Path(directory) / "cpuinfo"
            inventory.write_text("processor: 0\nflags: sse2 avx avx2 f16c fma\n")
            cloud._verify_cpu_features(cloud.REQUIRED_CPU_FLAGS, inventory)
            for requirements in (None, [], ["avx2"], ["avx", "avx2", "f16c", "fma", "avx512f"]):
                with self.assertRaisesRegex(ValueError, "requirements differ"):
                    cloud._verify_cpu_features(requirements, inventory)
            inventory.write_text("processor: 0\nflags: avx avx2 f16c fma\n\nprocessor: 1\nflags: avx f16c fma\n")
            with self.assertRaisesRegex(ValueError, "lacks qualified"):
                cloud._verify_cpu_features(cloud.REQUIRED_CPU_FLAGS, inventory)
            inventory.write_text("processor: 0\nmodel name: unknown\n")
            with self.assertRaisesRegex(ValueError, "lacks qualified"):
                cloud._verify_cpu_features(cloud.REQUIRED_CPU_FLAGS, inventory)
            inventory.write_text("processor: 0\nflags: avx avx2 f16c fma\n\nprocessor: 1\n")
            with self.assertRaisesRegex(ValueError, "lacks qualified"):
                cloud._verify_cpu_features(cloud.REQUIRED_CPU_FLAGS, inventory)

    def test_failed_input_renews_exact_ports_without_redownloading_success(self):
        document = spec()
        document["job"]["completion_url"] = "https://app.test/reservation/complete?attempt_id=" + document["job"]["attempt_id"]
        second = copy.deepcopy(document["job"]["objects"][0])
        second.update(uri="vf-local://objects/sha256/bb/" + "b" * 64 + ".png", sha256="sha256:" + "b" * 64)
        document["job"]["objects"].append(second)
        renewed = copy.deepcopy(document)
        renewed["job"]["objects"][0]["url"] = "https://objects.test/fresh"
        calls = []
        def download(item, destination, cancelled):
            calls.append(item["uri"])
            if item["uri"] == document["job"]["objects"][0]["uri"] and item["url"] != "https://objects.test/fresh":
                raise urllib.error.URLError("expired port")
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(b"accepted")
        with tempfile.TemporaryDirectory() as directory, patch.object(cloud.media, "_download", side_effect=download), patch.object(cloud, "_fetch_spec", return_value=renewed) as fetch:
            cloud._download_inputs(cloud.parse_spec(document), Path(directory), "capability", "lease", lambda: False)
        self.assertEqual(calls.count(second["uri"]), 1)
        self.assertEqual(calls.count(document["job"]["objects"][0]["uri"]), 2)
        self.assertIn("?attempt_id=" + document["job"]["attempt_id"], fetch.call_args.args[0])

    def test_renewed_input_facts_and_attempt_cannot_change(self):
        original = spec()
        for mutation in (lambda value: value["job"]["objects"][0].update(bytes=129),
                         lambda value: value["job"].update(attempt_id="99999999-9999-4999-8999-999999999999")):
            renewed = copy.deepcopy(original)
            mutation(renewed)
            with self.assertRaises(ValueError):
                cloud._renewed_objects(cloud.parse_spec(original), cloud.parse_spec(renewed))

    def test_reuses_four_immediately_ready_spans_without_new_deadline(self):
        documents = span_specs()
        with patch.object(cloud, "run", side_effect=[
            ("SUCCEEDED", documents[1]), ("SUCCEEDED", documents[2]),
            ("SUCCEEDED", documents[3]), ("SUCCEEDED", None)
        ]) as run:
            self.assertEqual(cloud.execute_batch(cloud.parse_spec(documents[0]), "capability", "lease", None), "SUCCEEDED")
        self.assertEqual(run.call_count, 4)
        self.assertEqual([call.kwargs["allow_next_span"] for call in run.call_args_list], [True, True, True, False])
        self.assertEqual([call.kwargs["executed_span_count"] for call in run.call_args_list], [1, 2, 3, 4])
        self.assertEqual(len({call.args[0].deadline_at for call in run.call_args_list}), 1)

    def test_no_ready_span_exits_without_poll_or_wait(self):
        with patch.object(cloud, "run", return_value=("SUCCEEDED", None)) as run:
            self.assertEqual(cloud.execute_batch(cloud.parse_spec(span_specs()[0]), "capability", "lease", None), "SUCCEEDED")
        self.assertEqual(run.call_count, 1)

    def test_next_span_rejects_tenant_deadline_runtime_and_duplicate_attempt(self):
        documents = span_specs()
        mutations = [
            lambda document: document.update(runtime_sha256="sha256:" + "c" * 64),
            lambda document: document.update(deadline_at=(datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()),
            lambda document: document["job"].update(attempt_id=documents[0]["job"]["attempt_id"]),
            lambda document: document["job"]["outputs"][0].update(object_key=documents[1]["job"]["outputs"][0]["object_key"].replace("account-a", "account-b")),
        ]
        for mutation in mutations:
            following = copy.deepcopy(documents[1])
            mutation(following)
            with patch.object(cloud, "run", return_value=("SUCCEEDED", following)) as run, patch.object(cloud, "_control") as control:
                self.assertEqual(cloud.execute_batch(cloud.parse_spec(documents[0]), "capability", "lease", None), "FAILED")
            self.assertEqual(run.call_count, 1)
            self.assertFalse(control.call_args.args[3]["allow_next_span"])

    def test_runtime_manifest_mismatch_fails_before_processing(self):
        parsed = cloud.parse_spec(spec())
        with patch.object(Path, "read_bytes", return_value=b'{"qualified":false}'), self.assertRaises(ValueError):
            cloud.verify_runtime(parsed, Path("/unqualified/runtime.json"))

    def test_spec_startup_wait_is_bounded_and_permanent_errors_stop(self):
        with patch.object(cloud.media, "_request_json", side_effect=[(409, None), (200, spec())]), patch(
            "threading.Event.wait"
        ):
            self.assertIsInstance(cloud._fetch_spec("https://app.test/spec", "capability", "lease"), dict)
        with patch.object(cloud.media, "_request_json", return_value=(403, None)) as request, self.assertRaises(ValueError):
            cloud._fetch_spec("https://app.test/spec", "capability", "lease")
        self.assertEqual(request.call_count, 1)
        with self.assertRaises(ValueError):
            cloud._fetch_spec("https://app.test/spec", "capability", "lease", startup_seconds=0)

    def test_separate_cloud_identity_preserves_exact_desktop_job(self):
        parsed = cloud.parse_spec(spec())
        self.assertEqual(parsed.job.kind, "RENDER")
        self.assertEqual(parsed.reservation_id, "22222222-2222-4222-8222-222222222222")
        for change in ({"schema_version": "videoforge-cloud-run-job-spec/v1"},
                       {"runtime_sha256": "latest"}, {"secret": "forbidden"},
                       {"deadline_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()}):
            with self.assertRaises(ValueError):
                cloud.parse_spec({**spec(), **change})

    def test_multipart_retries_only_failed_part_and_verifies_completion(self):
        payload = b"x" * (5 * 1024**2 + 3)
        authority = {"url": "https://objects.test/part", "requiredHeaders": {}}
        response = MagicMock()
        response.status = 200
        response.headers = {"ETag": '"part-etag"'}
        response.__enter__.return_value = response
        requests = []
        def control(url, token, lease, body):
            requests.append((url, body))
            return {"verified": True} if url.endswith("complete") else authority
        with patch.object(cloud, "_control", side_effect=control), patch(
            "urllib.request.urlopen", side_effect=[response, OSError("transient"), response]
        ):
            cloud._multipart(port(len(payload)), io.BytesIO(payload), len(payload),
                             "sha256:" + "a" * 64, "capability", "lease", lambda: False)
        self.assertEqual([body["part_number"] for url, body in requests if url.endswith("part")], [1, 2, 2])
        completed = requests[-1][1]
        self.assertEqual(len(completed["parts"]), 2)

    def test_multipart_aborts_on_cancel_or_unverified_whole_checksum(self):
        for cancelled in (True, False):
            response = MagicMock()
            response.status = 200
            response.headers = {"ETag": "etag"}
            response.__enter__.return_value = response
            calls = []
            def control(url, token, lease, body):
                calls.append(url)
                return {"url": "https://objects.test/part", "requiredHeaders": {}}
            with patch.object(cloud, "_control", side_effect=control), patch(
                "urllib.request.urlopen", return_value=response
            ), self.assertRaises((cloud.media._PersonalJobCancelled, ValueError)):
                cloud._multipart(port(3), io.BytesIO(b"abc"), 3, "sha256:" + "a" * 64,
                                 "capability", "lease", lambda: cancelled)
            self.assertEqual(calls[-1], "https://app.test/abort")

    def test_lost_multipart_completion_reconciles_same_parts_without_reupload(self):
        response = MagicMock()
        response.status = 200
        response.headers = {"ETag": "etag"}
        response.__enter__.return_value = response
        completions = []
        def control(url, token, lease, body):
            if url.endswith("complete"):
                completions.append(body)
                if len(completions) == 1:
                    raise OSError("lost acknowledgment")
                return {"verified": True}
            return {"url": "https://objects.test/part", "requiredHeaders": {}}
        with patch.object(cloud, "_control", side_effect=control), patch("urllib.request.urlopen", return_value=response) as upload:
            cloud._multipart(port(3), io.BytesIO(b"abc"), 3, "sha256:" + "a" * 64,
                             "capability", "lease", lambda: False)
        self.assertEqual(upload.call_count, 1)
        self.assertEqual(completions[0], completions[1])

    def test_single_put_streams_descriptor_and_rejects_large_single_put(self):
        response = {"method": "PUT", "contentLength": 3, "contentType": "video/mp4",
                    "checksumSha256": "sha256:" + "a" * 64}
        source = io.BytesIO(b"abc")
        with patch.object(cloud, "_control", return_value=response), patch.object(
            cloud.media, "_stream_put"
        ) as put:
            cloud._upload("https://app.test/upload", "PRIMARY_RESULT_OUTPUT", "key", "video/mp4",
                          source, 3, response["checksumSha256"], "capability", "lease", lambda: False)
            self.assertIs(put.call_args.args[1], source)
            response["contentLength"] = 6 * 1024**3
            with self.assertRaises(ValueError):
                cloud._upload("https://app.test/upload", "PRIMARY_RESULT_OUTPUT", "key", "video/mp4",
                              source, response["contentLength"], response["checksumSha256"],
                              "capability", "lease", lambda: False)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import base64
import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from videoforge_media_local.cloud_job import (
    _local_path,
    _sha256_bytes,
    _upload_port,
    _validated_asr_primary_output,
    _validated_primary_output,
    parse_spec,
)


def valid_spec() -> dict[str, object]:
    digest = "a" * 64
    return {
        "schema_version": "videoforge-cloud-run-job-spec/v1",
        "attempt_id": "attempt_v2_06_a",
        "kind": "ASR",
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=15))
        .isoformat()
        .replace("+00:00", "Z"),
        "input_document": {"cancellation_token": "cancel_v2_06_a"},
        "objects": [
            {
                "uri": f"vf-local://objects/sha256/aa/{digest}.bin",
                "url": "https://r2.example.test/exact-input?signature=redacted",
                "sha256": f"sha256:{digest}",
                "bytes": 128,
            }
        ],
        "outputs": [
            {
                "source": "PRIMARY_RESULT_OUTPUT",
                "object_key": "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/input/job/attempt-a/artifact/primary-a",
                "sign_url": "https://videoforge.example.test/api/v2/internal/cloud-run/upload-port/attempt-a",
                "content_type": "application/json",
                "max_bytes": 1048576,
            }
        ],
        "result": {
            "object_key": "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/input/job/attempt-a/artifact/result-a",
            "sign_url": "https://videoforge.example.test/api/v2/internal/cloud-run/upload-port/attempt-a",
            "max_bytes": 1048576,
        },
        "cancellation_url": "https://videoforge.example.test/cancel/attempt-a",
        "tooling": {
            "whisper_model_uri": f"vf-local://objects/sha256/aa/{digest}.bin",
            "whisper_version": "1.8.4",
            "ffmpeg_version": "8.1.2",
            "ffprobe_version": "8.1.2",
        },
    }


class CloudJobSpecTests(unittest.TestCase):
    def test_accepts_exact_bounded_signed_ports(self) -> None:
        parsed = parse_spec(valid_spec())
        self.assertEqual(parsed.kind, "ASR")
        self.assertEqual(parsed.attempt_id, "attempt_v2_06_a")
        self.assertEqual(len(parsed.objects), 1)

    def test_rejects_extra_fields_broad_urls_and_duplicate_objects(self) -> None:
        extra = valid_spec()
        extra["secret"] = "must-not-enter-spec"
        with self.assertRaises(ValueError):
            parse_spec(extra)

        insecure = valid_spec()
        insecure["objects"][0]["url"] = "http://r2.example.test/input"  # type: ignore[index]
        with self.assertRaises(ValueError):
            parse_spec(insecure)

        duplicate = valid_spec()
        duplicate["objects"] = [duplicate["objects"][0], duplicate["objects"][0]]  # type: ignore[index]
        with self.assertRaises(ValueError):
            parse_spec(duplicate)

    def test_rejects_unbounded_or_unowned_result_paths(self) -> None:
        broad = valid_spec()
        broad["result"]["object_key"] = "tenant/account-a"  # type: ignore[index]
        with self.assertRaises(ValueError):
            parse_spec(broad)

        oversized = valid_spec()
        oversized["result"]["max_bytes"] = 1048577  # type: ignore[index]
        with self.assertRaises(ValueError):
            parse_spec(oversized)

    def test_rejects_tool_version_drift(self) -> None:
        drifted = valid_spec()
        drifted["tooling"]["ffprobe_version"] = "8.1.1"  # type: ignore[index]
        with self.assertRaises(ValueError):
            parse_spec(drifted)

    def test_upload_port_requires_exact_checksum_bound_headers(self) -> None:
        payload = b"owned-render-output"
        checksum = _sha256_bytes(payload)
        checksum_header = base64.b64encode(bytes.fromhex(checksum[7:])).decode("ascii")
        response_document = {
            "schema_version": "videoforge-cloud-run-upload-port/v1",
            "method": "PUT",
            "url": "https://r2.example.test/exact-output?signature=redacted",
            "requiredHeaders": {
                "content-length": str(len(payload)),
                "content-type": "video/mp4",
                "x-amz-checksum-sha256": checksum_header,
            },
            "expiresAt": "2026-08-17T00:05:00.000Z",
            "contentType": "video/mp4",
            "contentLength": len(payload),
            "checksumSha256": checksum,
        }

        class Response:
            status = 200

            def __enter__(self):  # type: ignore[no-untyped-def]
                return self

            def __exit__(self, *_args):  # type: ignore[no-untyped-def]
                return False

            def read(self, _maximum: int) -> bytes:
                return json.dumps(response_document).encode("utf-8")

        with patch("urllib.request.urlopen", return_value=Response()):
            url, headers = _upload_port(
                "https://videoforge.example.test/upload-authority",
                "callback-token",
                "PRIMARY_RESULT_OUTPUT",
                "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/render/job/attempt-a/artifact/output-a",
                "video/mp4",
                payload,
            )
        self.assertEqual(url, response_document["url"])
        self.assertEqual(headers["x-amz-checksum-sha256"], checksum_header)

        response_document["requiredHeaders"]["x-amz-checksum-sha256"] = "wrong"
        with patch("urllib.request.urlopen", return_value=Response()):
            with self.assertRaisesRegex(ValueError, "exact output facts"):
                _upload_port(
                    "https://videoforge.example.test/upload-authority",
                    "callback-token",
                    "PRIMARY_RESULT_OUTPUT",
                    "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/render/job/attempt-a/artifact/output-a",
                    "video/mp4",
                    payload,
                )

    def test_primary_output_requires_exact_regular_bytes(self) -> None:
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload = b"owned-render-output"
            uri = f"vf-local://objects/sha256/{_sha256_bytes(payload)[7:9]}/{_sha256_bytes(payload)[7:]}.mp4"
            path = _local_path(root, uri)
            path.parent.mkdir(parents=True)
            path.write_bytes(payload)
            result = {
                "output": {
                    "artifact_uri": uri,
                    "bytes": len(payload),
                    "sha256": _sha256_bytes(payload),
                }
            }
            self.assertEqual(_validated_primary_output(root, result), payload)
            result["output"]["bytes"] = len(payload) + 1  # type: ignore[index]
            with self.assertRaises(ValueError):
                _validated_primary_output(root, result)
            path.unlink()
            with self.assertRaises(ValueError):
                _validated_primary_output(
                    root,
                    {
                        "output": {
                            "artifact_uri": uri,
                            "bytes": len(payload),
                            "sha256": _sha256_bytes(payload),
                        }
                    },
                )

    def test_asr_primary_output_uses_the_declared_result_uri(self) -> None:
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            uri = "vf-local-run://revision-a/attempt-a/asr-result.json"
            path = _local_path(root, uri)
            path.parent.mkdir(parents=True)
            payload = b'{"schema_version":"asr-job-result/v1"}'
            path.write_bytes(payload)
            self.assertEqual(
                _validated_asr_primary_output(root, {"output": {"result_uri": uri}}),
                payload,
            )
            with self.assertRaises(ValueError):
                _validated_asr_primary_output(
                    root, {"output": {"result_uri": "https://example.test/out"}}
                )


if __name__ == "__main__":
    unittest.main()

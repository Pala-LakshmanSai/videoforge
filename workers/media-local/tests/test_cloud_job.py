from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from videoforge_media_local.cloud_job import (
    _local_path,
    _sha256_bytes,
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
        "outputs": [],
        "result": {
            "object_key": "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/input/job/attempt-a/artifact/result-a",
            "upload_url": "https://r2.example.test/exact-result?signature=redacted",
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


if __name__ == "__main__":
    unittest.main()

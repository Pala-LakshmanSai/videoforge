from __future__ import annotations

import base64
import runpy
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode

derive = runpy.run_path(str(Path(__file__).parents[1] / "derive_retained_cloud_audio.py"))


class DerivedCloudAudioTests(unittest.TestCase):
    def setUp(self):
        self.sha = "sha256:" + "a" * 64
        self.plan = {"schema_version": "videoforge-cloud-media-derived-audio-plan/v1",
                     "source": {"url": "https://private.test/source", "sha256": self.sha,
                                "bytes": 2548151, "duration_ms": 159216, "sample_rate": 44100, "channels": 2},
                     "cycle_duration_ms": 159200, "target_duration_ms": 2700000,
                     "expected_image_digest": self.sha, "expected_ffmpeg_sha256": self.sha,
                     "publication": {"mailbox_url": "https://private.test/mailbox", "wait_seconds": 1800,
                                     "maximum_bytes": 536870912, "object_key": "tenant/exact-new.flac"}}
        self.facts = {"content_length": 100, "sha256": self.sha, "content_type": "audio/flac",
                      "duration_ms": 2700000, "sample_rate_hz": 44100, "channels": 2, "source_sha256": self.sha}
        self.headers = {"content-length": "100", "content-type": "audio/flac", "if-none-match": "*",
                        "x-amz-checksum-sha256": base64.b64encode(bytes.fromhex("a" * 64)).decode(),
                        "x-amz-meta-sha256": self.sha}
        query = urlencode({"X-Amz-SignedHeaders": ";".join(sorted(self.headers))})
        self.mailbox = {**self.facts, "schema_version": "videoforge-private-derived-audio-mailbox/v1",
                        "put_url": "https://private.test/bucket/tenant/exact-new.flac?" + query,
                        "headers": self.headers,
                        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=20)).isoformat()}

    def test_exact_bound_facts_and_object_authority(self):
        derive["validate_plan"](self.plan)
        self.assertEqual(derive["validate_mailbox"](self.plan, self.facts, self.mailbox), self.headers)

    def test_mailbox_cannot_change_object_hash_size_or_signed_headers(self):
        cases = [{"sha256": "sha256:" + "b" * 64}, {"content_length": 101},
                 {"put_url": self.mailbox["put_url"].replace("exact-new", "other")},
                 {"put_url": self.mailbox["put_url"].split("?")[0]},
                 {"headers": {**self.headers, "authorization": "not-allowed"}},
                 {"headers": {**self.headers, "if-none-match": "overwrite"}},
                 {"expires_at": "2000-01-01T00:00:00Z"}]
        for change in cases:
            with self.subTest(change=list(change)), self.assertRaises(ValueError):
                derive["validate_mailbox"](self.plan, self.facts, {**self.mailbox, **change})

    def test_plan_cannot_extend_wait_budget_or_change_source_geometry(self):
        for change in ({"wait_seconds": 1801}, {"maximum_bytes": 536870913}, {"object_key": "tenant/../other"}):
            with self.assertRaises(ValueError):
                derive["validate_plan"]({**self.plan, "publication": {**self.plan["publication"], **change}})
        with self.assertRaises(ValueError):
            derive["validate_plan"]({**self.plan, "source": {**self.plan["source"], "sample_rate": 48000}})


if __name__ == "__main__":
    unittest.main()

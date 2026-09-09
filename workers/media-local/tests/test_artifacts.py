from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from videoforge_media_local import R2PortFixtureArtifactResolver
from videoforge_media_local import cli


class R2PortFixtureTests(unittest.TestCase):
    def test_media_local_entrypoint_uses_r2_fixture_port_for_pinned_cpu_jobs(self) -> None:
        with patch.object(cli, "shared_media_main", return_value=0) as shared:
            self.assertEqual(cli.main(), 0)
        shared.assert_called_once_with(
            resolver_factory=R2PortFixtureArtifactResolver,
            accepted_commands=frozenset({"transcribe", "materialize-span", "render"}),
        )

    def test_personal_worker_accepts_full_terminal_25fps_rounding_only(self) -> None:
        digest = "a" * 64
        document = {
            "schema_version": "selected-span-audio-job/v1",
            "project_revision_id": "revision_001",
            "attempt_id": "attempt_001",
            "timeline_plan_id": "plan_001",
            "transcript_id": "transcript_001",
            "span_id": "span_001",
            "timeline_segment_id": "segment_001",
            "task_key": "audio-span:segment_001",
            "source_voiceover": {
                "asset_id": "asset_001",
                "sha256": f"sha256:{digest}",
                "artifact_uri": f"vf-local://objects/sha256/aa/{digest}.wav",
                "duration_ms": 159216,
            },
            "selection": {
                "selected_start_ms": 150264,
                "selected_end_ms_exclusive": 159216,
                "padded_start_ms": 150240,
                "padded_end_ms_exclusive": 159240,
                "trim_start_ms": 24,
                "trim_end_ms_exclusive": 8976,
            },
            "output": {
                "asset_id": "output_001",
                "result_uri": "vf-local-run://revision_001/attempt_001/span-audio-result.json",
            },
            "cancel_token": "span-cancel-token-001",
            "output_profile": "SOULX_PCM16_48K_MONO",
        }
        with self.assertRaises(ValueError):
            cli._shared_span_document(document)
        parsed = cli._personal_worker_span_document(document)
        self.assertEqual(parsed["source_voiceover"]["duration_ms"], 159216)
        document["selection"]["padded_end_ms_exclusive"] = 159256
        with self.assertRaises(ValueError):
            cli._personal_worker_span_document(document)

    def test_maps_content_addressed_input_and_bounded_run_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            resolver = R2PortFixtureArtifactResolver(root)
            content = b"owned private R2 fixture audio"
            digest = hashlib.sha256(content).hexdigest()
            stored = root / resolver.bucket / "objects" / "sha256" / digest[:2] / f"{digest}.wav"
            stored.parent.mkdir(parents=True)
            stored.write_bytes(content)
            uri = f"vf-local://objects/sha256/{digest[:2]}/{digest}.wav"
            self.assertEqual(resolver.resolve_object(uri).read_bytes(), content)
            self.assertEqual(
                resolver.resolve_run("vf-local-run://revision_cp03/attempt_cp03/asr-result.json"),
                root
                / resolver.bucket
                / "runs"
                / "revision_cp03"
                / "attempt_cp03"
                / "asr-result.json",
            )
            run_output = resolver.resolve_run(
                "vf-local-run://revision_cp03/attempt_cp03/render.mp4"
            )
            run_output.write_bytes(b"exact rendered output")
            output_sha256 = "sha256:" + hashlib.sha256(run_output.read_bytes()).hexdigest()
            published_uri = resolver.publish_object(run_output, output_sha256, "mp4")
            self.assertEqual(
                resolver.resolve_object(published_uri).read_bytes(), run_output.read_bytes()
            )
            self.assertEqual(
                resolver.publish_object(run_output, output_sha256, "mp4"), published_uri
            )

    def test_rejects_escape_and_symlinked_private_prefix(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            sandbox = Path(temporary).resolve()
            root = sandbox / "r2"
            outside = sandbox / "outside"
            outside.mkdir()
            resolver = R2PortFixtureArtifactResolver(root)
            (root / resolver.bucket).symlink_to(outside, target_is_directory=True)
            with self.assertRaises(ValueError):
                resolver.resolve_run("vf-local-run://revision_cp03/attempt_cp03/result.json")
            self.assertEqual(list(outside.iterdir()), [])


if __name__ == "__main__":
    unittest.main()

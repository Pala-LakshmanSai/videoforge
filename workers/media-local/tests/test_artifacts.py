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
            accepted_commands=frozenset({"transcribe", "render"}),
        )

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

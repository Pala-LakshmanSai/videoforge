from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

from videoforge_media_local import R2PortFixtureArtifactResolver


class R2PortFixtureTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()

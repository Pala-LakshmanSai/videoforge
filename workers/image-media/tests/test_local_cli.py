from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

from videoforge_image_media.local_cli import LocalArtifactResolver, cancellation_marker


class LocalArtifactResolverTests(unittest.TestCase):
    def test_resolves_canonical_objects_and_bounded_run_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            resolver = LocalArtifactResolver(root)
            content = b"owned local media"
            digest = hashlib.sha256(content).hexdigest()
            object_path = root / "objects" / "sha256" / digest[:2] / f"{digest}.wav"
            object_path.parent.mkdir(parents=True)
            object_path.write_bytes(content)

            self.assertEqual(
                resolver.resolve_object(f"vf-local://objects/sha256/{digest[:2]}/{digest}.wav"),
                object_path,
            )
            self.assertEqual(
                resolver.resolve_run("vf-local-run://revision_001/attempt_001/result.json"),
                root / "runs" / "revision_001" / "attempt_001" / "result.json",
            )
            with self.assertRaises(ValueError):
                resolver.resolve_run("vf-local-run://revision_001/attempt_001/../escape.json")

    def test_publishes_exact_bytes_immutably_and_reuses_an_identical_object(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            resolver = LocalArtifactResolver(root)
            source = root / "runs" / "revision_001" / "attempt_001" / "output.mp4"
            source.parent.mkdir(parents=True)
            source.write_bytes(b"local synthetic mp4")
            sha256 = f"sha256:{hashlib.sha256(source.read_bytes()).hexdigest()}"

            first = resolver.publish_object(source, sha256, "mp4")
            second = resolver.publish_object(source, sha256, "mp4")
            self.assertEqual(first, second)
            self.assertEqual(resolver.resolve_object(first).read_bytes(), source.read_bytes())

    def test_uses_an_opaque_hash_of_the_cancel_token_for_marker_paths(self) -> None:
        root = Path("/tmp/videoforge-local-cli-test").resolve()
        token = "secret-local-cancel-token-0000000000000001"
        marker = cancellation_marker(root, token)
        self.assertEqual(marker.parent, root / "cancellations")
        self.assertNotIn(token, marker.name)


if __name__ == "__main__":
    unittest.main()

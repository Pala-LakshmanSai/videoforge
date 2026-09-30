from __future__ import annotations

import copy
import hashlib
import runpy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

overlay = runpy.run_path(str(Path(__file__).parents[1] / "prepare_runpod_source.py"))
prepare = overlay["prepare"]


class RunPodSourceTests(unittest.TestCase):
    def fixture(self, root):
        sources = {}
        for relative in overlay["SOURCE_ROOTS"]:
            path = root / relative / "module.py"
            path.parent.mkdir(parents=True)
            path.write_text("# updated exact source\n")
            sources[path.relative_to(root).as_posix()] = "sha256:" + "a" * 64
        lock = root / "workers/media-local/runpod-requirements.lock"
        lock.write_bytes(b"exact locked dependencies\n")
        base = {"schema_version": "videoforge-linux-media-runtime/v1", "platform": "linux",
                "qualified": True, "source_sha256": overlay["BASE_SOURCE_SHA256"],
                "source_files": sources, "tools": {"model": {"sha256": "exact model"}},
                "required_cpu_flags": ["avx", "avx2", "f16c", "fma"],
                "offline_acceptance": {"old": "proof"}}
        pins = {"BASE_RUNTIME_SHA256": "sha256:" + hashlib.sha256(overlay["canonical"](base)).hexdigest(),
                "BASE_LOCK_SHA256": overlay["digest"](lock)}
        return base, pins

    def test_changed_sources_are_unqualified_and_tools_model_lock_remain_pinned(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base, pins = self.fixture(root)
            with patch.dict(prepare.__globals__, pins):
                candidate = prepare(root, base, overlay["BASE_IMAGE"])
            self.assertIs(candidate["qualified"], False)
            self.assertEqual(candidate["span_batch_protocol"], 2)
            self.assertNotIn("offline_acceptance", candidate)
            self.assertEqual(candidate["tools"], base["tools"])
            self.assertEqual(candidate["required_cpu_flags"], base["required_cpu_flags"])
            self.assertEqual(candidate["dependency_lock_sha256"], pins["BASE_LOCK_SHA256"])
            self.assertNotEqual(candidate["source_sha256"], base["source_sha256"])
            for name, checksum in candidate["source_files"].items():
                self.assertEqual(overlay["digest"](root / name), checksum)
            self.assertIs(base["qualified"], True)
            self.assertIn("offline_acceptance", base)

    def test_mutable_image_platform_unqualified_base_and_changed_lock_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base, pins = self.fixture(root)
            with patch.dict(prepare.__globals__, pins):
                for image in ("private/runtime:latest", overlay["BASE_IMAGE"].replace("d054", "a054")):
                    with self.assertRaises(ValueError):
                        prepare(root, base, image)
                for mutation in ({"qualified": False}, {"platform": "darwin"},
                                 {"source_sha256": "sha256:" + "b" * 64}):
                    bad = copy.deepcopy(base)
                    bad.update(mutation)
                    with self.assertRaises(ValueError):
                        prepare(root, bad, overlay["BASE_IMAGE"])
                (root / "workers/media-local/runpod-requirements.lock").write_text("changed deps")
                with self.assertRaises(ValueError):
                    prepare(root, base, overlay["BASE_IMAGE"])

    def test_stale_removed_added_or_symlink_sources_cannot_enter_overlay(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base, pins = self.fixture(root)
            with patch.dict(prepare.__globals__, pins):
                path = root / "workers/media-local/src/module.py"
                path.unlink()
                with self.assertRaises(ValueError):
                    prepare(root, base, overlay["BASE_IMAGE"])
                path.write_text("restored")
                extra = path.with_name("extra.py")
                extra.write_text("new source needs full qualification")
                with self.assertRaises(ValueError):
                    prepare(root, base, overlay["BASE_IMAGE"])
                extra.unlink()
                extra.symlink_to(path)
                with self.assertRaises(ValueError):
                    prepare(root, base, overlay["BASE_IMAGE"])


if __name__ == "__main__":
    unittest.main()

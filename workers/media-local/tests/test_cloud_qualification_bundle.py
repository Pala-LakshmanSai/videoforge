from __future__ import annotations

import runpy
import stat
import tempfile
import unittest
import zipfile
import io
from pathlib import Path
from unittest.mock import patch

fetch = runpy.run_path(str(Path(__file__).parents[1] / "fetch_cloud_qualification.py"))


class QualificationBundleTests(unittest.TestCase):
    def test_exact_local_jobs_extract_without_capabilities(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "inputs.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                for kind in ("asr", "span", "render"):
                    bundle.writestr(f"jobs/{kind}.json", '{"schema_version":"local-job","cancel_token":"local-cancel"}')
                bundle.writestr("artifact-root/objects/sha256/aa/input.wav", b"accepted bytes")
            target = root / "accepted"
            target.mkdir()
            fetch["extract"](archive, target)
            self.assertEqual((target / "artifact-root/objects/sha256/aa/input.wav").read_bytes(), b"accepted bytes")

    def test_traversal_symlinks_and_remote_capabilities_reject(self):
        for bad in ("../outside", "artifact-root/../outside", "symlink", "remote", "credential"):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                archive = root / "inputs.zip"
                with zipfile.ZipFile(archive, "w") as bundle:
                    if bad == "symlink":
                        link = zipfile.ZipInfo("artifact-root/link")
                        link.create_system = 3
                        link.external_attr = (stat.S_IFLNK | 0o777) << 16
                        bundle.writestr(link, "/outside")
                    elif bad in {"remote", "credential"}:
                        for kind in ("asr", "span", "render"):
                            document = ('{"url":"https://private.test/capability"}' if bad == "remote"
                                        else '{"authorization":"private-credential"}')
                            bundle.writestr(f"jobs/{kind}.json", document)
                    else:
                        bundle.writestr(bad, b"outside")
                target = root / "rejected"
                target.mkdir()
                with self.assertRaises(ValueError):
                    fetch["extract"](archive, target)

    def test_download_hash_mismatch_fails_without_extracting_or_logging_capability(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "inputs"
            output = io.StringIO()
            with patch("sys.argv", ["fetch", "--sha256", "sha256:" + "0" * 64,
                                    "--target", str(target)]), \
                    patch.dict("os.environ", {"VIDEOFORGE_CLOUD_QUALIFICATION_URL":
                                               "https://private.test/secret-capability"}), \
                    patch("urllib.request.urlopen", return_value=io.BytesIO(b"wrong archive")), \
                    patch("sys.stdout", output):
                self.assertEqual(fetch["main"](), 1)
            self.assertFalse(target.exists())
            self.assertNotIn("secret-capability", output.getvalue())


if __name__ == "__main__":
    unittest.main()

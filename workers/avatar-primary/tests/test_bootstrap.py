import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


BOOTSTRAP_PATH = Path(__file__).resolve().parents[1] / "bootstrap_models.py"


def load_bootstrap(model_root: Path):
    previous = os.environ.get("ECHOMIMIC_MODEL_ROOT")
    previous_hub = sys.modules.get("huggingface_hub")
    os.environ["ECHOMIMIC_MODEL_ROOT"] = str(model_root)
    sys.modules["huggingface_hub"] = types.SimpleNamespace(snapshot_download=lambda **_kwargs: None)
    try:
        spec = importlib.util.spec_from_file_location("bootstrap_models_under_test", BOOTSTRAP_PATH)
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        if previous is None:
            os.environ.pop("ECHOMIMIC_MODEL_ROOT", None)
        else:
            os.environ["ECHOMIMIC_MODEL_ROOT"] = previous
        if previous_hub is None:
            sys.modules.pop("huggingface_hub", None)
        else:
            sys.modules["huggingface_hub"] = previous_hub


class BootstrapTest(unittest.TestCase):
    def test_exact_revisions_and_manifest_byte_total(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            module = load_bootstrap(Path(temporary))
            self.assertEqual(module.SOURCE_REVISION, "7e89489ca51c0d008fc1963ec6c03fc5bd0b9397")
            self.assertEqual(module.FLASH_REVISION, "311e176905a8c4c24b240b530488fe636ce4d249")
            self.assertEqual(module.BASE_REVISION, "fc913c34361f4ec879e2f9c78b4f11ae50a937d1")
            self.assertEqual(module.AUDIO_REVISION, "3991242c806928916fff4a8c0e4f76acf661b743")
            self.assertEqual(sum(item[1] for item in module.REQUIRED_FILES if item[2]), 23922317735)

    def test_cache_hit_is_verified_and_download_free(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            module = load_bootstrap(Path(temporary))
            expected = {"schema_version": "videoforge.echomimic-cache/v1"}
            module.MARKER.write_text(json.dumps(expected), encoding="utf-8")
            with (
                patch.object(module, "verify_cache", return_value=expected),
                patch.object(module, "snapshot_download") as download,
            ):
                result = module.bootstrap_models()
            self.assertTrue(result["cache_hit"])
            download.assert_not_called()

    def test_nonempty_incomplete_cache_refuses_download(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "partial").write_bytes(b"partial")
            module = load_bootstrap(root)
            with patch.object(module, "snapshot_download") as download:
                with self.assertRaisesRegex(RuntimeError, "ECHOMIMIC_CACHE_INCOMPLETE"):
                    module.bootstrap_models()
            download.assert_not_called()

    def test_mutated_digest_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            module = load_bootstrap(Path(temporary))
            target = Path(temporary) / "one.bin"
            target.write_bytes(b"wrong")
            module.REQUIRED_FILES = (("one.bin", 5, hashlib.sha256(b"right").hexdigest()),)
            module.SELECTED_RUNTIME_BYTES = 5
            with self.assertRaisesRegex(RuntimeError, "ECHOMIMIC_CACHE_MUTATED"):
                module.verify_cache()


if __name__ == "__main__":
    unittest.main()

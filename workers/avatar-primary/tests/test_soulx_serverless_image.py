from __future__ import annotations

import hashlib
import importlib.util
import os
import re
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


AVATAR_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = AVATAR_ROOT.parents[1]
DOCKERFILE = AVATAR_ROOT / "Dockerfile.serverless"
REQUIREMENTS = AVATAR_ROOT / "requirements.serverless.txt"

BASE = (
    "ghcr.io/pala-lakshmansai/videoforge-soulx-flashhead-pro-vf924s"
    "@sha256:0538d16199f04cac0a68ad4570b3fc260470b079200da025fe8f36640fb69a9b"
)
SOURCE_REVISION = "9bc03de06bb0de82cd6bc477804512ae06144bf2"
MODEL_REVISION = "59119b6c681230c3eeee157e224ae1941746711e"
MODEL_MANIFEST = "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626"


def _docker_instructions(source: str) -> list[str]:
    instructions: list[str] = []
    current = ""
    for raw_line in source.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        current = f"{current} {line}".strip()
        if current.endswith("\\"):
            current = current[:-1].rstrip()
            continue
        instructions.append(current)
        current = ""
    if current:
        instructions.append(current)
    return instructions


class SoulXServerlessImageDefinitionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = DOCKERFILE.read_text(encoding="utf-8")
        cls.instructions = _docker_instructions(cls.source)

    def test_base_and_runtime_lineage_are_exact(self) -> None:
        from_lines = [line for line in self.instructions if line.startswith("FROM ")]
        self.assertEqual(from_lines, [f"FROM {BASE}"])
        for value in (
            'ai.videoforge.lane="soulx_avatar"',
            'ai.videoforge.runtime-profile="videoforge_soulx_flashhead_pro_bf16_v1"',
            f'ai.videoforge.source-revision="{SOURCE_REVISION}"',
            f'ai.videoforge.model-revision="{MODEL_REVISION}"',
            f'ai.videoforge.model-manifest="{MODEL_MANIFEST}"',
        ):
            self.assertIn(value, self.source)

    def test_exact_entrypoint_and_ffprobe_are_packaged(self) -> None:
        self.assertEqual(
            [line for line in self.instructions if line.startswith("ENTRYPOINT ")],
            ['ENTRYPOINT ["python", "-u", "/opt/videoforge/soulx-serverless-entrypoint.py"]'],
        )
        self.assertFalse(any(line.startswith("CMD ") for line in self.instructions))
        self.assertIn("VIDEOFORGE_FFPROBE_PATH=/usr/bin/ffprobe", self.source)
        self.assertIn('test "$(command -v ffprobe)" = /usr/bin/ffprobe', self.source)
        self.assertIn("ffprobe -version", self.source)

    def test_model_volume_is_offline_and_never_prepared_by_overlay(self) -> None:
        self.assertIn("SOULX_MODEL_ROOT=/runpod-volume/soulx-flashhead-pro", self.source)
        for flag in ("HF_HUB_OFFLINE=1", "TRANSFORMERS_OFFLINE=1", "DIFFUSERS_OFFLINE=1"):
            self.assertIn(flag, self.source)
        for path in (
            "VIDEOFORGE_JOB_SCRATCH_ROOT=/tmp/",
            "HF_HOME=/tmp/",
            "TRANSFORMERS_CACHE=/tmp/",
            "DIFFUSERS_CACHE=/tmp/",
            "XDG_CACHE_HOME=/tmp/",
            "XDG_CONFIG_HOME=/tmp/",
            "TMPDIR=/tmp/",
        ):
            self.assertIn(path, self.source)
        self.assertFalse(any(line.startswith("VOLUME ") for line in self.instructions))
        copy_lines = [line for line in self.instructions if line.startswith("COPY ")]
        self.assertFalse(any("/runpod-volume" in line for line in copy_lines))
        run_lines = "\n".join(line for line in self.instructions if line.startswith("RUN "))
        for forbidden in ("git clone", "hf_hub_download", "snapshot_download", "huggingface-cli"):
            self.assertNotIn(forbidden, run_lines)
        self.assertNotIn("SOULX_MODE=prepare", self.source)
        self.assertNotIn("COPY prepare_soulx_volume.py", self.source)
        for removed in ("soulx_prepare_service.py", "prepare_soulx_volume.py"):
            self.assertIn(f"test ! -e /opt/videoforge/{removed}", self.source)

    def test_direct_serverless_dependencies_are_exactly_pinned(self) -> None:
        self.assertEqual(
            REQUIREMENTS.read_text(encoding="utf-8").splitlines(),
            ["jsonschema==4.25.1", "runpod==1.7.0"],
        )
        self.assertIn(
            "COPY workers/avatar-primary/requirements.serverless.txt ./requirements.serverless.txt",
            self.source,
        )
        self.assertIn(
            "pip install --no-cache-dir --requirement requirements.serverless.txt", self.source
        )
        self.assertIn("python -m pip check", self.source)

    def test_build_hashes_match_exact_copied_sources(self) -> None:
        expected_paths = {
            "/opt/videoforge/soulx_serverless.py": AVATAR_ROOT / "soulx_serverless.py",
            "/opt/videoforge/soulx-serverless-entrypoint.py": (
                AVATAR_ROOT / "soulx-serverless-entrypoint.py"
            ),
            "/opt/videoforge/common/secure_scratch.py": (
                REPO_ROOT / "workers/common/secure_scratch.py"
            ),
            "/opt/videoforge/common/serverless_envelope.py": (
                REPO_ROOT / "workers/common/serverless_envelope.py"
            ),
            "/opt/videoforge/src/videoforge_contracts/_schema_documents.py": (
                REPO_ROOT
                / "packages/contracts/python/videoforge_contracts/_schema_documents.py"
            ),
        }
        declared = dict(
            (path, digest)
            for digest, path in re.findall(r"\b([0-9a-f]{64}) (/opt/videoforge/\S+)", self.source)
        )
        self.assertEqual(set(declared), set(expected_paths))
        for image_path, local_path in expected_paths.items():
            digest = hashlib.sha256(local_path.read_bytes()).hexdigest()
            self.assertEqual(declared[image_path], digest, image_path)
        self.assertIn("sha256sum --check --strict", self.source)


class ReadOnlyModelMountTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        spec = importlib.util.spec_from_file_location(
            "soulx_serverless_entrypoint", AVATAR_ROOT / "soulx-serverless-entrypoint.py"
        )
        if spec is None or spec.loader is None:
            raise RuntimeError("could not load SoulX Serverless entrypoint")
        cls.entrypoint = importlib.util.module_from_spec(spec)
        handler_module = types.SimpleNamespace(handler=object())
        with mock.patch.dict(sys.modules, {"soulx_serverless": handler_module}):
            spec.loader.exec_module(cls.entrypoint)

    def _mountinfo(self, contents: str) -> Path:
        temporary = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", delete=False)
        self.addCleanup(lambda: Path(temporary.name).unlink(missing_ok=True))
        with temporary:
            temporary.write(contents)
        return Path(temporary.name)

    def test_accepts_exact_read_only_mount(self) -> None:
        mountinfo = self._mountinfo(
            "40 30 0:55 / /runpod-volume ro,nosuid,nodev - ext4 /dev/sdb ro\n"
        )
        with mock.patch.dict(
            os.environ, {"SOULX_MODEL_ROOT": "/runpod-volume/soulx-flashhead-pro"}
        ):
            self.entrypoint.require_read_only_model_mount(mountinfo)

    def test_rejects_missing_or_writable_mount(self) -> None:
        for contents, code in (
            ("40 30 0:55 / /other ro - ext4 /dev/sdb ro\n", "SOULX_MODEL_VOLUME_MOUNT_MISSING"),
            (
                "40 30 0:55 / /runpod-volume rw,nosuid - ext4 /dev/sdb rw\n",
                "SOULX_MODEL_VOLUME_NOT_READ_ONLY",
            ),
        ):
            with self.subTest(code=code), mock.patch.dict(
                os.environ, {"SOULX_MODEL_ROOT": "/runpod-volume/soulx-flashhead-pro"}
            ):
                with self.assertRaisesRegex(RuntimeError, code):
                    self.entrypoint.require_read_only_model_mount(self._mountinfo(contents))

    def test_rejects_model_root_drift(self) -> None:
        mountinfo = self._mountinfo(
            "40 30 0:55 / /runpod-volume ro,nosuid,nodev - ext4 /dev/sdb ro\n"
        )
        with mock.patch.dict(os.environ, {"SOULX_MODEL_ROOT": "/tmp/model"}):
            with self.assertRaisesRegex(RuntimeError, "SOULX_MODEL_ROOT_INVALID"):
                self.entrypoint.require_read_only_model_mount(mountinfo)


if __name__ == "__main__":
    unittest.main()

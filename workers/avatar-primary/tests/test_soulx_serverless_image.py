from __future__ import annotations

import hashlib
import importlib.util
import os
import re
import subprocess
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
            'org.opencontainers.image.revision="${VIDEOFORGE_SOURCE_COMMIT}"',
            'ai.videoforge.lane="soulx_avatar"',
            'ai.videoforge.source-commit="${VIDEOFORGE_SOURCE_COMMIT}"',
            'ai.videoforge.runtime-profile="videoforge_soulx_flashhead_pro_bf16_v1"',
            f'ai.videoforge.source-revision="{SOURCE_REVISION}"',
            f'ai.videoforge.model-revision="{MODEL_REVISION}"',
            f'ai.videoforge.model-manifest="{MODEL_MANIFEST}"',
        ):
            self.assertIn(value, self.source)
        self.assertIn("ARG VIDEOFORGE_SOURCE_COMMIT", self.source)

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

    def test_preserves_decord_and_allows_only_its_exact_platform_diagnostic(self) -> None:
        self.assertNotIn("pip uninstall", self.source)
        self.assertIn('pip_check_output="$(mktemp)"', self.source)
        self.assertIn('python -m pip check >"$pip_check_output" 2>&1', self.source)
        self.assertIn(
            "printf '%s\\n' 'decord 0.6.0 is not supported on this platform'", self.source
        )
        self.assertIn(
            'cmp -s - "$pip_check_output"',
            self.source,
        )
        self.assertIn('import decord; assert metadata.version("decord") == "0.6.0"', self.source)
        self.assertNotIn("decord", REQUIREMENTS.read_text(encoding="utf-8"))

    def test_decord_platform_diagnostic_exception_is_byte_exact(self) -> None:
        expected = b"decord 0.6.0 is not supported on this platform\n"
        for candidate, accepted in (
            (expected, True),
            (expected + b"\n", False),
            (expected + b"another conflict\n", False),
        ):
            with self.subTest(candidate=candidate):
                with tempfile.NamedTemporaryFile() as expected_file:
                    expected_file.write(expected)
                    expected_file.flush()
                    compared = subprocess.run(
                        ["cmp", "-s", expected_file.name, "-"],
                        input=candidate,
                        check=False,
                    )
                self.assertEqual(compared.returncode == 0, accepted)

    def test_build_hashes_match_exact_copied_sources(self) -> None:
        expected_paths = {
            "/opt/videoforge/soulx_serverless.py": AVATAR_ROOT / "soulx_serverless.py",
            "/opt/videoforge/soulx_runtime.py": AVATAR_ROOT / "soulx_runtime.py",
            "/opt/videoforge/soulx_volume.py": AVATAR_ROOT / "soulx_volume.py",
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
                REPO_ROOT / "packages/contracts/python/videoforge_contracts/_schema_documents.py"
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


class ApplicationReadOnlyModelMountTests(unittest.TestCase):
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

    def _environment(self) -> dict[str, str]:
        return {
            "SOULX_MODEL_ROOT": "/runpod-volume/soulx-flashhead-pro",
            "VIDEOFORGE_JOB_SCRATCH_ROOT": "/tmp/videoforge-soulx-jobs",
            "HF_HOME": "/tmp/videoforge-soulx-cache/huggingface",
            "TRANSFORMERS_CACHE": "/tmp/videoforge-soulx-cache/transformers",
            "DIFFUSERS_CACHE": "/tmp/videoforge-soulx-cache/diffusers",
            "XDG_CACHE_HOME": "/tmp/videoforge-soulx-cache",
            "XDG_CONFIG_HOME": "/tmp/videoforge-soulx-config",
            "TMPDIR": "/tmp/videoforge-soulx-tmp",
        }

    def test_accepts_exact_mount_without_requiring_kernel_read_only(self) -> None:
        for mount_options in ("ro,nosuid,nodev", "rw,nosuid,nodev"):
            with self.subTest(mount_options=mount_options):
                mountinfo = self._mountinfo(
                    f"40 30 0:55 / /runpod-volume {mount_options} - ext4 /dev/sdb {mount_options}\n"
                )
                with mock.patch.dict(os.environ, self._environment(), clear=True):
                    self.entrypoint.require_application_read_only_model_mount(mountinfo)

    def test_rejects_missing_exact_mount(self) -> None:
        mountinfo = self._mountinfo("40 30 0:55 / /other rw - ext4 /dev/sdb rw\n")
        with mock.patch.dict(os.environ, self._environment(), clear=True):
            with self.assertRaisesRegex(RuntimeError, "SOULX_MODEL_VOLUME_MOUNT_MISSING"):
                self.entrypoint.require_application_read_only_model_mount(mountinfo)

    def test_rejects_model_root_drift(self) -> None:
        mountinfo = self._mountinfo(
            "40 30 0:55 / /runpod-volume ro,nosuid,nodev - ext4 /dev/sdb ro\n"
        )
        environment = self._environment()
        environment["SOULX_MODEL_ROOT"] = "/tmp/model"
        with mock.patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(RuntimeError, "SOULX_MODEL_ROOT_INVALID"):
                self.entrypoint.require_application_read_only_model_mount(mountinfo)

    def test_rejects_every_writable_root_on_or_below_model_volume(self) -> None:
        mountinfo = self._mountinfo(
            "40 30 0:55 / /runpod-volume rw,nosuid,nodev - ext4 /dev/sdb rw\n"
        )
        for environment in self.entrypoint._WRITABLE_ROOT_ENVIRONMENTS:
            with self.subTest(environment=environment):
                values = self._environment()
                values[environment] = f"/runpod-volume/writable/{environment.lower()}"
                with mock.patch.dict(os.environ, values, clear=True):
                    with self.assertRaisesRegex(
                        RuntimeError, f"SOULX_WRITABLE_ROOT_INVALID:{environment}"
                    ):
                        self.entrypoint.require_application_read_only_model_mount(mountinfo)

    def test_rejects_missing_relative_or_symlinked_writable_root(self) -> None:
        mountinfo = self._mountinfo(
            "40 30 0:55 / /runpod-volume rw,nosuid,nodev - ext4 /dev/sdb rw\n"
        )
        for value in ("", "relative/cache"):
            with self.subTest(value=value):
                values = self._environment()
                values["HF_HOME"] = value
                with mock.patch.dict(os.environ, values, clear=True):
                    with self.assertRaisesRegex(
                        RuntimeError, "SOULX_WRITABLE_ROOT_INVALID:HF_HOME"
                    ):
                        self.entrypoint.require_application_read_only_model_mount(mountinfo)

        with tempfile.TemporaryDirectory() as temporary:
            outside = Path(temporary)
            model_mount = outside / "model-mount"
            model_mount.mkdir()
            (model_mount / "cache").mkdir()
            cache_link = outside / "cache-link"
            cache_link.symlink_to(model_mount / "cache", target_is_directory=True)
            with mock.patch.object(self.entrypoint, "_MODEL_MOUNT", model_mount):
                values = self._environment()
                values["SOULX_MODEL_ROOT"] = str(model_mount / "soulx-flashhead-pro")
                values["HF_HOME"] = str(cache_link)
                with (
                    mock.patch.object(
                        self.entrypoint, "_MODEL_ROOT", model_mount / "soulx-flashhead-pro"
                    ),
                    mock.patch.dict(os.environ, values, clear=True),
                ):
                    with self.assertRaisesRegex(
                        RuntimeError, "SOULX_WRITABLE_ROOT_INVALID:HF_HOME"
                    ):
                        self.entrypoint.require_application_read_only_model_mount(mountinfo)


if __name__ == "__main__":
    unittest.main()

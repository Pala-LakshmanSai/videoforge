from __future__ import annotations

import hashlib
import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = REPO_ROOT / ".github/workflows/avatar-primary-serverless-image.yml"
DOCKERFILE = REPO_ROOT / "workers/avatar-primary/Dockerfile.serverless"
REQUIREMENTS = REPO_ROOT / "workers/avatar-primary/requirements.serverless.txt"
REGISTRY_REPOSITORY = "pala-lakshmansai/videoforge-soulx-serverless-v2-08"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class SoulXServerlessPublicationWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = WORKFLOW.read_text(encoding="utf-8")
        cls.dockerfile = DOCKERFILE.read_text(encoding="utf-8")

    def test_is_manual_only_with_fail_closed_inputs(self) -> None:
        self.assertIn("  workflow_dispatch:\n", self.source)
        for automatic_trigger in (
            "  push:",
            "  pull_request:",
            "  schedule:",
            "  repository_dispatch:",
        ):
            self.assertNotIn(automatic_trigger, self.source)
        self.assertRegex(
            self.source,
            r"(?s)publish:\n.*?type: boolean\n\s+default: false",
        )
        self.assertRegex(
            self.source,
            rf"(?s)registry_repository:\n.*?type: choice\n.*?options:\n\s+- {re.escape(REGISTRY_REPOSITORY)}",
        )
        self.assertIn('${{ inputs.registry_repository }}', self.source)
        self.assertIn(f'"{REGISTRY_REPOSITORY}"', self.source)

    def test_binds_exact_dockerfile_requirements_and_copied_source_hashes(self) -> None:
        declared_dockerfile_hash = re.search(
            r'Dockerfile\.serverless \| awk .*?\)" = \\\n+\s+"([0-9a-f]{64})"',
            self.source,
        )
        declared_requirements_hash = re.search(
            r'requirements\.serverless\.txt \| awk .*?\)" = \\\n+\s+"([0-9a-f]{64})"',
            self.source,
        )
        self.assertIsNotNone(declared_dockerfile_hash)
        self.assertIsNotNone(declared_requirements_hash)
        assert declared_dockerfile_hash is not None
        assert declared_requirements_hash is not None
        self.assertEqual(declared_dockerfile_hash.group(1), _sha256(DOCKERFILE))
        self.assertEqual(declared_requirements_hash.group(1), _sha256(REQUIREMENTS))

        declarations = re.findall(
            r'"([^"|]+)\|([0-9a-f]{64})\|(/opt/videoforge/[^"|]+)"', self.source
        )
        self.assertEqual(len(declarations), 5)
        for source_path, expected_hash, image_path in declarations:
            self.assertEqual(expected_hash, _sha256(REPO_ROOT / source_path), source_path)
            self.assertIn(f"{expected_hash} {image_path}", self.dockerfile)
        self.assertIn('grep -F "${expected_hash} ${image_path}"', self.source)

        dependency_declarations = re.findall(
            r'"(packages/contracts/python/videoforge_contracts/[^"|]+)\|([0-9a-f]{64})"',
            self.source,
        )
        self.assertEqual(len(dependency_declarations), 3)
        for source_path, expected_hash in dependency_declarations:
            self.assertEqual(expected_hash, _sha256(REPO_ROOT / source_path), source_path)

    def test_build_uses_exact_image_definition_without_model_preparation(self) -> None:
        self.assertIn("--platform linux/amd64", self.source)
        self.assertIn(
            '--file "$build_context/workers/avatar-primary/Dockerfile.serverless"', self.source
        )
        self.assertIn('build_context="$RUNNER_TEMP/v208-soulx-serverless-context"', self.source)
        for contract_source in (
            "__init__.py",
            "_schema_documents.py",
            "models.py",
            "validator.py",
        ):
            self.assertIn(
                f"packages/contracts/python/videoforge_contracts/{contract_source}", self.source
            )
        self.assertIn('"$build_context"', self.source)
        self.assertIn("test ! -e /runpod-volume/soulx-flashhead-pro", self.source)
        for forbidden in (
            "prepare_soulx_volume.py",
            "soulx_prepare_service.py",
            "SOULX_MODE=prepare",
            "huggingface-cli",
            "hf_hub_download",
            "snapshot_download",
            "git clone",
            "curl ",
        ):
            self.assertNotIn(forbidden, self.source)

    def test_publication_is_allowlisted_and_returns_an_immutable_digest(self) -> None:
        self.assertIn(f'test "$repository" = "{REGISTRY_REPOSITORY}"', self.source)
        self.assertIn(f'tagged_image="ghcr.io/${{repository}}:${{GITHUB_SHA}}"', self.source)
        self.assertIn('image_digest="${immutable_image##*@}"', self.source)
        self.assertIn("immutable_image: ${{ steps.record.outputs.immutable_image }}", self.source)
        self.assertIn("image_digest: ${{ steps.record.outputs.image_digest }}", self.source)
        self.assertIn(
            r"^ghcr\.io/pala-lakshmansai/videoforge-soulx-serverless-v2-08@sha256:[a-f0-9]{64}$",
            self.source,
        )
        self.assertNotIn('ghcr.io/${owner}', self.source)

    def test_credentials_are_not_printed_or_retained(self) -> None:
        self.assertIn("GHCR_TOKEN: ${{ secrets.GITHUB_TOKEN }}", self.source)
        self.assertIn("docker login ghcr.io", self.source)
        self.assertIn("docker logout ghcr.io", self.source)
        self.assertNotIn('echo "$GHCR_TOKEN"', self.source)
        self.assertNotIn("set -x", self.source)
        self.assertNotRegex(self.source, r"GITHUB_(?:STEP_SUMMARY|OUTPUT).*GHCR_TOKEN")

    def test_record_is_artifact_backed_and_disclaims_provider_mutation(self) -> None:
        for field in (
            '"schema_version": "videoforge-image-deployability/v1"',
            '"immutable_image":',
            '"image_digest":',
            '"dockerfile_sha256":',
            '"requirements_sha256":',
            '"source_sha256":',
            '"model_download_performed": False',
            '"provider_endpoint_mutation_performed": False',
        ):
            self.assertIn(field, self.source)
        self.assertIn("deployability_record_sha256", self.source)
        self.assertIn("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02", self.source)
        self.assertIn("release-evidence/soulx-serverless-v2-08.json", self.source)
        for provider_mutator in ("api.runpod.io", "runpodctl", "endpoint/update", "endpoint/create"):
            self.assertNotIn(provider_mutator, self.source.lower())


if __name__ == "__main__":
    unittest.main()

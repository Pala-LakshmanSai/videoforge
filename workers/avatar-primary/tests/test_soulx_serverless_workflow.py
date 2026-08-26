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
        self.assertIn("${{ inputs.registry_repository }}", self.source)
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
        build_source = self.source.split(
            "- name: Build exact linux-amd64 candidate without a model volume", 1
        )[1].split("- name: Authenticate and reject any unbound same-commit tag", 1)[0]
        self.assertIn("--platform linux/amd64", self.source)
        self.assertIn(
            '--file "$build_context/workers/avatar-primary/Dockerfile.serverless"', self.source
        )
        self.assertIn('build_context="$RUNNER_TEMP/v208-soulx-serverless-context"', self.source)
        self.assertIn('--build-arg "VIDEOFORGE_SOURCE_COMMIT=$GITHUB_SHA"', self.source)
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
            self.assertNotIn(forbidden, build_source)

    def test_publication_is_allowlisted_and_returns_an_immutable_digest(self) -> None:
        self.assertIn(f'test "$repository" = "{REGISTRY_REPOSITORY}"', self.source)
        self.assertIn('tagged_image="ghcr.io/${repository}:${GITHUB_SHA}"', self.source)
        self.assertIn('image_digest="sha256:$(sha256sum "$remote_manifest"', self.source)
        self.assertIn('test "$image_digest" = "$push_digest"', self.source)
        self.assertIn('test "$header_digest" = "$push_digest"', self.source)
        self.assertIn(
            'test "$(jq -r \'.config.digest\' "$remote_manifest")" = "$SOULX_LOCAL_IMAGE_ID"',
            self.source,
        )
        self.assertIn("immutable_image: ${{ steps.record.outputs.immutable_image }}", self.source)
        self.assertIn("image_digest: ${{ steps.record.outputs.image_digest }}", self.source)
        self.assertIn(
            r"^ghcr\.io/pala-lakshmansai/videoforge-soulx-serverless-v2-08@sha256:[a-f0-9]{64}$",
            self.source,
        )
        self.assertNotIn("ghcr.io/${owner}", self.source)

    def test_new_publication_pulls_exact_remote_digest_and_rechecks_source_bytes(self) -> None:
        publish = self.source.split("- name: Publish only to the exact allowlisted repository", 1)[
            1
        ].split("- name: Remove registry credentials", 1)[0]
        self.assertIn('docker pull "$immutable_image"', publish)
        self.assertIn('ai.videoforge.source-commit\\"}}', publish)
        self.assertIn('= "$GITHUB_SHA"', publish)
        for expected_hash in (
            "a99c18e24cdc804cde09bf8f105ce8dd7d9f3c66e143adaf04f5c71e406878f5",
            "bde3ec146ffe31e891fdbe6bf9d21de065646c20f0ef2e0885e753d2850a0bb9",
            "7dafb7f17682f0c15158c39bd644f2aff16dcf614bb9ecb2ed747379eaebd775",
            "34949be02521ec896c27794ad382cfa4d2bd6f1b799615716a5dc2b9ce2e41d0",
            "6b20bfeac282bd8fd43291abb18cfe2cf7c46a352a58da006f57738307c9b7d6",
        ):
            self.assertIn(expected_hash, publish)
        self.assertIn("sha256sum --check --strict", publish)

    def test_same_commit_tag_is_idempotent_only_for_exact_post_run_digest(self) -> None:
        self.assertRegex(
            self.source,
            r'(?s)expected_existing_digest:.*?required: false.*?default: ""',
        )
        self.assertIn('test "$existing_digest" = "$expected_existing_digest"', self.source)
        self.assertIn('test "$header_digest" = "$expected_existing_digest"', self.source)
        self.assertIn("SOULX_PUBLICATION_STATE=EXACT_EXISTING_DIGEST_REUSED", self.source)
        self.assertIn("env.SOULX_EXISTING_EXACT != 'true'", self.source)
        reuse = self.source.split('if [[ "$status" = "200" ]]', 1)[1].split(
            'else\n            test "$status" = "404"', 1
        )[0]
        self.assertNotIn('= "$SOULX_LOCAL_IMAGE_ID"', reuse)
        self.assertIn("manifests/$expected_existing_digest", reuse)
        self.assertIn('cmp -s "$existing_manifest" "$digest_manifest"', reuse)
        self.assertIn("blobs/$existing_config_digest", reuse)
        self.assertIn('stat -c%s "$existing_config"', reuse)
        for label in (
            "ai.videoforge.source-commit",
            "org.opencontainers.image.revision",
            "org.opencontainers.image.base.name",
            "org.opencontainers.image.base.digest",
            "ai.videoforge.lane",
            "ai.videoforge.runtime-profile",
            "ai.videoforge.source-revision",
            "ai.videoforge.model-revision",
            "ai.videoforge.model-manifest",
        ):
            self.assertIn(label, reuse)
        self.assertIn("sha256sum --check --strict", reuse)

    def test_anonymous_pull_readback_covers_exact_manifest_and_every_blob(self) -> None:
        logout = self.source.index("docker logout ghcr.io")
        anonymous = self.source.index("Prove anonymous public pull visibility")
        self.assertLess(logout, anonymous)
        self.assertIn("anonymous_public_pull=passed", self.source)
        self.assertIn(".config.digest, .layers[].digest", self.source)
        self.assertIn('test "$public_digest" = "$SOULX_IMAGE_DIGEST"', self.source)
        self.assertIn("curl -sS -L -o /dev/null -w '%{http_code}' -I", self.source)

    def test_credentials_are_not_printed_or_retained(self) -> None:
        self.assertIn("GHCR_TOKEN: ${{ secrets.GITHUB_TOKEN }}", self.source)
        self.assertIn("docker login ghcr.io", self.source)
        self.assertIn("docker logout ghcr.io", self.source)
        self.assertNotIn('echo "$GHCR_TOKEN"', self.source)
        self.assertNotRegex(self.source, r"--user(?:=|\s)")
        self.assertNotRegex(self.source, r"curl[^\n]*\$GHCR_TOKEN")
        self.assertNotIn('-H "Authorization: Bearer $registry_token"', self.source)
        self.assertNotRegex(self.source, r"curl[^\n]*\$registry_token")
        self.assertEqual(self.source.count("printf 'header = \"Authorization: Bearer %s\"\\n'"), 4)
        self.assertEqual(self.source.count("curl --config -"), 6)
        self.assertEqual(
            self.source.count('printf \'user = "%s:%s"\\n\' "$GITHUB_ACTOR" "$GHCR_TOKEN"'),
            2,
        )
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
            '"qualification_status": "REQUIRES_FRESH_LIVE_REQUALIFICATION"',
            '"prior_qualification_reused": False',
            '"publication_state":',
        ):
            self.assertIn(field, self.source)
        self.assertIn("deployability_record_sha256", self.source)
        self.assertIn(
            "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02", self.source
        )
        self.assertIn("release-evidence/soulx-serverless-v2-08.json", self.source)
        for provider_mutator in (
            "api.runpod.io",
            "runpodctl",
            "endpoint/update",
            "endpoint/create",
        ):
            self.assertNotIn(provider_mutator, self.source.lower())

    def test_current_checkout_is_the_only_published_source_lineage(self) -> None:
        self.assertIn('test "$(git rev-parse HEAD)" = "$GITHUB_SHA"', self.source)
        self.assertIn('ai.videoforge.source-commit="${VIDEOFORGE_SOURCE_COMMIT}"', self.dockerfile)
        self.assertIn('ai.videoforge.source-commit\\"}}', self.source)


if __name__ == "__main__":
    unittest.main()

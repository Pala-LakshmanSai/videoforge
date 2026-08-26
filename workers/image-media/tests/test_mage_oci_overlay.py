import copy
import hashlib
import io
import json
import sys
import tarfile
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from build_mage_oci_overlay import (  # noqa: E402
    DOCKER_CONFIG_MEDIA_TYPE,
    DOCKER_LAYER_MEDIA_TYPE,
    DOCKER_MANIFEST_MEDIA_TYPE,
    OverlayError,
    _write_output,
    build_overlay,
)
from publish_mage_oci_overlay import (  # noqa: E402
    PublishError,
    RegistryClient,
    _validate_artifacts,
    main as publish_main,
)
from verify_mage_oci_overlay import CandidateError, verify_candidate  # noqa: E402


PARENT_REPOSITORY = "ghcr.io/example/videoforge-mage-v2-07"


def _fixture() -> tuple[dict, dict, bytes, bytes]:
    layer_bytes = b"parent-layer"
    layer_digest = "sha256:" + hashlib.sha256(layer_bytes).hexdigest()
    config = {
        "architecture": "amd64",
        "config": {
            "Entrypoint": ["python", "/opt/videoforge/mage-serverless-entrypoint.py"],
            "Env": [
                "HF_HUB_OFFLINE=1",
                "TRANSFORMERS_OFFLINE=1",
                "DIFFUSERS_OFFLINE=1",
                "MAGE_MODEL_ROOT=/runpod-volume",
            ],
            "Labels": {
                "ai.videoforge.source-commit": "0" * 40,
                "org.opencontainers.image.base.digest": "sha256:" + "0" * 64,
                "ai.videoforge.base-image": PARENT_REPOSITORY + "@sha256:" + "0" * 64,
                "ai.videoforge.overlay-parent": PARENT_REPOSITORY + "@sha256:" + "0" * 64,
            },
        },
        "history": [{"created_by": "parent"}],
        "os": "linux",
        "rootfs": {"type": "layers", "diff_ids": [layer_digest]},
    }
    config_bytes = json.dumps(config, separators=(",", ":"), sort_keys=True).encode() + b"\n"
    # The descriptor is intentionally for the exact bytes above.
    manifest = {
        "schemaVersion": 2,
        "mediaType": DOCKER_MANIFEST_MEDIA_TYPE,
        "config": {
            "mediaType": DOCKER_CONFIG_MEDIA_TYPE,
            "size": len(config_bytes),
            "digest": "sha256:" + hashlib.sha256(config_bytes).hexdigest(),
        },
        "layers": [
            {
                "mediaType": DOCKER_LAYER_MEDIA_TYPE,
                "size": len(layer_bytes),
                "digest": layer_digest,
            }
        ],
    }
    manifest_bytes = json.dumps(manifest, separators=(",", ":"), sort_keys=True).encode() + b"\n"
    return manifest, config, config_bytes, manifest_bytes


def _overlay_result() -> dict:
    manifest, config, config_bytes, manifest_bytes = _fixture()
    parent_image = PARENT_REPOSITORY + "@sha256:" + hashlib.sha256(manifest_bytes).hexdigest()
    return build_overlay(
        base_manifest=manifest,
        base_manifest_bytes=manifest_bytes,
        base_config=config,
        base_config_bytes=config_bytes,
        source_bytes=b"x = 1\n",
        source_commit="a" * 40,
        parent_image=parent_image,
        created="2026-08-20T09:39:31Z",
    )


class MageOciOverlayTest(unittest.TestCase):
    def test_identity_and_bytes_are_reproducible(self) -> None:
        manifest, config, config_bytes, manifest_bytes = _fixture()
        parent_image = PARENT_REPOSITORY + "@sha256:" + hashlib.sha256(manifest_bytes).hexdigest()
        kwargs = {
            "base_manifest": manifest,
            "base_manifest_bytes": manifest_bytes,
            "base_config": config,
            "base_config_bytes": config_bytes,
            "source_bytes": b"from repaired handler\n",
            "source_commit": "a" * 40,
            "parent_image": parent_image,
            "created": "2026-08-20T09:39:31Z",
        }
        first = build_overlay(**kwargs)
        second = build_overlay(**kwargs)
        for key in (
            "config_bytes",
            "manifest_bytes",
            "layer_tar_bytes",
            "layer_bytes",
        ):
            self.assertEqual(first[key], second[key])
        self.assertEqual(first["identity"], second["identity"])
        self.assertEqual(first["identity"]["source_commit"], "a" * 40)
        self.assertEqual(first["identity"]["parent_image"], parent_image)

    def test_layer_contains_only_the_repaired_handler_at_exact_path(self) -> None:
        manifest, config, config_bytes, manifest_bytes = _fixture()
        parent_image = PARENT_REPOSITORY + "@sha256:" + hashlib.sha256(manifest_bytes).hexdigest()
        result = build_overlay(
            base_manifest=manifest,
            base_manifest_bytes=manifest_bytes,
            base_config=config,
            base_config_bytes=config_bytes,
            source_bytes=b"new handler bytes",
            source_commit="b" * 40,
            parent_image=parent_image,
            created="2026-08-20T09:39:31Z",
        )
        with tarfile.open(fileobj=io.BytesIO(result["layer_tar_bytes"]), mode="r:") as archive:
            members = archive.getmembers()
            self.assertEqual(
                [member.name for member in members], ["opt/videoforge/mage_serverless.py"]
            )
            self.assertEqual(archive.extractfile(members[0]).read(), b"new handler bytes")
            self.assertEqual(members[0].uid, 0)
            self.assertEqual(members[0].gid, 0)
            self.assertEqual(members[0].mode, 0o644)
            self.assertEqual(members[0].mtime, 0)

    def test_multi_file_layer_is_sorted_and_binds_each_exact_runtime_source(self) -> None:
        manifest, config, config_bytes, manifest_bytes = _fixture()
        parent_image = PARENT_REPOSITORY + "@sha256:" + hashlib.sha256(manifest_bytes).hexdigest()
        source_files = (
            ("/opt/videoforge/src/videoforge_contracts/_schema_documents.py", b"SCHEMA = {}\n"),
            ("/opt/videoforge/mage_serverless.py", b"def handler():\n    return None\n"),
        )
        result = build_overlay(
            base_manifest=manifest,
            base_manifest_bytes=manifest_bytes,
            base_config=config,
            base_config_bytes=config_bytes,
            source_bytes=None,
            source_files=source_files,
            source_commit="a" * 40,
            parent_image=parent_image,
            created="2026-08-20T09:39:31Z",
        )
        self.assertEqual(
            [entry["destination"] for entry in result["identity"]["source_files"]],
            [destination for destination, _ in sorted(source_files)],
        )
        with tarfile.open(fileobj=io.BytesIO(result["layer_tar_bytes"]), mode="r:") as archive:
            self.assertEqual(
                [member.name for member in archive.getmembers()],
                [destination.lstrip("/") for destination, _ in sorted(source_files)],
            )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "overlay"
            output.mkdir()
            _write_output(result, output)
            parent_manifest = root / "parent-manifest.json"
            parent_manifest.write_bytes(manifest_bytes)
            parent_config = root / "parent-config.json"
            parent_config.write_bytes(config_bytes)
            handler = root / "mage_serverless.py"
            schema = root / "_schema_documents.py"
            verified = verify_candidate(
                output_dir=output,
                base_manifest_path=parent_manifest,
                base_config_path=parent_config,
                expected_manifest_digest=result["identity"]["manifest_digest"],
                expected_config_digest=result["identity"]["config_digest"],
                expected_layer_digest=result["identity"]["layer_digest"],
                expected_source_commit=result["identity"]["source_commit"],
                expected_source_sha256=None,
                expected_parent_image=parent_image,
                expected_source_files=tuple(
                    (entry["destination"], entry["source_sha256"])
                    for entry in result["identity"]["source_files"]
                ),
                extract_sources={
                    "/opt/videoforge/mage_serverless.py": handler,
                    "/opt/videoforge/src/videoforge_contracts/_schema_documents.py": schema,
                },
            )
            self.assertEqual(
                verified["sources_extracted"],
                sorted(
                    (
                        "/opt/videoforge/mage_serverless.py",
                        "/opt/videoforge/src/videoforge_contracts/_schema_documents.py",
                    )
                ),
            )
            self.assertEqual(handler.read_bytes(), source_files[1][1])
            self.assertEqual(schema.read_bytes(), source_files[0][1])

    def test_parent_config_and_manifest_are_digest_bound(self) -> None:
        manifest, config, config_bytes, manifest_bytes = _fixture()
        parent_image = PARENT_REPOSITORY + "@sha256:" + hashlib.sha256(manifest_bytes).hexdigest()
        wrong = copy.deepcopy(config)
        wrong["os"] = "windows"
        wrong_bytes = json.dumps(wrong, separators=(",", ":"), sort_keys=True).encode() + b"\n"
        with self.assertRaisesRegex(OverlayError, "base config digest mismatch"):
            build_overlay(
                base_manifest=manifest,
                base_manifest_bytes=manifest_bytes,
                base_config=wrong,
                base_config_bytes=wrong_bytes,
                source_bytes=b"handler",
                source_commit="c" * 40,
                parent_image=parent_image,
                created="2026-08-20T09:39:31Z",
            )

    def test_rejects_tampered_parent_manifest_bytes_and_preserves_descriptors(self) -> None:
        manifest, config, config_bytes, manifest_bytes = _fixture()
        parent_image = PARENT_REPOSITORY + "@sha256:" + hashlib.sha256(manifest_bytes).hexdigest()
        with self.assertRaisesRegex(OverlayError, "base manifest digest mismatch"):
            build_overlay(
                base_manifest=manifest,
                base_manifest_bytes=manifest_bytes + b" ",
                base_config=config,
                base_config_bytes=config_bytes,
                source_bytes=b"handler",
                source_commit="f" * 40,
                parent_image=parent_image,
                created="2026-08-20T09:39:31Z",
            )
        result = build_overlay(
            base_manifest=manifest,
            base_manifest_bytes=manifest_bytes,
            base_config=config,
            base_config_bytes=config_bytes,
            source_bytes=b"handler",
            source_commit="f" * 40,
            parent_image=parent_image,
            created="2026-08-20T09:39:31Z",
        )
        self.assertEqual(result["manifest"]["layers"][0], manifest["layers"][0])
        self.assertEqual(len(result["manifest"]["layers"]), len(manifest["layers"]) + 1)

    def test_rejects_manifest_config_layer_count_mismatch(self) -> None:
        manifest, config, config_bytes, manifest_bytes = _fixture()
        extra_manifest = copy.deepcopy(manifest)
        extra_manifest["layers"].append(copy.deepcopy(extra_manifest["layers"][0]))
        extra_manifest_bytes = (
            json.dumps(extra_manifest, separators=(",", ":"), sort_keys=True).encode() + b"\n"
        )
        parent_image = (
            PARENT_REPOSITORY + "@sha256:" + hashlib.sha256(extra_manifest_bytes).hexdigest()
        )
        with self.assertRaisesRegex(OverlayError, "layer count mismatch"):
            build_overlay(
                base_manifest=extra_manifest,
                base_manifest_bytes=extra_manifest_bytes,
                base_config=config,
                base_config_bytes=config_bytes,
                source_bytes=b"handler",
                source_commit="f" * 40,
                parent_image=parent_image,
                created="2026-08-20T09:39:31Z",
            )

    def test_rejects_non_immutable_parent_or_non_linux_architecture(self) -> None:
        manifest, config, config_bytes, manifest_bytes = _fixture()
        parent_image = PARENT_REPOSITORY + "@sha256:" + hashlib.sha256(manifest_bytes).hexdigest()
        with self.assertRaisesRegex(OverlayError, "immutable"):
            build_overlay(
                base_manifest=manifest,
                base_manifest_bytes=manifest_bytes,
                base_config=config,
                base_config_bytes=config_bytes,
                source_bytes=b"handler",
                source_commit="d" * 40,
                parent_image="ghcr.io/example/videoforge-mage-v2-07:latest",
                created="2026-08-20T09:39:31Z",
            )
        bad_manifest = copy.deepcopy(manifest)
        bad_manifest["mediaType"] = "application/vnd.oci.image.manifest.v1+json"
        with self.assertRaisesRegex(OverlayError, "Docker schema-2"):
            build_overlay(
                base_manifest=bad_manifest,
                base_manifest_bytes=manifest_bytes,
                base_config=config,
                base_config_bytes=config_bytes,
                source_bytes=b"handler",
                source_commit="e" * 40,
                parent_image=parent_image,
                created="2026-08-20T09:39:31Z",
            )

    def test_publisher_rejects_any_artifact_byte_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            _write_output(_overlay_result(), output)
            (output / "layer.tar.gz").write_bytes(
                (output / "layer.tar.gz").read_bytes() + b"tampered"
            )
            with self.assertRaisesRegex(PublishError, "layer bytes do not match"):
                _validate_artifacts(output)

    def test_publisher_sends_exact_blobs_and_manifest_then_verifies_readback(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            _write_output(_overlay_result(), output)
            artifacts = _validate_artifacts(output)

            class ExactRegistry(RegistryClient):
                def __init__(self) -> None:
                    super().__init__(
                        host="ghcr.io", repository="example/repository", token="hidden"
                    )
                    self.uploaded: dict[str, bytes] = {}

                def _request(self, method, path, *, body=b"", content_type=None, accept=None):
                    if method == "HEAD" and path.startswith("manifests/"):
                        raise PublishError("registry HEAD request failed with HTTP 404")
                    if method == "HEAD" and path.startswith("blobs/"):
                        raise PublishError("registry HEAD request failed with HTTP 404")
                    if method == "POST" and path == "blobs/uploads/":
                        # Distribution permits a relative Location.  Resolve
                        # it against the upload-start URL, preserving the
                        # registry state query while adding the digest.
                        return 202, {"Location": "session?_state=opaque"}, b""
                    if method == "PUT" and path.startswith("manifests/"):
                        self.assert_exact(body, artifacts["manifest_bytes"])
                        return 201, {"Docker-Content-Digest": artifacts["manifest_digest"]}, b""
                    if method == "GET" and path.startswith("manifests/"):
                        return (
                            200,
                            {"Docker-Content-Digest": artifacts["manifest_digest"]},
                            artifacts["manifest_bytes"],
                        )
                    raise AssertionError((method, path, content_type, accept))

                def _request_url(self, method, url, *, body=b"", content_type=None, accept=None):
                    parsed = urllib.parse.urlparse(url)
                    self_outer.assertEqual(
                        parsed.path,
                        "/v2/example/repository/blobs/uploads/session",
                    )
                    query = urllib.parse.parse_qs(parsed.query)
                    digest = query["digest"][0]
                    self_outer.assertEqual(
                        parsed.query,
                        "_state=opaque&digest=sha256:" + digest.split(":", 1)[1],
                    )
                    self_outer.assertEqual(query["_state"], ["opaque"])
                    self_outer.assertEqual(content_type, "application/octet-stream")
                    self.uploaded[digest] = body
                    return 201, {"Docker-Content-Digest": digest}, b""

                def assert_exact(self, actual: bytes, expected: bytes) -> None:
                    self_outer.assertEqual(actual, expected)

            self_outer = self
            registry = ExactRegistry()
            published = registry.publish(tag="candidate", artifacts=artifacts)
            self.assertEqual(published["manifest_digest"], artifacts["manifest_digest"])
            self.assertEqual(published["publication_state"], "PUBLISHED_NEW_DIGEST")
            self.assertEqual(
                registry.uploaded,
                {
                    artifacts["config_digest"]: artifacts["config_bytes"],
                    artifacts["layer_digest"]: artifacts["layer_bytes"],
                },
            )

    def test_publisher_reuses_only_the_exact_existing_manifest_digest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            _write_output(_overlay_result(), output)
            artifacts = _validate_artifacts(output)

            class ExistingRegistry(RegistryClient):
                def __init__(self, body: bytes) -> None:
                    super().__init__(
                        host="ghcr.io", repository="example/repository", token="hidden"
                    )
                    self.body = body

                def _request(self, method, path, *, body=b"", content_type=None, accept=None):
                    if method == "HEAD" and path == "manifests/candidate":
                        return 200, {}, b""
                    if method == "GET" and path == "manifests/candidate":
                        digest = "sha256:" + hashlib.sha256(self.body).hexdigest()
                        return 200, {"Docker-Content-Digest": digest}, self.body
                    raise AssertionError((method, path, content_type, accept))

            existing = ExistingRegistry(artifacts["manifest_bytes"])
            published = existing.publish(tag="candidate", artifacts=artifacts)
            self.assertEqual(published["publication_state"], "EXACT_EXISTING_DIGEST_REUSED")
            with self.assertRaisesRegex(PublishError, "different existing image tag"):
                ExistingRegistry(artifacts["manifest_bytes"] + b"drift").publish(
                    tag="candidate", artifacts=artifacts
                )

    def test_publisher_rejects_non_allowlisted_registry_before_credentials_or_artifacts(
        self,
    ) -> None:
        base = [
            "--output-dir",
            "/does/not/matter",
            "--repository",
            "pala-lakshmansai/videoforge-mage-v2-07",
            "--tag",
            "v2-07-lineage-0123456789ab",
            "--publish",
        ]
        mutations = (
            [*base, "--registry-host", "attacker.example"],
            [
                *base[:3],
                "attacker/repository",
                *base[4:],
            ],
            [*base, "--token-env", "UNRELATED_SECRET"],
            [*base, "--actor-env", "UNRELATED_ACTOR"],
        )
        for argv in mutations:
            with (
                self.subTest(argv=argv),
                patch("publish_mage_oci_overlay._validate_artifacts") as validate,
                patch("publish_mage_oci_overlay._registry_token") as token,
            ):
                with self.assertRaisesRegex(PublishError, "not allowlisted"):
                    publish_main(argv)
                validate.assert_not_called()
                token.assert_not_called()

    def test_blob_completion_request_sets_exact_http_headers(self) -> None:
        class Response:
            status = 201
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b""

        registry = RegistryClient(host="ghcr.io", repository="example/repository", token="hidden")
        with patch(
            "publish_mage_oci_overlay.urllib.request.urlopen", return_value=Response()
        ) as urlopen:
            registry._request_url(
                "PUT",
                "https://ghcr.io/v2/example/repository/blobs/uploads/session?digest=sha256%3A"
                + "a" * 64,
                body=b"abc",
                content_type="application/octet-stream",
            )
        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_method(), "PUT")
        self.assertEqual(request.headers["Authorization"], "Bearer hidden")
        self.assertEqual(request.headers["Content-length"], "3")
        self.assertEqual(request.headers["Content-type"], "application/octet-stream")

    def test_candidate_verifier_extracts_and_binds_exact_runtime_payload(self) -> None:
        _, _, config_bytes, manifest_bytes = _fixture()
        result = _overlay_result()
        parent_image = result["identity"]["parent_image"]
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "overlay"
            output.mkdir()
            _write_output(result, output)
            parent_manifest = Path(temporary) / "parent-manifest.json"
            parent_config = Path(temporary) / "parent-config.json"
            parent_manifest.write_bytes(manifest_bytes)
            parent_config.write_bytes(config_bytes)
            extracted = Path(temporary) / "candidate-mage_serverless.py"
            verified = verify_candidate(
                output_dir=output,
                base_manifest_path=parent_manifest,
                base_config_path=parent_config,
                expected_manifest_digest=result["identity"]["manifest_digest"],
                expected_config_digest=result["identity"]["config_digest"],
                expected_layer_digest=result["identity"]["layer_digest"],
                expected_source_commit=result["identity"]["source_commit"],
                expected_source_sha256=result["identity"]["source_sha256"],
                expected_parent_image=parent_image,
                extract_source=extracted,
            )
            self.assertEqual(verified["manifest_digest"], result["identity"]["manifest_digest"])
            self.assertEqual(extracted.read_bytes(), b"x = 1\n")
            self.assertTrue(verified["handler_extracted"])

    def test_candidate_verifier_rejects_parent_descriptor_drift(self) -> None:
        manifest, config, config_bytes, manifest_bytes = _fixture()
        result = _overlay_result()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "overlay"
            output.mkdir()
            _write_output(result, output)
            parent_manifest = copy.deepcopy(manifest)
            parent_manifest["layers"][0]["size"] += 1
            parent_manifest_path = root / "parent-manifest.json"
            parent_manifest_path.write_text(
                json.dumps(parent_manifest, separators=(",", ":"), sort_keys=True) + "\n",
                encoding="utf-8",
            )
            parent_config_path = root / "parent-config.json"
            parent_config_path.write_bytes(config_bytes)
            with self.assertRaisesRegex(CandidateError, "parent manifest bytes"):
                verify_candidate(
                    output_dir=output,
                    base_manifest_path=parent_manifest_path,
                    base_config_path=parent_config_path,
                    expected_manifest_digest=result["identity"]["manifest_digest"],
                    expected_config_digest=result["identity"]["config_digest"],
                    expected_layer_digest=result["identity"]["layer_digest"],
                    expected_source_commit=result["identity"]["source_commit"],
                    expected_source_sha256=result["identity"]["source_sha256"],
                    expected_parent_image=result["identity"]["parent_image"],
                )


if __name__ == "__main__":
    unittest.main()

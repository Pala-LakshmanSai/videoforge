import copy
import hashlib
import io
import json
import sys
import tarfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from build_mage_oci_overlay import (  # noqa: E402
    DOCKER_CONFIG_MEDIA_TYPE,
    DOCKER_LAYER_MEDIA_TYPE,
    DOCKER_MANIFEST_MEDIA_TYPE,
    OverlayError,
    build_overlay,
)


PARENT_REPOSITORY = "ghcr.io/example/videoforge-mage-v2-07"


def _fixture() -> tuple[dict, dict, bytes, bytes]:
    layer_bytes = b"parent-layer"
    layer_digest = "sha256:" + hashlib.sha256(layer_bytes).hexdigest()
    config = {
        "architecture": "amd64",
        "config": {
            "Entrypoint": ["python", "/opt/videoforge/mage-serverless-entrypoint.py"],
            "Labels": {"ai.videoforge.source-commit": "0" * 40},
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
            self.assertEqual([member.name for member in members], ["opt/videoforge/mage_serverless.py"])
            self.assertEqual(archive.extractfile(members[0]).read(), b"new handler bytes")
            self.assertEqual(members[0].uid, 0)
            self.assertEqual(members[0].gid, 0)
            self.assertEqual(members[0].mode, 0o644)
            self.assertEqual(members[0].mtime, 0)

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
        extra_manifest_bytes = json.dumps(
            extra_manifest, separators=(",", ":"), sort_keys=True
        ).encode() + b"\n"
        parent_image = PARENT_REPOSITORY + "@sha256:" + hashlib.sha256(extra_manifest_bytes).hexdigest()
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


if __name__ == "__main__":
    unittest.main()

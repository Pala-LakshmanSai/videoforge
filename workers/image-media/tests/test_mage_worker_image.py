import ast
import hashlib
import json
import os
import re
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
REPAIR_DOCKERFILE = ROOT / "Dockerfile.mage.repair"
REPAIRED_SOURCE_COMMIT = "431198333a22d66ad1929244bf92662c53be5a6b"
PRIOR_IMMUTABLE_IMAGE = (
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@"
    "sha256:ab5043715f422c20ad1190f063c4f9e66f0d73907738c1ff185ab4d37a57af4e"
)
sys.path[:0] = [str(ROOT), str(ROOT / "src")]

import mage_volume as volume  # noqa: E402
import mage_prepare_service as prepare_service  # noqa: E402
from mage_bootstrap import bootstrap  # noqa: E402
from mage_runtime import MageRuntime  # noqa: E402
from prepare_mage_volume import CONFIRMATION, prepare  # noqa: E402


def make_volume(root: Path, *, lane: str = volume.MAGE_LANE) -> dict[str, object]:
    for item in volume.MAGE_MODEL_FILES:
        path = root / item.path
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("wb") as stream:
            stream.truncate(item.bytes)
    body = volume.manifest_body(
        volume_id_hash="sha256:" + hashlib.sha256(b"cp06-volume").hexdigest(),
        prepared_at="2026-08-14T00:00:00Z",
    )
    body["lane"] = lane
    marker = volume.seal_manifest(body)
    (root / volume.MAGE_MARKER_NAME).write_text(json.dumps(marker), encoding="utf-8")
    return marker


class MageWorkerImageTest(unittest.TestCase):
    def test_repair_image_pins_prior_immutable_lineage_and_complete_source(self) -> None:
        dockerfile = REPAIR_DOCKERFILE.read_text(encoding="utf-8")
        self.assertRegex(
            dockerfile,
            rf"(?m)^FROM {re.escape(PRIOR_IMMUTABLE_IMAGE)}$",
        )
        self.assertIn(
            f'org.opencontainers.image.revision="{REPAIRED_SOURCE_COMMIT}"',
            dockerfile,
        )
        self.assertIn(f'ai.videoforge.source-commit="{REPAIRED_SOURCE_COMMIT}"', dockerfile)
        self.assertIn(
            f'org.opencontainers.image.base.digest="{PRIOR_IMMUTABLE_IMAGE.split("@", 1)[1]}"',
            dockerfile,
        )
        self.assertIn(f'ai.videoforge.base-image="{PRIOR_IMMUTABLE_IMAGE}"', dockerfile)

    def test_repair_image_overlays_handler_and_inherits_entrypoint(self) -> None:
        dockerfile = REPAIR_DOCKERFILE.read_text(encoding="utf-8")
        original = (ROOT / "Dockerfile.mage").read_text(encoding="utf-8")
        self.assertIn(
            'ENTRYPOINT ["python", "/opt/videoforge/mage-serverless-entrypoint.py"]',
            original,
        )
        self.assertNotRegex(dockerfile, r"(?m)^\s*(?:ENTRYPOINT|CMD)\b")
        self.assertRegex(
            dockerfile,
            r"(?m)^COPY workers/image-media/mage_serverless\.py "
            r"/opt/videoforge/mage_serverless\.py$",
        )
        copy_lines = [
            line.strip() for line in dockerfile.splitlines() if line.strip().startswith("COPY ")
        ]
        self.assertEqual(
            copy_lines,
            ["COPY workers/image-media/mage_serverless.py /opt/videoforge/mage_serverless.py"],
        )

    def test_repair_image_has_no_volume_mutation_or_download_instruction(self) -> None:
        dockerfile = REPAIR_DOCKERFILE.read_text(encoding="utf-8")
        for instruction in ("ADD", "ARG", "ENV", "RUN", "VOLUME", "WORKDIR"):
            self.assertNotRegex(dockerfile, rf"(?m)^\s*{instruction}(?:\s|$)")
        for forbidden in ("apt-get", "curl", "git clone", "hf_hub_download", "pip install", "wget"):
            self.assertNotIn(forbidden, dockerfile)
        self.assertNotIn("MAGE_MODEL_ROOT=", dockerfile)
        repaired_source = (ROOT / "mage_serverless.py").read_text(encoding="utf-8")
        self.assertIn("verify_model_root", repaired_source)
        self.assertIn('Path(os.environ.get("MAGE_MODEL_ROOT", "/runpod-volume"))', repaired_source)
        self.assertNotIn("hf_hub_download", repaired_source)

    def test_generate_contract_accepts_json_body_not_query_value(self) -> None:
        tree = ast.parse((ROOT / "mage_api.py").read_text(encoding="utf-8"))
        generate = next(
            node
            for node in tree.body
            if isinstance(node, ast.AsyncFunctionDef) and node.name == "generate"
        )
        value_default = generate.args.defaults[0]
        self.assertIsInstance(value_default, ast.Call)
        self.assertEqual(value_default.func.id, "Body")

    def test_image_is_exact_int8_persistent_pod_contract(self) -> None:
        dockerfile = (ROOT / "Dockerfile.mage").read_text(encoding="utf-8")
        node_verifier = (ROOT / "verify_comfyui_nodes.py").read_text(encoding="utf-8")
        workflow = (ROOT.parents[1] / ".github/workflows/mage-image.yml").read_text(
            encoding="utf-8"
        )
        for exact in (
            "d8c99241f6fa80fbd453014234af2bf337ea21e6",
            "26d7f8556822d9d08c2d3e1878636ac3b4969af9",
            "int8-convrot",
            "torch-2.11.0%2Bcu130",
            "python:3.11-slim-bookworm@sha256:28255a3ace7eb4c48bc1b57b90af29e1bc82b4fd6c60614a8e3dce61b87ff941",
        ):
            self.assertIn(exact, dockerfile + workflow)
        active = "\n".join(
            (ROOT / name).read_text(encoding="utf-8")
            for name in (
                "Dockerfile.mage",
                "mage-entrypoint.py",
                "mage_api.py",
                "mage_bootstrap.py",
                "mage_runtime.py",
                "mage_serverless.py",
                "mage-serverless-entrypoint.py",
            )
        )
        self.assertIn("runpod.serverless.start", active)
        self.assertNotIn("hf_hub_download", active)
        self.assertIn("HF_HUB_OFFLINE=1", dockerfile)
        self.assertIn("comfy_extras.nodes_mage", node_verifier)
        self.assertNotIn("init_extra_nodes", node_verifier)

    def test_exact_three_file_manifest_and_headroom(self) -> None:
        self.assertEqual(volume.MAGE_MODEL_BYTES, 13_379_919_280)
        self.assertEqual(volume.MAGE_VOLUME_SIZE_GB, 50)
        self.assertEqual(volume.MAGE_MINIMUM_HEADROOM_BYTES, 36_620_080_720)
        self.assertEqual(
            [item.path for item in volume.MAGE_MODEL_FILES],
            [
                "diffusion_models/mage_flow_turbo_int8_convrot.safetensors",
                "text_encoders/qwen3vl_4b_bf16.safetensors",
                "vae/mage_flow_vae_bf16.safetensors",
            ],
        )

    def test_volume_verifier_accepts_only_exact_owned_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker = make_volume(root)
            with patch.object(
                volume,
                "sha256_file",
                side_effect=[item.sha256 for item in volume.MAGE_MODEL_FILES],
            ):
                observed = volume.verify_model_root(
                    root, expected_volume_id_hash=marker["volume_id_hash"]
                )
            self.assertEqual(observed["precision"], "int8-convrot")

    def test_missing_wrong_and_cross_lane_volumes_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_volume(root, lane="echo_avatar")
            with self.assertRaisesRegex(volume.MageVolumeError, "MAGE_VOLUME_LANE_MISMATCH"):
                volume.verify_model_root(root)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_volume(root)
            (root / volume.MAGE_MODEL_FILES[0].path).unlink()
            with self.assertRaisesRegex(volume.MageVolumeError, "MAGE_VOLUME_FILE_SET_MISMATCH"):
                volume.verify_model_root(root)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            make_volume(root)
            extra = root / "vae" / "foreign.safetensors"
            extra.write_bytes(b"foreign")
            with self.assertRaisesRegex(volume.MageVolumeError, "MAGE_VOLUME_FILE_SET_MISMATCH"):
                volume.verify_model_root(root)

    def test_preparation_requires_exact_confirmation_before_network_import(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(RuntimeError, "MAGE_PREPARATION_CONFIRMATION_INVALID"):
                prepare(
                    Path(temporary),
                    volume_id="volume_cp06",
                    volume_size_gb=50,
                    confirmation=CONFIRMATION + "_WRONG",
                )

    def test_preparation_service_exposes_only_hashed_ready_evidence(self) -> None:
        marker = {"manifest_sha256": "sha256:" + "f" * 64}
        environment = {
            "VIDEOFORGE_MAGE_VOLUME_ID": "volume_cp06",
            "VIDEOFORGE_MAGE_DOWNLOAD_CONFIRMATION": CONFIRMATION,
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch("mage_prepare_service.prepare", return_value=marker),
        ):
            prepare_service.run_preparation()
            health = prepare_service.health_payload()
        self.assertEqual(health["phase"], "ready")
        self.assertEqual(health["model"]["exact_bytes"], volume.MAGE_MODEL_BYTES)
        self.assertEqual(health["volume"]["requested_size_gb"], 50)
        self.assertEqual(health["volume"]["manifest_sha256"], marker["manifest_sha256"])
        self.assertNotIn("volume_cp06", json.dumps(health))

    def test_normal_boot_requires_offline_mode_and_never_downloads(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            model_root = Path(temporary) / "model"
            comfy_root = Path(temporary) / "comfy"
            model_root.mkdir()
            with patch.dict(os.environ, {}, clear=True):
                with self.assertRaisesRegex(
                    volume.MageVolumeError, "MAGE_OFFLINE_RUNTIME_REQUIRED"
                ):
                    bootstrap(model_root, comfy_root)

    def test_actual_gpu_identity_memory_and_cuda_are_checked(self) -> None:
        fake_properties = types.SimpleNamespace(total_memory=24 * 1024**3)
        fake_torch = types.SimpleNamespace(
            __version__="2.11.0+cu130",
            version=types.SimpleNamespace(cuda="13.0"),
            cuda=types.SimpleNamespace(
                is_available=lambda: True,
                device_count=lambda: 1,
                get_device_name=lambda _index: "NVIDIA GeForce RTX 4090",
                get_device_properties=lambda _index: fake_properties,
                mem_get_info=lambda _index: (4 * 1024**3, 24 * 1024**3),
            ),
        )
        runtime = MageRuntime()
        with (
            patch.dict(sys.modules, {"torch": fake_torch}),
            patch.dict(
                os.environ,
                {"VIDEOFORGE_MAGE_GPU_OFFERING_ID": "NVIDIA GeForce RTX 4090"},
            ),
        ):
            runtime.verify_gpu()
            self.assertEqual(runtime.device_vram_used_bytes(), 20 * 1024**3)
        self.assertTrue(runtime.gpu["approved"])
        self.assertEqual(runtime.gpu["offering_id"], "NVIDIA GeForce RTX 4090")

    def test_runtime_rejects_any_non_4090_offering_before_cuda_probe(self) -> None:
        runtime = MageRuntime()
        with patch.dict(
            os.environ,
            {
                "VIDEOFORGE_MAGE_VOLUME_ID_HASH": "sha256:" + ("a" * 64),
                "VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST": (
                    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:" + ("b" * 64)
                ),
                "RUNPOD_POD_ID": "serverless-worker-1",
                "VIDEOFORGE_MAGE_WORKER_TOKEN": "x" * 32,
                "VIDEOFORGE_MAGE_GPU_OFFERING_ID": "NVIDIA RTX PRO 4500 Blackwell",
            },
            clear=True,
        ):
            with self.assertRaisesRegex(RuntimeError, "MAGE_GPU_OFFERING_INVALID"):
                runtime.verify_runtime_identity()

    def test_serverless_runtime_requires_the_v2_07_immutable_image(self) -> None:
        environment = {
            "VIDEOFORGE_MAGE_VOLUME_ID_HASH": "sha256:" + ("a" * 64),
            "VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST": (
                "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:" + ("b" * 64)
            ),
            "RUNPOD_POD_ID": "serverless-worker-1",
            "VIDEOFORGE_MAGE_WORKER_TOKEN": "x" * 32,
            "VIDEOFORGE_MAGE_GPU_OFFERING_ID": "NVIDIA GeForce RTX 4090",
        }
        with patch.dict(os.environ, environment, clear=True):
            MageRuntime.verify_runtime_identity()
            os.environ["VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST"] = (
                "ghcr.io/pala-lakshmansai/videoforge-mage-cp06@sha256:" + ("b" * 64)
            )
            with self.assertRaisesRegex(RuntimeError, "MAGE_WORKER_IMAGE_IDENTITY_INVALID"):
                MageRuntime.verify_runtime_identity()

    def test_health_is_not_ready_until_real_warmup_finishes(self) -> None:
        runtime = MageRuntime()
        self.assertEqual(runtime.health()["model"]["status"], "loading")
        runtime.transition("warmup")
        self.assertEqual(runtime.health()["model"]["status"], "loading")
        runtime.transition("ready")
        runtime.ready = True
        self.assertEqual(runtime.health()["model"]["status"], "ready")


if __name__ == "__main__":
    unittest.main()

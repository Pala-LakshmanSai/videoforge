import hashlib
import struct
import sys
import unittest
import zlib
import tempfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from videoforge_image_media import mage_production as mage  # noqa: E402


def digest(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode()).hexdigest()


def item(index: int, *, inline: bool = False) -> dict[str, object]:
    prompt = f"Owned documentary scene {index}, photorealistic, no text"
    negative_prompt = "visible text, logo, repeated people, malformed anatomy"
    value: dict[str, object] = {
        "scene_id": f"scene_{index:03d}",
        "positive_prompt": prompt,
        "positive_prompt_sha256": digest(prompt),
        "negative_prompt": negative_prompt,
        "negative_prompt_sha256": digest(negative_prompt),
        "seed": 42 + index,
        "width": 1280,
        "height": 720,
    }
    if not inline:
        value["output_put_url"] = f"https://objects.example/{index}.png?signature=private"
    return value


def inline() -> dict[str, object]:
    return {
        "mode": "INLINE_QUALIFICATION_V1",
        "attempt_id": "mage_inline_001",
        "model_revision": mage.MAGE_MODEL_REVISION,
        "items": [item(0, inline=True)],
    }


def remote(count: int = 32) -> dict[str, object]:
    return {
        "attempt_id": "mage_attempt_001",
        "model_revision": mage.MAGE_MODEL_REVISION,
        "items": [item(i) for i in range(count)],
    }


def png(width: int, height: int) -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    rows = b"".join(b"\x00" + b"\x10\x20\x30" * width for _ in range(height))
    return (
        mage.PNG_SIGNATURE
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


class MageProductionContractTest(unittest.TestCase):
    def test_batch_and_fail_closed_contracts(self) -> None:
        self.assertEqual(len(mage.MageJob.from_value(remote()).items), 32)
        self.assertEqual(len(mage.MageJob.from_value(remote(64)).items), 64)
        for count in (1, 31, 65):
            with self.assertRaisesRegex(mage.MageContractError, "MAGE_BATCH_SIZE_INVALID"):
                mage.MageJob.from_value(remote(count))
        value = remote()
        value["items"][0]["positive_prompt_sha256"] = "sha256:" + "0" * 64
        with self.assertRaisesRegex(mage.MageContractError, "MAGE_PROMPT_HASH_MISMATCH"):
            mage.MageJob.from_value(value)
        for invalid, code in [
            ("", "MAGE_NEGATIVE_PROMPT_INVALID"),
            ("x" * 6_001, "MAGE_NEGATIVE_PROMPT_INVALID"),
        ]:
            value = remote()
            value["items"][0]["negative_prompt"] = invalid
            with self.assertRaisesRegex(mage.MageContractError, code):
                mage.MageJob.from_value(value)
        value = remote()
        value["items"][0]["negative_prompt_sha256"] = "sha256:" + "0" * 64
        with self.assertRaisesRegex(mage.MageContractError, "MAGE_NEGATIVE_PROMPT_HASH_MISMATCH"):
            mage.MageJob.from_value(value)
        value = remote()
        del value["items"][0]["negative_prompt"]
        with self.assertRaisesRegex(mage.MageContractError, "MAGE_ITEM_SHAPE_INVALID"):
            mage.MageJob.from_value(value)

    def test_inline_profile_is_exact_native_landscape(self) -> None:
        parsed = mage.MageInlineJob.from_value(inline())
        self.assertEqual((parsed.items[0].width, parsed.items[0].height), (1280, 720))
        value = inline()
        value["items"][0]["height"] = 1024
        with self.assertRaisesRegex(mage.MageContractError, "MAGE_INLINE_SIZE_INVALID"):
            mage.MageInlineJob.from_value(value)

    def test_public_identity_and_all_weight_hashes_are_exact(self) -> None:
        self.assertEqual(mage.MAGE_MODEL_ID, "Comfy-Org/Mage-Flow")
        self.assertEqual(mage.MAGE_MODEL_REVISION, "d8c99241f6fa80fbd453014234af2bf337ea21e6")
        self.assertEqual(mage.MAGE_SOURCE_REVISION, "26d7f8556822d9d08c2d3e1878636ac3b4969af9")
        self.assertEqual(mage.MAGE_TRANSFORMER_FILENAME, "mage_flow_turbo_int8_convrot.safetensors")
        self.assertEqual(mage.MAGE_TRANSFORMER_BYTES, 4_159_146_840)
        self.assertEqual(
            mage.MAGE_TRANSFORMER_SHA256,
            "327c3967a5190ea52e453ec3dd81ba168e37a2a0ff2c763aa3e9260bbbe1913c",
        )
        self.assertEqual(mage.MAGE_TEXT_ENCODER_BYTES, 8_875_719_384)
        self.assertEqual(mage.MAGE_VAE_BYTES, 345_053_056)
        self.assertEqual(
            mage.MAGE_TEXT_ENCODER_SHA256,
            "36f3ff447ef59201722e8f9ce6020c9819fdcfba6aa2608c4e09b1c0ce114e34",
        )
        self.assertEqual(
            mage.MAGE_VAE_SHA256, "34e076dc1e8a15321e1e07be5111d59cf16dd10b804b7c7e20b4de29013427e0"
        )
        self.assertEqual(mage.MAGE_REPOSITORY_BYTE_CEILING, 13_379_919_280)
        self.assertEqual(mage.MAGE_DTYPE, "int8-convrot")

    def test_graph_matches_only_proven_comfy_path(self) -> None:
        graph = mage.build_workflow(mage.MageInlineJob.from_value(inline()))
        self.assertEqual(graph["3"]["inputs"]["type"], "mage")
        self.assertEqual(graph["5"]["class_type"], "TextEncodeMageFlowEdit")
        self.assertEqual(
            graph["5"]["inputs"]["negative_prompt"],
            "visible text, logo, repeated people, malformed anatomy",
        )
        self.assertEqual(graph["6"]["inputs"]["latent_image"], ["5", 2])
        self.assertEqual(graph["6"]["inputs"]["steps"], 4)
        self.assertEqual(graph["6"]["inputs"]["cfg"], 1.0)
        self.assertEqual(graph["6"]["inputs"]["sampler_name"], "euler")
        self.assertEqual(graph["6"]["inputs"]["scheduler"], "simple")
        self.assertNotIn("EmptySD3LatentImage", str(graph))

    def test_inline_runner_returns_validated_comfy_png(self) -> None:
        parsed = mage.MageInlineJob.from_value(inline())
        output = png(1280, 720)
        responses = [
            {"prompt_id": "p1"},
            {
                "p1": {
                    "outputs": {
                        "9": {"images": [{"filename": "x.png", "subfolder": "", "type": "output"}]}
                    }
                }
            },
        ]
        with (
            patch.object(mage, "_request_json", side_effect=responses),
            patch.object(mage, "_request_bytes", return_value=output),
        ):
            result = mage.run_inline_job(parsed, Path("/models"))
        self.assertEqual(result["output_sha256"], "sha256:" + hashlib.sha256(output).hexdigest())
        self.assertEqual((result["width"], result["height"]), (1280, 720))
        self.assertGreaterEqual(result["generation_duration_ms"], 0)
        self.assertEqual(result["negative_prompt_sha256"], digest(parsed.items[0].negative_prompt))

    def test_inline_runner_removes_exact_comfy_output_after_read(self) -> None:
        parsed = mage.MageInlineJob.from_value(inline())
        output = png(1280, 720)
        responses = [
            {"prompt_id": "p1"},
            {
                "p1": {
                    "outputs": {
                        "9": {"images": [{"filename": "x.png", "subfolder": "", "type": "output"}]}
                    }
                }
            },
        ]
        with tempfile.TemporaryDirectory() as temporary:
            output_path = Path(temporary) / "x.png"
            output_path.write_bytes(output)
            with (
                patch.object(mage, "_request_json", side_effect=responses),
                patch.object(mage, "_request_bytes", return_value=output),
                patch.dict("os.environ", {"VIDEOFORGE_COMFY_OUTPUT_ROOT": temporary}),
            ):
                mage.run_inline_job(parsed, Path("/models"))
            self.assertFalse(output_path.exists())

    def test_png_rejects_wrong_profile_and_metadata(self) -> None:
        mage.probe_png_bytes(png(1280, 720), 1280, 720)
        with self.assertRaisesRegex(mage.MageContractError, "MAGE_OUTPUT_PROFILE_INVALID"):
            mage.probe_png_bytes(png(1024, 1024), 1280, 720)


if __name__ == "__main__":
    unittest.main()

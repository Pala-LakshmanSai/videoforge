import hashlib
import struct
import sys
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from videoforge_image_media import mage_production as mage  # noqa: E402

REVISION = mage.MAGE_MODEL_REVISION


def digest(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode()).hexdigest()


def item(index: int, *, inline: bool = False) -> dict[str, object]:
    prompt = f"Owned documentary scene {index}, no text, no logo, no watermark"
    value: dict[str, object] = {
        "scene_id": f"scene_{index:03d}",
        "positive_prompt": prompt,
        "positive_prompt_sha256": digest(prompt),
        "seed": 42 + index,
        "width": 1024,
        "height": 1024,
    }
    if not inline:
        value["output_put_url"] = f"https://objects.example/{index}.png?signature=private"
    return value


def remote(count: int = 32) -> dict[str, object]:
    return {
        "attempt_id": "mage_attempt_001",
        "model_revision": REVISION,
        "items": [item(index) for index in range(count)],
    }


def inline() -> dict[str, object]:
    return {
        "mode": "INLINE_QUALIFICATION_V1",
        "attempt_id": "mage_inline_001",
        "model_revision": REVISION,
        "items": [item(0, inline=True)],
    }


def png(width: int, height: int, *, color: int = 2) -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, color, 0, 0, 0)
    pixel = b"\x10\x20\x30" + (b"\xff" if color == 6 else b"")
    rows = b"".join(b"\x00" + pixel * width for _ in range(height))
    return (
        mage.PNG_SIGNATURE
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


class MageProductionContractTest(unittest.TestCase):
    def test_accepts_only_bounded_packed_production_batches(self) -> None:
        parsed = mage.MageJob.from_value(remote())
        self.assertEqual(len(parsed.items), 32)
        self.assertEqual(parsed.items[-1].seed, 73)
        self.assertEqual(len(mage.MageJob.from_value(remote(64)).items), 64)
        for count in (1, 31, 65):
            with (
                self.subTest(count=count),
                self.assertRaisesRegex(mage.MageContractError, "MAGE_BATCH_SIZE_INVALID"),
            ):
                mage.MageJob.from_value(remote(count))

    def test_rejects_shape_hash_seed_size_url_and_control_drift(self) -> None:
        cases = []
        value = remote()
        value["extra"] = True
        cases.append((value, "MAGE_JOB_SHAPE_INVALID"))
        value = remote()
        value["items"][0]["positive_prompt_sha256"] = "sha256:" + "0" * 64
        cases.append((value, "MAGE_PROMPT_HASH_MISMATCH"))
        value = remote()
        value["items"][1]["seed"] = 999
        cases.append((value, "MAGE_SEED_SEQUENCE_INVALID"))
        value = remote()
        value["items"][0]["width"] = 1000
        cases.append((value, "MAGE_SIZE_INVALID"))
        value = remote()
        value["items"][0]["output_put_url"] = "file:///tmp/output.png"
        cases.append((value, "MAGE_OUTPUT_URL_INVALID"))
        value = remote()
        value["items"][0]["positive_prompt"] = "bad\x00prompt"
        value["items"][0]["positive_prompt_sha256"] = digest("bad\x00prompt")
        cases.append((value, "MAGE_PROMPT_INVALID"))
        for value, code in cases:
            with self.subTest(code=code), self.assertRaisesRegex(mage.MageContractError, code):
                mage.MageJob.from_value(value)

    def test_inline_qualification_is_exactly_one_square_image(self) -> None:
        parsed = mage.MageInlineJob.from_value(inline())
        self.assertEqual((parsed.items[0].width, parsed.items[0].height), (1024, 1024))
        value = inline()
        value["items"][0]["height"] = 768
        with self.assertRaisesRegex(mage.MageContractError, "MAGE_INLINE_SIZE_INVALID"):
            mage.MageInlineJob.from_value(value)

    def test_model_revision_mismatch_fails_closed_before_command_or_model_activity(self) -> None:
        parsed = mage.MageInlineJob.from_value(inline())
        value = inline()
        value["model_revision"] = "1" * 40
        mismatched = mage.MageInlineJob.from_value(value)
        with self.assertRaisesRegex(mage.MageContractError, "MAGE_MODEL_REVISION_MISMATCH"):
            mage.build_command(mismatched, Path("/models/pinned"), Path("/output"))
        self.assertEqual(
            mage.require_admitted_model_revision(parsed.model_revision), mage.MAGE_MODEL_REVISION
        )

    def test_model_identity_and_size_ceiling_are_exact(self) -> None:
        self.assertEqual(mage.MAGE_MODEL_REVISION, "395402ba3ef110c96e70d01abe4d178dbe4e01a5")
        self.assertEqual(
            mage.MAGE_TRANSFORMER_SHA256,
            "6df47df3d7efc9ebdad075b87b3e9e4f74d09dca672d592271788f0ee27ab97d",
        )
        self.assertEqual(mage.MAGE_TRANSFORMER_BYTES, 8_231_536_760)
        self.assertEqual(mage.MAGE_REPOSITORY_BYTE_CEILING, 18_000_000_000)

    def test_command_pins_turbo_settings_and_has_no_negative_branch(self) -> None:
        parsed = mage.MageInlineJob.from_value(inline())
        command = mage.build_command(parsed, Path("/models/pinned"), Path("/output"))
        self.assertEqual(command[0], "python")
        self.assertEqual(command[command.index("--steps") + 1], "4")
        self.assertEqual(command[command.index("--cfg") + 1], "1.0")
        self.assertEqual(command[command.index("--seed") + 1], "42")
        self.assertNotIn("--neg_prompt", command)
        self.assertFalse(any("https://" in argument for argument in command))

    def test_source_patch_is_mandatory_for_watermark_and_refusal_bytes(self) -> None:
        with self.assertRaisesRegex(mage.MageContractError, "MAGE_SOURCE_PATCH_MISSING"):
            mage.assert_patched_source(
                "def generate_images():\nx = encode_noise(tuple(x.shape))\n# Image edit"
            )
        with self.assertRaisesRegex(mage.MageContractError, "MAGE_SOURCE_PATCH_MISSING"):
            mage.assert_patched_source(
                "def generate_images():\nresults[i] = make_refusal_image(verdict)\n# Image edit"
            )
        mage.assert_patched_source(
            'def generate_images():\nraise ValueError("MAGE_PROMPT_REFUSED")\nx = get_noise()\n# Image edit'
        )

    def test_png_probe_and_results_bind_exact_lineage(self) -> None:
        parsed = mage.MageInlineJob.from_value(inline())
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "gen_000.png"
            output.write_bytes(png(1024, 1024))
            results = mage.collect_results(parsed, root)
            self.assertEqual(
                results[0]["output_sha256"],
                "sha256:" + hashlib.sha256(output.read_bytes()).hexdigest(),
            )
            self.assertEqual(results[0]["model_revision"], REVISION)
            self.assertEqual(results[0]["source_revision"], mage.MAGE_SOURCE_REVISION)
            output.write_bytes(png(512, 1024))
            with (
                self.assertRaisesRegex(mage.MageContractError, "MAGE_OUTPUT_PROFILE_INVALID"),
            ):
                mage.collect_results(parsed, root)

    def test_process_cancel_timeout_failure_and_start_errors_are_redacted(self) -> None:
        process = unittest.mock.Mock()
        process.poll.return_value = None
        process.wait.return_value = 0
        with (
            patch.object(mage.subprocess, "Popen", return_value=process),
            self.assertRaisesRegex(mage.MageContractError, "MAGE_INFERENCE_CANCELLED"),
        ):
            mage.run_process(
                ["python", "private-token"], Path("/tmp"), cancel_requested=lambda: True
            )
        process.terminate.assert_called_once()

        process.reset_mock()
        process.poll.return_value = None
        with (
            patch.object(mage.subprocess, "Popen", return_value=process),
            patch.object(mage.time, "monotonic", side_effect=[0.0, 2.0]),
            self.assertRaisesRegex(mage.MageContractError, "MAGE_INFERENCE_TIMEOUT"),
        ):
            mage.run_process(["python", "private-token"], Path("/tmp"), 1)
        process.terminate.assert_called_once()

        process.reset_mock()
        process.poll.return_value = 1
        process.returncode = 1
        with (
            patch.object(mage.subprocess, "Popen", return_value=process),
            self.assertRaisesRegex(mage.MageContractError, "MAGE_INFERENCE_FAILED") as raised,
        ):
            mage.run_process(["python", "private-token"], Path("/tmp"), 1)
        self.assertNotIn("private-token", str(raised.exception))

        with (
            patch.object(mage.subprocess, "Popen", side_effect=OSError("private-token")),
            self.assertRaisesRegex(mage.MageContractError, "MAGE_INFERENCE_START_FAILED") as raised,
        ):
            mage.run_process(["python", "private-token"], Path("/tmp"), 1)
        self.assertNotIn("private-token", str(raised.exception))


if __name__ == "__main__":
    unittest.main()

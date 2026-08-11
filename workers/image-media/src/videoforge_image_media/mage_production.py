from __future__ import annotations

import base64
import hashlib
import os
import re
import struct
import subprocess
import time
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal, TypedDict
from urllib.parse import urlsplit

MAGE_SOURCE_REVISION = "76bec2bb3818863f470de7e867c2dc7f1d0bfd83"
MAGE_MODEL_ID = "microsoft/Mage-Flow-Turbo"
MAGE_MODEL_REVISION = "395402ba3ef110c96e70d01abe4d178dbe4e01a5"
MAGE_TRANSFORMER_SHA256 = "6df47df3d7efc9ebdad075b87b3e9e4f74d09dca672d592271788f0ee27ab97d"
MAGE_TRANSFORMER_BYTES = 8_231_536_760
MAGE_REPOSITORY_BYTE_CEILING = 18_000_000_000
MAGE_STEPS = 4
MAGE_CFG = 1.0
MAGE_DTYPE = "bfloat16"
MAGE_QUALIFICATION_SIZE = 1024
MAGE_TIMEOUT_SECONDS = 600
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
REVISION = re.compile(r"^[0-9a-f]{40}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$")


class MageContractError(ValueError):
    pass


class MageResult(TypedDict):
    schema_version: Literal["videoforge.mage-image-result/v1"]
    attempt_id: str
    scene_id: str
    output_sha256: str
    bytes: int
    width: int
    height: int
    seed: int
    positive_prompt_sha256: str
    source_revision: str
    model_revision: str
    renderer_source_profile: Literal["mage-square-native-v1"]


class MageInlineResult(MageResult):
    output_base64: str


def _exact_keys(value: object, keys: set[str], code: str) -> dict[str, object]:
    if not isinstance(value, dict) or set(value) != keys:
        raise MageContractError(code)
    return value


def _text(value: object, maximum: int, code: str) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise MageContractError(code)
    if any(ord(character) < 32 for character in value):
        raise MageContractError(code)
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as error:
        raise MageContractError(code) from error
    return value


@dataclass(frozen=True)
class MageItem:
    scene_id: str
    positive_prompt: str
    positive_prompt_sha256: str
    seed: int
    width: int
    height: int
    output_put_url: str | None = None

    @classmethod
    def from_value(cls, value: object, *, inline: bool) -> MageItem:
        keys = {
            "scene_id",
            "positive_prompt",
            "positive_prompt_sha256",
            "seed",
            "width",
            "height",
            *(set() if inline else {"output_put_url"}),
        }
        item = cls(**_exact_keys(value, keys, "MAGE_ITEM_SHAPE_INVALID"))
        if not IDENTIFIER.fullmatch(item.scene_id):
            raise MageContractError("MAGE_SCENE_ID_INVALID")
        prompt = _text(item.positive_prompt, 6_000, "MAGE_PROMPT_INVALID")
        if (
            "sha256:" + hashlib.sha256(prompt.encode("utf-8")).hexdigest()
            != item.positive_prompt_sha256
        ):
            raise MageContractError("MAGE_PROMPT_HASH_MISMATCH")
        if (
            not isinstance(item.seed, int)
            or isinstance(item.seed, bool)
            or not 0 <= item.seed < 2**32
        ):
            raise MageContractError("MAGE_SEED_INVALID")
        for size in (item.width, item.height):
            if (
                not isinstance(size, int)
                or isinstance(size, bool)
                or size < 512
                or size > 2048
                or size % 16
            ):
                raise MageContractError("MAGE_SIZE_INVALID")
        if not inline:
            if not isinstance(item.output_put_url, str) or len(item.output_put_url) > 8_192:
                raise MageContractError("MAGE_OUTPUT_URL_INVALID")
            parsed_url = urlsplit(item.output_put_url)
            if (
                parsed_url.scheme != "https"
                or not parsed_url.hostname
                or parsed_url.username is not None
                or parsed_url.password is not None
                or parsed_url.fragment
                or any(ord(character) < 32 for character in item.output_put_url)
            ):
                raise MageContractError("MAGE_OUTPUT_URL_INVALID")
        return item


def _validate_batch(items: tuple[MageItem, ...], *, inline: bool) -> None:
    minimum, maximum = (1, 1) if inline else (32, 64)
    if not minimum <= len(items) <= maximum:
        raise MageContractError("MAGE_BATCH_SIZE_INVALID")
    if len({item.scene_id for item in items}) != len(items):
        raise MageContractError("MAGE_SCENE_ID_DUPLICATE")
    base_seed = items[0].seed
    if any(item.seed != base_seed + index for index, item in enumerate(items)):
        raise MageContractError("MAGE_SEED_SEQUENCE_INVALID")


@dataclass(frozen=True)
class MageJob:
    attempt_id: str
    model_revision: str
    items: tuple[MageItem, ...]

    @classmethod
    def from_value(cls, value: object) -> MageJob:
        parsed = _exact_keys(
            value, {"attempt_id", "model_revision", "items"}, "MAGE_JOB_SHAPE_INVALID"
        )
        raw_items = parsed["items"]
        if not isinstance(raw_items, list):
            raise MageContractError("MAGE_BATCH_SIZE_INVALID")
        job = cls(
            attempt_id=parsed["attempt_id"],
            model_revision=parsed["model_revision"],
            items=tuple(MageItem.from_value(item, inline=False) for item in raw_items),
        )
        _validate_identity(job.attempt_id, job.model_revision)
        _validate_batch(job.items, inline=False)
        return job


@dataclass(frozen=True)
class MageInlineJob:
    mode: Literal["INLINE_QUALIFICATION_V1"]
    attempt_id: str
    model_revision: str
    items: tuple[MageItem, ...]

    @classmethod
    def from_value(cls, value: object) -> MageInlineJob:
        parsed = _exact_keys(
            value,
            {"mode", "attempt_id", "model_revision", "items"},
            "MAGE_INLINE_JOB_SHAPE_INVALID",
        )
        raw_items = parsed["items"]
        if parsed["mode"] != "INLINE_QUALIFICATION_V1" or not isinstance(raw_items, list):
            raise MageContractError("MAGE_INLINE_SCOPE_INVALID")
        job = cls(
            mode=parsed["mode"],
            attempt_id=parsed["attempt_id"],
            model_revision=parsed["model_revision"],
            items=tuple(MageItem.from_value(item, inline=True) for item in raw_items),
        )
        _validate_identity(job.attempt_id, job.model_revision)
        _validate_batch(job.items, inline=True)
        if (job.items[0].width, job.items[0].height) != (
            MAGE_QUALIFICATION_SIZE,
            MAGE_QUALIFICATION_SIZE,
        ):
            raise MageContractError("MAGE_INLINE_SIZE_INVALID")
        return job


def _validate_identity(attempt_id: object, model_revision: object) -> None:
    if not isinstance(attempt_id, str) or not IDENTIFIER.fullmatch(attempt_id):
        raise MageContractError("MAGE_ATTEMPT_ID_INVALID")
    if not isinstance(model_revision, str) or not REVISION.fullmatch(model_revision):
        raise MageContractError("MAGE_MODEL_REVISION_INVALID")


def require_admitted_model_revision(requested: str) -> str:
    if requested != MAGE_MODEL_REVISION:
        raise MageContractError("MAGE_MODEL_REVISION_MISMATCH")
    return requested


def build_command(job: MageJob | MageInlineJob, model_root: Path, output_root: Path) -> list[str]:
    require_admitted_model_revision(job.model_revision)
    command = [
        "python",
        "/opt/mage/mage_flow/inference.py",
        "--prompt",
        *(item.positive_prompt for item in job.items),
        "--height",
        *(str(item.height) for item in job.items),
        "--width",
        *(str(item.width) for item in job.items),
        "--model_path",
        str(model_root),
        "--steps",
        str(MAGE_STEPS),
        "--cfg",
        str(MAGE_CFG),
        "--seed",
        str(job.items[0].seed),
        "--device",
        "cuda",
        "--out",
        str(output_root),
    ]
    if any("\x00" in argument for argument in command):
        raise MageContractError("MAGE_COMMAND_INVALID")
    return command


def assert_patched_source(source: str) -> None:
    start = source.find("def generate_images(")
    end = source.find("# Image edit", start)
    generation = source[start:end] if start >= 0 and end > start else ""
    if (
        not generation
        or "x = encode_noise(" in generation
        or "results[i] = make_refusal_image" in generation
    ):
        raise MageContractError("MAGE_SOURCE_PATCH_MISSING")


def probe_png(path: Path, expected_width: int, expected_height: int) -> tuple[int, int]:
    data = path.read_bytes()
    if len(data) < 57 or not data.startswith(PNG_SIGNATURE):
        raise MageContractError("MAGE_OUTPUT_PNG_INVALID")
    offset = len(PNG_SIGNATURE)
    chunks: list[tuple[bytes, bytes]] = []
    while offset < len(data):
        if offset + 12 > len(data):
            raise MageContractError("MAGE_OUTPUT_PNG_INVALID")
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        end = offset + 12 + length
        if end > len(data):
            raise MageContractError("MAGE_OUTPUT_PNG_INVALID")
        kind = data[offset + 4 : offset + 8]
        payload = data[offset + 8 : offset + 8 + length]
        expected_crc = struct.unpack(">I", data[offset + 8 + length : end])[0]
        if zlib.crc32(kind + payload) & 0xFFFFFFFF != expected_crc:
            raise MageContractError("MAGE_OUTPUT_PNG_INVALID")
        chunks.append((kind, payload))
        offset = end
        if kind == b"IEND":
            break
    if offset != len(data) or not chunks or chunks[0][0] != b"IHDR" or chunks[-1][0] != b"IEND":
        raise MageContractError("MAGE_OUTPUT_PNG_INVALID")
    if any(kind in {b"tEXt", b"zTXt", b"iTXt"} for kind, _ in chunks):
        raise MageContractError("MAGE_OUTPUT_TEXT_METADATA_FORBIDDEN")
    if len(chunks[0][1]) != 13:
        raise MageContractError("MAGE_OUTPUT_PNG_INVALID")
    width, height, depth, color, compression, filtering, interlace = struct.unpack(
        ">IIBBBBB", chunks[0][1]
    )
    if (width, height) != (expected_width, expected_height) or depth != 8 or color not in {2, 6}:
        raise MageContractError("MAGE_OUTPUT_PROFILE_INVALID")
    if (compression, filtering, interlace) != (0, 0, 0):
        raise MageContractError("MAGE_OUTPUT_PROFILE_INVALID")
    if len(data) > 16 * 1024 * 1024:
        raise MageContractError("MAGE_OUTPUT_TOO_LARGE")
    compressed = b"".join(payload for kind, payload in chunks if kind == b"IDAT")
    bytes_per_pixel = 3 if color == 2 else 4
    expected_bytes = (width * bytes_per_pixel + 1) * height
    inflater = zlib.decompressobj()
    decoded = inflater.decompress(compressed, expected_bytes + 1)
    decoded += inflater.flush()
    if len(decoded) != expected_bytes or not inflater.eof or inflater.unused_data:
        raise MageContractError("MAGE_OUTPUT_PNG_INVALID")
    return width, height


def collect_results(job: MageJob | MageInlineJob, output_root: Path) -> tuple[MageResult, ...]:
    require_admitted_model_revision(job.model_revision)
    paths = sorted(output_root.glob("gen_*.png"))
    if len(paths) != len(job.items):
        raise MageContractError("MAGE_OUTPUT_COUNT_INVALID")
    results: list[MageResult] = []
    for item, path in zip(job.items, paths, strict=True):
        width, height = probe_png(path, item.width, item.height)
        results.append(
            {
                "schema_version": "videoforge.mage-image-result/v1",
                "attempt_id": job.attempt_id,
                "scene_id": item.scene_id,
                "output_sha256": "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest(),
                "bytes": path.stat().st_size,
                "width": width,
                "height": height,
                "seed": item.seed,
                "positive_prompt_sha256": item.positive_prompt_sha256,
                "source_revision": MAGE_SOURCE_REVISION,
                "model_revision": job.model_revision,
                "renderer_source_profile": "mage-square-native-v1",
            }
        )
    return tuple(results)


def run_process(
    command: list[str],
    root: Path,
    timeout: int = MAGE_TIMEOUT_SECONDS,
    cancel_requested: Callable[[], bool] = lambda: False,
) -> None:
    allowed_environment = {
        key: value
        for key, value in os.environ.items()
        if key
        in {
            "CUDA_VISIBLE_DEVICES",
            "LD_LIBRARY_PATH",
            "NVIDIA_DRIVER_CAPABILITIES",
            "NVIDIA_VISIBLE_DEVICES",
            "PATH",
            "PYTHONPATH",
        }
    }
    allowed_environment.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"})
    try:
        process = subprocess.Popen(
            command,
            cwd=root,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=allowed_environment,
            start_new_session=True,
        )
    except OSError as error:
        raise MageContractError("MAGE_INFERENCE_START_FAILED") from error
    deadline = time.monotonic() + timeout
    while process.poll() is None:
        if cancel_requested():
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            raise MageContractError("MAGE_INFERENCE_CANCELLED")
        if time.monotonic() >= deadline:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            raise MageContractError("MAGE_INFERENCE_TIMEOUT")
        time.sleep(0.1)
    if process.returncode:
        raise MageContractError("MAGE_INFERENCE_FAILED")


def run_inline_job(job: MageInlineJob, model_root: Path) -> MageInlineResult:
    import tempfile

    with tempfile.TemporaryDirectory(prefix="videoforge-mage-qualification-") as temporary:
        output_root = Path(temporary)
        command = build_command(job, model_root, output_root)
        run_process(command, Path("/opt/mage"))
        result = collect_results(job, output_root)[0]
        output_path = output_root / "gen_000.png"
        if result["bytes"] > 16 * 1024 * 1024:
            raise MageContractError("MAGE_INLINE_OUTPUT_TOO_LARGE")
        return {
            **result,
            "output_base64": base64.b64encode(output_path.read_bytes()).decode("ascii"),
        }

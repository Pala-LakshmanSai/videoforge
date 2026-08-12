from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import struct
import time
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal, TypedDict
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

MAGE_SOURCE_REVISION = "1108f2ac5e412b27accb0e5d51c90ef2ba39784d"
MAGE_MODEL_ID = "Comfy-Org/Mage-Flow"
MAGE_MODEL_REVISION = "d8c99241f6fa80fbd453014234af2bf337ea21e6"
MAGE_TRANSFORMER_FILENAME = "mage_flow_turbo_bf16.safetensors"
MAGE_TRANSFORMER_SHA256 = "6df47df3d7efc9ebdad075b87b3e9e4f74d09dca672d592271788f0ee27ab97d"
MAGE_TRANSFORMER_BYTES = 8_231_536_760
MAGE_TEXT_ENCODER_FILENAME = "qwen3vl_4b_bf16.safetensors"
MAGE_TEXT_ENCODER_SHA256 = "36f3ff447ef59201722e8f9ce6020c9819fdcfba6aa2608c4e09b1c0ce114e34"
MAGE_TEXT_ENCODER_BYTES = 8_875_719_384
MAGE_VAE_FILENAME = "mage_flow_vae_bf16.safetensors"
MAGE_VAE_SHA256 = "34e076dc1e8a15321e1e07be5111d59cf16dd10b804b7c7e20b4de29013427e0"
MAGE_VAE_BYTES = 345_053_056
MAGE_REPOSITORY_BYTE_CEILING = 18_000_000_000
MAGE_STEPS = 4
MAGE_CFG = 1.0
MAGE_DTYPE = "bfloat16"
MAGE_QUALIFICATION_WIDTH = 1280
MAGE_QUALIFICATION_HEIGHT = 720
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
    renderer_source_profile: Literal["mage-landscape-native-1280x720-v1"]
    generation_duration_ms: int


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
            MAGE_QUALIFICATION_WIDTH,
            MAGE_QUALIFICATION_HEIGHT,
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


def build_workflow(job: MageInlineJob) -> dict[str, object]:
    require_admitted_model_revision(job.model_revision)
    item = job.items[0]
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": MAGE_TRANSFORMER_FILENAME, "weight_dtype": "default"},
        },
        "3": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": MAGE_TEXT_ENCODER_FILENAME,
                "type": "mage",
                "device": "default",
            },
        },
        "4": {"class_type": "VAELoader", "inputs": {"vae_name": MAGE_VAE_FILENAME}},
        "5": {
            "class_type": "TextEncodeMageFlowEdit",
            "inputs": {
                "clip": ["3", 0],
                "vae": ["4", 0],
                "prompt": item.positive_prompt,
                "negative_prompt": "",
                "width": item.width,
                "height": item.height,
                "batch_size": 1,
            },
        },
        "6": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "positive": ["5", 0],
                "negative": ["5", 1],
                "latent_image": ["5", 2],
                "seed": item.seed,
                "steps": MAGE_STEPS,
                "cfg": MAGE_CFG,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1.0,
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["6", 0], "vae": ["4", 0]}},
        "9": {
            "class_type": "SaveImage",
            "inputs": {"images": ["8", 0], "filename_prefix": job.attempt_id},
        },
    }


def probe_png_bytes(data: bytes, expected_width: int, expected_height: int) -> tuple[int, int]:
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


def _request_json(base_url: str, path: str, payload: dict[str, object] | None = None) -> object:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        f"{base_url}{path}",
        data=data,
        headers={"content-type": "application/json"} if data else {},
    )
    try:
        with urlopen(request, timeout=30) as response:
            return json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError) as error:
        raise MageContractError("MAGE_COMFY_TRANSPORT_FAILED") from error


def _request_bytes(base_url: str, path: str) -> bytes:
    try:
        with urlopen(f"{base_url}{path}", timeout=120) as response:
            return response.read(16 * 1024 * 1024 + 1)
    except (HTTPError, URLError, TimeoutError) as error:
        raise MageContractError("MAGE_COMFY_OUTPUT_FETCH_FAILED") from error


def run_inline_job(
    job: MageInlineJob,
    _model_root: Path,
    *,
    base_url: str | None = None,
    cancel_requested: Callable[[], bool] = lambda: False,
) -> MageInlineResult:
    base = base_url or os.environ.get("MAGE_COMFY_URL", "http://127.0.0.1:8188")
    started = time.monotonic()
    queued = _request_json(base, "/prompt", {"prompt": build_workflow(job)})
    if not isinstance(queued, dict) or not isinstance(queued.get("prompt_id"), str):
        raise MageContractError("MAGE_COMFY_RESPONSE_INVALID")
    prompt_id = queued["prompt_id"]
    deadline = started + MAGE_TIMEOUT_SECONDS
    history: object = None
    while time.monotonic() < deadline:
        if cancel_requested():
            raise MageContractError("MAGE_INFERENCE_CANCELLED")
        observed = _request_json(base, f"/history/{prompt_id}")
        if isinstance(observed, dict) and prompt_id in observed:
            history = observed[prompt_id]
            break
        time.sleep(0.25)
    if history is None:
        raise MageContractError("MAGE_INFERENCE_TIMEOUT")
    if not isinstance(history, dict) or not isinstance(history.get("outputs"), dict):
        raise MageContractError("MAGE_COMFY_HISTORY_INVALID")
    images: list[dict[str, object]] = []
    for output in history["outputs"].values():
        if isinstance(output, dict) and isinstance(output.get("images"), list):
            images.extend(image for image in output["images"] if isinstance(image, dict))
    if len(images) != 1:
        raise MageContractError("MAGE_OUTPUT_COUNT_INVALID")
    image = images[0]
    if not all(isinstance(image.get(key), str) for key in ("filename", "subfolder", "type")):
        raise MageContractError("MAGE_COMFY_HISTORY_INVALID")
    query = urlencode(
        {"filename": image["filename"], "subfolder": image["subfolder"], "type": image["type"]}
    )
    output = _request_bytes(base, f"/view?{query}")
    item = job.items[0]
    width, height = probe_png_bytes(output, item.width, item.height)
    duration_ms = round((time.monotonic() - started) * 1000)
    result: MageInlineResult = {
        "schema_version": "videoforge.mage-image-result/v1",
        "attempt_id": job.attempt_id,
        "scene_id": item.scene_id,
        "output_sha256": "sha256:" + hashlib.sha256(output).hexdigest(),
        "bytes": len(output),
        "width": width,
        "height": height,
        "seed": item.seed,
        "positive_prompt_sha256": item.positive_prompt_sha256,
        "source_revision": MAGE_SOURCE_REVISION,
        "model_revision": job.model_revision,
        "renderer_source_profile": "mage-landscape-native-1280x720-v1",
        "generation_duration_ms": duration_ms,
        "output_base64": base64.b64encode(output).decode("ascii"),
    }
    return result

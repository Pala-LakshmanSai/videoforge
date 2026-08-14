from __future__ import annotations

import hashlib
from pathlib import Path

from echo_volume import (
    ECHO_FLASH_REVISION,
    ECHO_PRECISION,
    ECHO_PREPARED_ARTIFACT_MAX_BYTES,
    ECHO_PREPARED_STATE_PATH,
    ECHO_REQUIRED_SOURCE_FILES,
    ECHO_SOURCE_REVISION,
    ECHO_TORCH_VERSION,
    ECHO_TORCHAO_VERSION,
    ECHO_WAN_REVISION,
    canonical_json,
    sha256_file,
)


def require_fp8_preparation_device(torch: object) -> object:
    """Return the exact CUDA device required by TorchAO's FP8 transform."""
    cuda = getattr(torch, "cuda", None)
    if cuda is None or not cuda.is_available():
        raise RuntimeError("ECHO_PREPARATION_CUDA_REQUIRED")
    device = torch.device("cuda")
    major, minor = cuda.get_device_capability(device)
    if (major, minor) < (8, 9):
        raise RuntimeError("ECHO_PREPARATION_GPU_FP8_UNSUPPORTED")
    return device


def prepare_fp8_artifact(model_root: Path) -> dict[str, object]:
    """Create the owned, carded FP8 state during the authorized preparation Pod only."""
    try:
        import torch
        from omegaconf import OmegaConf
        from safetensors.torch import load_file
        from torchao.quantization import float8_dynamic_activation_float8_weight, quantize_
        from infer_flash import WanTransformer
    except Exception as error:
        raise RuntimeError("ECHO_PREPARATION_TOOLCHAIN_UNAVAILABLE") from error
    if str(torch.__version__).split("+")[0] != ECHO_TORCH_VERSION:
        raise RuntimeError("ECHO_PREPARATION_TORCH_MISMATCH")
    try:
        import torchao

        torchao_version = str(torchao.__version__)
    except Exception as error:
        raise RuntimeError("ECHO_PREPARATION_TORCHAO_UNAVAILABLE") from error
    if torchao_version != ECHO_TORCHAO_VERSION:
        raise RuntimeError("ECHO_PREPARATION_TORCHAO_MISMATCH")
    source_flash = model_root / ECHO_REQUIRED_SOURCE_FILES[0].path
    if sha256_file(source_flash) != ECHO_REQUIRED_SOURCE_FILES[0].sha256:
        raise RuntimeError("ECHO_PREPARATION_FLASH_HASH_MISMATCH")
    source_root = Path("/opt/echomimic_v3")
    config_path = source_root / "config/config.yaml"
    config = OmegaConf.load(config_path)
    base_root = model_root / "source/base"
    transformer = WanTransformer.from_pretrained(
        str(
            base_root
            / config["transformer_additional_kwargs"].get("transformer_subpath", "transformer")
        ),
        transformer_additional_kwargs=OmegaConf.to_container(
            config["transformer_additional_kwargs"]
        ),
        low_cpu_mem_usage=True,
        torch_dtype=torch.bfloat16,
    )
    state = load_file(str(source_flash), device="cpu")
    missing, unexpected = transformer.load_state_dict(state, strict=False)
    if unexpected:
        raise RuntimeError("ECHO_PREPARATION_FLASH_UNEXPECTED_KEYS")
    preparation_device = require_fp8_preparation_device(torch)
    transformer.to(device=preparation_device, dtype=torch.bfloat16)
    torch.cuda.synchronize(preparation_device)
    quantize_(transformer, float8_dynamic_activation_float8_weight())
    quantized_linear_count = sum(
        1
        for module in transformer.modules()
        if isinstance(module, torch.nn.Linear)
        and type(module.weight).__module__.startswith("torchao.")
    )
    if quantized_linear_count < 1:
        raise RuntimeError("ECHO_PREPARATION_QUANTIZATION_EMPTY")
    destination = model_root / ECHO_PREPARED_STATE_PATH
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = destination.with_suffix(".tmp")
    torch.save(transformer.state_dict(), temporary, _use_new_zipfile_serialization=True)
    if temporary.stat().st_size > ECHO_PREPARED_ARTIFACT_MAX_BYTES:
        raise RuntimeError("ECHO_PREPARATION_ARTIFACT_TOO_LARGE")
    verified = torch.load(temporary, map_location="cpu", weights_only=True)
    if not isinstance(verified, dict) or set(verified) != set(transformer.state_dict()):
        raise RuntimeError("ECHO_PREPARATION_WEIGHTS_ONLY_REOPEN_FAILED")
    temporary.replace(destination)
    report = {
        "schema_version": "videoforge.echo-flash-turbo-fp8-preparation/v1",
        "source_revision": ECHO_SOURCE_REVISION,
        "flash_revision": ECHO_FLASH_REVISION,
        "wan_revision": ECHO_WAN_REVISION,
        "source_flash_sha256": ECHO_REQUIRED_SOURCE_FILES[0].sha256,
        "precision": ECHO_PRECISION,
        "torch_version": ECHO_TORCH_VERSION,
        "torchao_version": ECHO_TORCHAO_VERSION,
        "serialization": "torch_state_dict_weights_only_v1",
        "load_policy": "weights_only_true",
        "quantized_linear_count": quantized_linear_count,
        "missing_source_keys": sorted(str(value) for value in missing),
        "unexpected_source_keys": [],
        "prepared_state_path": ECHO_PREPARED_STATE_PATH,
        "prepared_state_bytes": destination.stat().st_size,
        "prepared_state_sha256": sha256_file(destination),
        "first_request_quantization": False,
        "long_video_cfg": False,
    }
    report_path = model_root / "prepared/quantization.json"
    report_path.write_bytes(canonical_json(report) + b"\n")
    return report


def report_sha256(report: dict[str, object]) -> str:
    return hashlib.sha256(canonical_json(report)).hexdigest()

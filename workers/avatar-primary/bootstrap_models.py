from __future__ import annotations

import os
from pathlib import Path
from typing import Callable

from huggingface_hub import snapshot_download

MODEL_ROOT = Path(os.environ.get("AVATARFORCING_MODEL_ROOT", "/models"))


def fetch(
    repo_id: str,
    revision: str,
    destination: Path,
    allow_patterns: list[str],
) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=repo_id,
        revision=revision,
        local_dir=destination,
        local_dir_use_symlinks=False,
        allow_patterns=allow_patterns,
        max_workers=4,
    )


def bootstrap_models(progress: Callable[[str], None] = lambda _: None) -> None:
    progress("bootstrap_wan_started")
    fetch(
        "Wan-AI/Wan2.1-T2V-1.3B",
        "37ec512624d61f7aa208f7ea8140a131f93afc9a",
        MODEL_ROOT / "Wan2.1-T2V-1.3B",
        [
            "Wan2.1_VAE.pth",
            "config.json",
            "diffusion_pytorch_model.safetensors",
            "google/umt5-xxl/*",
            "models_t5_umt5-xxl-enc-bf16.pth",
        ],
    )
    progress("bootstrap_wan_complete")
    fetch(
        "facebook/wav2vec2-base-960h",
        "22aad52d435eb6dbaf354bdad9b0da84ce7d6156",
        MODEL_ROOT / "wav2vec2-base-960h",
        ["config.json", "model.safetensors", "preprocessor_config.json"],
    )
    progress("bootstrap_wav2vec_complete")
    fetch(
        "lycui/AvatarForcing",
        "e2448919a7b535c29f34e07892884ae1a43c6ace",
        MODEL_ROOT / "avatarforcing",
        ["model.pt", "ode_audio_init.pt"],
    )
    progress("bootstrap_avatarforcing_complete")

    root = Path(os.environ.get("AVATARFORCING_ROOT", "/opt/avatarforcing"))
    (root / "wan_models").mkdir(exist_ok=True)
    (root / "checkpoints").mkdir(exist_ok=True)
    for link, target in [
        (root / "wan_models" / "Wan2.1-T2V-1.3B", MODEL_ROOT / "Wan2.1-T2V-1.3B"),
        (root / "wan_models" / "wav2vec2-base-960h", MODEL_ROOT / "wav2vec2-base-960h"),
        (
            root / "checkpoints" / "ode_audio_init.pt",
            MODEL_ROOT / "avatarforcing" / "ode_audio_init.pt",
        ),
    ]:
        if link.is_symlink() or link.exists():
            link.unlink()
        link.symlink_to(target)
    for required in [
        MODEL_ROOT / "avatarforcing" / "model.pt",
        MODEL_ROOT / "avatarforcing" / "ode_audio_init.pt",
        MODEL_ROOT / "Wan2.1-T2V-1.3B" / "config.json",
        MODEL_ROOT / "wav2vec2-base-960h" / "config.json",
    ]:
        if not required.is_file():
            raise RuntimeError("AVATAR_BOOTSTRAP_INCOMPLETE")
    progress("bootstrap_complete")


if __name__ == "__main__":
    bootstrap_models()

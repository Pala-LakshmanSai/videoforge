from __future__ import annotations

import os
from pathlib import Path
from typing import Callable

from huggingface_hub import snapshot_download

MODEL_ID = "Skywork/SkyReels-V3-A2V-19B"
MODEL_REVISION = "fdad4053f492aba389b5a8c3c6982118c6a1ecf3"
MODEL_ROOT = Path(os.environ.get("SKYREELS_MODEL_ROOT", "/models/skyreels-v3-a2v-19b"))


def bootstrap_models(progress: Callable[[str], None] = lambda _: None) -> None:
    progress("bootstrap_skyreels_started")
    snapshot_download(
        repo_id=MODEL_ID,
        revision=MODEL_REVISION,
        local_dir=MODEL_ROOT,
        local_dir_use_symlinks=False,
        max_workers=4,
    )
    for required in [
        MODEL_ROOT / "config.json",
        MODEL_ROOT / "diffusion_pytorch_model.safetensors.index.json",
        MODEL_ROOT / "Wan2.1_VAE.pth",
    ]:
        if not required.is_file():
            raise RuntimeError("SKYREELS_BOOTSTRAP_INCOMPLETE")
    progress("bootstrap_skyreels_complete")


if __name__ == "__main__":
    bootstrap_models()

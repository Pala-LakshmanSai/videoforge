from __future__ import annotations

import os
from pathlib import Path

from huggingface_hub import snapshot_download

MODEL_ROOT = Path(os.environ.get("AVATARFORCING_MODEL_ROOT", "/models"))


def fetch(repo_id: str, revision: str, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=repo_id,
        revision=revision,
        local_dir=destination,
        local_dir_use_symlinks=False,
    )


fetch(
    "Wan-AI/Wan2.1-T2V-1.3B",
    "37ec512624d61f7aa208f7ea8140a131f93afc9a",
    MODEL_ROOT / "Wan2.1-T2V-1.3B",
)
fetch(
    "facebook/wav2vec2-base-960h",
    "22aad52d435eb6dbaf354bdad9b0da84ce7d6156",
    MODEL_ROOT / "wav2vec2-base-960h",
)
fetch(
    "lycui/AvatarForcing",
    "e2448919a7b535c29f34e07892884ae1a43c6ace",
    MODEL_ROOT / "avatarforcing",
)

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

"""RunPod queue entrypoint for the V2-08 SoulX Serverless candidate."""

from __future__ import annotations

import os
from pathlib import Path

from soulx_serverless import handler


_MODEL_MOUNT = Path("/runpod-volume")


def _decode_mount_path(value: str) -> str:
    """Decode the octal escapes used by Linux mountinfo paths."""

    return (
        value.replace(r"\040", " ")
        .replace(r"\011", "\t")
        .replace(r"\012", "\n")
        .replace(r"\134", "\\")
    )


def require_read_only_model_mount(mountinfo: Path = Path("/proc/self/mountinfo")) -> None:
    """Fail closed unless the sealed model volume is an exact read-only mount."""

    expected_root = Path(os.environ.get("SOULX_MODEL_ROOT", ""))
    if expected_root != _MODEL_MOUNT / "soulx-flashhead-pro":
        raise RuntimeError("SOULX_MODEL_ROOT_INVALID")

    for line in mountinfo.read_text(encoding="utf-8").splitlines():
        fields = line.split()
        if len(fields) < 7 or "-" not in fields:
            continue
        if _decode_mount_path(fields[4]) != str(_MODEL_MOUNT):
            continue
        mount_options = set(fields[5].split(","))
        if "ro" not in mount_options or "rw" in mount_options:
            raise RuntimeError("SOULX_MODEL_VOLUME_NOT_READ_ONLY")
        return
    raise RuntimeError("SOULX_MODEL_VOLUME_MOUNT_MISSING")


def main() -> None:
    require_read_only_model_mount()

    import runpod

    runpod.serverless.start({"handler": handler})


if __name__ == "__main__":
    main()

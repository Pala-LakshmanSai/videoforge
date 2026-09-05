"""RunPod queue entrypoint for the V2-08 SoulX Serverless candidate."""

from __future__ import annotations

import os
from pathlib import Path

from soulx_serverless import handler


_MODEL_MOUNT = Path("/runpod-volume")
_MODEL_ROOT = _MODEL_MOUNT / "soulx-flashhead-pro"
_WRITABLE_ROOT_ENVIRONMENTS = (
    "VIDEOFORGE_JOB_SCRATCH_ROOT",
    "HF_HOME",
    "TRANSFORMERS_CACHE",
    "DIFFUSERS_CACHE",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "TMPDIR",
)


def _decode_mount_path(value: str) -> str:
    """Decode the octal escapes used by Linux mountinfo paths."""

    return (
        value.replace(r"\040", " ")
        .replace(r"\011", "\t")
        .replace(r"\012", "\n")
        .replace(r"\134", "\\")
    )


def _is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def require_application_read_only_model_mount(
    mountinfo: Path = Path("/proc/self/mountinfo"),
) -> None:
    """Validate the exact mount and the application-enforced read-only policy.

    RunPod does not promise a kernel read-only network-volume mount. The worker therefore accepts
    either kernel mount mode, opens model bytes only through the sealed verifier/runtime, and keeps
    every writable scratch/cache/config/temp root outside the model volume.
    """

    expected_root = Path(os.environ.get("SOULX_MODEL_ROOT", ""))
    if expected_root != _MODEL_ROOT:
        raise RuntimeError("SOULX_MODEL_ROOT_INVALID")

    resolved_model_mount = _MODEL_MOUNT.resolve(strict=False)
    for environment in _WRITABLE_ROOT_ENVIRONMENTS:
        value = os.environ.get(environment, "")
        writable_root = Path(value)
        if (
            not value
            or not writable_root.is_absolute()
            or _is_within(writable_root, _MODEL_MOUNT)
            or _is_within(writable_root.resolve(strict=False), resolved_model_mount)
        ):
            raise RuntimeError(f"SOULX_WRITABLE_ROOT_INVALID:{environment}")

    for line in mountinfo.read_text(encoding="utf-8").splitlines():
        fields = line.split()
        if len(fields) < 7 or "-" not in fields:
            continue
        if _decode_mount_path(fields[4]) != str(_MODEL_MOUNT):
            continue
        return
    raise RuntimeError("SOULX_MODEL_VOLUME_MOUNT_MISSING")


def main() -> None:
    require_application_read_only_model_mount()

    import runpod

    runpod.serverless.start({"handler": handler})


if __name__ == "__main__":
    main()

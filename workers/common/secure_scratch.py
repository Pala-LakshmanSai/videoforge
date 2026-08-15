"""Fail-closed job scratch shared by the active Mage and SoulX lane wrappers."""

from __future__ import annotations

import os
import re
import shutil
import stat
from contextlib import AbstractContextManager
from pathlib import Path
from typing import Final

MODEL_VOLUME_MOUNT: Final = Path("/runpod-volume")
JOB_ID: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
TERMINAL_REASONS: Final = frozenset(
    {"SUCCESS", "FAILURE", "CANCEL", "TIMEOUT", "SIGNAL", "REFRESH"}
)


class ScratchIsolationError(RuntimeError):
    pass


def model_volume_policy(lane: str) -> dict[str, object]:
    if lane not in {"MAGE_IMAGE", "SOULX_AVATAR"}:
        raise ScratchIsolationError("SCRATCH_LANE_INVALID")
    return {
        "lane": lane,
        "mount": str(MODEL_VOLUME_MOUNT),
        "application_read_only": True,
        "mutable_cache_allowed": False,
        "cross_mount_allowed": False,
    }


class JobScratch(AbstractContextManager["JobScratch"]):
    """One attempt-owned local filesystem tree, never a model-volume child."""

    def __init__(self, root: Path, job_id: str, lane: str) -> None:
        if not JOB_ID.fullmatch(job_id):
            raise ScratchIsolationError("SCRATCH_JOB_ID_INVALID")
        model_volume_policy(lane)
        self.root = root.absolute()
        self.job_id = job_id
        self.lane = lane
        self.path = self.root / "jobs" / job_id
        self._device: int | None = None
        self._active = False
        self.cleanup_reason: str | None = None

    def __enter__(self) -> JobScratch:
        if self.root == MODEL_VOLUME_MOUNT or MODEL_VOLUME_MOUNT in self.root.parents:
            raise ScratchIsolationError("SCRATCH_ON_MODEL_VOLUME_FORBIDDEN")
        if self.root.exists() and self.root.is_symlink():
            raise ScratchIsolationError("SCRATCH_ROOT_SYMLINK_FORBIDDEN")
        self.path.mkdir(mode=0o700, parents=True, exist_ok=False)
        self.path = self.path.resolve(strict=True)
        os.chmod(self.path, 0o700)
        self._device = self.path.stat(follow_symlinks=False).st_dev
        self._active = True
        return self

    def environment(self) -> dict[str, str]:
        self._require_active()
        cache = self.safe_path("cache", directory=True)
        config = self.safe_path("config", directory=True)
        temporary = self.safe_path("tmp", directory=True)
        outputs = self.safe_path("outputs", directory=True)
        locks = self.safe_path("locks", directory=True)
        return {
            "HF_HOME": str(cache / "huggingface"),
            "TRANSFORMERS_CACHE": str(cache / "transformers"),
            "DIFFUSERS_CACHE": str(cache / "diffusers"),
            "XDG_CACHE_HOME": str(cache),
            "XDG_CONFIG_HOME": str(config),
            "TMPDIR": str(temporary),
            "TEMP": str(temporary),
            "TMP": str(temporary),
            "VIDEOFORGE_OUTPUT_ROOT": str(outputs),
            "VIDEOFORGE_LOCK_ROOT": str(locks),
        }

    def safe_path(self, relative: str, *, directory: bool = False) -> Path:
        self._require_active()
        candidate_relative = Path(relative)
        if candidate_relative.is_absolute() or ".." in candidate_relative.parts:
            raise ScratchIsolationError("SCRATCH_PATH_TRAVERSAL_FORBIDDEN")
        candidate = self.path.joinpath(candidate_relative)
        current = self.path
        for part in candidate_relative.parts:
            current = current / part
            if current.exists() or current.is_symlink():
                mode = current.lstat().st_mode
                if stat.S_ISLNK(mode):
                    raise ScratchIsolationError("SCRATCH_SYMLINK_FORBIDDEN")
                if current.stat(follow_symlinks=False).st_dev != self._device:
                    raise ScratchIsolationError("SCRATCH_CROSS_MOUNT_FORBIDDEN")
        resolved_parent = candidate.parent.resolve(strict=True)
        if resolved_parent != self.path and self.path not in resolved_parent.parents:
            raise ScratchIsolationError("SCRATCH_ESCAPE_FORBIDDEN")
        if directory:
            candidate.mkdir(mode=0o700, parents=True, exist_ok=True)
            if candidate.stat(follow_symlinks=False).st_dev != self._device:
                raise ScratchIsolationError("SCRATCH_CROSS_MOUNT_FORBIDDEN")
        return candidate

    def cleanup(self, reason: str) -> None:
        if reason not in TERMINAL_REASONS:
            raise ScratchIsolationError("SCRATCH_CLEANUP_REASON_INVALID")
        if self.path.exists() or self.path.is_symlink():
            if self.path.is_symlink():
                raise ScratchIsolationError("SCRATCH_ROOT_REPLACED_BY_SYMLINK")
            shutil.rmtree(self.path)
        self._active = False
        self.cleanup_reason = reason

    def _require_active(self) -> None:
        if not self._active:
            raise ScratchIsolationError("SCRATCH_NOT_ACTIVE")

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> bool:
        self.cleanup("SUCCESS" if exc_type is None else "FAILURE")
        return False


def cleanup_stale_jobs(root: Path) -> int:
    """Worker refresh cleanup; refuses links and removes only exact job children."""
    jobs = root.absolute() / "jobs"
    if not jobs.exists():
        return 0
    if jobs.is_symlink():
        raise ScratchIsolationError("SCRATCH_JOBS_SYMLINK_FORBIDDEN")
    removed = 0
    for child in jobs.iterdir():
        if child.is_symlink():
            child.unlink()
        elif child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
        removed += 1
    return removed

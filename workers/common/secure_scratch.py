"""Fail-closed job scratch shared by the active Mage and SoulX lane wrappers."""

from __future__ import annotations

import os
import re
import shutil
import stat
from collections.abc import Mapping
from contextlib import AbstractContextManager
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

MODEL_VOLUME_MOUNT: Final = Path("/runpod-volume")
JOB_ID: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
PORT_ID: Final = JOB_ID
PORT_CONTENT_TYPE: Final = re.compile(r"^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$")
PORT_CHECKSUM: Final = re.compile(r"^sha256:[0-9a-f]{64}$")
PORT_CAPABILITY: Final = re.compile(r"^[A-Za-z0-9._:-]{32,512}$")
TERMINAL_REASONS: Final = frozenset(
    {"SUCCESS", "FAILURE", "CANCEL", "TIMEOUT", "SIGNAL", "REFRESH"}
)


class ScratchIsolationError(RuntimeError):
    pass


def _canonical_local_root(root: Path) -> Path:
    absolute = root.absolute()
    resolved = absolute.resolve(strict=False)
    if absolute != resolved:
        raise ScratchIsolationError("SCRATCH_ANCESTOR_SYMLINK_FORBIDDEN")
    if resolved == MODEL_VOLUME_MOUNT or MODEL_VOLUME_MOUNT in resolved.parents:
        raise ScratchIsolationError("SCRATCH_ON_MODEL_VOLUME_FORBIDDEN")
    if resolved.exists() and (resolved.is_symlink() or not resolved.is_dir()):
        raise ScratchIsolationError("SCRATCH_ROOT_INVALID")
    return resolved


def _device_id(path: Path) -> int:
    return path.stat(follow_symlinks=False).st_dev


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


PORT_KEYS: Final = frozenset(
    {
        "schema_version",
        "reservation_id",
        "account_id",
        "workspace_id",
        "method",
        "path",
        "content_type",
        "content_length",
        "checksum_sha256",
        "expires_at",
        "max_uses",
        "capability_handle",
    }
)


def validate_scoped_port(
    port: Mapping[str, object],
    *,
    account_id: str,
    workspace_id: str,
    job_id: str,
    method: str,
    now: datetime,
) -> None:
    if set(port) != PORT_KEYS or port.get("schema_version") != "artifact-transfer-port/v3":
        raise ScratchIsolationError("WORKER_ARTIFACT_PORT_INVALID")
    if port.get("account_id") != account_id or port.get("workspace_id") != workspace_id:
        raise ScratchIsolationError("WORKER_ARTIFACT_SCOPE_MISMATCH")
    if port.get("method") != method:
        raise ScratchIsolationError("WORKER_ARTIFACT_METHOD_MISMATCH")
    if not isinstance(port.get("reservation_id"), str) or not PORT_ID.fullmatch(
        port["reservation_id"]
    ):
        raise ScratchIsolationError("WORKER_ARTIFACT_PORT_INVALID")
    if not isinstance(port.get("content_type"), str) or not PORT_CONTENT_TYPE.fullmatch(
        port["content_type"]
    ):
        raise ScratchIsolationError("WORKER_ARTIFACT_PORT_INVALID")
    content_length = port.get("content_length")
    if (
        not isinstance(content_length, int)
        or isinstance(content_length, bool)
        or not 0 <= content_length <= 10_737_418_240
    ):
        raise ScratchIsolationError("WORKER_ARTIFACT_PORT_INVALID")
    if not isinstance(port.get("checksum_sha256"), str) or not PORT_CHECKSUM.fullmatch(
        port["checksum_sha256"]
    ):
        raise ScratchIsolationError("WORKER_ARTIFACT_PORT_INVALID")
    max_uses = port.get("max_uses")
    if not isinstance(max_uses, int) or isinstance(max_uses, bool) or not 1 <= max_uses <= 3:
        raise ScratchIsolationError("WORKER_ARTIFACT_PORT_INVALID")
    if not isinstance(port.get("capability_handle"), str) or not PORT_CAPABILITY.fullmatch(
        port["capability_handle"]
    ):
        raise ScratchIsolationError("WORKER_ARTIFACT_PORT_INVALID")
    path = port.get("path")
    expected_prefix = f"/tenant/{account_id}/workspace/{workspace_id}/"
    if (
        not isinstance(path, str)
        or not path.startswith(expected_prefix)
        or f"/job/{job_id}/" not in path
    ):
        raise ScratchIsolationError("WORKER_ARTIFACT_PATH_MISMATCH")
    if "?" in path or "/../" in path:
        raise ScratchIsolationError("WORKER_ARTIFACT_PATH_MISMATCH")
    try:
        expires_at = datetime.fromisoformat(str(port["expires_at"]).replace("Z", "+00:00"))
    except (KeyError, ValueError):
        raise ScratchIsolationError("WORKER_ARTIFACT_EXPIRY_INVALID") from None
    if expires_at.tzinfo is None or now.astimezone(UTC) >= expires_at.astimezone(UTC):
        raise ScratchIsolationError("WORKER_ARTIFACT_PORT_EXPIRED")


class ScopedWorkerIO(AbstractContextManager["ScopedWorkerIO"]):
    """Provider-neutral worker I/O: exact ports plus one lane/job scratch tree only."""

    def __init__(
        self,
        *,
        lane: str,
        root: Path,
        account_id: str,
        workspace_id: str,
        job_id: str,
        input_ports: tuple[Mapping[str, object], ...],
        output_ports: tuple[Mapping[str, object], ...],
        now: datetime,
    ) -> None:
        for port in input_ports:
            validate_scoped_port(
                port,
                account_id=account_id,
                workspace_id=workspace_id,
                job_id=job_id,
                method="GET",
                now=now,
            )
        for port in output_ports:
            validate_scoped_port(
                port,
                account_id=account_id,
                workspace_id=workspace_id,
                job_id=job_id,
                method="PUT",
                now=now,
            )
        self.input_ports = input_ports
        self.output_ports = output_ports
        self.scratch = JobScratch(root, job_id, lane)

    def __enter__(self) -> ScopedWorkerIO:
        self.scratch.__enter__()
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> bool:
        return self.scratch.__exit__(exc_type, exc, traceback)

    def environment(self) -> dict[str, str]:
        return self.scratch.environment()


def mage_worker_io(**kwargs: object) -> ScopedWorkerIO:
    return ScopedWorkerIO(lane="MAGE_IMAGE", **kwargs)  # type: ignore[arg-type]


def soulx_worker_io(**kwargs: object) -> ScopedWorkerIO:
    return ScopedWorkerIO(lane="SOULX_AVATAR", **kwargs)  # type: ignore[arg-type]


class JobScratch(AbstractContextManager["JobScratch"]):
    """One attempt-owned local filesystem tree, never a model-volume child."""

    def __init__(self, root: Path, job_id: str, lane: str) -> None:
        if not JOB_ID.fullmatch(job_id):
            raise ScratchIsolationError("SCRATCH_JOB_ID_INVALID")
        model_volume_policy(lane)
        self.root = _canonical_local_root(root)
        self.job_id = job_id
        self.lane = lane
        self.path = self.root / "jobs" / job_id
        self._device: int | None = None
        self._active = False
        self.cleanup_reason: str | None = None

    def __enter__(self) -> JobScratch:
        self.path.mkdir(mode=0o700, parents=True, exist_ok=False)
        self.path = self.path.resolve(strict=True)
        os.chmod(self.path, 0o700)
        self._device = _device_id(self.path)
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
                if _device_id(current) != self._device:
                    raise ScratchIsolationError("SCRATCH_CROSS_MOUNT_FORBIDDEN")
        resolved_parent = candidate.parent.resolve(strict=True)
        if resolved_parent != self.path and self.path not in resolved_parent.parents:
            raise ScratchIsolationError("SCRATCH_ESCAPE_FORBIDDEN")
        if directory:
            candidate.mkdir(mode=0o700, parents=True, exist_ok=True)
            if _device_id(candidate) != self._device:
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
    canonical_root = _canonical_local_root(root)
    jobs = canonical_root / "jobs"
    if not jobs.exists():
        return 0
    if jobs.is_symlink():
        raise ScratchIsolationError("SCRATCH_JOBS_SYMLINK_FORBIDDEN")
    removed = 0
    for child in jobs.iterdir():
        if child.is_symlink():
            child.unlink()
        elif child.is_dir():
            if _device_id(child) != _device_id(jobs):
                raise ScratchIsolationError("SCRATCH_CROSS_MOUNT_FORBIDDEN")
            shutil.rmtree(child)
        else:
            child.unlink()
        removed += 1
    return removed

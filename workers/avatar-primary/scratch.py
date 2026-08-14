from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path

from span_contract import EchoSpanJob


@dataclass(slots=True)
class EchoScratch:
    root: Path

    def cleanup(self) -> None:
        if self.root.exists():
            shutil.rmtree(self.root)


def create_scratch(job: EchoSpanJob, *, scratch_root: Path, model_root: Path) -> EchoScratch:
    scratch_root = scratch_root.resolve()
    model_root = model_root.resolve()
    if scratch_root == model_root or scratch_root.is_relative_to(model_root):
        raise ValueError("ECHO_SCRATCH_CROSS_MOUNT_FORBIDDEN")
    scratch_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if scratch_root.is_symlink():
        raise ValueError("ECHO_SCRATCH_ROOT_INVALID")
    task_root = scratch_root / job.project_revision_id / job.span_id / job.attempt_id
    task_root.mkdir(parents=True, exist_ok=False, mode=0o700)
    resolved = task_root.resolve()
    if not resolved.is_relative_to(scratch_root) or resolved.is_relative_to(model_root):
        raise ValueError("ECHO_SCRATCH_PATH_INVALID")
    os.chmod(task_root, 0o700)
    return EchoScratch(task_root)

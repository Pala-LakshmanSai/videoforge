"""Cloud-only observations; the shared desktop CLI remains default-off."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

from .cli import main

PHASE_FILENAME = "cloud-render-phase.json"


def render_observer(root: Path, attempt_id: str):
    destination = root / PHASE_FILENAME
    temporary = root / (PHASE_FILENAME + ".tmp")
    started: int | None = None

    def observe(phase: str, duration_ms: int | None) -> None:
        nonlocal started
        if phase == "CHECKING_VIDEO" and duration_ms is None and started is None:
            started = time.monotonic_ns()
            sequence = 1
        elif (phase == "TECHNICAL_VERIFICATION_COMPLETE" and started is not None
              and type(duration_ms) is int and 0 <= duration_ms <= 14_400_000):
            sequence = 2
        else:
            raise ValueError("Cloud render observation is invalid")
        value = {"schema_version": "videoforge-cloud-render-phase/v1", "attempt_id": attempt_id,
                 "phase": phase, "sequence": sequence, "started_monotonic_ns": started,
                 "technical_verification_ms": duration_ms}
        # The job root is fresh and owned. Never follow an existing temporary symlink.
        with temporary.open("xb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(json.dumps(value, separators=(",", ":")).encode("utf-8"))
        os.replace(temporary, destination)

    return observe


if __name__ == "__main__":
    raise SystemExit(main(render_observer_factory=render_observer))

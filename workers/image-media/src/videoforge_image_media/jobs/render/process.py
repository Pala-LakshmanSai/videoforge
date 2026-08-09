from __future__ import annotations

import subprocess
from collections.abc import Callable, Sequence

from .ports import ProcessResult


class SubprocessRunner:
    """Execute trusted tool paths with argument arrays and cooperative cancellation."""

    def __init__(self, poll_interval_seconds: float = 0.1) -> None:
        if poll_interval_seconds <= 0:
            raise ValueError("poll_interval_seconds must be positive")
        self._poll_interval_seconds = poll_interval_seconds

    def run(
        self,
        arguments: Sequence[str],
        *,
        should_cancel: Callable[[], bool],
    ) -> ProcessResult:
        if not arguments:
            return ProcessResult(return_code=-1, launch_error="failed")

        try:
            process = subprocess.Popen(  # noqa: S603 - executable comes from the trusted tool port
                list(arguments),
                shell=False,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except FileNotFoundError:
            return ProcessResult(return_code=-1, launch_error="missing")
        except OSError:
            return ProcessResult(return_code=-1, launch_error="failed")

        while True:
            if should_cancel():
                process.terminate()
                try:
                    stdout, stderr = process.communicate(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    stdout, stderr = process.communicate()
                return ProcessResult(
                    return_code=process.returncode if process.returncode is not None else -1,
                    stdout=stdout,
                    stderr=stderr,
                    cancelled=True,
                )

            try:
                stdout, stderr = process.communicate(timeout=self._poll_interval_seconds)
                return ProcessResult(
                    return_code=process.returncode if process.returncode is not None else -1,
                    stdout=stdout,
                    stderr=stderr,
                )
            except subprocess.TimeoutExpired:
                continue

from __future__ import annotations

import os
import signal
import subprocess
from collections.abc import Callable, Sequence

from .ports import ProcessResult

_FORCE_KILL = getattr(signal, "SIGKILL", signal.SIGTERM)
_MINIMAL_ENVIRONMENT = {
    "LANG": "C",
    "LC_ALL": "C",
    "PATH": os.defpath,
}


class SubprocessRunner:
    """Run one argument-array command and terminate it cooperatively on cancellation."""

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
            process = subprocess.Popen(  # noqa: S603 - executable is supplied by a trusted tool port
                list(arguments),
                shell=False,
                start_new_session=os.name == "posix",
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=_MINIMAL_ENVIRONMENT,
            )
        except FileNotFoundError:
            return ProcessResult(return_code=-1, launch_error="missing")
        except OSError:
            return ProcessResult(return_code=-1, launch_error="failed")

        while True:
            if should_cancel():
                _signal_process_group(process, signal.SIGTERM)
                try:
                    stdout, stderr = process.communicate(timeout=2)
                except subprocess.TimeoutExpired:
                    _signal_process_group(process, _FORCE_KILL)
                    stdout, stderr = process.communicate()
                return ProcessResult(
                    return_code=process.returncode if process.returncode is not None else -1,
                    stdout=_bounded(stdout),
                    stderr=_bounded(stderr),
                    cancelled=True,
                )

            try:
                stdout, stderr = process.communicate(timeout=self._poll_interval_seconds)
                return ProcessResult(
                    return_code=process.returncode if process.returncode is not None else -1,
                    stdout=_bounded(stdout),
                    stderr=_bounded(stderr),
                )
            except subprocess.TimeoutExpired:
                continue


def _signal_process_group(process: subprocess.Popen[str], requested_signal: int) -> None:
    try:
        if os.name == "posix":
            os.killpg(process.pid, requested_signal)
        elif requested_signal == signal.SIGTERM:
            process.terminate()
        else:
            process.kill()
    except ProcessLookupError:
        return


def _bounded(value: str, limit: int = 16_384) -> str:
    return value[:limit]

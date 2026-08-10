from __future__ import annotations

import subprocess
from collections.abc import Callable, Sequence

from .ports import ProcessResult


class SubprocessRunner:
    """Run trusted absolute executables with an argument vector and bounded polling."""

    def run(
        self,
        arguments: Sequence[str],
        *,
        should_cancel: Callable[[], bool],
    ) -> ProcessResult:
        if isinstance(arguments, str):
            raise TypeError("span audio commands must be argument arrays")
        try:
            process = subprocess.Popen(  # noqa: S603 - absolute trusted executable is injected
                list(arguments),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        except FileNotFoundError:
            return ProcessResult(return_code=-1, launch_error="missing")
        except OSError:
            return ProcessResult(return_code=-1, launch_error="failed")

        while process.poll() is None:
            if should_cancel():
                process.terminate()
                try:
                    stdout, stderr = process.communicate(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    stdout, stderr = process.communicate()
                return ProcessResult(
                    return_code=process.returncode or -15,
                    stdout=stdout,
                    stderr=stderr,
                    cancelled=True,
                )
            try:
                stdout, stderr = process.communicate(timeout=0.05)
                return ProcessResult(process.returncode or 0, stdout, stderr)
            except subprocess.TimeoutExpired:
                continue
        stdout, stderr = process.communicate()
        return ProcessResult(process.returncode or 0, stdout, stderr)

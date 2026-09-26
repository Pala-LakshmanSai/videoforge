from __future__ import annotations

import os
import subprocess
import threading
from collections.abc import Callable, Sequence
from contextlib import contextmanager, nullcontext
from pathlib import Path
from typing import Iterator

from videoforge_image_media.subprocess_options import background_creationflags

try:
    import resource
except ImportError:  # pragma: no cover - resource is unavailable on Windows
    resource = None  # type: ignore[assignment]

from .ports import ProcessResult

_FILE_DESCRIPTOR_LIMIT_LOCK = threading.Lock()


class _FileDescriptorLimitError(Exception):
    pass


@contextmanager
def _temporary_file_descriptor_limit(limit: int) -> Iterator[None]:
    """Raise the child limit during spawn without changing the worker permanently."""

    if os.name != "posix" or resource is None:
        if os.name != "posix":
            yield
            return
        raise _FileDescriptorLimitError

    with _FILE_DESCRIPTOR_LIMIT_LOCK:
        try:
            soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
            if hard < limit:
                raise _FileDescriptorLimitError
            if soft >= limit:
                yield
                return
            resource.setrlimit(resource.RLIMIT_NOFILE, (limit, hard))
        except (OSError, ValueError) as error:
            raise _FileDescriptorLimitError from error
        try:
            yield
        finally:
            # A failed restore must not mask a successfully spawned child. The
            # raised worker limit is safe and still prevents the original class
            # of render failure.
            try:
                resource.setrlimit(resource.RLIMIT_NOFILE, (soft, hard))
            except (OSError, ValueError):
                pass


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
        cwd: Path | None = None,
        file_descriptor_limit: int | None = None,
    ) -> ProcessResult:
        if not arguments:
            return ProcessResult(return_code=-1, launch_error="failed")

        try:
            spawn_context = (
                _temporary_file_descriptor_limit(file_descriptor_limit)
                if file_descriptor_limit
                else nullcontext()
            )
            with spawn_context:
                process = subprocess.Popen(  # noqa: S603 - executable comes from the trusted tool port
                    list(arguments),
                    shell=False,
                    creationflags=background_creationflags(),
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    cwd=cwd,
                )
        except _FileDescriptorLimitError:
            return ProcessResult(return_code=-1, launch_error="resource_limit")
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

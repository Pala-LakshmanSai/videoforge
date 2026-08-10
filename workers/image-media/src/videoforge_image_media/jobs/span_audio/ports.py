from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class ProcessResult:
    return_code: int
    stdout: str = ""
    stderr: str = ""
    cancelled: bool = False
    launch_error: str | None = None


class ArtifactResolver(Protocol):
    def resolve_object(self, uri: str) -> Path: ...

    def resolve_run(self, uri: str) -> Path: ...

    def publish_object(self, source: Path, sha256: str, extension: str) -> str: ...


class ProcessRunner(Protocol):
    def run(
        self,
        arguments: Sequence[str],
        *,
        should_cancel: Callable[[], bool],
    ) -> ProcessResult: ...


class CancellationProbe(Protocol):
    def is_cancelled(self, token: str) -> bool: ...


class NeverCancelled:
    def is_cancelled(self, token: str) -> bool:
        del token
        return False

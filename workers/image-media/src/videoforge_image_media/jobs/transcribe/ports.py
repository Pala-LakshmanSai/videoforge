from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

DiagnosticValue = str | int | bool
LaunchError = Literal["missing", "failed"]


@dataclass(frozen=True)
class WhisperTool:
    executable: Path
    model: Path
    version: str
    ffmpeg: Path
    ffprobe: Path


@dataclass(frozen=True)
class ProcessResult:
    return_code: int
    stdout: str = ""
    stderr: str = ""
    cancelled: bool = False
    launch_error: LaunchError | None = None


class ArtifactResolver(Protocol):
    """Resolve already-validated local artifact URIs inside an allocated safe root."""

    def resolve_object(self, uri: str) -> Path: ...

    def resolve_run(self, uri: str) -> Path: ...


class WhisperToolResolver(Protocol):
    """Return pinned local tool/model paths without downloading either artifact."""

    def resolve(self, engine: str, model_name: str) -> WhisperTool: ...


class ProcessRunner(Protocol):
    def run(
        self,
        arguments: Sequence[str],
        *,
        should_cancel: Callable[[], bool],
    ) -> ProcessResult: ...


class CancellationProbe(Protocol):
    def is_cancelled(self, token: str) -> bool: ...


class DiagnosticSink(Protocol):
    """Receive only allow-listed metadata; commands, paths, stderr, and tokens are forbidden."""

    def record(self, event: str, fields: Mapping[str, DiagnosticValue]) -> None: ...


class NeverCancelled:
    def is_cancelled(self, token: str) -> bool:
        del token
        return False


class NullDiagnosticSink:
    def record(self, event: str, fields: Mapping[str, DiagnosticValue]) -> None:
        del event, fields

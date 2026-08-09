from __future__ import annotations

import hashlib
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

LaunchError = Literal["missing", "failed"]


@dataclass(frozen=True)
class RenderTools:
    ffmpeg: Path
    ffprobe: Path
    ffmpeg_version: str
    ffprobe_version: str


@dataclass(frozen=True)
class ProcessResult:
    return_code: int
    stdout: str = ""
    stderr: str = ""
    cancelled: bool = False
    launch_error: LaunchError | None = None


class ArtifactResolver(Protocol):
    """Resolve validated local URIs without exposing an ambient filesystem root."""

    def resolve_object(self, uri: str) -> Path: ...

    def resolve_run(self, uri: str) -> Path: ...

    def publish_object(self, source: Path, sha256: str, extension: str) -> str: ...


class ArtifactIO(Protocol):
    def exists(self, path: Path) -> bool: ...

    def read_bytes(self, path: Path) -> bytes: ...

    def size(self, path: Path) -> int: ...

    def sha256(self, path: Path) -> str: ...


class ToolResolver(Protocol):
    def resolve(self) -> RenderTools: ...


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


class LocalArtifactIO:
    """Streaming local byte operations for paths already authorized by the resolver."""

    def exists(self, path: Path) -> bool:
        return path.is_file()

    def read_bytes(self, path: Path) -> bytes:
        return path.read_bytes()

    def size(self, path: Path) -> int:
        return path.stat().st_size

    def sha256(self, path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return f"sha256:{digest.hexdigest()}"

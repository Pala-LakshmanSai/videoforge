from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import sys
import uuid
from pathlib import Path
from typing import Any

from .jobs.render import (
    LocalArtifactIO,
    RenderJob,
    RenderJobDependencies,
    RenderTools,
    SubprocessRunner as RenderSubprocessRunner,
)
from .jobs.span_audio import (
    SpanAudioMaterializationJob,
    SubprocessRunner as SpanAudioSubprocessRunner,
)
from .jobs.transcribe import (
    SubprocessRunner as TranscribeSubprocessRunner,
    TranscriptionJob,
    WhisperTool,
)

_OBJECT_URI = re.compile(
    r"^vf-local://objects/sha256/(?P<prefix>[0-9a-f]{2})/"
    r"(?P<digest>[0-9a-f]{64})\.(?P<extension>[a-z0-9]{1,10})$"
)
_RUN_URI = re.compile(
    r"^vf-local-run://(?P<revision>[A-Za-z0-9][A-Za-z0-9._:-]{0,159})/"
    r"(?P<attempt>[A-Za-z0-9][A-Za-z0-9._:-]{0,159})/"
    r"(?P<filename>[A-Za-z0-9][A-Za-z0-9._-]{0,159})$"
)
_SHA256 = re.compile(r"^sha256:(?P<digest>[0-9a-f]{64})$")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


class LocalArtifactResolver:
    """Resolve only canonical VideoForge URIs below one explicit non-symlink artifact root."""

    def __init__(self, root: Path) -> None:
        if not root.is_absolute():
            raise ValueError("artifact root must be absolute")
        root.mkdir(parents=True, exist_ok=True)
        if root.is_symlink() or not root.is_dir():
            raise ValueError("artifact root must be a real directory")
        self.root = root.resolve(strict=True)
        if self.root == Path(self.root.anchor):
            raise ValueError("filesystem root is not a valid artifact root")

    def _inside(self, candidate: Path, *, must_exist: bool) -> Path:
        resolved = candidate.resolve(strict=must_exist)
        if not resolved.is_relative_to(self.root):
            raise ValueError("artifact path escaped its root")
        if candidate.is_symlink():
            raise ValueError("artifact paths may not be symbolic links")
        return resolved

    def _ensure_directory(self, *segments: str) -> Path:
        """Create one real directory at a time without traversing an existing symlink."""

        if (
            hasattr(os, "O_DIRECTORY")
            and hasattr(os, "O_NOFOLLOW")
            and os.open in os.supports_dir_fd
            and os.mkdir in os.supports_dir_fd
        ):
            return self._ensure_directory_from_handle(*segments)

        current = self.root
        for segment in segments:
            candidate = current / segment
            try:
                information = candidate.lstat()
            except FileNotFoundError:
                try:
                    candidate.mkdir(mode=0o700)
                except FileExistsError:
                    # Another local process may have created the entry. Inspect it below.
                    pass
                information = candidate.lstat()
            if stat.S_ISLNK(information.st_mode) or not stat.S_ISDIR(information.st_mode):
                raise ValueError("artifact directory components must be real directories")
            current = self._inside(candidate, must_exist=True)
        return current

    def _ensure_directory_from_handle(self, *segments: str) -> Path:
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        current_fd = os.open(self.root, flags)
        current = self.root
        try:
            for segment in segments:
                try:
                    os.mkdir(segment, mode=0o700, dir_fd=current_fd)
                except FileExistsError:
                    pass
                try:
                    next_fd = os.open(segment, flags, dir_fd=current_fd)
                except OSError as error:
                    raise ValueError(
                        "artifact directory components must be real directories"
                    ) from error
                information = os.fstat(next_fd)
                if not stat.S_ISDIR(information.st_mode):
                    os.close(next_fd)
                    raise ValueError("artifact directory components must be real directories")
                os.close(current_fd)
                current_fd = next_fd
                current /= segment
            return self._inside(current, must_exist=True)
        finally:
            os.close(current_fd)

    def resolve_object(self, uri: str) -> Path:
        match = _OBJECT_URI.fullmatch(uri)
        if match is None or match.group("prefix") != match.group("digest")[:2]:
            raise ValueError("invalid content-addressed object URI")
        candidate = (
            self.root
            / "objects"
            / "sha256"
            / match.group("prefix")
            / f"{match.group('digest')}.{match.group('extension')}"
        )
        resolved = self._inside(candidate, must_exist=True)
        if not resolved.is_file():
            raise FileNotFoundError("object URI does not resolve to a regular file")
        return resolved

    def resolve_run(self, uri: str) -> Path:
        match = _RUN_URI.fullmatch(uri)
        if match is None:
            raise ValueError("invalid run artifact URI")
        safe_parent = self._ensure_directory(
            "runs", match.group("revision"), match.group("attempt")
        )
        candidate = safe_parent / match.group("filename")
        if candidate.exists() or candidate.is_symlink():
            return self._inside(candidate, must_exist=True)
        return candidate

    def publish_object(self, source: Path, sha256: str, extension: str) -> str:
        digest_match = _SHA256.fullmatch(sha256)
        if digest_match is None or re.fullmatch(r"[a-z0-9]{1,10}", extension) is None:
            raise ValueError("invalid immutable object facts")
        safe_source = self._inside(source, must_exist=True)
        if not safe_source.is_file() or _sha256(safe_source) != sha256:
            raise ValueError("published object bytes do not match their SHA-256")
        digest = digest_match.group("digest")
        safe_parent = self._ensure_directory("objects", "sha256", digest[:2])
        destination = safe_parent / f"{digest}.{extension}"
        uri = f"vf-local://objects/sha256/{digest[:2]}/{digest}.{extension}"
        if destination.exists():
            if destination.is_symlink() or _sha256(destination) != sha256:
                raise ValueError("immutable object destination conflicts with existing bytes")
            return uri

        temporary = safe_parent / f".{digest}.{uuid.uuid4().hex}.tmp"
        try:
            with safe_source.open("rb") as reader, temporary.open("xb") as writer:
                shutil.copyfileobj(reader, writer, length=1024 * 1024)
                writer.flush()
                os.fsync(writer.fileno())
            try:
                os.link(temporary, destination)
            except FileExistsError:
                if destination.is_symlink() or _sha256(destination) != sha256:
                    raise ValueError("immutable object publication collided") from None
        finally:
            temporary.unlink(missing_ok=True)
        return uri


class LocalWhisperTools:
    def __init__(self, tool: WhisperTool) -> None:
        self._tool = tool

    def resolve(self, engine: str, model_name: str) -> WhisperTool:
        if engine != "whisper.cpp" or model_name != "base.en":
            raise ValueError("unsupported local ASR tool request")
        return self._tool


class LocalRenderTools:
    def __init__(self, tools: RenderTools) -> None:
        self._tools = tools

    def resolve(self) -> RenderTools:
        return self._tools


def cancellation_marker(root: Path, token: str) -> Path:
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return root / "cancellations" / f"{digest}.cancel"


class FileCancellationProbe:
    def __init__(self, root: Path) -> None:
        self._root = root

    def is_cancelled(self, token: str) -> bool:
        return cancellation_marker(self._root, token).is_file()


def _read_input(path: Path, root: Path) -> dict[str, Any]:
    if not path.is_absolute() or path.is_symlink():
        raise ValueError("input path must be an absolute regular file")
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise ValueError("input path must stay inside the artifact root")

    def reject_constant(value: str) -> None:
        raise ValueError(f"non-finite JSON constant {value}")

    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate JSON property {key}")
            result[key] = value
        return result

    parsed = json.loads(
        resolved.read_text(encoding="utf-8"),
        object_pairs_hook=reject_duplicates,
        parse_constant=reject_constant,
    )
    if not isinstance(parsed, dict):
        raise ValueError("job input must be a JSON object")
    return parsed


def _absolute_tool(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        raise ValueError("tool paths must be absolute existing regular files")
    resolved = path.resolve(strict=True)
    if not resolved.is_file():
        raise ValueError("tool paths must be absolute existing regular files")
    return resolved


def _transcribe(arguments: argparse.Namespace, resolver: LocalArtifactResolver) -> dict[str, Any]:
    document = _read_input(Path(arguments.input), resolver.root)
    tool = WhisperTool(
        executable=_absolute_tool(arguments.whisper),
        model=_absolute_tool(arguments.model),
        version=arguments.whisper_version,
        ffmpeg=_absolute_tool(arguments.ffmpeg),
        ffprobe=_absolute_tool(arguments.ffprobe),
    )
    return TranscriptionJob(
        artifacts=resolver,
        tools=LocalWhisperTools(tool),
        processes=TranscribeSubprocessRunner(),
        cancellation=FileCancellationProbe(resolver.root),
    ).run(document)


def _render(arguments: argparse.Namespace, resolver: LocalArtifactResolver) -> dict[str, Any]:
    document = _read_input(Path(arguments.input), resolver.root)
    tools = RenderTools(
        ffmpeg=_absolute_tool(arguments.ffmpeg),
        ffprobe=_absolute_tool(arguments.ffprobe),
        ffmpeg_version=arguments.ffmpeg_version,
        ffprobe_version=arguments.ffprobe_version,
    )
    return RenderJob(
        RenderJobDependencies(
            resolver=resolver,
            artifacts=LocalArtifactIO(),
            tools=LocalRenderTools(tools),
            process=RenderSubprocessRunner(),
            cancellation=FileCancellationProbe(resolver.root),
        )
    ).run(document, claimed_attempt_id=arguments.claimed_attempt_id)


def _materialize_span(
    arguments: argparse.Namespace, resolver: LocalArtifactResolver
) -> dict[str, Any]:
    document = _read_input(Path(arguments.input), resolver.root)
    return SpanAudioMaterializationJob(
        artifacts=resolver,
        process=SpanAudioSubprocessRunner(),
        ffmpeg=_absolute_tool(arguments.ffmpeg),
        ffprobe=_absolute_tool(arguments.ffprobe),
        cancellation=FileCancellationProbe(resolver.root),
    ).run(document)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="VideoForge provider-free local media job bridge")
    subparsers = parser.add_subparsers(dest="command", required=True)

    transcribe = subparsers.add_parser("transcribe")
    transcribe.add_argument("--artifact-root", required=True)
    transcribe.add_argument("--input", required=True)
    transcribe.add_argument("--whisper", required=True)
    transcribe.add_argument("--model", required=True)
    transcribe.add_argument("--whisper-version", required=True)
    transcribe.add_argument("--ffmpeg", required=True)
    transcribe.add_argument("--ffprobe", required=True)

    materialize_span = subparsers.add_parser("materialize-span")
    materialize_span.add_argument("--artifact-root", required=True)
    materialize_span.add_argument("--input", required=True)
    materialize_span.add_argument("--ffmpeg", required=True)
    materialize_span.add_argument("--ffprobe", required=True)

    render = subparsers.add_parser("render")
    render.add_argument("--artifact-root", required=True)
    render.add_argument("--input", required=True)
    render.add_argument("--claimed-attempt-id", required=True)
    render.add_argument("--ffmpeg", required=True)
    render.add_argument("--ffprobe", required=True)
    render.add_argument("--ffmpeg-version", required=True)
    render.add_argument("--ffprobe-version", required=True)
    return parser


def main() -> int:
    arguments = _parser().parse_args()
    try:
        resolver = LocalArtifactResolver(Path(arguments.artifact_root))
        if arguments.command == "transcribe":
            result = _transcribe(arguments, resolver)
        elif arguments.command == "materialize-span":
            result = _materialize_span(arguments, resolver)
        else:
            result = _render(arguments, resolver)
    except (OSError, TypeError, ValueError):
        print("Local media bridge rejected its trusted configuration.", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

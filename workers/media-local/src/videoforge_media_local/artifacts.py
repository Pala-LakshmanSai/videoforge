from __future__ import annotations

import hashlib
import os
import re
import shutil
import stat
import uuid
from pathlib import Path

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


class R2PortFixtureArtifactResolver:
    """Filesystem double for the future private R2 object/run prefix port."""

    def __init__(self, root: Path, bucket: str = "videoforge-private-fixture") -> None:
        if not root.is_absolute() or not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,62}", bucket):
            raise ValueError("R2 fixture root or bucket is invalid")
        root.mkdir(parents=True, exist_ok=True)
        if root.is_symlink() or not root.is_dir():
            raise ValueError("R2 fixture root must be a real directory")
        self.root = root.resolve(strict=True)
        if self.root == Path(self.root.anchor):
            raise ValueError("filesystem root is not a valid R2 fixture root")
        self.bucket = bucket

    def _inside(self, candidate: Path, *, must_exist: bool) -> Path:
        resolved = candidate.resolve(strict=must_exist)
        if not resolved.is_relative_to(self.root) or candidate.is_symlink():
            raise ValueError("R2 fixture key escaped its private root")
        return resolved

    def _ensure_directory(self, *segments: str) -> Path:
        """Create keys without ever following a pre-existing symlink component."""

        if (
            hasattr(os, "O_DIRECTORY")
            and hasattr(os, "O_NOFOLLOW")
            and os.open in os.supports_dir_fd
            and os.mkdir in os.supports_dir_fd
        ):
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
                            "R2 fixture key components must be real directories"
                        ) from error
                    if not stat.S_ISDIR(os.fstat(next_fd).st_mode):
                        os.close(next_fd)
                        raise ValueError("R2 fixture key components must be real directories")
                    os.close(current_fd)
                    current_fd = next_fd
                    current /= segment
                return self._inside(current, must_exist=True)
            finally:
                os.close(current_fd)

        current = self.root
        for segment in segments:
            candidate = current / segment
            try:
                information = candidate.lstat()
            except FileNotFoundError:
                try:
                    candidate.mkdir(mode=0o700)
                except FileExistsError:
                    pass
                information = candidate.lstat()
            if stat.S_ISLNK(information.st_mode) or not stat.S_ISDIR(information.st_mode):
                raise ValueError("R2 fixture key components must be real directories")
            current = self._inside(candidate, must_exist=True)
        return current

    def resolve_object(self, uri: str) -> Path:
        match = _OBJECT_URI.fullmatch(uri)
        if match is None or match.group("prefix") != match.group("digest")[:2]:
            raise ValueError("invalid content-addressed object URI")
        candidate = (
            self.root
            / self.bucket
            / "objects"
            / "sha256"
            / match.group("prefix")
            / f"{match.group('digest')}.{match.group('extension')}"
        )
        resolved = self._inside(candidate, must_exist=True)
        if not resolved.is_file():
            raise FileNotFoundError("R2 fixture object is not a regular file")
        return resolved

    def resolve_run(self, uri: str) -> Path:
        match = _RUN_URI.fullmatch(uri)
        if match is None:
            raise ValueError("invalid run artifact URI")
        safe_parent = self._ensure_directory(
            self.bucket, "runs", match.group("revision"), match.group("attempt")
        )
        candidate = safe_parent / match.group("filename")
        if candidate.exists() or candidate.is_symlink():
            return self._inside(candidate, must_exist=True)
        return candidate

    def publish_object(self, source: Path, sha256: str, extension: str) -> str:
        digest_match = _SHA256.fullmatch(sha256)
        if digest_match is None or re.fullmatch(r"[a-z0-9]{1,10}", extension) is None:
            raise ValueError("invalid immutable R2 fixture object facts")
        safe_source = self._inside(source, must_exist=True)
        if not safe_source.is_file() or _sha256(safe_source) != sha256:
            raise ValueError("published R2 fixture bytes do not match their SHA-256")
        digest = digest_match.group("digest")
        safe_parent = self._ensure_directory(self.bucket, "objects", "sha256", digest[:2])
        destination = safe_parent / f"{digest}.{extension}"
        uri = f"vf-local://objects/sha256/{digest[:2]}/{digest}.{extension}"
        if destination.exists():
            if destination.is_symlink() or _sha256(destination) != sha256:
                raise ValueError("immutable R2 fixture destination conflicts with existing bytes")
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
                    raise ValueError("immutable R2 fixture publication collided") from None
        finally:
            temporary.unlink(missing_ok=True)
        return uri

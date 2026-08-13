from __future__ import annotations

import re
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


class R2PortFixtureArtifactResolver:
    """Filesystem double for the future private R2 object/run prefix port."""

    def __init__(self, root: Path, bucket: str = "videoforge-private-fixture") -> None:
        if not root.is_absolute() or not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,62}", bucket):
            raise ValueError("R2 fixture root or bucket is invalid")
        root.mkdir(parents=True, exist_ok=True)
        if root.is_symlink() or not root.is_dir():
            raise ValueError("R2 fixture root must be a real directory")
        self.root = root.resolve(strict=True)
        self.bucket = bucket

    def _inside(self, candidate: Path, *, must_exist: bool) -> Path:
        resolved = candidate.resolve(strict=must_exist)
        if not resolved.is_relative_to(self.root) or candidate.is_symlink():
            raise ValueError("R2 fixture key escaped its private root")
        return resolved

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
        parent = self.root / self.bucket / "runs" / match.group("revision") / match.group("attempt")
        parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        safe_parent = self._inside(parent, must_exist=True)
        candidate = safe_parent / match.group("filename")
        if candidate.exists() or candidate.is_symlink():
            return self._inside(candidate, must_exist=True)
        return candidate

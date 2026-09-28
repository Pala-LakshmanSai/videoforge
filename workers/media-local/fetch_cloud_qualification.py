"""Fetch one hashed private acceptance ZIP without logging its signed capability."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import tempfile
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

MAX_ARCHIVE_BYTES = 1024**3
MAX_EXTRACTED_BYTES = 4 * 1024**3


def extract(archive: Path, target: Path) -> None:
    with zipfile.ZipFile(archive) as bundle:
        members = bundle.infolist()
        if len(members) > 4096 or sum(item.file_size for item in members) > MAX_EXTRACTED_BYTES:
            raise ValueError("Qualification bundle exceeds its approved input bound")
        seen = set()
        for item in members:
            path = PurePosixPath(item.filename)
            mode = item.external_attr >> 16
            if (path.is_absolute() or ".." in path.parts or "\\" in item.filename
                    or path.parts[0] not in {"artifact-root", "jobs"}
                    or item.filename in seen or stat.S_ISLNK(mode)):
                raise ValueError("Qualification bundle path is unsafe")
            seen.add(item.filename)
            destination = target.joinpath(*path.parts)
            if item.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(item) as source, destination.open("xb") as output:
                    while chunk := source.read(1024 * 1024):
                        output.write(chunk)
        for kind in ("asr", "span", "render"):
            document = json.loads((target / "jobs" / f"{kind}.json").read_bytes())
            # Local contracts require vf-local URIs. Capabilities belong outside this archive.
            if re.search(r"https?://|authorization|api_key|password", json.dumps(document), re.IGNORECASE):
                raise ValueError("Qualification document contains a remote capability or credential field")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--target", type=Path, required=True)
    args = parser.parse_args()
    try:
        url = os.environ.pop("VIDEOFORGE_CLOUD_QUALIFICATION_URL")
        parsed = urllib.parse.urlsplit(url)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or not re.fullmatch(r"sha256:[0-9a-f]{64}", args.sha256)):
            raise ValueError("Qualification authority is malformed")
        with tempfile.TemporaryDirectory(prefix="vf-private-qualification-") as directory:
            archive = Path(directory) / "inputs.zip"
            checksum = hashlib.sha256()
            size = 0
            with urllib.request.urlopen(url, timeout=60) as response, archive.open("xb") as output:
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_ARCHIVE_BYTES:
                        raise ValueError("Qualification archive exceeds its bound")
                    checksum.update(chunk)
                    output.write(chunk)
            if "sha256:" + checksum.hexdigest() != args.sha256:
                raise ValueError("Qualification archive hash differs")
            args.target.mkdir(parents=True, exist_ok=False)
            extract(archive, args.target)
        print("Private qualification inputs verified")
        return 0
    except Exception:
        print("Private qualification input verification failed")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

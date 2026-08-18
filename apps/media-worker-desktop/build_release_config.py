from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_ORIGIN_ERROR = "control-plane origin must be an absolute credential-free HTTPS URL"


def _validate_origin(value: str) -> str:
    if not isinstance(value, str) or not value or value.strip() != value:
        raise ValueError(_ORIGIN_ERROR)
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as error:
        raise ValueError(_ORIGIN_ERROR) from error
    if (
        parsed.scheme.lower() != "https"
        or not hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or (port is not None and not 1 <= port <= 65535)
    ):
        raise ValueError(_ORIGIN_ERROR)
    return value.rstrip("/")


def build_configuration(
    origin: str,
    tools_root: str,
    execution_bundle_sha256: str,
    whisper_model_sha256: str,
) -> dict[str, str]:
    origin = _validate_origin(origin)
    if not _SHA256.fullmatch(execution_bundle_sha256):
        raise ValueError("execution bundle SHA-256 must be exact lowercase prefixed hex")
    if not _SHA256.fullmatch(whisper_model_sha256):
        raise ValueError("whisper model SHA-256 must be exact lowercase prefixed hex")
    return {
        "schema_version": "videoforge-personal-worker-build/v1",
        "control_plane_origin": origin,
        "execution_bundle_sha256": execution_bundle_sha256,
        "whisper_model_sha256": whisper_model_sha256,
        "tools_root": tools_root,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--origin", required=True)
    parser.add_argument("--tools-root", default="resources/bin")
    parser.add_argument("--execution-bundle-sha256", required=True)
    parser.add_argument("--whisper-model-sha256", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        value = build_configuration(
            args.origin,
            args.tools_root,
            args.execution_bundle_sha256,
            args.whisper_model_sha256,
        )
    except ValueError as error:
        raise SystemExit(str(error)) from error
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

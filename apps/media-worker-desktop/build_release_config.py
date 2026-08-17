from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlsplit


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--origin", required=True)
    parser.add_argument("--tools-root", default="resources/bin")
    parser.add_argument("--execution-bundle-sha256", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    parsed = urlsplit(args.origin)
    if parsed.scheme != "https" or not parsed.netloc or parsed.query or parsed.fragment:
        raise SystemExit("control-plane origin must be an absolute credential-free HTTPS URL")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", args.execution_bundle_sha256):
        raise SystemExit("execution bundle SHA-256 must be exact lowercase prefixed hex")
    value = {
        "schema_version": "videoforge-personal-worker-build/v1",
        "control_plane_origin": args.origin.rstrip("/"),
        "execution_bundle_sha256": args.execution_bundle_sha256,
        "tools_root": args.tools_root,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

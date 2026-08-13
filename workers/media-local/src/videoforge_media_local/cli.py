from __future__ import annotations

import sys

from videoforge_image_media.local_cli import main as shared_media_main


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] != "transcribe":
        print("CP-03 media-local worker accepts only the transcribe job mode.", file=sys.stderr)
        return 2
    return shared_media_main()


if __name__ == "__main__":
    raise SystemExit(main())

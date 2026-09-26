from __future__ import annotations

import os
import subprocess


def background_creationflags() -> int:
    """Keep trusted console tools invisible when launched by the desktop worker."""
    return subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0

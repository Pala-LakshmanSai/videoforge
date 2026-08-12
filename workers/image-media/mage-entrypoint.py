from __future__ import annotations

import atexit
import json
import os
import subprocess
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

from mage_bootstrap import bootstrap


def main() -> None:
    comfy_root = Path(os.environ.get("COMFY_ROOT", "/opt/comfyui"))
    model_root = Path(os.environ.get("MAGE_MODEL_ROOT", "/models/mage-flow-turbo"))
    bootstrap(model_root, comfy_root)
    started = time.time()
    process = subprocess.Popen(
        [
            "python",
            str(comfy_root / "main.py"),
            "--listen",
            "127.0.0.1",
            "--port",
            "8188",
            "--output-directory",
            "/tmp/comfy-output",
            "--disable-auto-launch",
            "--disable-metadata",
        ],
        cwd=comfy_root,
    )
    atexit.register(process.terminate)
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("MAGE_COMFY_START_FAILED")
        try:
            with urlopen("http://127.0.0.1:8188/system_stats", timeout=2) as response:
                if response.status == 200:
                    break
        except (URLError, TimeoutError):
            time.sleep(0.5)
    else:
        raise RuntimeError("MAGE_COMFY_START_TIMEOUT")
    completed = time.time()
    Path("/tmp/mage-comfy-start.json").write_text(
        json.dumps(
            {
                "schema_version": "videoforge.mage-comfy-start/v1",
                "source_revision": os.environ["MAGE_SOURCE_REVISION"],
                "started_unix_ms": round(started * 1000),
                "completed_unix_ms": round(completed * 1000),
                "duration_ms": round((completed - started) * 1000),
            },
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    from mage_handler import start_worker

    start_worker()


if __name__ == "__main__":
    main()

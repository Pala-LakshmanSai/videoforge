from __future__ import annotations

import os

import uvicorn


def main() -> None:
    if os.environ.get("VIDEOFORGE_ECHO_PREPARATION") == "1":
        uvicorn.run(
            "echo_prepare_service:app",
            host="0.0.0.0",
            port=8000,
            access_log=False,
            log_level="info",
        )
        return
    for name in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "DIFFUSERS_OFFLINE"):
        if os.environ.get(name) != "1":
            raise RuntimeError("ECHO_OFFLINE_RUNTIME_REQUIRED")
    uvicorn.run("echo_api:app", host="0.0.0.0", port=8000, access_log=False, log_level="info")


if __name__ == "__main__":
    main()

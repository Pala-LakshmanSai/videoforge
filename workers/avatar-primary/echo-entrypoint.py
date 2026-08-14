from __future__ import annotations

import os

import uvicorn

OFFLINE_ENVIRONMENT = ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "DIFFUSERS_OFFLINE")


def enable_preparation_downloads() -> None:
    """Clear image-level offline flags before any preparation app import occurs."""
    if os.environ.get("VIDEOFORGE_ECHO_PREPARATION") != "1":
        raise RuntimeError("ECHO_PREPARATION_MODE_REQUIRED")
    for name in OFFLINE_ENVIRONMENT:
        os.environ.pop(name, None)


def main() -> None:
    if os.environ.get("VIDEOFORGE_ECHO_PREPARATION") == "1":
        enable_preparation_downloads()
        uvicorn.run(
            "echo_prepare_service:app",
            host="0.0.0.0",
            port=8000,
            access_log=False,
            log_level="info",
        )
        return
    for name in OFFLINE_ENVIRONMENT:
        if os.environ.get(name) != "1":
            raise RuntimeError("ECHO_OFFLINE_RUNTIME_REQUIRED")
    uvicorn.run("echo_api:app", host="0.0.0.0", port=8000, access_log=False, log_level="info")


if __name__ == "__main__":
    main()

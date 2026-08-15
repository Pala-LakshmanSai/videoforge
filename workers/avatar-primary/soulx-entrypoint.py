from __future__ import annotations

import os

import uvicorn


def main() -> None:
    mode = os.environ.get("SOULX_MODE", "runtime")
    if mode == "prepare":
        os.environ.update(
            HF_HUB_OFFLINE="0",
            TRANSFORMERS_OFFLINE="0",
            DIFFUSERS_OFFLINE="0",
        )
        app = "soulx_prepare_service:app"
    elif mode == "runtime":
        os.environ.update(
            HF_HUB_OFFLINE="1",
            TRANSFORMERS_OFFLINE="1",
            DIFFUSERS_OFFLINE="1",
        )
        app = "soulx_api:app"
    else:
        raise RuntimeError(f"unsupported SOULX_MODE: {mode}")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")


if __name__ == "__main__":
    main()

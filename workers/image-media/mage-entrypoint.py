from __future__ import annotations

import os

import uvicorn


def main() -> None:
    required = {
        "HF_HUB_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
        "DIFFUSERS_OFFLINE": "1",
    }
    if any(os.environ.get(name) != value for name, value in required.items()):
        raise RuntimeError("MAGE_OFFLINE_RUNTIME_REQUIRED")
    uvicorn.run("mage_api:app", host="0.0.0.0", port=8000, access_log=False, log_level="info")


if __name__ == "__main__":
    main()

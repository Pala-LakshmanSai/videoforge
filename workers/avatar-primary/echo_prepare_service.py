from __future__ import annotations

import asyncio
import hashlib
import os
import time
from pathlib import Path

from fastapi import FastAPI

from echo_volume import (
    ECHO_PINNED_SMALL_CONFIG_MAX_BYTES,
    ECHO_SELECTED_RUNTIME_BLOB_BYTES,
    ECHO_VOLUME_SIZE_GB,
)
from prepare_echo_volume import prepare

app = FastAPI(title="VideoForge Echo CP-07 preparation", docs_url=None, redoc_url=None)
started = time.monotonic()
state: dict[str, object] = {"phase": "starting", "error_code": None}


def _run() -> None:
    volume_id = os.environ.get("VIDEOFORGE_ECHO_VOLUME_ID", "")
    confirmation = os.environ.get("VIDEOFORGE_ECHO_DOWNLOAD_CONFIRMATION", "")
    try:
        state["phase"] = "preparing"
        manifest = prepare(
            Path(os.environ.get("ECHO_MODEL_ROOT", "/runpod-volume/echo-fp8")),
            volume_id=volume_id,
            volume_size_gb=ECHO_VOLUME_SIZE_GB,
            confirmation=confirmation,
        )
        state.update(
            {
                "phase": "ready",
                "error_code": None,
                "manifest_sha256": manifest["manifest_sha256"],
                "volume_id_sha256": "sha256:"
                + hashlib.sha256(volume_id.encode("utf-8")).hexdigest(),
            }
        )
    except Exception as error:
        state.update({"phase": "failed", "error_code": str(error)[:120]})


@app.on_event("startup")
async def startup() -> None:
    asyncio.create_task(asyncio.to_thread(_run))


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        "schema_version": "videoforge.echo-fp8-preparation-health/v1",
        "service": "videoforge-echo-cp07-preparation",
        "phase": state["phase"],
        "model": {
            "id": "EchoMimicV3-Flash",
            "selected_runtime_blob_bytes": ECHO_SELECTED_RUNTIME_BLOB_BYTES,
            "pinned_small_config_max_bytes": ECHO_PINNED_SMALL_CONFIG_MAX_BYTES,
            "precision": "float8_e4m3fn_dynamic_activation_weight",
        },
        "volume": {
            "requested_size_gb": ECHO_VOLUME_SIZE_GB,
            "volume_id_sha256": state.get("volume_id_sha256"),
            "manifest_sha256": state.get("manifest_sha256"),
        },
        "uptime_ms": round((time.monotonic() - started) * 1_000),
        "error_code": state["error_code"],
    }

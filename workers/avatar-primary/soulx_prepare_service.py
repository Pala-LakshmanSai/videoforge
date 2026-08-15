from __future__ import annotations

import threading
from typing import Any

from fastapi import FastAPI

from prepare_soulx_volume import prepare

app = FastAPI(title="VideoForge SoulX volume preparation")
state: dict[str, Any] = {"state": "preparing", "error": None}


def run_prepare() -> None:
    try:
        state.update({"state": "ready", **prepare()})
    except Exception as error:
        state.update({"state": "failed", "error": f"{type(error).__name__}: {error}"})


@app.on_event("startup")
def start_prepare() -> None:
    threading.Thread(target=run_prepare, daemon=True).start()


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "schema_version": "videoforge.soulx-flashhead-pro-preparation-health/v1",
        "service": "videoforge-soulx-flashhead-pro-vf924s-preparation",
        **state,
    }

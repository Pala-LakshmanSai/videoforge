from __future__ import annotations

import threading
import os

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from soulx_runtime import runtime


class GenerateRequest(BaseModel):
    source_image_base64: str
    audio_wav_base64: str


app = FastAPI(title="VideoForge SoulX-FlashHead Pro VF-9-24S")


def authorize(authorization: str | None) -> None:
    token = os.environ.get("VIDEOFORGE_SOULX_WORKER_TOKEN", "")
    if len(token) < 32 or authorization != f"Bearer {token}":
        raise HTTPException(status_code=401, detail="unauthorized")


@app.on_event("startup")
def start_runtime() -> None:
    threading.Thread(target=runtime.initialize, daemon=True).start()


@app.get("/health")
def health() -> dict[str, object]:
    return runtime.health()


@app.post("/generate", status_code=202)
def generate(
    request: GenerateRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    authorize(authorization)
    try:
        return {"job_id": runtime.submit(request.source_image_base64, request.audio_wav_base64)}
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/jobs/{job_id}")
def job(job_id: str, authorization: str | None = Header(default=None)) -> dict[str, object]:
    authorize(authorization)
    try:
        return runtime.job(job_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="unknown job") from error

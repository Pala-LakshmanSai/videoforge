from __future__ import annotations

import threading

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from soulx_runtime import runtime


class GenerateRequest(BaseModel):
    source_image_base64: str
    audio_wav_base64: str


app = FastAPI(title="VideoForge SoulX-FlashHead Pro VF-9-24S")


@app.on_event("startup")
def start_runtime() -> None:
    threading.Thread(target=runtime.initialize, daemon=True).start()


@app.get("/health")
def health() -> dict[str, object]:
    return runtime.health()


@app.post("/generate", status_code=202)
def generate(request: GenerateRequest) -> dict[str, str]:
    try:
        return {"job_id": runtime.submit(request.source_image_base64, request.audio_wav_base64)}
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.get("/jobs/{job_id}")
def job(job_id: str) -> dict[str, object]:
    try:
        return runtime.job(job_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="unknown job") from error

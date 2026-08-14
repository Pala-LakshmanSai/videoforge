from __future__ import annotations

import hmac
import os

from fastapi import Body, FastAPI, Header, HTTPException

from echo_runtime import EchoRuntime

app = FastAPI(title="VideoForge Echo Flash Turbo FP8 CP-07 Pod", docs_url=None, redoc_url=None)
runtime = EchoRuntime()


@app.on_event("startup")
async def startup() -> None:
    await runtime.startup()


def _authorize(authorization: str | None) -> None:
    expected = os.environ.get("VIDEOFORGE_ECHO_WORKER_TOKEN", "")
    supplied = (authorization or "").removeprefix("Bearer ")
    if len(expected) < 32 or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="ECHO_WORKER_AUTH_INVALID")


@app.get("/health")
async def health() -> dict[str, object]:
    return runtime.health()


@app.post("/generate")
async def generate(
    value: object = Body(...), authorization: str | None = Header(default=None)
) -> dict[str, object]:
    _authorize(authorization)
    try:
        return await runtime.generate_qualification(value)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)[:120]) from error
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)[:120]) from error

from __future__ import annotations

import asyncio
import hmac
import os
from contextlib import asynccontextmanager

from fastapi import Body, FastAPI, Header, HTTPException

from mage_runtime import MageRuntime
from videoforge_image_media.mage_production import MageContractError

runtime = MageRuntime()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    startup = asyncio.create_task(runtime.startup())
    try:
        yield
    finally:
        if not startup.done():
            startup.cancel()
        await runtime.shutdown()


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


def authorize(value: str | None) -> None:
    token = os.environ.get("VIDEOFORGE_MAGE_WORKER_TOKEN", "")
    supplied = value.removeprefix("Bearer ") if value else ""
    if len(token) < 32 or not hmac.compare_digest(token, supplied):
        raise HTTPException(status_code=401, detail={"code": "MAGE_AUTH_REQUIRED"})


@app.get("/v1/health")
async def health() -> dict[str, object]:
    return runtime.health()


@app.post("/v1/generate")
async def generate(
    value: object = Body(...), authorization: str | None = Header(default=None)
) -> dict[str, object]:
    authorize(authorization)
    try:
        return {"ok": True, "result": await runtime.generate(value)}
    except MageContractError as error:
        raise HTTPException(status_code=422, detail={"code": str(error)[:120]}) from None
    except RuntimeError as error:
        code = str(error)[:120]
        raise HTTPException(
            status_code=503 if code == "MAGE_WORKER_NOT_READY" else 500,
            detail={"code": code},
        ) from None

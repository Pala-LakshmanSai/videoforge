from __future__ import annotations

import asyncio
import hmac
import os
import secrets

from fastapi import Body, FastAPI, Header, HTTPException

from echo_runtime import EchoRuntime

app = FastAPI(title="VideoForge Echo Flash Turbo FP8 CP-07 Pod", docs_url=None, redoc_url=None)
runtime = EchoRuntime()
jobs: dict[str, dict[str, object]] = {}
tasks: set[asyncio.Task[None]] = set()


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


async def _run_generation(job_id: str, value: object) -> None:
    try:
        jobs[job_id] = {"status": "complete", "result": await runtime.generate_qualification(value)}
    except (ValueError, RuntimeError) as error:
        jobs[job_id] = {"status": "failed", "error_code": str(error)[:120]}
    except Exception:
        jobs[job_id] = {"status": "failed", "error_code": "ECHO_GENERATION_FAILED"}


@app.post("/generate", status_code=202)
async def generate(
    value: object = Body(...), authorization: str | None = Header(default=None)
) -> dict[str, object]:
    _authorize(authorization)
    if any(job.get("status") == "running" for job in jobs.values()):
        raise HTTPException(status_code=409, detail="ECHO_GENERATION_ALREADY_RUNNING")
    job_id = secrets.token_urlsafe(24)
    jobs[job_id] = {"status": "running"}
    task = asyncio.create_task(_run_generation(job_id, value))
    tasks.add(task)
    task.add_done_callback(tasks.discard)
    return {
        "schema_version": "videoforge.echo-qualification-accepted/v1",
        "job_id": job_id,
        "status": "running",
    }


@app.get("/generate/{job_id}")
async def generation_status(
    job_id: str, authorization: str | None = Header(default=None)
) -> dict[str, object]:
    _authorize(authorization)
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="ECHO_GENERATION_JOB_NOT_FOUND")
    return {
        "schema_version": "videoforge.echo-qualification-status/v1",
        "job_id": job_id,
        **job,
    }

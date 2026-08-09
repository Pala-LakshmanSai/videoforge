from typing import Literal, TypedDict


class WorkerHealth(TypedDict):
    schema_version: Literal["worker-health/v1"]
    worker_id: Literal["image-media"]
    process_state: Literal["ready"]
    model_state: Literal["not_loaded"]
    provider_mode: Literal["fixture"]
    synthetic: Literal[True]
    provider_calls_authorized: Literal[False]
    external_spend_usd: Literal[0]
    capabilities: list[str]


def health_payload() -> WorkerHealth:
    """Return a non-secret process health payload without loading models."""
    return {
        "schema_version": "worker-health/v1",
        "worker_id": "image-media",
        "process_state": "ready",
        "model_state": "not_loaded",
        "provider_mode": "fixture",
        "synthetic": True,
        "provider_calls_authorized": False,
        "external_spend_usd": 0,
        "capabilities": ["transcribe", "image_generate", "render", "technical_probe"],
    }

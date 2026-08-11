from typing import Literal, TypedDict


class WorkerHealth(TypedDict):
    schema_version: Literal["worker-health/v1"]
    worker_id: Literal["avatar-quality"]
    process_state: Literal["ready"]
    model_state: Literal["not_loaded"]
    provider_mode: Literal["runpod_serverless"]
    synthetic: Literal[False]
    provider_calls_authorized: Literal[False]
    external_spend_usd: Literal[0]
    capabilities: list[str]


def health_payload() -> WorkerHealth:
    """Return non-secret process health without loading SkyReels."""
    return {
        "schema_version": "worker-health/v1",
        "worker_id": "avatar-quality",
        "process_state": "ready",
        "model_state": "not_loaded",
        "provider_mode": "runpod_serverless",
        "synthetic": False,
        "provider_calls_authorized": False,
        "external_spend_usd": 0,
        "capabilities": ["avatar_quality_fallback"],
    }

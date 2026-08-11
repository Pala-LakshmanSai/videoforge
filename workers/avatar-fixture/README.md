# Avatar fixture worker

Provider-free, non-production Avatar job boundary. It validates exact pinned Avatar source and
materialized span-audio lineage, emits deterministic synthetic MP4-signature fixture bytes, and
never loads weights, invokes a shell, sends callbacks, accesses a network, or incurs spend.

Focused check from the repository root:

```sh
PYTHONPATH=workers/avatar-fixture/src uv run pytest -q workers/avatar-fixture/tests
```

Root workspace/verification registration is intentionally left to the integration owner.

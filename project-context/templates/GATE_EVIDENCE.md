# Gate evidence record

## Identity

- Gate ID:
- Run ID:
- Date/time (UTC):
- Owner:
- Blocking milestone:
- Decision under test:

## Exact system

- Git commit:
- Container digest:
- Model/checkpoint hash:
- Worker image and Serverless template/endpoint/config digest:
- Model lane/revision/precision/manifest hash:
- Exact existing volume ID/region/capacity/mount and pre/post manifest (redacted or hashed):
- Live inventory receipt, selected offering, actual GPU, region, and rate:
- Input fixture IDs and hashes:

## Authorization and cost

- Real calls authorized by:
- Maximum authorized spend:
- Reserved/reported/settled cost:
- Provider jobs/cancellation/reconciliation and zero-worker-after-drain evidence:
- Expected retained endpoint/volume identities, state, and recurring charges:
- Possible duplicate-compute/cost evidence:

## Procedure

- Commands:
- Cold queue-to-worker and worker-to-`model_ready` runs:
- Warm worker-to-`model_ready`/first-item runs:
- Assignment/container/volume-verify/model-load/warm-up/inference/upload/idle/drain timings:
- `/status` reconciliation and durable signed provenance receipt:
- Exact init/execution/TTL/idle/scaler/worker-bound configuration:
- Fault/retry cases:

## Results

- Raw evidence path:
- Metrics:
- Human Chrome review:
- Rejections/retries:

## Decision

- `PASS | FAIL | NEEDS_MORE_EVIDENCE`
- Acceptance criteria comparison:
- Approved profile/decision change:
- Follow-up:

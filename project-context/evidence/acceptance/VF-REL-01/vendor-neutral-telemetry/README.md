# VF-REL-01 vendor-neutral telemetry evidence

Status: technical pass at `$0` on 2026-08-11.

## Result

- Added immutable `telemetry-event/v1` with explicit request/workspace/project/revision/task/
  attempt/outbox/provider-job correlation, operation/stage, queue wait, duration, retry, cost,
  sequence, outcome, and safe error classification.
- Exact-key plain-data validation rejects accessors, symbols, exotic objects, URLs, authorization,
  raw prompts/media, stack traces, and secret-shaped fields.
- No-op and deterministic in-memory adapters use per-stream monotonic sequence. Sink, validation,
  and classifier failures cannot alter domain results.
- The real local workflow dispatch seam emits start/success/failure with queue wait and durable
  correlation while preserving dispatch acknowledgement mapping.
- Focused telemetry tests passed 8/8. Integrated control-plane passed 172/172; forced canonical
  verification passed with Workerd 1/1, Chrome 38/38, and zero skips.

No vendor SDK, exporter, network call, credential, provider call, cloud mutation, or spend exists.

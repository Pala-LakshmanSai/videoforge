# VF-5-01 Avatar fixture job evidence

Status: provider-free technical pass at `$0` on 2026-08-11.

- Deterministic fixture worker validates exact revision/task/attempt, Avatar version/hash/runtime
  source, materialized padded-span audio, layout/crop/rate, destination, claim, and callback facts.
- One native 832x480p25 clip is reused for full and split layouts; renderer crop bindings differ.
- Focused pytest passed 17/17: byte determinism, media facts, tampering, replay/retry/cancel,
  callback fencing, workspace isolation, review/cost records, and zero outbound activity.
- Root Python lint and seven worker suites passed. Forced canonical verification passed in 171.14s:
  751 tests/journeys, control-plane 193/193, Workerd 1/1, installed Chrome 38/38, zero skips.

Fixture bytes are explicitly non-production and close no Avatar/provider/GPU gate.

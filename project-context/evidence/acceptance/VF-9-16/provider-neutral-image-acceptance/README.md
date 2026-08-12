# VF-9-16 provider-neutral durable image acceptance

Status: complete at `$0`.

- Added additive migration 0013 so durable image acceptance admits exact fixture and Mage acceptance
  versions without rewriting existing rows.
- Existing fixture result/acceptance bytes, dimensions, metadata, telemetry, replay, and restore remain
  unchanged.
- Added exact Mage durable result variant with locked image/model/source/GPU, 1280x720 PNG bytes,
  positive/negative prompt hashes, runtime evidence, exact cost, session-derived reviewer, timestamp,
  and explicit passed visual review.
- Real-shaped Mage results persist truthful non-fixture asset metadata, technical QA, provider details,
  cost events, task/attempt completion, callback binding, append-only acceptance, replay, and metadata
  restore. Provider, reviewer, prompt, media, cost, callback, and rejected-review drift fail before
  durable mutation.
- Server composition validates the strict RunPod Mage envelope first, then builds the durable union;
  no provider/network capability exists in control-plane acceptance.
- Canonical forced verification passed: control-plane 212/212, web 212/212, Workerd 1/1, installed
  Chrome 38/38, zero skips. Context/secret/diff checks passed.
- No provider call, credential, GPU, model download, mutation, or spend occurred. RunPod remained
  independently confirmed absolute zero.

# Engineering best practices

Status: required implementation discipline  
Read when: writing or reviewing application/worker code.

## Keep intelligence narrow

- AI writes image prompts and media pixels; a multimodal analyzer may derive a reusable Image Style only when an explicit new draft style version is analyzed.
- Code controls timing, timeline composition, state, permissions, budgets, retries, lineage, and rendering.
- Do not add an LLM call when deterministic parsing/validation answers the question.
- Never re-run style vision analysis during an ordinary project or for each generated image.
- Do not add an automatic enhancement stage without a measured acceptance gain.

## Version everything that affects output

Persist:

- EDL/schema/scheduler versions.
- System prompt, permanent guardrail, and selected style-profile version.
- Selected Image Style ID/version/profile hash, analyzer/prompt/schema version, scene-writer/compiler versions, prompt components, extra-keyword text/toggle, permanent guardrail version, exact final positive/negative strings, and hashes of their exact UTF-8 bytes.
- Selected Avatar Profile parent/version/profile hash, canonical runtime source asset/checksum, source-preparation/validation versions, compatibility state at preflight, and matching immutable terminal evidence when one exists.
- Model repo revision/checkpoint checksum.
- Container digest and CUDA/PyTorch/FFmpeg versions.
- Inference settings, seed, GPU SKU.
- Input/output checksums and parent lineage.

An accepted render must be explainable and reproducible from its manifest.

## Idempotency first

- Every externally billed action has a deterministic idempotency key.
- Reserve budget and create the attempt/outbox atomically.
- Callbacks are duplicate-safe, ordered, signed, and tied to one attempt.
- Retry the smallest failed unit.
- Never interpret a timeout as proof that the provider did nothing; reconcile before dispatching again.
- Application idempotency does not imply provider at-most-once billing. Use `DISPATCH_ACK_UNKNOWN`, a worker-side single execution claim before model load, and one accepted-result invariant.

## Immutable artifacts

- Never overwrite accepted R2 objects.
- Use content hashes and attempt IDs.
- Project changes create revisions.
- Published Image Style versions never mutate; edits create a new version while existing project revisions remain pinned. Parent style archive/default/active-version state remains outside the immutable profile payload.
- Ready Avatar Profile versions never mutate; replacing source pixels creates a new version while parent rename/archive/active-version state stays outside the immutable payload. Workers receive only the revision-pinned binding and never resolve `latest`.
- Failed/repaired derivatives keep parent pointers.
- SkyReels always starts from the revision-pinned canonical runtime source and same selected span audio—not a failed derivative; enforce this in schema, not comments alone.

## Truthful asynchronous UX

- Server state is authoritative.
- Disable duplicate action immediately.
- Distinguish queued, worker starting, container ready, model loading, model ready, generating, uploading, retrying, blocked, cancelling, and complete.
- Percentages derive from real completed/total units and versioned stage weights.
- ETA shows confidence/range until measured history exists.
- Never hide a cost-producing retry.

## Bounded concurrency and cost

- Start `workersMax=1` for expensive lanes.
- Enforce workspace/project/daily caps.
- Fairly chunk work across users.
- Estimate before dispatch; reconcile with provider-reported cost.
- Judge GPUs by cost per accepted output, not hourly rate alone.
- Scale to zero only after the shared lane drains.

## Stable adapters, simple implementations

Define narrow interfaces for:

- Prompt provider.
- Reference-style analyzer.
- Image generator.
- Avatar primary/repair/fallback.
- Compute dispatcher.
- Artifact store.
- Renderer.

Only one production implementation per interface is needed now. The boundary exists to make a later measured swap possible, not to build a speculative multi-provider router.

## External response validation

- Treat provider output as untrusted.
- Validate JSON schema, IDs, counts, media decode, dimensions, duration, hash, and expected object prefix.
- Enforce maximum sizes/durations.
- Treat reference-image pixels and visible text as untrusted data, never instructions; use browser-side bounded sRGB re-encoding/EXIF removal plus independent server checks for magic bytes, raster metadata, decompression limits, dimensions, and checksum.
- Normalize/cap project extra image keywords as data and reject hard-rule conflicts without another LLM call. Run the same validator over analyzer output and user-edited style clauses before publication; only soft creative conflicts warn.
- Sanitize filenames and FFmpeg arguments; use argument arrays, not shell-concatenated user text.
- Never fetch arbitrary internal/private URLs supplied by a user.

## Secrets and access

- Secrets are server-side environment/bindings only.
- Use per-environment credentials and rotate them.
- Short-lived signed URLs, scoped callback tokens, HMAC replay protection.
- Invite-only Google login plus server-side workspace checks.
- Avoid logging voiceover URLs, tokens, or raw provider authorization headers.
- Avoid logging Avatar Profile pixels, signed source/thumbnail URLs, EXIF/GPS, likeness metadata, or cross-workspace hashes. Require workspace authorization plus image-use and likeness-animation attestations; never place private avatar assets in public fixtures/builds/analytics.
- Avoid logging style-reference bytes, EXIF/GPS, signed URLs, or full analyzer payloads; send EXIF-stripped normalized derivatives only after explicit Runware non-ZDR/non-confidential disclosure consent.
- Distinguish deletion of VideoForge/R2 copies from provider-side retention/deletion. Never imply that one button erases data outside VideoForge unless the provider confirms it.
- Keep research-only third-party frames out of public builds and final assets.
- Do not claim ordinary Runware processing is zero-data-retention; record rights/retention and use the lowest officially available retention mode.

## Worker design

- Prebuilt, pinned containers; no runtime `pip install` or source compilation in a job.
- Weights cached on immutable read-only volumes.
- Health check for process readiness; separate model-ready event.
- Emit heartbeat/progress between items.
- Check cancellation between items.
- Upload/checkpoint each item so chunk retry resumes missing work.
- Release/unload models between incompatible job types; never stack Mage and avatar models in one worker.

## Database practice

- Explicit migrations reviewed in source control.
- Foreign keys and unique idempotency constraints.
- Transactions for state transitions/outbox/budget.
- Append-only events/cost ledger.
- Optimistic version or lease for concurrent project edits.
- Workspace-scope every style/reference/version and Avatar Profile/version/source/thumbnail/compatibility query; never expose cross-workspace hash matches while deduplicating.
- Store timestamps in UTC. Canonical output timeline boundaries are integer `start_frame/end_frame_exclusive`; source-audio/word boundaries are integer milliseconds or samples, never float seconds.

## Media determinism

- Compile all durations to output-frame counts.
- Define rounding policy once.
- No gap/overlap after conversion.
- Every allowed avatar renderer source profile has pixel-level crop/rate golden tests; a model/profile/crop mismatch fails schema validation.
- Pin FFmpeg and capture the actual command/filtergraph in the manifest.
- Do not burn UI/debug/status text into video.

## Tests before optimization

- Unit/golden tests for scheduler and contracts.
- Small real model fixtures for worker smoke.
- Fault injection for provider ambiguity.
- Chrome E2E for human workflows.
- Measure cold and warm paths separately.
- Optimize only the observed bottleneck after correctness and output quality.

## Repository discipline

- Preserve unrelated user changes.
- Narrow commits with descriptive scope.
- Never commit secrets, full downloaded reference videos, model weights, or private output.
- Never commit user style references, private avatar pixels/thumbnails/test clips, or generated private previews; automated fixtures must be owned, synthetic, or explicitly redistributable.
- CI artifacts tie to an exact commit and digest.
- Update this context pack in the same change as an approved decision.
- Repository visibility defaults private unless the user explicitly overrides it. The current
  repository is public by the user's 2026-08-11 decision. Optional third-party planning assets must
  not be required for builds/tests; use owned/synthetic fixtures.
- Keep `CURRENT_STATE.yaml` as the replace-in-place handoff snapshot and follow `19_IMPLEMENTATION_PLAYBOOK.md` for stable Chrome/dev-server behavior.

## Observability

Minimum structured fields: workspace, owner type/ID, optional project/revision or Avatar Profile/version/assessment, task, attempt, model profile, provider job, GPU, stage, event sequence, elapsed, reserved/reported cost, error code. Logs are useful only when they can reconstruct a failure without exposing secrets.

Alert on stuck leases, callback reconciliation, repeated model OOM, rising rejection rate, budget blocks, provider balance, and workers that remain active after an empty lane.

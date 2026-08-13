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
- Exact lane/model profile, model repo revision, every required model-file path/checksum, and the
  canonical persistent-volume manifest hash.
- Container digest and CUDA/PyTorch/FFmpeg versions.
- Inference settings, seed, live-inventory receipt, user-selected exact GPU SKU/ID/rate, `EU-RO-1`
  volume binding, actual Pod identity, and actual GPU observed after create.
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
- Each exact active model has one separately provisioned persistent-volume identity. Mage and Echo
  volume IDs, manifests, caches, locks, and adoption paths are never interchangeable. A new Pod may
  adopt only its own exact model profile's volume after manifest verification.

## Truthful asynchronous UX

- Server state is authoritative.
- Disable duplicate action immediately.
- Distinguish inventory refreshing, Pod creating, volume attached, container ready, volume manifest
  verified, model loading, warming up, model ready, generating, uploading, durable, Pod deleting,
  Pod absent, retrying, blocked, cancelling, and complete.
- Percentages derive from real completed/total units and versioned stage weights.
- ETA shows confidence/range until measured history exists.
- Never hide a cost-producing retry.

## Bounded concurrency and cost

- At most one paid disposable Pod per active model lane is authorized for an ordinary Generate.
  This is a Mage Pod and an Echo Pod, not two replicas of one lane.
- Start the two independently selected Pods concurrently only after the exact task reservation and
  final live-inventory/rate revalidation succeeds.
- Enforce workspace/project/daily caps; estimate before creation and reconcile measured runtime.
- Judge GPUs by model-ready time and cost per accepted output, not hourly rate alone.
- Delete each exact Pod immediately after its accepted outputs are durable and no bounded retry
  needs the resident model. Independently prove absence. Retain and keep paying for the two intended
  model volumes; routine cleanup must never delete them.
- Fairly chunk work across users. Never keep a Pod alive merely because another lane or the final
  local render is unfinished.

## Stable adapters, simple implementations

Define narrow interfaces for:

- Prompt provider.
- Reference-style analyzer.
- Image generator.
- Avatar generator.
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

- Prebuilt, digest-pinned containers; no runtime `pip install`, source compilation, or model
  download during ordinary Pod boot.
- Keep large weights on two distinct persistent `EU-RO-1` network volumes: one exact Mage INT8
  volume and one exact Echo FP8 volume. Treat verified model files as immutable/read-only in the
  worker during jobs, write scratch/results elsewhere, and verify for mutation; do not assume a
  provider-enforced read-only mount.
- Normal boot fails closed on a missing, extra, corrupt, wrong-revision, wrong-profile, or
  cross-model volume manifest. Only separately authorized one-time preparation may populate or
  change model files.
- Process/container health is not readiness. Emit authoritative `model_ready` only after the exact
  volume, manifest, runtime, actual GPU, load, and bounded warm-up all pass.
- Emit heartbeat/progress between items.
- Check cancellation between items.
- Upload/checkpoint each item so chunk retry resumes missing work.
- Never stack Mage and Echo in one container, Pod, volume, cache, or process.
- A successful worker makes outputs durable before cleanup authorizes deletion of its Pod. Pod
  deletion and post-delete absence are journaled separately from retained-volume health.

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

Minimum structured fields: workspace, owner type/ID, optional project/revision or Avatar Profile/version/assessment, task, attempt, lane, exact model profile, container digest, volume/manifest identity, inventory receipt, requested/actual GPU, Pod identity, stage, event sequence, elapsed, reserved/measured cost, durable-result receipt, delete/absence evidence, and error code. Logs are useful only when they can reconstruct a failure without exposing secrets.

Alert on stuck leases, ambiguous create/delete reconciliation, cross-volume or manifest mismatch,
repeated model OOM, rising rejection rate, budget blocks, provider balance, and paid Pods that remain
after their lane is durable. A retained intended model volume is expected, not a leaked Pod.

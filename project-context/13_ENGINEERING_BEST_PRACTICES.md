# Engineering best practices

Status: binding implementation rules for VideoForge V2
Read when: implementing any application, worker, data, provider, security, or operations checkpoint.

## Preserve proven foundations

Extend the existing UI, immutable revision model, word transcript, deterministic scheduler,
renderer-neutral timeline, FFmpeg renderer, fixture adapters, Mage runtime, and SoulX runtime. Do not
rebuild a green foundation merely because hosting changes.

Historical global-session/manual-Pod contracts and evidence remain immutable and replayable. New V2
behavior is additive: tenant scope, fair admission, Serverless v3 transport, and hosted artifacts.
Never relabel old Pod evidence as Serverless acceptance.

## Tenant isolation is structural

- Derive account/workspace from the authenticated server session; never trust a client tenant ID.
- Carry `account_id` and `workspace_id` on every owned row and enforce composite foreign keys.
- Scope every repository read/write and every object-key construction by tenant.
- Return indistinguishable not-found/unauthorized responses to prevent enumeration.
- User Avatar Profiles, Image Styles, projects, inputs, results, queue rows, costs, and audit trails
  are private. Only explicit immutable built-in presets are system-visible.
- Test isolation at repository, API, signed-URL, queue, callback, R2, log, and cache/scratch layers.
- Do not place tenant IDs, signed URLs, raw provider bodies, voiceover text, or source-image data in
  ordinary logs.

## Keep intelligence narrow and deterministic

- DeepSeek writes image prompts only.
- Gemini vision analyzes references only when a user explicitly creates/analyzes a draft Image Style.
- Word timestamps and the seeded scheduler decide timing/layout; neither an LLM nor GPU worker does.
- Allowed compositions remain full avatar, full image, and avatar-left/image-right split.
- Hard cuts only; no captions, text overlays, lower thirds, borders, watermarks, title cards, motion
  graphics, or decorative transitions.
- Every AI still uses the approved subtle deterministic zoom.

## Version every output-affecting fact

Pin immutable project revision, voiceover hash/probe, transcript/timeline, scheduler version/seed,
Avatar Profile version/source hash, Image Style version/profile hash, prompt compiler, runtime
profile, model/weights, container digest, volume manifest, crop, renderer, and output settings.

External attempt lineage additionally pins endpoint/template, dispatch token, provider job ID when
assigned, GPU policy/actual GPU, rate/timeouts, artifact reservations, receipts, timings, and cost.
Live availability and signed URLs are attempt state, not creative revision fields.

TypeScript remains the RFC 8785/JCS canonicalization authority. Python validates schemas, signatures,
semantic bindings, and exact hashes but treats the canonical JSON hash as opaque.

## Idempotency without false exactly-once claims

- Persist business mutation and outbox intent in one database transaction before any external call.
- Give each logical operation and provider attempt separate stable IDs and a unique dispatch token.
- A timeout is ambiguous, not proof the provider did nothing. Reconcile before replacement.
- RunPod `/run` does not provide a documented exactly-once/billing guarantee. Enforce at most one
  **accepted output** with current-assignment compare-and-swap; record bounded possible duplicate
  compute/cost rather than claiming it cannot occur.
- Provider callback, provider status, worker receipt, durable artifact, accepted application state,
  and settled cost are separate facts.
- Late/duplicate/superseded results are quarantined; they never silently overwrite accepted bytes.

## Fair, bounded admission

- Postgres owns fairness. RunPod's endpoint queue is backpressure only.
- Enforce one active provider workload per account and two from different accounts globally in one
  serializable admission transaction with a locked capacity/fairness row. Ordinary videos retain the
  one/account and two/global caps; explicit preset previews use those same slots only after every
  eligible video head.
- Preserve stable order inside an account unless its owner reorders waiting entries; always rotate
  fairly across eligible account heads.
- Users see and mutate only their own waiting rows; reordering cannot bypass another account's turn.
- Waiting work creates no provider/CPU request. Only admitted work may materialize dispatch outbox.
- Do not increase global or per-endpoint concurrency above two without new evidence and a decision.

## Immutable artifacts and tenant R2

- Large inputs/results live in private R2; database rows store exact keys, hashes, probes, and state.
- The server constructs tenant prefixes. Never accept an arbitrary client object key or URL.
- Signed URLs are short-lived, least privilege, exact-method, content-type/size/checksum bounded,
  tenant-authorized, and redacted from logs/database after expiry.
- Upload completion is not durability. Reopen/head the exact object, verify size/hash/media, then
  commit its receipt.
- Use content-addressed or attempt-unique keys; never overwrite an accepted object.
- Built-in preset media uses an explicit system prefix and contains no user data.

## Serverless worker design

- Keep separate immutable Mage and SoulX images/templates/endpoints. Do not create one shared
  image/media endpoint or import both model stacks into one worker.
- Each endpoint uses `workersMin=0`, `workersMax=2`, one GPU, and RTX 4090 only until a lane-specific
  RTX 5090 qualification passes.
- Ordinary boot loads only from the lane's existing isolated 50 GB `EU-RO-1` volume mounted at
  `/runpod-volume`. No download, repair, compilation into the volume, quantization, or cross-mount.
- Treat `/runpod-volume` as application-read-only even if the provider mount is writable. Redirect
  cache/config/temp/locks to a unique job-local scratch directory and compare pre/post manifests.
- Validate envelope, tenant, signature/hash, expiry, endpoint/model/volume, limits, and artifact
  reservations before expensive model load where possible.
- Load once per worker, perform a real warm-up, and process one admitted video's bounded lane batch.
- Upload item outputs directly to exact tenant reservations, emit an application-signed provenance
  receipt, then scrub scratch. The receipt is not provider hardware/billing attestation.
- Never use RunPod queue purge. Cancel only an exact authorized provider job.

## Timeouts and recovery

- Measure and set request TTL, execution timeout, handler deadline, idle timeout, and
  `RUNPOD_INIT_TIMEOUT`; do not inherit defaults blindly.
- TTL includes provider queue plus execution. A too-short TTL can remove running work.
- Persist normalized status because asynchronous provider results expire after 30 minutes.
- Poll exact provider job status. Webhooks are latency hints, not the sole truth.
- Bound retries by class and cost. A new provider attempt requires a new token and resolved prior
  ambiguity.
- Recovery after control-plane restart reads database/outbox/assignment/artifact truth first, then
  reconciles providers. It never reconstructs authority from a log or UI state.

## Truthful asynchronous UX

Show distinct states for account waiting, fair admission, preparing, dispatch pending/ambiguous,
provider queue, worker initializing, volume verified, model loading/warming/ready, generating,
uploading, artifact verifying, rendering, cancelling, retrying, blocked, failed, and complete.

Do not show manual Pod/GPU controls. Users click Generate once and the platform owns lifecycle. Do not
call a worker ready from container health, a task complete from provider `COMPLETED`, or compute zero
from an application label. Show private queue/capacity facts without exposing other tenants.

## Cost and cleanup

- Reserve before dispatch; reconcile estimate, provider report, possible duplicate exposure,
  settled amount, and refund per attempt/project.
- Judge a GPU by cold/warm cost per accepted output, not hourly rate alone.
- Scale workers to zero after demand and independently verify zero total workers (`Active + Flex`)
  and zero endpoint jobs after paid
  acceptance.
- Zero workers is not zero fixed cost: report the two retained 50 GB volumes and ongoing `$7/month`
  planning rate separately.
- Never delete or mutate a model volume during ordinary cancellation, project cleanup, account
  erasure, or endpoint scale-down.

## Security and secrets

- Browser bundles receive no RunPod, R2, database, signing, Runware, Cloud Run, or admin credential.
- Use least-privilege service identities, separate staging/production resources, key rotation, and
  redaction tests.
- Raw invite codes are never stored; verified-email redemption is atomic and replay-safe.
- Internal callbacks authenticate before expensive parsing where practical, enforce body/type/size
  limits, validate nonce/expiry/assignment, and reject cross-tenant or stale attempts.
- Apply CSRF/origin protection, secure cookies, upload sniffing, decompression limits, and media
  probing. Treat filenames and media metadata as untrusted.
- Never print secrets while running doctor, tests, provider preflight, or evidence collection.

## Hosted CPU workers

Whisper.cpp and FFmpeg run as pinned scale-to-zero Cloud Run Jobs in production, using tenant R2
reservations/receipts. They have no RunPod credential or model-volume mount. The same entrypoints may
run locally for provider-free parity, but production cannot depend on the user's Mac.

## Testing before optimization

Use schema/negative fixtures, PGlite migration/constraint tests, repository isolation tests,
property-based scheduler checks, fake Serverless transport, fault injection, worker unit/smoke tests,
real Workerd parity, installed-Chrome journeys, and then bounded live qualification. A fixture pass
does not prove a live provider; a live sample does not prove concurrency/security/economics.

Quality optimization follows measured output/timing/cost evidence. Do not add AI decision calls,
always-on workers, model fallbacks, speculative caches, or concurrency to solve an unmeasured issue.

## Repository discipline

- Keep provider-free mode default and fail closed when production bindings are absent.
- Use small green commits; preserve unrelated user work.
- Never commit secrets, signed URLs, private user media, third-party reference assets, model weights,
  or provider responses containing sensitive fields.
- Heavy x86 container builds run on approved hosted runners, not the user's Mac, and publish nothing
  unless the checkpoint explicitly authorizes publication.
- Every context/contract change passes context and schema validators. Every implementation handoff
  records checkpoint, commit, validations, remaining gates, provider/spend state, and compute
  shutdown state in `CURRENT_STATE.yaml`.

## Observability

Structured events use opaque IDs and include checkpoint, account/workspace hash or internal ID,
revision/request/task/attempt, lane, dispatch token hash, provider job ID hash, endpoint/runtime/
manifest IDs, state transition, duration, byte counts, cost class, and error code. Never log raw media,
voiceover content, prompts beyond approved redacted diagnostics, credentials, or signed URL queries.

Metrics cover admission latency, per-account wait, starvation, queue depth, worker count, cold/warm
readiness, inference/upload/render, accepted/rejected artifacts, retries/ambiguity, possible duplicate
cost, spend, zero-worker drain, and volume-manifest drift. Alerts point to exact attempts and bounded
runbooks; they never authorize automatic destructive repair.

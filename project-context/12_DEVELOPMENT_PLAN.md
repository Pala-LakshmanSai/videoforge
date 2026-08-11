# Development plan

Status: Phase 0–2 complete; prompt/style qualification and adapters green; VF-7-06 selected
Read when: opening a coding chat, sequencing work, assigning ownership, or accepting a milestone.

## Delivery strategy

Current checkpoint `20fd592` is fully provider-free and green. Phase 0A–2, VF-DX-01/02,
VF-REL-01, VF-4-01/02, VF-5-01, and VF-7-07 are complete. Current serial order is:
VF-5-02, VF-7-08, and VF-7-09. Provider gates,
staging, hardening, and release follow only from exact successor briefs and recorded authority.

Run coordinated local and viability tracks under the accelerated wave authority in
`21_IMPLEMENTATION_EXECUTION_PLAN.md`:

- **Experience track:** fixture-backed UI at the stable URL in the user's real Chrome with hot reload.
- **Viability track:** capped RunPod/Runware spikes replacing paper claims with measured VRAM, cold/warm time, accepted quality, rate, cost, and exact digests.

Shared schemas land first. Up to three disjoint implementation lanes run under one integration
owner. Each task/wave ends in a green commit, reproducible evidence, an updated
`CURRENT_STATE.yaml`, and a live-Chrome checkpoint. Provider calls use durable task contracts and
remain inactive until separately authorized.

## Milestone map

~~~mermaid
flowchart LR
    A["Completed Phase 0 + VF-1-01A"] --> B["Wave 1 Runtime + sandbox harness"]
    B --> C["Wave 2 Auth | Artifacts | Orchestration"]
    C --> D["Wave 3 Recovery"]
    B -. "separate activation" .-> V["Provider qualification"]
    D --> E["Wave 4 Isolation | Restore | Timing"]
    E --> F["Prompt then Mage"]
    E --> G["AvatarForcing"]
    E --> H["Custom styles"]
    V --> F
    V --> G
    V --> H
    F --> I["Real fast-path render"]
    G --> I
    G --> J["Fallbacks"]
    I --> K["Fault hardening"]
    H --> K
    J --> K
    K --> L["Controlled release"]
~~~

## Phase 0A: private repository and contract skeleton

Current: repo commands, sixteen contracts, cross-language validation/types, and TypeScript JCS
are complete. Schemas cover orchestration plus local ASR,
render, and probe boundaries. Python verifies exact bytes and treats canonical hashes as opaque;
durable database orchestration belongs to Phase 1.

- Initialize private Git; exclude research, private references, outputs, secrets, weights, and screenshots.
- Create the monorepo shape in `19_IMPLEMENTATION_PLAYBOOK.md`: web, shared packages, and four worker lanes.
- Pin Node, pnpm, Python, CUDA bases, FFmpeg, formatters, test runners, and lockfiles.
- Implement the strict-port, provider-free root commands and stable URL in `19_IMPLEMENTATION_PLAYBOOK.md`.
- Keep project request/revision, Avatar Profile version, Image Style, analyzer, timeline-plan,
  resolved-render, production-manifest, worker-job, and orchestration-state JSON Schemas canonical;
  expose them through parity-tested Zod/Pydantic entry points and golden valid/invalid fixtures.
- Add CI: typecheck, lint, unit/schema compatibility, local link/context validation, secret scan, dependency audit.
- Add `.env.example` with no values. Real provider mode defaults off.
- Keep GHCR provisional until pull/cache/storage/start behavior is measured.

Exit: TypeScript and Python validate identical fixtures; root commands work; a private initial commit exists.

## Phase 0B: fixture UI shell in live Chrome

Current (2026-08-10): `GATE_UI_001` remains closed. A later user-directed refinement maps the
preferred Chrome 80% appearance to real 100% through compact geometry; it is technically verified
and awaits final review.

- Implement compact 100%-zoom tokens, the full-width command bar, fixed-base scale-only dock, fixture routes, and matched preset Hubs/wizards.
- Create Project uses integrated app-native visual preset dropdowns, minimal voiceover copy with strict validation, no script field, a confirmation-free keyword opt-in, and truthful app-native `image_media`/`avatar_primary` profile selectors; planned candidates stay disabled until `GATE_GPU_001`.
- Implement every scenario ID from `19_IMPLEMENTATION_PLAYBOOK.md`, including preset draft preservation/version drift, extra-keyword off/conflict behavior, empty/invalid/ready/archived avatar states, cold start, style analysis, partial failure, fallback approval, budget block, ambiguous dispatch, reconciliation, cancellation, ready-for-review, and approved.
- Keep `http://localhost:4173` running/reused in the user's actual Chrome; inspect workflows as a human and capture approved feedback in `05_UI_UX_SPEC.md`.
- `+ New style` must preserve the entire project draft and return/select after publish.
- `+ New avatar` must preserve the entire project draft and return/select after approval; Create Project never offers an inline avatar upload.

Exit: user approves the core visual direction and can play through success/failure flows without real provider spend; hot reload preserves the active draft/fixture, and the compact fixture/health disclosure makes mode, health, commit, synthetic data, and `$0` authorization unmistakable on demand.

## Phase 0C: local walking vertical slice

Current (2026-08-10): the provider-free ASR, scheduler, render/probe, API, UI, and automated
acceptance are implemented. Real Chrome completed create, pipeline, playback, seek, approval, and
hash-verified download. The user then reviewed the final `ffmpeg-render-v3` replacement in installed
Chrome and accepted its continuous 2.5–3.5% centered zoom as “good enough.” Phase 0C is closed.
That historical checkpoint was process-local; the Phase 1 and 2 handoffs now add the durable local
control-plane and strict timing/runtime restart/restore boundaries described below.

- Use 30–120 seconds of owned/synthetic English audio.
- Use one owned synthetic ready Avatar Profile fixture, then run local `whisper.cpp base.en`, deterministic phrase/timeline scheduling, `timeline-plan/v1`, fixture image/avatar slots, `resolved-render-manifest/v1`, real FFmpeg zoom/crops/hard cuts/audio, and technical QA.
- Play/seek the actual 1080p30 MP4 in Chrome.
- Prove split requires two assets, every image zooms, AvatarForcing's profile/crop/25→30 conversion is deterministic, and frame coverage has no gaps/overlaps.

Exit: a short end-to-end video works before any cloud model integration.

## Phase 0D: capped viability spikes

These may run in parallel after shared contracts exist. Every task defaults to no external calls until an explicit budget is authorized.

### Runware DeepSeek

- Test 40–60 representative phrases using sanitized title once per 25–50-scene batch, assigned in-image shot roles, continuity carry, thinking off, and strict JSON.
- Verify exact 0731 identity, schema/scene ID fidelity, latency, and reported cost.

### Mage

- Build exact candidate worker; test 1024×576, 1280×720, 1536×864, and 8:9.
- Run representative prompts and a 300-image batch; measure cold/load, batching, VRAM, failure/retry, accepted-image cost, style adherence, and final zoom detail.
- Retrieve exact checkpoint/license evidence. Mage-Flow-Turbo is T2I; reference editing is a separate deferred model/path.

### Avatar ladder

- Use several owned/approved representative Avatar Profile versions and 12–20 representative audio clips across the suite.
- Test AvatarForcing on 4090 first; record fit, cold/load, frame time, identity, lips, background/body motion, 25→30 cadence, full/split crops, and accepted cost.
- Measure the optional three-clip per-profile compatibility workflow separately; saving a ready profile must still make zero model calls.
- Classify one lip-only failure and one whole-frame failure explicitly; exercise retry/MuseTalk/SkyReels lineage only with authorized spend.

### Image Style analyzer/adherence

- Test Runware Gemini 3.5 Flash with complete request/schema, coherent/conflicting/outlier references, trait coverage, privacy disclosure, latency/cost, and content separation.
- Seed `documentary_stock_v1` locally without sending Ranga frames.
- Compare fixed neutral Mage prompts across the built-in plus four distinct custom styles.

Exit: relevant gates pass or the user receives concrete evidence/tradeoffs before any model/architecture change.

## Phase 1: durable control-plane walking slice

- Begin with `VF-1-01` from `tasks/VF-1-01.md`: committed additive PostgreSQL SQL migrations,
  query-library-neutral repository contracts, and provider-free PGlite migration/constraint tests
  in a new `@videoforge/control-plane` package. This locks durable semantics without Docker, a live
  Neon connection, credentials, or a premature ORM/runtime-driver choice.
- `VF-1-02` then makes Hono runtime-neutral and adds local Cloudflare Worker/Vite emulator bindings;
  provider-free `VF-0D-01` may build its isolated sandbox harness in parallel. Deployment remains
  separately authorized.
- Only after those shared foundations commit may Auth (`VF-1-03`), R2 artifact storage
  (`VF-1-04`), and Postgres/outbox/workflow orchestration (`VF-1-05`) run as disjoint parallel
  adapters under one integration owner.
- `VF-1-06` is the serial mock dispatch/reconciliation checkpoint. After it freezes the contract,
  `VF-1-07` two-account isolation/large-upload/avatar reuse and `VF-1-08` metadata export/restore
  run in parallel.
- One Cloudflare Vite Worker deployment with React static assets, Hono `/api/*`, Workflows/R2 bindings; Neon migrations/test DB.
- Better Auth Google OAuth plus admin allowlist/memberships; no email provider.
- R2 signed multipart transfers, checksums, project/revision CRUD, archive/access control.
- Avatar Profile parent/version CRUD, private source upload, normalization/metadata stripping, validation, rights/likeness consent, ready activation, optional test evidence, archive, and exact revision binding before any project revision can start.
- Built-in style seed/pinning first so the video path is not blocked by the full custom-style workflow.
- Minimal durable task/attempt/outbox/cost-reservation/workflow/callback/reconciliation/cancellation path **before** live media workers.
- Mock worker proving `DISPATCHING → DISPATCH_ACK_UNKNOWN → RECONCILING`, execution claims, duplicate suppression, signed callbacks, and one accepted result.
- Execution-profile records and API-only RunPod endpoint preflight/reconciliation contract.
- Scheduled metadata backup/export plus an early restore smoke.

Chrome checkpoint: two invited fixture/test accounts see only permitted data; a persisted mock job survives restart/reconciliation and large audio bypasses Worker bodies.

The Chrome checkpoint also creates a named Avatar Profile once, selects it by image/name in a project, and proves the project request contains no raw avatar asset/upload path.

## Phase 2: word timing and deterministic timeline compiler

Current (2026-08-10): complete. `VF-2-01` through `VF-2-05` are committed and green. The final
implementation/evidence pair is `907e0e4`/`d16c2a9`; it proves strict latest-attempt restore,
materialized selected-span audio, byte-equivalent timing/timeline/media, and real installed-Chrome
playback/approval/download at `$0`.

- `VF-2-01` first commits the additive timing/timeline persistence contract. Then `VF-2-02`
  transcription/span audio, `VF-2-03` deterministic timeline, and `VF-2-04` Chrome inspection run
  in disjoint lanes; `VF-2-05` serially integrates and accepts the phase.
- Add image/media `transcribe` job using local `whisper.cpp base.en`; benchmark CPU behavior without evicting Mage.
- Deterministic optional-script reconciliation for legacy non-null API inputs; the web shell uses ASR text; word/sentence/phrase records.
- Seeded timeline composition and in-image shot-role scheduler.
- Canonical 30 fps frame conversion, `timeline-plan/v1` validation, selected avatar span-audio materialization.
- Show the timeline strip/coverage in Chrome using real audio.

Exit: identical input/seed/version yields byte-equivalent plan; no gap/overlap; full/split/image bounds pass.

## Phase 3: Runware prompt lane

Current (2026-08-11): `VF-3-00` through `VF-3-09` completed the gate refresh, bounded DeepSeek and
Gemini qualification, deterministic prompt/style semantic foundations, provider-free injected
adapters, RunPod account preflight, public Git/CI checkpoint, and read-only Mage evidence audit.
`GATE_LLM_001` and `GATE_STYLE_001` are closed. Runtime provider composition is still disabled;
Mage/Avatar/GPU/RunPod/cost gates and exact task authority still block production media.

- Strict schema, title/style prefix once per batch, assigned shot roles, continuity carry, 25–50 scenes, partial retry, provider cost logging.
- Deterministic prompt compiler with pinned style profile, crop guidance, optional keywords, permanent guardrails, exact submitted bytes/hashes.
- Disabled keyword text neither blocks nor reaches providers; enabled blank/conflicting text follows the documented validation semantics.
- Stream valid batches without waiting for the entire project.

Chrome checkpoint: inspect phrases, title context, shot roles, style version, toggle, components, hashes, and per-item retry.

## Cross-cutting DX/reliability foundation

Complete. `VF-DX-01` reduced forced verification by 33.05% with identical coverage; `VF-DX-02`
added split CI/doctor/owned dev commands; `VF-REL-01` added vendor-neutral telemetry. Hosted split
CI remains unverified because current work grants no push/dispatch authority.

## Phase 4: Mage image lane

Current provider-free status: VF-4-01 durable production-code PGlite prompt execution is complete
at `1fba04c`. VF-7-07 persistence is complete at `20fd592`; VF-4-02 deterministic Mage-shaped
fixture image result acceptance is complete at `bbb0a48`. Real Mage/RunPod execution remains
gate-blocked.

- RunPod endpoint/template/volume and API-only configuration preflight.
- Async chunks, execution claim, per-item checkpoint/upload/callback, bounded provider queue, fair owner rotation.
- Execution profiles and model-ready versus container-ready.
- Image preview/regenerate/auto-selected draft semantics; slow zoom for full and split.
- Cross-style/no-reference-content leakage fixtures and cost events.

Exit: real batch meets the measured Phase 0 envelope, recovers a failed chunk, and scales to zero.

## Phase 5: AvatarForcing primary lane

Current provider-free status: VF-5-01 deterministic fixture worker is complete. VF-5-02 must
compose results into durable control-plane acceptance. Real AvatarForcing remains blocked by
license, Avatar, GPU, and RunPod gates.

- Resolve only the revision-pinned Avatar Profile binding; workers never read a mutable active/latest profile pointer.
- Materialized padded per-span audio only; never send full voiceover.
- Resident-model chunking, technical auto-checks, selected-draft semantics, explicit user subjective defect classification.
- One clip/two layouts, exact crop and deterministic 25→30 tests.
- Retry and cost lineage.

Chrome checkpoint: user reviews exact-avatar full/split clips and can flag lip-only versus whole-frame failure.

## Phase 6: real fast-path render

- Close the asset barrier into immutable `resolved-render-manifest/v1`.
- Versioned FFmpeg compiler: eased zoom on every image, source-profile-validated fixed crops, direct 25→30 AvatarForcing or 24→30 SkyReels conversion, hard cuts, original voiceover, loudness policy, H.264/AAC.
- FFprobe QA/checksum, `READY_FOR_REVIEW` signed Chrome play/seek preview, explicit approval, then immutable production provenance manifest and approved download.
- Run short jobs first, then a full 30-minute fast-path measurement.

Exit: output matches the spec and measured fast-path cost/SLO can replace planning ranges.

## Phase 7: full custom Image Styles lifecycle

Current (2026-08-11): `VF-7-01` through `VF-7-07` are committed and green. Durable version
lifecycle, exact reference metadata, claimed analyzer composition, atomic canonical result
acceptance, immutable root/derived artifacts, production PGlite edit persistence, exact-current-byte
publication, and metadata restore are complete. Routes, UI, upload/normalization, previews, live orchestration,
and `GATE_STYLE_002` remain incomplete.

- Parent/version/reference/attempt/preview records and version-scoped APIs.
- Browser normalized sRGB derivatives plus independent server structure/metadata/checksum/decompression validation.
- Rights/non-ZDR disclosure, retention, durable cover, analyze/retry/abandon/review/edit/test/atomic publish/duplicate/archive.
- Published v1 stays selectable during v2; deleted refs require explicit retained reuse or fresh upload.
- Project-form round trip preserves draft inputs.

Chrome checkpoint: create/analyze/review/test/publish/select a style and prove ordinary video generation makes zero analyzer calls.

## Phase 8: conditional avatar fallbacks

- User-confirmed defect classification activates the approved router.
- MuseTalk only for otherwise-good lip failure; SkyReels from the same revision-pinned canonical runtime source for whole-frame failure.
- Preserve SkyReels' accepted 1280×720/24 source through its own renderer profile and prove both native full/split crops plus direct 24→30 cadence; never force it through AvatarForcing's source profile.
- Budget reservation/approval before heavy fallback; no redundant call and no global primary swap without user-approved threshold.

Exit: forced fixtures prove source lineage, cost cap, discard behavior, and cold scale-to-zero.

## Phase 9: multi-user and fault hardening

- Ten-user fair queue; bounded dispatch window and workspace/project concurrency caps.
- Endpoint three/seven-day idle reduction to `workersMax=2/0` plus other config drift, no capacity, expired URLs, ambiguous ack, OOM, crash after partial upload, lost/duplicate/out-of-order callbacks, balance exhaustion, cancellation, and control-plane restart.
- Free-tier usage alarms, retention lifecycle, security review, backup/restore drill.
- Measure isolated service time separately from queue wait and capacity.

Exit: no corrupted revision/orphan worker; one accepted result; duplicate execution/billing is surfaced/reconciled; caps and isolation hold.

## Phase 10: production and real-Chrome acceptance

- Fresh-account API setup, production secrets/least privilege, migrations, monitoring, current price/profile refresh.
- Create/store/version/archive an Avatar Profile, select it without re-upload, then submit, monitor, review, regenerate, cancel, fallback, render, download, and archive in the user's Chrome.
- Verify exact commit, container digests, endpoint profiles, model hashes, private artifact provenance, backup restore, and scale-to-zero.

Exit: user signs off on UI, output, speed, budget, and recovery.

## Safe parallel ownership

Safe after shared contract lock:

- Fixture UI vs isolated capped model spikes.
- Style UI/schema vs analyzer bakeoff.
- Avatar Hub UI vs disjoint model-worker bakeoff after shared profile contracts lock.
- Mage worker vs AvatarForcing worker.
- Targeted tests vs disjoint implementation module.

Serialize edits to shared schemas, state machines, migrations, root UI shell, and context authority. Integrate frequently.

## Deferred AI B-roll video

Do not implement. A future extension needs its own user decision, model/license/cost bakeoff, worker/volume, prompt/QA contract, and timeline enums. Images remain default.

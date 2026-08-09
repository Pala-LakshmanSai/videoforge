# Development plan

Status: implementation underway; Phase 0A and the Phase 0B fixture shell are complete, with `GATE_UI_001` awaiting user approval
Read when: opening a coding chat, sequencing work, assigning ownership, or accepting a milestone.

## Delivery strategy

Run two coordinated tracks from the first development day:

- **Experience track:** fixture-backed UI at the stable URL in the user's real Chrome with hot reload.
- **Viability track:** capped RunPod/Runware spikes replacing paper claims with measured VRAM, cold/warm time, accepted quality, rate, cost, and exact digests.

Shared schemas land first. Every milestone ends in a small green commit, reproducible evidence, an updated `CURRENT_STATE.yaml`, and a live-Chrome checkpoint when user-visible. Do not build a polished disconnected UI or throwaway provider calls that bypass durable task contracts.

## Milestone map

~~~mermaid
flowchart LR
    A["0A Private repo + contracts"] --> B["0B Fixture Chrome shell + preset hubs"]
    A --> C["0C Local short-video slice"]
    A --> D["0D Capped viability spikes"]
    B --> E["1 Durable control-plane slice"]
    C --> E
    E --> F["2 Timing + timeline plan"]
    F --> G["3 DeepSeek prompt lane"]
    G --> H["4 Mage image lane"]
    D --> H
    F --> I["5 AvatarForcing lane"]
    D --> I
    H --> J["6 Real fast-path render"]
    I --> J
    J --> K["7 Custom Image Styles"]
    K --> L["8 Conditional fallbacks"]
    L --> M["9 Multi-user/fault hardening"]
    M --> N["10 Production acceptance"]
~~~

## Phase 0A: private repository and contract skeleton

- Initialize private Git; keep third-party research, private references, outputs, secrets, model weights, and local UI screenshots out of tracked/public artifacts.
- Create pnpm/Turborepo layout: `apps/web` (Vite React + same-origin Hono Worker API), `workers/image-media`, `workers/avatar-primary`, `workers/avatar-repair`, `workers/avatar-quality`, `packages/contracts`, `packages/config`, and `packages/test-fixtures`.
- Pin Node, pnpm, Python, CUDA bases, FFmpeg, formatters, test runners, and lockfiles.
- Implement the stable commands and URL in `19_IMPLEMENTATION_PLAYBOOK.md`, including `doctor`, strict-port `dev`, `dev:status`, `dev:open`, provider-free `verify`, fixture default, Chrome smoke, and context validation.
- Convert project request/revision, Avatar Profile version, Image Style, analyzer, timeline-plan, resolved-render, production-manifest, job, event, and state-machine contracts into cross-language Zod/Pydantic types and golden fixtures.
- Add CI: typecheck, lint, unit/schema compatibility, local link/context validation, secret scan, dependency audit.
- Add `.env.example` with no values. Real provider mode defaults off.
- Configure a private GHCR candidate/profile for worker containers; benchmark image pull/cache/storage/start behavior before treating it as locked.

Exit: TypeScript and Python validate identical fixtures; root commands work; a private initial commit exists.

## Phase 0B: fixture UI shell in live Chrome

- Implement tokens, persistent/collapsible sidebar, queue, Create Project, Avatar Hub, Image Styles Hub/wizard, progress, review, usage, settings, and library against deterministic fixtures.
- Implement every scenario ID from `19_IMPLEMENTATION_PLAYBOOK.md`, including preset draft preservation/version drift, extra-keyword off/conflict behavior, empty/invalid/ready/archived avatar states, cold start, style analysis, partial failure, fallback approval, budget block, ambiguous dispatch, reconciliation, cancellation, ready-for-review, and approved.
- Keep `http://localhost:4173` running/reused in the user's actual Chrome; inspect workflows as a human and capture approved feedback in `05_UI_UX_SPEC.md`.
- `+ New style` must preserve the entire project draft and return/select after publish.
- `+ New avatar` must preserve the entire project draft and return/select after approval; Create Project never offers an inline avatar upload.

Exit: user approves the core visual direction and can play through success/failure flows without real provider spend; hot reload preserves the active draft/fixture, and the fixture-only status ribbon makes mode/health/commit unmistakable.

## Phase 0C: local walking vertical slice

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

- Add image/media `transcribe` job using local `whisper.cpp base.en`; benchmark CPU behavior without evicting Mage.
- Optional-script deterministic token reconciliation; word/sentence/phrase records.
- Seeded timeline composition and in-image shot-role scheduler.
- Canonical 30 fps frame conversion, `timeline-plan/v1` validation, selected avatar span-audio materialization.
- Show the timeline strip/coverage in Chrome using real audio.

Exit: identical input/seed/version yields byte-equivalent plan; no gap/overlap; full/split/image bounds pass.

## Phase 3: Runware prompt lane

- Strict schema, title/style prefix once per batch, assigned shot roles, continuity carry, 25–50 scenes, partial retry, provider cost logging.
- Deterministic prompt compiler with pinned style profile, crop guidance, optional keywords, permanent guardrails, exact submitted bytes/hashes.
- Disabled keyword text neither blocks nor reaches providers; enabled blank/conflicting text follows the documented validation semantics.
- Stream valid batches without waiting for the entire project.

Chrome checkpoint: inspect phrases, title context, shot roles, style version, toggle, components, hashes, and per-item retry.

## Phase 4: Mage image lane

- RunPod endpoint/template/volume and API-only configuration preflight.
- Async chunks, execution claim, per-item checkpoint/upload/callback, bounded provider queue, fair owner rotation.
- Execution profiles and model-ready versus container-ready.
- Image preview/regenerate/auto-selected draft semantics; slow zoom for full and split.
- Cross-style/no-reference-content leakage fixtures and cost events.

Exit: real batch meets the measured Phase 0 envelope, recovers a failed chunk, and scales to zero.

## Phase 5: AvatarForcing primary lane

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

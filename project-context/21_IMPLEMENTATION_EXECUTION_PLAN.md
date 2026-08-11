# Implementation execution plan

Status: `VF-5-02` complete at `e0bec7e`; `VF-7-08` Style edit API selected
Read when: selecting, implementing, integrating, or handing off one task.

## Authority

`CURRENT_STATE.yaml` selects one task. Load only its named read profile and exact brief. Product
behavior remains normative in the decision ledger and primary domain files. Missing brief,
contradictory context, unexplained dirty state, failed gate, or new external authority stops work.

Shared migrations, repository/unit-of-work adapters, contracts, routes, lockfiles, context, and final
integration are serial. Parallel work is allowed only for explicitly disjoint directories and
recorded ownership. Each completed task ends with one green implementation commit, evidence,
refreshed `CURRENT_STATE.yaml`, and exactly one successor brief.

## Preserved completed baseline

Completed work is compressed here; Git, evidence, and `CURRENT_STATE.yaml.completed_tasks` retain
exact history.

- Phase 0A–0C: contracts/tooling, accepted fixture Chrome shell, local ASR/scheduler/FFmpeg slice,
  installed-Chrome create/play/seek/approve/download, and accepted smooth zoom.
- Phase 1–2: durable provider-free control plane, recovery, isolation, direct transfer, metadata
  restore, timing/timeline, selected Avatar spans, and byte-equivalent reopen/restore.
- Provider qualification foundations: DeepSeek and Gemini gates closed; injected adapters remain
  runtime-disabled. Mage and AvatarForcing legal/model gates remain open.
- DX/reliability: `VF-DX-01/02` and `VF-REL-01` complete.
- Image Styles: `VF-7-01` through `VF-7-06` complete through byte-identical publication and the
  preserve-and-detach provenance contract.
- Provider-free media foundations: VF-4-01 durable prompt execution is complete at `1fba04c`,
  VF-5-01 deterministic Avatar fixture worker is complete at `fcb8f31`, and VF-7-07 durable style
  derived-artifact persistence is complete at `20fd592`.
- VF-4-02 durable fixture image acceptance is complete at `bbb0a48`; VF-5-02 durable fixture Avatar
  acceptance is complete at `e0bec7e`.
- VF-5-02 checkpoint: focused 4/4, control-plane 209/209, aggregate 762, Workerd 1/1,
  installed Chrome 38/38, zero skips, fixture mode, `$0`; development server stopped.

Do not redesign accepted shell/dock/Hubs, rerun architecture research, replace the renderer, change
output grammar, or redo completed tasks.

## Current serial provider-free sequence

### 1. VF-4-01 — complete

Migration `0009` and the production PGlite prompt store are committed at `1fba04c`; evidence is
`evidence/acceptance/VF-4-01/durable-fixture-prompt-execution`. Do not redo it.

### 2. VF-7-07 — complete

Migration `0010`, immutable root/derived artifacts, PGlite edit persistence, exact-current-byte
publication, and metadata restore are committed at `20fd592`; evidence is
`evidence/acceptance/VF-7-07/style-derived-edit-service`. Do not redo it.

### 3. VF-4-02 — Mage-shaped fixture image lane

Complete at `bbb0a48`; evidence is
`evidence/acceptance/VF-4-02/fixture-image-result-acceptance`. Do not redo it.

- Deterministic fixture worker input/result handling; no weights or outbound calls.
- Persist prompt/task/attempt/outbox/cost/technical-validation/accepted-image/callback lineage.
- Reject malformed media, checksum/profile/style drift, replay conflicts, cancellation, and
  cross-workspace confusion.
- On completion author exactly one successor brief: VF-5-02.

### 4. VF-5-02 — Avatar result acceptance

Complete at `e0bec7e`; evidence is
`evidence/acceptance/VF-5-02/avatar-result-acceptance`. Do not redo it.

- Compose VF-5-01 output into durable task/attempt/asset/QA/cost records.
- Preserve one native clip for full/split layouts, exact Avatar/span lineage, retry/cancel/callback
  fencing, and explicit subjective review classification.
- On completion author exactly one successor brief: VF-7-08.

### 5. VF-7-08 then VF-7-09 — Style API and Hub

- VF-7-08 selected now. Use `phase7_style_edit_api` and `tasks/VF-7-08.md` only: full-candidate
  `PATCH /api/v1/image-styles/{style_id}/versions/{version_id}` with `If-Match` and
  `Idempotency-Key`; move shared DTOs to versioned contract exports.
- VF-7-09: browser/server normalization, upload/review/publish/select flows, fixture-backed
  installed-Chrome coverage.
- Preserve accepted UI design and ordinary-video zero-analysis behavior.
- On VF-7-08 completion author exactly one successor brief: VF-7-09.

## Provider gates and real-video milestone

License investigation may run read-only alongside provider-free work. Resource mutation and paid
qualification remain serial.

1. Resolve exact authoritative Mage checkpoint/license evidence.
2. Resolve AvatarForcing code/weights/commercial-license evidence.
3. If ambiguity remains, stop that lane and record a replacement-model decision; never download
   around a blocker.
4. Only after an exact paid brief and recorded authority, qualify Mage and AvatarForcing quality,
   latency, VRAM, retries, batching/cadence, cost, and scale-to-zero.
5. Prove RunPod config repair, ambiguous acknowledgement, claims, callback replay,
   duplicate-cost visibility, cancellation, and drain-to-zero.
6. Close image, Avatar, GPU, RunPod, style-adherence, and relevant cost gates before enabling any
   selectable profile.
7. Produce one real 30–120-second video through the accepted barrier and FFmpeg v3.
8. In installed Chrome verify contact-sheet review, play, seek, explicit approval, hash-matched
   download, and downloaded MP4 playback.

Fallback models are not required for this milestone. Rejected primary assets return to explicit
regeneration/review.

## Staging, hardening, release

After the real-video milestone and exact successor briefs:

- Split oversized PGlite/artifact adapters by capability without changing interfaces.
- Add isolated Neon, private R2 direct transfer, Better Auth/Google admission, Cloudflare Workflow
  recovery, and fail-closed bindings as separate small tasks.
- Add ten-user fairness/contention, restart, callback, config drift, cancellation, budget,
  isolation, and security tests.
- Add encrypted metadata backups, R2 integrity inventory, clean-target restore drills, and
  telemetry-backed fault evidence.
- Complete live custom-style Gemini orchestration and optional gated Mage previews.
- Run representative 30-minute cold/warm jobs, then at least ten completed runs before p50/p90.
- Finish with fresh-account production Chrome acceptance, exact commit/container/model/profile
  evidence, cost review, restore proof, scale-to-zero, and user sign-off.

## Development and verification rules

- Provider mode defaults to `fixture`; ordinary verification performs zero provider calls and `$0`.
- No credential, provider, GPU, cloud, push, download, or spend action without exact recorded
  authority.
- Use focused tests and `pnpm verify:fast` during implementation.
- At integration checkpoints run forced `CI=1 TURBO_FORCE=true pnpm verify`, then
  `pnpm context:validate`, `pnpm secret:scan`, Prettier checks, dependency audit, and
  `git diff --check`.
- Never skip, weaken, delete, or silently reinterpret a check or schema.
- Use additive migrations. Preserve accepted data and rollback with normal Git revert.
- Reuse only the owned stable loopback URL when Chrome is needed; never disturb another server.
- Preserve exact Avatar/style version pins and accepted UI/output behavior: three compositions,
  hard cuts, realistic footage, required slow image zoom, and no captions/text/graphics/borders/
  watermarks/decorative transitions.

## Completion boundary

VideoForge is complete only after durable multi-user production recovery, measured provider/model/
GPU/cost gates, backups/restore, scale-to-zero, full real Chrome create-through-downloaded-playback,
clean full verification, exact provenance, and explicit user sign-off. Provider-free code or one
real artifact alone is not production completion.

## Fresh-chat start

Read `AGENTS.md`, `00_START_HERE.md`, `MANIFEST.yaml`, and `CURRENT_STATE.yaml`; confirm clean HEAD
descends from recorded checkpoint; then load only selected profile and brief. Preserve all commits.
Do not run a new research pass. Finish, verify, commit, refresh state, and author exactly one
successor brief before loading any later profile.

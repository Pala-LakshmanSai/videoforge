# VideoForge: start here

Status: CP-01 complete after persisted-authority fix and provider-free re-audit; CP-02 not started
Context schema: `1.5`  
Last updated: `2026-08-13`

VideoForge is an invite-only voiceover-to-video app for 5–10 teammates. Input: title, final
voiceover, exact ready Avatar Profile version, and immutable Image Style version. Output: a fully
assembled local/downloadable 1920×1080 MP4. No Premiere import or manual alignment is part of the
product flow.

The output grammar is only full avatar, full AI image, or avatar-left/image-right split. Hard cuts
only. Every AI image uses a slow, smooth centered zoom. No captions, titles, text overlays, lower
thirds, borders, watermarks, motion graphics, decorative graphics, or decorative transitions.

## Authoritative MVP and compute lifecycle

VideoForge is one global shared application for 5–10 admitted users. Everyone sees the same
projects, results, Avatar Hub, Image Styles Hub, generation session, and manually ordered queue,
with equal product rights and actor audit. Signup is closed: each new identity uses email/password
or Google plus one unique, single-use invite code bound to the same verified email. Admission and
code consumption are atomic. Returning admitted users never see the invite challenge again.

VideoForge has two isolated model lanes:

| Lane | Exact active model | Durable model storage | Disposable compute |
|---|---|---|---|
| Images | ImageForge's current `Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6` INT8 ConvRot profile, pinned ComfyUI, 4 steps, guidance 1.0, 1280×720 | Mage-only persistent `EU-RO-1` network volume | Mage-only Pod |
| Avatar | EchoMimicV3-Flash FP8 from pinned first-party source/weights/base/audio lineage | Different Echo-only persistent `EU-RO-1` network volume | Echo-only Pod |

Never share or cross-adopt a volume, Pod, manifest, cache, lock, or runtime between lanes. Volume
capacities are not yet approved; derive each from its verified exact manifest plus explicit
headroom before provisioning. Persistent-volume pricing is accepted.

When no generation session exists, the first user explicitly selects one exact live compatible
Secure Cloud offering for Mage and one for Echo. The first atomically accepted Generate locks that
pair for the session and starts both required Pods concurrently. Exactly one video is active. New
projects join the shared queue and inherit the locked pair; waiting projects are orchestration-inert
until promoted after the active video is terminal.

For the active video, the Cloud Run whisper.cpp job, deterministic scheduling, prompts, and selected
avatar-span preparation overlap Pod boot. Ordinary boots download no model files: each Pod verifies
only its lane volume, loads the exact model, runs a real warm-up, and then reports authoritative
`model_ready`. An already-running lane Pod stays warm when projects are waiting. If no project is
waiting when a lane finishes, delete that exact Pod immediately and prove absence, without waiting
for the other lane or final render. A later waiting entry never recreates a missing Pod early; the
next active project may recreate it only on the same locked GPU after fresh availability/rate
revalidation. The session unlocks only after active and waiting work are empty and both Pods are
proven absent. Both model volumes remain.

Production word transcription and final FFmpeg render/probe run as scale-to-zero Cloud Run Jobs
over private R2. The same pinned media path runs on the Mac only for development parity. The ideal
Pod model-ready target is at most two minutes. The user's ImageForge experience of roughly three to
four minutes is a comparison baseline, not a measured VideoForge result.

## Current handoff

The earlier Serverless/ephemeral `VF-9-24I` paid retry is superseded and non-executable. It produced
no MP4. Its evidence, failed attempts, measured costs, and final zero-resource observations remain
historical truth; its former `$8` ceiling does not authorize the new two-volume/two-Pod lifecycle.
No current provider call, credential use, model download, Pod creation, volume creation, or spend is
authorized.

`VF-9-24L` completed the global-shared-MVP audit, every-fifth-frame Ranga recheck, architecture
reconciliation, and balanced completion roadmap. `VF-9-24K`/`CP-01` then completed at implementation
commit `9ee3267fb0c1ccf0a275a723d0ccf6dee4ad57b7` as a bounded `$0` provider-free task. It added
versioned admitted-identity, singleton session, immutable GPU pair, global queue, isolated volume,
Pod lifecycle/absence, durable-output/cost, and Pod-dispatch contracts plus an additive migration,
repository, restore proof, and legacy import firewall. Current v1 machine bytes remain
legacy/provider-free and cannot enter the new Pod dispatch boundary.

The later independent audit found that a coherently rewritten foreign dispatch tuple could pass the
in-memory firewall and that durable output rows did not prove exact Pod ownership. Fix commit
`522ed6112d39e0bcbd03955ad753b79cef2fdb6d` adds append-only exact-envelope dispatch authority,
active persisted tuple verification before the paid port, and queue/lane ownership enforcement for
durable model output. Fresh, upgrade, restore, schema, adversarial, canonical, and Chrome gates pass.
The current proof is `evidence/acceptance/VF-9-24K/cp01-global-session-contracts/reaudit-after-authority-fix.json`.
Older acceptance files remain historical. `CP-02` has not started. All production gates remain open.

No VideoForge persistent model volume exists yet. Future provisioning/preparation is a separate
explicitly authorized provider task after contracts and offline workers are green.

## Locked active providers

| Role | Choice |
|---|---|
| Image prompts | Runware DeepSeek V4 Flash 0731 |
| Style analysis | Runware Gemini 3.5 Flash, only when explicitly analyzing a new style draft |
| Images | Exact ImageForge Mage-Flow INT8 ConvRot profile |
| Avatar | EchoMimicV3-Flash FP8, short selected spans only |
| Avatar repair/fallback | `null` |
| Timing | Pinned `whisper.cpp base.en` in Cloud Run Jobs; same path on Mac for development |
| Render | Direct FFmpeg in Cloud Run Jobs; same path on Mac for development |

AvatarForcing, MuseTalk, SkyReels, earlier Mage BF16, Serverless endpoints, ephemeral model caches,
and Echo Long Video CFG remain historical evidence only. They authorize no active dispatch.

## Absolute rules

- Project selects an exact ready stored Avatar Profile version; no project-local avatar upload.
- Project pins an immutable published Image Style; ordinary generation makes no style vision call.
- Send Echo only scheduler-selected short spans, normally 2–6 seconds; opener maximum 7 seconds.
- One native Echo clip serves full and split layouts after measured crop acceptance.
- Deterministic code owns timing/layout. Fully automatic assembly returns the final MP4.
- Exactly one active video; waiting entries do no CPU/GPU work until atomic promotion.
- All admitted users have equal shared access; only waiting queue entries may move or be removed.
- API-only RunPod control; exact create/delete intent and fail-closed ambiguity reconciliation.
- At most one disposable Pod per lane initially. Delete Pods; retain the two intended volumes.
- Private inputs, outputs, credentials, and model bytes never enter Git or public images.
- Technical success is `READY_FOR_USER_REVIEW`; only the user approves visual quality.

## Context navigation

Read `MANIFEST.yaml`, `CURRENT_STATE.yaml`, then only the selected profile and task. Normative
decisions: `15_DECISIONS_AND_OPEN_GATES.md`; architecture: `06_SYSTEM_ARCHITECTURE.md`; models:
`08_MODELS_AND_PROVIDERS.md`; pipeline: `07_PIPELINE_AND_SCHEDULER.md`; RunPod:
`09_RUNPOD_AND_QUEUE_OPERATIONS.md`; contracts: `10_DATA_AND_API_CONTRACTS.md`; cost:
`11_COST_SPEED_BUDGET.md`; acceptance: `14_TESTING_AND_ACCEPTANCE.md`; execution:
`21_IMPLEMENTATION_EXECUTION_PLAN.md`; completion checkpoints:
`22_PROJECT_COMPLETION_CHECKPOINTS.md`; copy-ready prompts:
`templates/CHECKPOINT_CHAT_PROMPTS.md`; maintenance: `16_CONTEXT_MAINTENANCE.md`.

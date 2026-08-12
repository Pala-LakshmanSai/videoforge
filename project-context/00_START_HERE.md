# VideoForge: start here

Status: `VF-9-24` stopped by one-worker/no-retry guard; awaiting new authority
Context schema: `1.5`  
Last updated: `2026-08-12`

VideoForge is an invite-only web app for 5–10 teammates. Input: title, final voiceover, exact ready
Avatar Profile version, and immutable Image Style version. Output: 1920×1080 YouTube video using
only full avatar, full AI image, or avatar-left/image-right split. Hard cuts only. Every AI image
uses a slow, smooth centered zoom. No captions, titles, text overlays, lower thirds, borders,
watermarks, motion graphics, decorative graphics, or decorative transitions.

## Current handoff

User superseded active AvatarForcing route with `DEC_AVATAR_007`: EchoMimicV3-Flash native output is
sole active avatar path. AvatarForcing, MuseTalk, and SkyReels remain immutable historical
evidence/replay only; no new dispatch. `VF-9-21` preserves `$0.4496891390` spend and zero-reviewable-
output evidence. LongCat remains excluded.

`VF-9-22` pinned public/ungated source, Flash weights, Wan base, and audio encoder revisions plus
license artifacts and an exact `23,922,317,735`-byte selected runtime manifest under
`evidence/gates/GATE_AVATAR_004/2026-08-12-echomimic-v3-flash-preflight/`. No model bytes,
credentials, providers, GPUs, or spend were used. `GATE_AVATAR_004` remains open until worker
bootstrap reproduces the manifest. `GATE_AVATAR_001` remains open until sample/full qualification.

`VF-9-23` published the production-shaped worker as
`ghcr.io/pala-lakshmansai/videoforge-avatar-primary@sha256:e4a4b71e5e706ef6da4a62cdc7fa87e0c599e9fe2fa702fea73081ed19b86d73`.
Container smoke, full local verification, and hosted CI passed at `f0829b9`; no RunPod/model/GPU
activity or provider spend occurred.

`VF-9-24` dispatched its sole authorized job. RunPod created three `EXITED` endpoint worker records
before returning output, so the one-worker/no-retry guard stopped the attempt. No MP4 was produced
and no retry is authorized. Observed balance delta was `$0`; three independent post-cleanup reads
proved zero Pods, workers, endpoints, templates, and volumes. Await explicit new user authority.

## Locked active providers

| Task | Choice | Role |
|---|---|---|
| Image prompts | Runware DeepSeek V4 Flash 0731 | Batched strict JSON, thinking off |
| Style analysis | Runware Gemini 3.5 Flash | Only explicit new draft-style analysis |
| Images | Mage-Flow-Turbo BF16 via pinned ComfyUI | 4-step narration-relevant stills |
| Avatar | EchoMimicV3-Flash | Sole active native avatar path |
| Avatar repair/fallback | `null` | None active |
| Timing | local `whisper.cpp base.en` | Free word timing |
| Render | FFmpeg | Crops, zoom, hard cuts, audio, encode |

Fixture mode remains default and `$0`. Production Neon/R2/Workflow/OAuth deployment, accepted Mage
image, accepted Echo clip, production execution profiles, 30-minute benchmarks, and production
release remain unproven.

## Absolute rules

- Project selects exact ready Avatar Profile version; no project-local avatar upload.
- Project pins exact immutable published Image Style; ordinary generation makes no style vision call.
- Send only scheduled avatar spans, never full voiceover.
- One native avatar clip serves both layouts after measured crop approval.
- No repair, fallback, retry, tuning, model/GPU substitution, deployment, or production promotion
  without explicit task authority.
- RunPod is API-only, `workersMin=0`, bounded workers/jobs, exact cost, finally cleanup, independent
  zero proof.
- Private input/output/model/credential bytes never enter Git or public image.
- Technical success is `READY_FOR_USER_REVIEW`; only user approves visual quality.

## Context navigation

Read `MANIFEST.yaml`, `CURRENT_STATE.yaml`, then only selected profile and task. Normative decisions:
`15_DECISIONS_AND_OPEN_GATES.md`; models: `08_MODELS_AND_PROVIDERS.md`; pipeline:
`07_PIPELINE_AND_SCHEDULER.md`; RunPod: `09_RUNPOD_AND_QUEUE_OPERATIONS.md`; cost:
`11_COST_SPEED_BUDGET.md`; acceptance: `14_TESTING_AND_ACCEPTANCE.md`; Avatar Hub:
`20_AVATAR_HUB.md`; execution: `21_IMPLEMENTATION_EXECUTION_PLAN.md`; maintenance:
`16_CONTEXT_MAINTENANCE.md`.

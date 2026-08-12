# VideoForge: start here

Status: `VF-9-24H` persistent-cache A100 sample selected; RunPod absolute zero
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
before returning output. Diagnosis found that exited history was incorrectly counted as active
workers and the forced stop preceded durable runner serialization. No MP4 was produced. Observed
balance delta was `$0`; three independent post-cleanup reads proved absolute zero.

`VF-9-24A` corrected state-aware inventory, durable attempt journaling, startup/bootstrap
observability, and exact-entrypoint image smoke. The corrected worker is pinned at
`sha256:79e799a1312168123aed0809cc93c9d83047bef2354ff5dbac77caed64da87f1`. Paid RunPod use needs a
fresh explicit cap. `VF-9-24B` consumed one attempt and `$0.0260412778`, failing before model-ready
because one pinned tokenizer SHA-256 omitted its final `b`. Cleanup is absolute zero. `VF-9-24C`
corrected that pin, added the missing digest-length regression shield, and published image
`sha256:d0e487d13bf19b74d09af5c7bb3b800eb2faa75dcce6eca9e155a48b0403ffe9` at `$0`. `VF-9-24D`
used one attempt within the user's `$2` cumulative ceiling. Model bootstrap succeeded, but exact
253-frame inference failed with `AVATAR_INFERENCE_CUDA_OOM`; no MP4 exists. Cumulative measured spend
was initially measured as `$0.0260412778`; delayed billing makes the live cumulative delta
`$0.0649517111`. Cleanup and three independent reads prove absolute zero. The user then authorized
one unchanged exact sample attempt on an A100 80 GB PCIe within the existing `$2` cumulative cap.
`VF-9-24E` reached the worker but returned generic `AVATAR_PRIMARY_FAILED` before inference because
the published worker still enforced an RTX-4090-only runtime guard. It spent `$0.0044856296`; cleanup
and three independent reads prove absolute zero. `VF-9-24F` is the narrow guard/diagnostic repair,
immutable image publication, and one corrected A100 PCIe job. That job acquired no worker for ten
minutes and ended `$0`; cleanup and three reads prove zero. `VF-9-24G` changes only the capacity SKU
to A100 SXM 80 GB and kept BF16 model/input/config identical. It acquired after 74.108 seconds but
hit the ephemeral-download spend stop before a model result; no MP4. Cleanup and three reads prove
zero. `VF-9-24H` creates one temporary 50 GB volume, warms the exact cache on cheaper RTX 4090, runs
one A100 SXM inference, then deletes the volume. No FP8, fallback, chunking, or tuning.

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

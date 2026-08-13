# VideoForge: start here

Status: isolated persistent model-lane architecture approved; provider activation paused
Context schema: `1.5`  
Last updated: `2026-08-13`

VideoForge is an invite-only voiceover-to-video app for 5–10 teammates. Input: title, final
voiceover, exact ready Avatar Profile version, and immutable Image Style version. Output: a fully
assembled local/downloadable 1920×1080 MP4. No Premiere import or manual alignment is part of the
product flow.

The output grammar is only full avatar, full AI image, or avatar-left/image-right split. Hard cuts
only. Every AI image uses a slow, smooth centered zoom. No captions, titles, text overlays, lower
thirds, borders, watermarks, motion graphics, decorative graphics, or decorative transitions.

## Authoritative model and compute lifecycle

VideoForge has two isolated model lanes:

| Lane | Exact active model | Durable model storage | Disposable compute |
|---|---|---|---|
| Images | ImageForge's current `Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6` INT8 ConvRot profile, pinned ComfyUI, 4 steps, guidance 1.0, 1280×720 | Mage-only persistent `EU-RO-1` network volume | Mage-only Pod |
| Avatar | EchoMimicV3-Flash FP8 from pinned first-party source/weights/base/audio lineage | Different Echo-only persistent `EU-RO-1` network volume | Echo-only Pod |

Never share or cross-adopt a volume, Pod, manifest, cache, lock, or runtime between lanes. Volume
capacities are not yet approved; derive each from its verified exact manifest plus explicit
headroom before provisioning. Persistent-volume pricing is accepted.

The app refreshes live compatible Secure Cloud GPU inventory and the user independently selects an
exact current GPU offering for Mage and Echo. Local decode/probe, checksum, immutable input identity,
and a resumable upload reservation are the pre-Generate barrier. One Generate action then starts
both required Pods in parallel while durable voiceover upload, local ASR, deterministic scheduling,
prompt compilation, and selected avatar-span slicing overlap boot. No inference dispatch occurs
before its exact durable input barrier. Ordinary boots download no model files: the Pod verifies
its lane volume, loads the exact model, runs a warm-up, then reports authoritative `model_ready`.

After a lane's outputs are durable, delete its exact Pod and prove provider absence; retain its
volume. The ideal model-ready target is at most two minutes. The user's ImageForge experience of
roughly three to four minutes is only a comparison baseline, not a measured VideoForge result.

## Current handoff

The earlier Serverless/ephemeral `VF-9-24I` paid retry is superseded and non-executable. It produced
no MP4. Its evidence, failed attempts, measured costs, and final zero-resource observations remain
historical truth; its former `$8` ceiling does not authorize the new two-volume/two-Pod lifecycle.
No current provider call, credential use, model download, Pod creation, volume creation, or spend is
authorized.

`VF-9-24J` completed this context/architecture reset. `VF-9-24K` is the proposed `$0`, provider-free
contract and fixture task, but application implementation is paused until the user explicitly
authorizes it. It will version exact per-lane volume bindings, live-inventory receipts, independent
GPU selections, Pod lifecycle/model-readiness/deletion state, and cross-lane rejection before any
cloud mutation.
Current v1 machine schemas are legacy/provider-free and must fail closed before paid Pod dispatch;
they are not being silently reinterpreted as the approved architecture.

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
| Timing | Local `whisper.cpp base.en` |
| Render | Direct FFmpeg |

AvatarForcing, MuseTalk, SkyReels, earlier Mage BF16, Serverless endpoints, ephemeral model caches,
and Echo Long Video CFG remain historical evidence only. They authorize no active dispatch.

## Absolute rules

- Project selects an exact ready stored Avatar Profile version; no project-local avatar upload.
- Project pins an immutable published Image Style; ordinary generation makes no style vision call.
- Send Echo only scheduler-selected short spans, normally 2–6 seconds; opener maximum 7 seconds.
- One native Echo clip serves full and split layouts after measured crop acceptance.
- Deterministic code owns timing/layout. Fully automatic assembly returns the final MP4.
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
`21_IMPLEMENTATION_EXECUTION_PLAN.md`; maintenance: `16_CONTEXT_MAINTENANCE.md`.

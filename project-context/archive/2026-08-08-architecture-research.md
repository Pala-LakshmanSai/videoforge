# Archived: VideoForge architecture and research decisions

> This early research file is retained for traceability. The authoritative, complete project brain is now [`../00_START_HERE.md`](../00_START_HERE.md), with decisions in [`../MANIFEST.yaml`](../MANIFEST.yaml). If this file conflicts with the numbered context pack, the context pack wins.

Status: historical/superseded; not current implementation authority

This document preserves early avatar/renderer research only. It is not the source of truth for implementation. Current product, Image Styles Hub, costs, models, plans, and gates live in the numbered `project-context/` pack.

## Product target

VideoForge produces long-form YouTube videos from:

- a title;
- a supplied voiceover and its canonical script;
- an avatar image or reusable Avatar Profile;
- a pinned published Image Style, defaulting to Authentic Documentary Stock;
- optional project-wide image prompt keywords controlled by an explicit apply toggle.

Reusable reference-derived styles and their one-time Runware Gemini analysis were added after this historical note. See [`../18_IMAGE_STYLES_HUB.md`](../18_IMAGE_STYLES_HUB.md); ordinary project generation never re-analyzes a ready style.

The visual grammar is deliberately restricted to:

- full-screen avatar;
- full-screen AI image with a slow, smooth zoom;
- 50/50 avatar plus image or, in a future version, video.

There must be no motion graphics, text overlays, captions, lower-thirds, decorative graphics, or decorative transitions. Composition changes use hard cuts. The current MVP is image-only apart from the talking avatar.

## Timeline and composition

Composition selection is deterministic code with bounded variation, not an LLM task. Word timings come from local Whisper and are reconciled against the supplied script. Scene boundaries snap to phrase or sentence boundaries.

The reference-video audit supports short avatar appearances, typically 2–6 seconds, alternating between full-screen and 50/50. The remaining timeline uses voiceover-relevant Mage-generated images with slow zooms.

Only audio spans assigned to avatar compositions are sent to avatar inference. Images and avatar clips generate in parallel.

## Final avatar model ladder

### Primary: AvatarForcing

AvatarForcing is the provisional single default, conditional on passing the exact-avatar acceptance test.

- Official implementation: https://github.com/KlingAIResearch/AvatarForcing
- License: Apache-2.0.
- Inputs: the original avatar image, only the selected voiceover span, and an optional restrained motion prompt.
- Output: an audio-synchronized talking-avatar clip containing lip movement plus subtle face, head, and upper-body movement.
- Typical official format: 832x480 at 25 fps with a one-step 1.3B model.
- The paper reports 34 ms per frame, but does not disclose the benchmark GPU. RunPod RTX 4090 fit, VRAM, startup time, throughput, and exact-avatar quality remain benchmark gates rather than promises.

SoulX-FlashHead is not part of the normal production path if AvatarForcing passes. LongCat is excluded as the per-video default because its cost is incompatible with the target unit economics.

### Conditional lip-only repair: MuseTalk

MuseTalk is not a mandatory enhancement, resolution enhancer, or general quality pass.

- Official implementation: https://github.com/TMElyralab/MuseTalk
- It runs only when AvatarForcing produced an otherwise acceptable clip whose remaining defect is lip synchronization.
- It receives the AvatarForcing clip as source video and the same selected voiceover span as driving audio.
- It must not run on already-good AvatarForcing output because unnecessary redubbing can soften teeth and facial detail or introduce seams and identity changes.
- It may later support a reusable performance-bank dubbing workflow.

### Whole-clip quality fallback: SkyReels V3 Talking Avatar

SkyReels V3 is the quality fallback for defects that MuseTalk cannot repair.

- Official implementation: https://github.com/SkyworkAI/SkyReels-V3
- Inputs: the original avatar image and selected voiceover span, never the failed MuseTalk output.
- It provides a native 720p, landscape-capable talking-avatar path with broader motion and potentially stronger full-screen detail.
- It is a much heavier 19B model. Low-VRAM FP8 and block-offload paths exist, but it remains an on-demand fallback rather than a warm default.

AvatarForcing is not replaced globally because of one bad clip. SkyReels becomes the global primary only if AvatarForcing repeatedly fails the initial exact-avatar suite or crosses the production rejection threshold.

## One clip, two compositions

The avatar is always horizontally centered. A single generated clip serves both full-screen and 50/50 compositions. A second avatar version must never be generated.

Starting from the 832x480 AvatarForcing output:

### Full-screen

1. Crop six pixels from the top and six pixels from the bottom.
2. Result: 832x468, exactly 16:9.
3. Scale to 1920x1080.

Canonical FFmpeg geometry:

```text
crop=832:468:0:6,scale=1920:1080
```

### 50/50

1. Begin from the same vertically cropped 832x468 clip.
2. Take a fixed horizontal center crop: x=208, width=416.
3. Result: 416x468, exactly 8:9.
4. Scale to 960x1080 and place at x=0 on the left.
5. Scale/crop the companion image or future video to 960x1080 and place it at x=960 on the right.

Canonical avatar-side geometry:

```text
crop=416:468:208:6,scale=960:1080
```

This is deterministic FFmpeg crop, scale, and placement. It does not use face tracking, intelligent reframing, another model, or another AI call. It is layout, not motion graphics.

## Per-clip quality router

The router is defect-specific and operates only on the failed short clip.

1. Generate with AvatarForcing from the original avatar image and selected voiceover.
2. If it passes, accept it directly. Do not run MuseTalk.
3. If only lip synchronization is poor, retry AvatarForcing once.
4. If lip synchronization remains poor while identity, body, background, motion, and full-screen detail remain acceptable, run MuseTalk on that AvatarForcing clip.
5. If MuseTalk repairs the lip synchronization without introducing a new defect, accept the repaired clip.
6. If MuseTalk fails, discard that repair and generate the clip with SkyReels V3 from the original avatar image and voiceover.
7. If the AvatarForcing failure is identity drift, unnatural face or body motion, background instability, insufficient full-screen detail, or any other whole-frame defect, skip MuseTalk and route directly to SkyReels V3.
8. A single failed clip never changes the global primary model. Global replacement requires repeated acceptance-suite failure or breach of the agreed production rejection threshold.

The router must preserve the original source inputs and provenance for every attempt. A repaired or failed derivative must never silently become the source for a whole-clip regeneration.

## Avatar validation gate

Before AvatarForcing becomes the production default, benchmark it on RunPod using the exact intended avatar and representative audio:

- ordinary speech;
- fast and sibilant speech;
- visible teeth and difficult mouth shapes;
- pauses and silence;
- subtle head and upper-body motion;
- final 1920x1080 full-screen output;
- final 960x1080 50/50 crop.

Record cold start, peak VRAM, generation time, first-pass acceptance rate, cost per accepted output second, lip synchronization, identity consistency, background stability, and final-resolution visual quality. Paper FPS alone is not an acceptance criterion.

## Worker and queue implications

- Start image and avatar work in parallel.
- Keep one AvatarForcing model resident while processing all selected spans for a project; do not reload per clip.
- Keep MuseTalk and SkyReels cold unless their specific fallback is required.
- Queue work across the expected 5–10 users and stop compute when the shared queue is empty after a short drain window.
- Use RunPod APIs for worker lifecycle; the user is never required to operate the RunPod console.
- Preserve an immutable manifest containing source image, source audio range, model version, seed/settings, output artifact, QA result, and fallback lineage for every clip.
- The final renderer consumes the canonical timeline and performs only deterministic crop, scale, slow image zoom, audio muxing, and hard cuts.

## Cost position

The budget architecture avoids generating the complete narration as avatar footage and avoids expensive whole-frame fallback on successful clips. AvatarForcing is paid only for selected spans. MuseTalk and SkyReels are paid only for the short clips whose defect matches their role.

LongCat remains excluded from normal production. It may be reconsidered only as an explicitly approved, one-time Avatar Profile or motion-master creation tool, never as an automatic per-video fallback.

## UI and development acceptance

The timeline UI must show the chosen composition, source audio span, generated clip, QA state, retry/fallback state, and cost for each avatar segment. Users can preview full-screen and 50/50 crops before final rendering.

During development, the application will run with hot reload and be exercised in the user's real Chrome session so UI, queue, retry, and failure behavior can be inspected continuously. Final acceptance includes end-to-end testing in Chrome rather than only automated tests.

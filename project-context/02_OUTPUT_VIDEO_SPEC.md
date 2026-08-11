# Final output video specification

Status: approved output grammar  
Read when: implementing the scheduler, image generator, avatar worker, renderer, QA, or output review UI.

Terminology: use `timeline composition`, `image framing`, and `in-image shot role` as defined in `GLOSSARY.md`; never use one bare `composition` field for both layout and still-image framing.

## Delivery profile

| Property | Required value |
|---|---|
| Container | MP4 |
| Video | H.264, `yuv420p`, web-compatible |
| Frame | 1920×1080, full-frame 16:9, no letterbox |
| Rate | 30 fps constant frame rate |
| Audio | AAC, 48 kHz, stereo container acceptable |
| Loudness | target near −16 LUFS integrated; true peak no higher than −1.5 dBTP |
| Visual transitions | hard cuts only |

Do not add music or sound effects in MVP unless the user later approves a separate audio decision.

`voiceover-minus16lufs-v1` is the fixed MVP audio policy: measure the normalized source; preserve it when integrated loudness is within −17 to −15 LUFS and true peak is at or below −1.5 dBTP, otherwise run measured two-pass loudness normalization targeting −16 LUFS integrated and −1.5 dBTP. Record before/after measurements and the exact FFmpeg version/filter arguments. Do not apply automatic compression, denoising, music, or sound effects.

## Canonical compositions

### `AVATAR_FULL`

Avatar occupies the full 1920×1080 frame. The render manifest pins one of two deterministic, centered source profiles.

AvatarForcing's typical 832×480/25 fps output uses `avatarforcing-centered-832x480p25-v1`, crops exactly to 16:9, then scales:

```text
crop=832:468:0:6,scale=1920:1080
```

An accepted SkyReels fallback keeps its 1280×720/25 fps detail and uses `skyreels-centered-1280x720p25-v2`:

```text
crop=1280:720:0:0,scale=1920:1080
```

Do not route a SkyReels asset through AvatarForcing crop coordinates or downscale it to 832×480 before layout. The accepted asset records its exact source profile; renderer schema validation rejects a mismatched profile/crop pair.

Avatar source requirements are enforced when a reusable Avatar Profile version is approved in the Avatar Hub: horizontally centered, direct-to-camera, eye-level, tight head-and-shoulders or medium close shot, natural setting, and suitable for restrained motion. A project always uses the exact pinned runtime source/checksum; upscaled full-screen detail remains an acceptance gate.

### `IMAGE_FULL`

A narration-relevant 16:9 Mage image following the project's pinned Image Style fills 1920×1080. The clip applies only a slow centered zoom-in. Default generation candidate is 1536×864; benchmark 1024×576, 1280×720, and 1536×864 before lock.

Recommended zoom envelope:

- Short image scene: 1.00 → 1.025.
- Typical image scene: 1.00 → 1.03.
- Long image scene: never exceed 1.035 without a separately approved render profile.
- Use a quintic smootherstep progression at 30 fps so speed and acceleration both settle at the
  first and last frame.
- `ffmpeg-render-v3` uses per-frame floating-point source-corner coordinates with cubic
  interpolation rather than integer crop stepping. This keeps the centered movement continuous at
  subpixel precision; an alternative implementation must prove equivalent monotonic, jitter-free
  motion. `ffmpeg-render-v1` and `v2` remain replay-only profiles for historical manifests.
- Center crop by default. Do not pan, parallax, shake, punch, track a face, or allow frame-to-frame
  crop-direction reversals.

### `AVATAR_SPLIT_IMAGE`

Use the same accepted centered clip that would serve full-screen; never generate a layout-specific second avatar clip. Apply the crop belonging to its pinned source profile.

AvatarForcing profile:

```text
crop=416:468:208:6,scale=960:1080
```

SkyReels fallback profile:

```text
crop=640:720:320:0,scale=960:1080
```

- Avatar: x=0 through 959.
- Image: x=960 through 1919.
- Clean central seam.
- No divider, border, label, shadow, rounded panel, or decoration.
- The right image should be generated for an 8:9-safe composition when possible; 1024×1152 is the initial candidate.
- The right image uses the smaller 1.00 → 1.025 `split-right-zoom-v3` profile during the short split
  interval. Every displayed AI image moves slowly, including split companions.

### Avatar frame-rate conversion

AvatarForcing and SkyReels candidate outputs are 25 fps while delivery is 30 fps. Convert each
accepted source directly with ordinary FFmpeg nearest-timestamp frame duplication/resampling (the
equivalent of `fps=30:round=near`) before layout:

- Preserve duration and timeline boundaries exactly.
- Do not use optical flow, frame interpolation, or another AI model.
- Record the FFmpeg version/filtergraph and golden-test the cadence.
- If full-screen cadence is visibly unacceptable in the exact-avatar bakeoff, pause at the avatar gate; do not silently add an interpolation stage.

## Timeline grammar

- Start at 00:00 with `AVATAR_FULL` unless a later user decision overrides the cold-open rule.
- Target 21–22% total avatar coverage.
- Target approximately half of avatar time in `AVATAR_FULL` and half in `AVATAR_SPLIT_IMAGE`.
- Typical avatar clip: 2–6 seconds, approximately 3.7 seconds average.
- Target avatar cadence: one appearance every 14–20 seconds, adjusted to phrase boundaries.
- Alternate full and split as the VideoForge rule; do not claim the source videos do so without every exception.
- Fill all remaining time with 3–7 second images, merging or splitting at clauses/sentences.
- Every output frame has exactly one visual composition; no gaps and no overlaps.
- No silent visual montage; narration drives the entire edit.

## Built-in default visual language

When `documentary_stock_v1` is selected, the final video should feel like an authentic field-documentary explainer:

- Direct, personal avatar as the recurring visual home base.
- Candid observational images rather than staged advertisements.
- Repeated shot-scale variation: environmental wide → human interaction → hands/action → close evidence → reaction/result.
- Natural daylight and practical interior light.
- Real skin, material, soil, food, clothing, and tool texture.
- Earthy, true-to-life color and soft contrast.
- Mild believable imperfection is acceptable; synthetic perfection is not.
- Physical detail does the explanatory work that graphics would normally do.

Custom Image Styles may intentionally select another photographic or illustrated still-image medium. They do not change the timeline grammar, avatar realism, crop geometry, slow zoom, hard cuts, or global output prohibitions. A custom-style image is judged against its pinned published style rather than the documentary-only traits above. See `18_IMAGE_STYLES_HUB.md`.

## Prohibited output and honest QA authority

The renderer can deterministically prevent/reject what VideoForge itself controls:

- Any authored motion graphic, caption, lower-third, title, label, UI, chart, diagram, arrow, infographic, border, watermark, or decorative overlay.
- Decorative transitions, fades, dissolves, wipes, glitches, spins, light leaks, or end cards.
- Split-screen borders/decorative frames, cinematic letterbox bars, extra subtitle/data streams, or non-approved source assets.
- Third-party Ranga/source frames in the final video.

Generated pixels can still contain pseudo-text, logo-like marks, malformed anatomy, duplicate limbs, nonsensical objects, accidental mixed media, or style mismatch. Prompts and bounded regeneration reduce these failures, but technical checks cannot honestly detect all of them. In MVP they are explicit reviewer rejection reasons, not a hidden automatic-vision claim. For `documentary_stock_v1`, reviewer rejection also includes obvious CGI/illustration/fantasy, plastic skin, or synthetic perfection.

The automated pipeline ends at `READY_FOR_REVIEW`. A user may inspect the segment/contact-sheet view, regenerate a defect, then mark the revision `APPROVED`; only that state means the product's creative quality has been human accepted. Automatic multimodal QA remains deferred, and the app must never imply it performed one.

## Technical QA

Before delivery verify:

- Exact duration matches source audio within the accepted mux tolerance.
- Constant 1920×1080/30 fps and `yuv420p`.
- Deterministic native 25→30 AvatarForcing and SkyReels conversion has no duration change, drift, or unacceptable visible cadence.
- Audio/video starts at zero; no drift or missing tail.
- Exactly one EDL segment covers every frame.
- Full and split crop geometry matches the selected source-profile formulas above; a profile/crop mismatch is rejected.
- Both `IMAGE_FULL` and the right image in `AVATAR_SPLIT_IMAGE` have the required subtle eased zoom;
  neither is static, neither oscillates around its center, and neither exhibits integer-crop shake.
- Every image attempt and content-addressed prompt manifest points to the revision's pinned Image Style version/effective prompt hash; `production-manifest/v2` binds that prompt manifest plus the pinned Avatar Profile binding to the renderer-only resolved-render manifest and final MP4.
- No intermediate filename, debugging text, subtitle stream, extra audio stream, or metadata leak.
- MP4 is seekable and plays in the user's Chrome.

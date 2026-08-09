# Reference-video forensics

Status: measured research baseline and built-in default-style provenance, not product assets  
Read when: changing scheduler cadence, avatar share, framing, prompt shot mix, or output style.

## Correct references

1. [KILL EVERY Mosquito The AMISH Way. SAFE For Honey Bees & Pets!](https://www.youtube.com/watch?v=cVotLLx5bNs), video ID `cVotLLx5bNs`, cached duration 1481.814 seconds (24:42), reference stream 854×480 at 30 fps.
2. [How to Pick a Sweet Watermelon... The Old AMISH Way](https://www.youtube.com/watch?v=6jZ7ib2Edes), video ID `6jZ7ib2Edes`, cached duration 1132.294 seconds (18:52), reference stream 854×480 at 30 fps; the opening 40 seconds was also inspected at 1920×1080.

Explicitly exclude `5JCQbwj0Kso`; the user identified it as the wrong watermelon video.

## Measured composition audit

The following values are estimates from a prior 5-fps classification audit and direct frame checks. They are internally consistent, but they are not presented as frame-perfect publisher analytics.

| Metric | Mosquito | Watermelon |
|---|---:|---:|
| Runtime | 24:42 | 18:52 |
| Avatar visible | 21.60% | 21.97% |
| Full-screen avatar | 10.53% | 11.08% |
| 50/50 avatar | 11.07% | 10.90% |
| Avatar appearances | 86 | 66 |

Combined findings:

- Mean avatar appearance: approximately 3.74 seconds.
- Typical avatar appearance: 2–6 seconds.
- Median image/B-roll-only gap: approximately 11.2 seconds.
- Mean visual-change interval in the supplied complete Watermelon analysis: about 4.35 seconds; median 4.13 seconds; middle 50% about 2.8–5.2 seconds.
- Full and split cumulative shares are nearly equal.
- Hard cuts dominate.

Frequent near-alternation is observed; strict seeded alternation is a suitable VideoForge rule. Do not state that Watermelon alternates without any exception.

## Verified opening rhythms

Watermelon:

- 00:01 full avatar.
- 00:04 topical full-screen real-world footage.
- 00:10 50/50, avatar left and footage right.
- 00:13 topical full-screen footage.
- Detected opening spans: `[0,2.667)`, `[2.667,8.500)`, `[8.500,11.800)`, `[11.800,14.900)`.

Mosquito:

- 00:01 full avatar.
- 00:05 topical full-screen footage.
- 00:16 50/50.
- 00:24 macro/detail footage.
- 00:28 wider context footage.

See the compact opening sheets in `references/ranga/frames/`.

## Framing and visual grammar

Avatar:

- Same presenter/look and nearly pixel-aligned room/camera recur across distant intervals and both videos.
- Tight head-and-shoulders, centered, direct gaze, eye-level camera.
- Background remains recognizable; windows and ordinary room details are visible.
- Full avatar and split-left use the same visual home base.

B-roll:

- Handheld observational medium shots.
- First-person/over-shoulder demonstrations.
- Hands, tools, produce, surfaces, and extreme close evidence.
- Environmental farms, markets, stores, and domestic spaces.
- Short result/reaction or object beauty views.
- Composition moves repeatedly through person → action/hands → close evidence → environment → avatar reset.

The source mixes real/UGC/stock/archive footage and occasionally contains webpage, sponsor, subtitle, watermark, arrow/circle, or multi-panel material. Those are source exceptions to exclude, not permission to reproduce graphics.

## What VideoForge borrows

- Cadence.
- Full-avatar home base.
- Clean 50/50 seam with speaker left and evidence right.
- Highly literal, narration-related visual proof.
- Wide/medium/close shot variation.
- Hard cuts and continuous narration.
- Authentic, lightly imperfect field-documentary feel.

## What VideoForge never copies

- Third-party footage, frames, people, branding, watermarks, sponsor screens, web pages, subtitles, or graphic callouts.
- The exact presenter identity or room.
- Source exceptions containing motion graphics or text.

## Economic inference, not fact

The recurring pixel-stable presenter background, natural mid-phoneme starts, body motion, and reported low production cost are more consistent with a reusable/recorded performance or a very fast avatar/reenactment process than with regenerating every appearance using a slow LongCat/Hallo-class diffusion model. This is a plausible inference, not confirmed knowledge of Ranga's private pipeline.

VideoForge's approved response is a fast AvatarForcing primary, short-span generation only, optional MuseTalk lip repair, and cold SkyReels whole-frame fallback.

## Relationship to the Image Styles Hub

These findings seed only the built-in `documentary_stock_v1` Image Style and the universal edit grammar. They do not force every custom Image Style to be photorealistic or documentary. Custom styles may change still-image medium, lighting, palette, texture, and camera language while the no-graphics/no-text rules, compositions, avatar behavior, cadence, and slow zoom remain fixed.

The third-party frames are manual research provenance only. Do not transmit them to the external style analyzer or use them as a product thumbnail; the built-in profile in `evidence/default_image_style_v1.json` is already manually derived.

## Rights and provenance

All included reference stills are third-party copyrighted research material:

- Private research reference only.
- Not a product asset.
- Not for model training.
- Never place in generated output.
- Do not publish or commit to a public repository without permission.

This is a practical provenance policy, not a legal fair-use determination. Exact timestamps and source URLs are recorded in `references/ranga/frames/frames.csv`.

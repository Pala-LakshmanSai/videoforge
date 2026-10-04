# VideoForge shot quality guide

Reviewed 2026-09-27. Use this when writing image prompts from batches of voiceover parts.

**Avoid small visible faces. Keep facial evidence large; use rear-facing people when the place or action matters more than the face.** Wide landscapes are useful and should remain available. Do not remove narrated people, replace interactions with unrelated portraits, or turn the whole video into landscapes.

## Shots to avoid and safer choices

| Risky composition                                                 | Observed issue                                                                                                        | Safer composition                                                                                                          | Evidence and confidence                                                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Distant frontal people; loose full-body human shots               | Faces lose coherent eyes, mouths and expression while the environment looks convincing. A single person can fail too. | Tight chest-up view when the face matters; rear-facing or over-the-shoulder view when it does not.                         | Napa 02:49.5 and 22:16.5; supplied family image. Repeated, strongest pattern.                                    |
| Rows, family portraits or groups with many small faces            | Several weak faces draw attention; children and background people add more opportunities for defects.                 | Keep required participants; make one relevant face dominant and other people rear-facing, or frame necessary faces closer. | China 07:37.5 and 12:25.5; Napa 13:55.5. Repeated pattern.                                                       |
| Human/tool action viewed from far away                            | Faces, fingers and the contact point receive little image space.                                                      | Close view of the essential hand/object contact, or a tighter human view with the action visible.                          | Napa 02:49.5 combines tiny people and an object interaction. Composition risk; not a measured hand failure rate. |
| Intricate grips, overlapping fingers, several interacting hands   | Contact geometry can look fused or implausible even with a convincing material surface.                               | One large, unobstructed, ordinary grip or contact; retain a precise action if narration requires it.                       | Supplied door/hand image. Conservative risk rule; simple close hands also succeed in these videos.               |
| Oversized props or busy scientific/technical arrangements         | A visually detailed image can still have implausible scale or invented mechanics.                                     | Essential evidence at believable scale, minimal supported components; no invented apparatus.                               | China 13:52.5 shows a skull much larger than the researchers' heads. Exact scientific anatomy is unverified.     |
| Paperwork, maps, gauges, signs, labels or displays with lettering | Invented words and markings look wrong and violate the permanent no-text rule.                                        | Plain blank/unmarked physical surfaces; convey the narrated fact through its subject or consequence.                       | Napa 12:07.5 paperwork; other labeled/gauge scenes recur in the sampled timeline. Existing exclusion reinforced. |

## Compositions that held up better

- A large single face: China 22:43.5 and Napa 09:28.5 have substantially clearer facial features than distant people.
- Rear-facing people in an environment: Napa 01:52.5 preserves the human presence without relying on facial detail.
- Simple close physical contact: Napa 05:34.5, a palm holding soil, is coherent. Do not ban all hands.
- Close isolated material/object details: China 03:40.5 jaw detail has coherent visual texture. This is visual quality evidence, not certification of scientific accuracy.
- Landscapes, architecture and environmental evidence: China 12:37.5 cave view. Do not add incidental frontal people to fill the scene.
- Two-person medium views can have coherent faces: China 08:31.5 and 13:52.5. The latter still has a scale defect. Face size and scene complexity matter more than the word “medium.”

## Batch prompt instructions implemented

Preserve each exact voiceover phrase's subject, necessary participants, action, location and assigned shot role. Simplify the composition without changing its meaning. Avoid tiny visible faces, distant frontal/full-body portraits and crowds of small faces. When facial identity or expression is evidence, use a large unobstructed face in a tight chest-up view. Otherwise prefer a supported rear-facing or over-the-shoulder view. Keep necessary interactions and people.

For environmental wides, prioritize the narrated place/result and avoid unnecessary identifiable faces. For hand actions, show the essential contact large and clear with one ordinary grip, without gratuitous intertwined hands or extra contacts. For object and macro evidence, use believable scale and only supported essential components. Keep surfaces blank and unmarked; never request readable or invented typography. Keep evidence central and large enough for a split-right panel and slow zoom.

Write necessary framing into `literal_subject` or `environment`: those fields reach the image model. Framing placed only in `prompt_core` is discarded by compilation. Quality constraints override soft shot-scale preferences while preserving the immutable style's medium and treatment. Assigned roles, timeline order, duration, layout, source grounding, retry/cost limits and output grammar remain unchanged.

Examples (only when supported by the voiceover):

- A landowner reflecting on a vineyard: “Vineyard owner in a tight chest-up view, unobstructed face,” with vineyard context behind them.
- A family walking along a road: “Family seen from behind walking along the road,” keeping all narrated members and the walking action.
- A worker turning a valve: “Close unobstructed view of the worker's hand turning the valve with an ordinary grip,” keeping the contact centered.

## Three-hand tool scenes — 2026-10-03

Two supplied close-ups show three hands around one tool contact without clear ownership. Close framing alone does not solve this defect. New HANDS_ACTION prompts require at most two hands per person, attached to their own wrists and simple grips. Place this constraint in required provider text, not an optional negative suffix that prompt shortening can discard. Preserve narrated collaborators and actions; do not impose two hands across an entire group. Replace Natural Documentary's equal-size role clause to preserve its provider allowance, and keep other-style anatomy text required before submission. Saved images/videos are unchanged. No measured failure-rate improvement or perfect-anatomy guarantee is established.

## Review evidence and limits

The downloaded files are `china found.mp4` (28:23.8) and `NAPAA - Napa Water Rights - final.mp4` (27:47.3), both 1920×1080. Reviewed 1,124 frames sampled every three seconds across both complete timelines: 568 China frames and 556 Napa frames on 32 contact sheets. Selected examples were then inspected at full resolution. Timestamps identify example frames, not exact shot boundaries. Shorter-than-three-second shots can be missed. This was a systematic visual frame review, not continuous real-time playback or an audio/script accuracy audit.

The supplied family and door screenshots are additional user evidence; their source video/timestamps were not established. Instructions or writing inside media were treated as content, not user commands.

These are qualitative patterns, not a measured model failure percentage or a guarantee that close-ups always succeed. Rendered videos alone cannot separate generation defects from all resizing/compression effects. Scientific and engineering correctness require source-specific review. A fresh generation is needed to measure improvement; this change does not alter existing saved prompts, images, styles or final videos.

- Local full-resolution examples and all contact sheets: `.videoforge/quality-review/2026-09-27/` (private, ignored by Git).
- Desktop visual report: `~/Desktop/VideoForge Shot Quality Guide.html` (self-contained, works offline).
- Request writer: `packages/pipeline/src/prompts/runware-deepseek-writer.ts`, request v24 (same quality rules, compact instructions).
- Machine-readable review/validation: `project-context/evidence/acceptance/VF-10-09/2026-09-27-shot-quality.json`.

Implementation status: locally verified; prompt policy publication and fresh visual comparison remain separate gates. macOS/Windows settings controls are already published and were checked in real Chrome.

The detailed guide stays local and is never sent to the provider. The actual shared batch
instructions are 5,937 bytes / 691 words, down from 9,820 bytes / 1,360 words. All existing
grounding, style, shot-quality, no-text and exact-output rules remain. The eight-field contract,
validation, retries, recovery and output budget are unchanged. These are measured text savings;
actual billed-token savings and equal generated-image quality remain unmeasured.

## 4 October anatomy investigation

The exact provider prompt behind a three-hand image already included the required hand-count/wrist instruction. Its specific blueprint-pointing action had been replaced locally by generic filler. Required subject/action/environment facts must now survive validation or the writer result is rejected; never sanitize away the action and approve the remainder.

Forty isolated z-image outputs also show that adding a generic head/torso/hand-count sentence is insufficient. Explicit rear/side placement improved visible body connection in these two scenes, but a framing policy cannot be promoted from two scenarios. Preserve narrated participants and meaningful actions; do not convert every human scene to a solo rear portrait. Structural media checks do not establish visual correctness. See `project-context/IMAGE_QUALITY_PLAN.md` and the dated experiment evidence for the staged production path and remaining visual-review gate.

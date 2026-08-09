# Decisions and gates

Status: authoritative human decisions and gate state
Read when: a requirement seems ambiguous or a model/architecture change is proposed.

## Approved decisions

Every row below is `APPROVED` by the user and recorded in this planning session on 2026-08-08 unless the row notes a later date or an explicit superseding row is added. Primary normative detail lives in the domain file named by `16_CONTEXT_MAINTENANCE.md`; this ledger owns decision/status, while MANIFEST mirrors the IDs for loading.

| ID | Decision | Why |
|---|---|---|
| `DEC_SCOPE_001` | MVP uses AI still images, not AI B-roll video | Much simpler, faster, cheaper; user explicitly chose image-only now |
| `DEC_OUTPUT_001` | Only full avatar, full image, and avatar-left/image-right split | Matches target style without effects |
| `DEC_OUTPUT_002` | Hard cuts; no motion graphics/text/decorative transitions | Absolute repeated user requirement |
| `DEC_OUTPUT_003` | Every AI image has a slow smooth zoom-in | Avoid static-feeling image clips |
| `DEC_LLM_001` | Runware DeepSeek V4 Flash 0731 | User finalized provider/model after price research |
| `DEC_LLM_002` | DeepSeek writes production image prompts only | AI timeline-layout intelligence adds calls without valued quality; a separate vision model is allowed only for explicit analysis of a new draft style version |
| `DEC_STYLE_001` | Workspace Image Styles Hub with immutable published versions | User explicitly requires reusable styles created from reference images |
| `DEC_STYLE_002` | Built-in `documentary_stock_v1` is the default | Preserves the approved realistic Ranga/stock-footage look without setup |
| `DEC_STYLE_003` | Runware Gemini 3.5 Flash performs one-time reference analysis | Strong multi-image/strict-JSON fit through the already selected Runware account; provisional on gate |
| `DEC_STYLE_004` | Every project revision pins one published style version/hash | Reproducibility; later edits/archive cannot change prior output |
| `DEC_STYLE_005` | Optional extra image keywords require an explicit toggle, off by default; the toggle is the only persistent applied-state indicator | Gives user control without silently changing every prompt or adding an LLM call; the user removed redundant applied/not-applied confirmation UI on 2026-08-09 |
| `DEC_STYLE_006` | Analyzer extracts shared visual traits, not reference content/identity/logo/text | Prevents accidental copying and keeps styles reusable across topics |
| `DEC_IMAGE_001` | `microsoft/Mage-Flow-Turbo`, 4-step path | User locked Mage Flow; speed/quality fit |
| `DEC_AVATAR_001` | AvatarForcing primary | Fast one-step open model; provisional on exact-avatar gate |
| `DEC_AVATAR_002` | MuseTalk only repairs isolated lip failure | Avoid redundant face softening/seams |
| `DEC_AVATAR_003` | SkyReels V3 is whole-frame fallback from the revision-pinned canonical runtime source and same selected span audio—not from a failed derivative | Higher-detail/heavier rescue path while preserving exact Avatar Profile provenance |
| `DEC_AVATAR_004` | Same centered avatar clip serves both layouts | Saves inference; deterministic crop is sufficient |
| `DEC_AVATAR_005` | Workspace Avatar Hub is the only ordinary source of project avatars; projects select and pin an exact ready version, with no inline avatar upload | User explicitly requested create-once reuse, image/name dropdown selection, and sibling Avatar/Image Style hubs on 2026-08-09; exact version pinning prevents later source changes from altering a project |
| `DEC_TIMING_001` | Free local `whisper.cpp base.en` | Proven local path; paid ASR unnecessary |
| `DEC_CONTRACT_001` | TypeScript is the sole RFC 8785/JCS authority; Python workers validate schemas and exact byte hashes but treat canonical JSON hashes as opaque | Avoids cross-language number-serialization drift while keeping one deterministic canonical hash authority; recorded for Phase 0C on 2026-08-09 |
| `DEC_SCHEDULER_001` | Seeded deterministic bounded variation | Fast, cheap, reproducible; no AI layout calls |
| `DEC_SCHEDULER_002` | Target ~22% avatar, half full/half split, 2–6 sec appearances | Derived from both audited references |
| `DEC_RENDER_001` | Direct FFmpeg | Leanest correct renderer for simple grammar |
| `DEC_RENDER_002` | No Remotion/HyperFrames in MVP | No relevant quality benefit; extra runtime/cost |
| `DEC_HOSTING_001` | Zero-required-subscription Cloudflare/Neon/R2 control plane | Avoid Supabase Pro/$54 baseline and always-on services |
| `DEC_QUEUE_001` | Postgres is authoritative; RunPod is execution transport | Durable multi-user recovery and audit |
| `DEC_RUNPOD_001` | Scale-to-zero endpoints first; all operations via API | Simple, no console, no idle GPU |
| `DEC_UX_001` | Fixture-first UI visible in real Chrome throughout development | User can identify breakage and guide UX live |
| `DEC_UX_002` | Use a medium-scale minimal production-console UI with an 18 px root, 52 px normal controls, a full-width internally inset active-project command bar, restrained project/progress hierarchy, strong vertical pipeline, live artifact panel, and a fixed-base floating dock with scale-only fine-pointer proximity magnification. Desktop icon tiles rest at 48×44 px with 30 px glyphs, peak at 1.75× under the pointer, taper through immediate and second neighbors, and remain exactly 1× at 300 px or farther. Icon bottom edges, item layout boxes, and active-route backing geometry never move; reduced-motion, coarse-pointer, and mobile modes remain neutral. Ordinary user-facing text remains at least 16 px; the accepted fixture shell retains only its existing 14.4–15.3 px developer-only health/fixture/terse technical metadata exception. | User rejected the first shell as too small/zoomed-out, dense, and explanatory; corrected the narrow centered top bar; requested a smooth macOS-like dock; and later explicitly superseded the lift, bottom-gap, outward-shift, and expanding-backing behavior after comparing it with macOS screenshots on 2026-08-09. The same feedback requested larger resting icons and stronger scale-only magnification. |
| `DEC_UX_003` | Avatar and Image Style surfaces are visual-first and share a two-column/equal-media Hub layout; healthy cards keep only image/name/on-demand details, Create Project uses app-native integrated visual dropdowns, and authorized galleries plus dense technical detail remain progressively disclosed | User required seeing every avatar/style image without spreading presets across the form, removed repeated ready/passed/version copy, and rejected detached/browser-native dropdown surfaces on 2026-08-09; custom uploaded references remain distinct from built-in owned/generated examples |

## User-approved avatar router

In MVP, deterministic media checks can auto-pass technical validity, but the user/reviewer confirms the subjective defect class before fallback dispatch; no general visual-QA model is silently added.

1. AvatarForcing from the revision-pinned canonical Avatar Profile runtime source and selected span audio.
2. Passed clip → accept, no MuseTalk.
3. Lip-only failure → retry AvatarForcing once.
4. Still lip-only while whole frame is good → MuseTalk on failed AvatarForcing clip.
5. MuseTalk repair fails → discard; SkyReels from that same pinned runtime source and selected span audio, never the failed derivative.
6. Identity/body/background/motion/detail failure → skip MuseTalk; SkyReels from that same pinned runtime source and selected span audio.
7. One failed clip never changes the primary globally.

## Open gates

| ID | Evidence needed | Consequence |
|---|---|---|
| `GATE_AVATAR_001` | AvatarForcing exact-avatar 4090 VRAM, FPS, cold start, quality, cost | Lock 4090 profile or select measured compatible GPU |
| `GATE_AVATAR_002` | User approves global rejection/demotion threshold after bakeoff | Until then SkyReels is per-clip only |
| `GATE_IMAGE_001` | Reproduce ~300 images in 5–8 generation minutes and <$0.20 | Lock Mage resolution/batch/GPU |
| `GATE_IMAGE_002` | Retrieve exact checkpoint and launch-license artifact | Required before commercial launch |
| `GATE_LLM_001` | Confirm exact 0731 endpoint identity and strict-schema fixture | Lock Runware production config |
| `GATE_STYLE_001` | Gemini 3.5 multi-reference schema, content separation, latency, cost, retention posture | Lock analyzer model/settings or A/B only the analyzer fallback |
| `GATE_STYLE_002` | Same-content Mage bakeoff across default + four distinct extracted styles | Prove prompt-only profiles are sufficient before considering LoRA/reference conditioning |
| `GATE_FALLBACK_001` | SkyReels low-VRAM 48 GB fit, quality, boot, accepted cost | Provision/lock quality endpoint |
| `GATE_GPU_001` | Benchmark tested model/GPU allowlists | The UI may show planned candidates disabled, but no untested image/media or primary-avatar execution profile can become selectable |
| `GATE_RUNPOD_001` | Prove API repair after RunPod's idle max-worker reduction/config drift, timeout/TTL/result reconciliation, ambiguous dispatch handling, worker execution claims, and duplicate-cost visibility | Required before live RunPod dispatch is enabled |
| `GATE_COST_001` | Full cold/warm 30-minute measurement on new RunPod account | Replace planning estimates/SLO confidence |

## Closed gates

| ID | Result | Evidence |
|---|---|---|
| `GATE_UI_001` | **PASS** — the user explicitly accepted the final medium/minimal fixture shell on 2026-08-09; the approved visual system is frozen unless later user feedback or a verified regression reopens it | `evidence/gates/GATE_UI_001/2026-08-09-stabilization-audit/` |

## Proposed values awaiting evidence/user sign-off

- AvatarForcing production demotion: consider if the initial exact-avatar suite fails broadly or first-pass production rejection remains above roughly 10% after the first 10 real projects. This is not yet an approved automatic threshold.
- Workspace active projects: one or two by default.
- 30-minute default hard cap: $1.50, user-adjustable only up to the MVP contract ceiling of $2; current Serverless planning is about $0.40–$0.98 fast/no-major-fallback and $0.50–$1.30 with modest fallback.
- Storage retention: intermediates 3–7 days, final 30 days.
- Mage full resolution: select from benchmark candidates.
- Style analyzer first-attempt target: <$0.08; total with one approved retry <$0.15.
- Per-profile AvatarForcing compatibility preview remains optional in MVP: ready untested/stale profiles show a warning but remain selectable. Revisit only with rejection-rate evidence or an explicit user decision; never require the global 12–20-clip suite for every avatar.

## Deferred decisions

- AI B-roll video model/provider and percentage.
- Reusable performance-bank dubbing.
- Commercial customer accounts/billing.
- Music/SFX.
- Automatic vision QA model.
- Automatic Style LoRA training/reference-conditioned image generation.
- Public deployment domain/branding name.
- Manual hourly-Pod cost mode.

## Superseded research

- The historical complex architecture screenshot is not the implementation blueprint.
- The unattributed Hallo3/Hallo2 ranking screenshot is not the current avatar ladder.
- LongCat is not the default because measured/estimated per-video cost conflicts with the budget.
- DeepSeek via other providers, Gemini, GPT Luna, and OpenRouter were researched but not selected after the user fixed Runware.
- Gemini is now used through Runware only for one-time Image Style analysis; this does not supersede DeepSeek as the fixed production prompt writer.
- AI video model comparisons are retained only as historical research; AI B-roll video is deferred.

## Change authority

Only an explicit user decision changes an approved item. Benchmark evidence may recommend a change, but the implementation pauses at the relevant gate and presents the tradeoff. Follow the authority/consistency protocol in `16_CONTEXT_MAINTENANCE.md`; never treat the MANIFEST mirror or an older summary as a separate authority.

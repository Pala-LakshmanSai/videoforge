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
| `DEC_OUTPUT_003` | Every AI image has a subtle, centered, jitter-free eased zoom-in. The current `ffmpeg-render-v3` envelope is 1.00→1.025/1.03/1.035 for full images and 1.00→1.025 for split-right images, sampled with a continuous cubic subpixel transform. | Avoid static-feeling image clips without calling attention to the effect. After reviewing v2, the user requested exactly one percentage point more endpoint zoom and even smoother movement, then accepted the exact v3 replacement as “good enough” in installed Chrome on 2026-08-10; v1/v2 remain replay-only. Evidence: `evidence/acceptance/VF-0C-08/2026-08-10-continuous-zoom-v3/`. |
| `DEC_LLM_001` | Runware DeepSeek V4 Flash 0731 | User finalized provider/model after price research |
| `DEC_LLM_002` | DeepSeek writes production image prompts only | AI timeline-layout intelligence adds calls without valued quality; a separate vision model is allowed only for explicit analysis of a new draft style version |
| `DEC_STYLE_001` | Workspace Image Styles Hub with immutable published versions | User explicitly requires reusable styles created from reference images |
| `DEC_STYLE_002` | Built-in `documentary_stock_v1` is the default | Preserves the approved realistic Ranga/stock-footage look without setup |
| `DEC_STYLE_003` | Runware Gemini 3.5 Flash performs one-time reference analysis | Seven-set Runware qualification closed `GATE_STYLE_001` on 2026-08-11 with strict exact-shape output, canonical local semantic validation, content separation, bounded retry, latency, privacy, and cost evidence |
| `DEC_STYLE_004` | Every project revision pins one published style version/hash | Reproducibility; later edits/archive cannot change prior output |
| `DEC_STYLE_005` | Optional extra image keywords require an explicit toggle, off by default; the toggle is the only persistent applied-state indicator | Gives user control without silently changing every prompt or adding an LLM call; the user removed redundant applied/not-applied confirmation UI on 2026-08-09 |
| `DEC_STYLE_006` | Analyzer extracts shared visual traits, not reference content/identity/logo/text | Prevents accidental copying and keeps styles reusable across topics |
| `DEC_STYLE_007` | Manual edits use preserve-and-detach provenance: accepted analyzer bytes/evidence remain immutable historical source truth, while every pre-publication edit creates a new immutable derived profile artifact in the same open version; the derived profile marks analyzer evidence inapplicable and publication pins only its exact current bytes | User explicitly selected this policy on 2026-08-11; it prevents analyzer confidence/evidence from being misrepresented as describing user-edited creative bytes while retaining full audit history |
| `DEC_IMAGE_001` | `microsoft/Mage-Flow-Turbo`, 4-step path | User locked Mage Flow; speed/quality fit |
| `DEC_AVATAR_001` | AvatarForcing remains a blocked provisional primary technical candidate pending replacement decision | `VF-3-10` pinned the official code and weights revisions but found no unambiguous commercial code-and-weights permission: the README says Apache-2.0, the root license names RollingForcing and prohibits commercial/production use, and the weights card declares no license. No download, qualification, profile, or commercial use is allowed. |
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
| `DEC_DB_001` | The durable foundation uses committed additive PostgreSQL SQL migrations plus query-library-neutral repository contracts. PGlite is pinned only for network-free migration/constraint/adapter contract tests; it is not production persistence. Neon connectivity and the production query implementation wait for `VF-1-02`/`VF-1-05`. | The user asked for a fast, trouble-free fresh-chat plan on 2026-08-10. This boundary tests real PostgreSQL behavior without Docker, secrets, provider/network dependence, or an early ORM lock while preserving Neon as production truth. Official compatibility sources are recorded in `17_SOURCE_INDEX.md`; exact task scope is `tasks/VF-1-01.md`. |
| `DEC_QUEUE_001` | Postgres is authoritative; RunPod is execution transport | Durable multi-user recovery and audit |
| `DEC_RUNPOD_001` | Scale-to-zero endpoints first; all operations via API | Simple, no console, no idle GPU |
| `DEC_UX_001` | Fixture-first UI visible in real Chrome throughout development | User can identify breakage and guide UX live |
| `DEC_UX_002` | Use a compact minimal production-console UI whose real Chrome 100% appearance matches the user's preferred 80% reference through component geometry, never CSS `zoom` or a transformed shell. The root is 15 px, normal actionable controls keep a 44 px floor, the content canvas is 1184 px, and the active-project command bar remains full-width and internally inset. The fixed-base floating dock uses 76×62 px desktop items, 38×35 px icon tiles, 24 px glyphs, and scale-only fine-pointer proximity magnification above 820 px. The target peaks at 1.75×, tapers through neighbors across 240 px, and is exactly 1× outside that radius. Icon bottom edges, item layout boxes, and active-route backing geometry never move; reduced-motion, coarse-pointer, and compact/mobile modes remain neutral. Ordinary copy is 14–16 px; 12–13 px is limited to short secondary status/provenance labels. | User rejected the first shell as too small/zoomed-out, then rejected 20 px/60 px as oversized, corrected the narrow top bar, and refined the dock against macOS screenshots on 2026-08-09. On 2026-08-10 the user explicitly superseded the accepted 18 px/52 px density after comparing the same Create screen at Chrome 100% and 80%, asking for the 80% appearance at real 100%. This later request also proportionally compacts the dock while preserving the already approved scale-only, bottom-anchored behavior. |
| `DEC_UX_003` | Avatar and Image Style surfaces are visual-first and share a two-column/equal-media Hub layout; healthy cards keep only image/name/on-demand details, Create Project uses app-native integrated visual dropdowns, and authorized galleries plus dense technical detail remain progressively disclosed | User required seeing every avatar/style image without spreading presets across the form, removed repeated ready/passed/version copy, and rejected detached/browser-native dropdown surfaces on 2026-08-09; custom uploaded references remain distinct from built-in owned/generated examples |
| `DEC_UX_004` | Major sibling sections use one consistent 20 px desktop / 16 px compact/mobile vertical rhythm. Expanded generic disclosures keep at least 12 px between the trigger and first visible child and between sibling fact cards. Structural panels, cards, metrics, workflow rows, and summaries use dedicated, clearly visible translucent-lavender boundary tokens plus a dark depth shadow and restrained cobalt/violet halo; nested controls and incidental dividers keep a lighter treatment. Lists and grids always declare a nonzero gap, and no border, glow, or shadow may substitute for actual spacing. | On 2026-08-09 the user rejected touching Usage layouts and application-wide faint card/section boundaries, and explicitly requested clearer futuristic, clean, minimal division via a stronger border, drop shadow, or glow. On 2026-08-10 a Settings screenshot showed expanded disclosure content touching its trigger and sibling fact card, so the same rule now explicitly covers disclosure interiors. Evidence: `evidence/gates/GATE_UI_001/2026-08-09-surface-separation-refinement/` plus the 2026-08-10 real-Chrome refinement. |

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
| `GATE_AVATAR_003` | **OPEN — BLOCKED:** pinned code README says Apache-2.0; pinned root `LICENSE.txt` names RollingForcing and prohibits commercial/production use; pinned public weights card has no license. Evidence: `evidence/gates/GATE_AVATAR_003/2026-08-11-avatarforcing-access-license/` | No AvatarForcing weight download, paid qualification, production profile, or commercial use; next task is a bounded replacement-model decision |
| `GATE_IMAGE_001` | Reproduce ~300 images in 5–8 generation minutes and <$0.20 | Lock Mage resolution/batch/GPU |
| `GATE_IMAGE_002` | Exact Hugging Face checkpoint/license remains inaccessible (HTTP 401/signed-out 404); Microsoft source labels Mage-Flow MIT but also gives research-only deployment guidance | Required before weight download, paid qualification, or commercial launch; do not infer authority from cached metadata |
| `GATE_STYLE_002` | Same-content Mage bakeoff across default + four distinct extracted styles | Prove prompt-only profiles are sufficient before considering LoRA/reference conditioning |
| `GATE_FALLBACK_001` | SkyReels low-VRAM 48 GB fit, quality, boot, accepted cost | Provision/lock quality endpoint |
| `GATE_GPU_001` | Benchmark tested model/GPU allowlists | The UI may show planned candidates disabled, but no untested image/media or primary-avatar execution profile can become selectable |
| `GATE_RUNPOD_001` | Prove API repair after RunPod's idle max-worker reduction/config drift, timeout/TTL/result reconciliation, ambiguous dispatch handling, worker execution claims, and duplicate-cost visibility | Required before live RunPod dispatch is enabled |
| `GATE_COST_001` | Full cold/warm 30-minute measurement on new RunPod account | Replace planning estimates/SLO confidence |

## Closed gates

| ID | Result | Evidence |
|---|---|---|
| `GATE_UI_001` | **PASS** — the user explicitly accepted the final medium/minimal fixture shell on 2026-08-09; the approved visual system is frozen unless later user feedback or a verified regression reopens it | `evidence/gates/GATE_UI_001/2026-08-09-stabilization-audit/` |
| `GATE_LLM_001` | **PASS** — live Runware model search resolved canonical AIR `deepseek:v4@flash` to `DeepSeek-V4-Flash-0731`; 40 strict-schema scenes across five styles passed exact IDs, roles, literal anchors, forbidden-output checks, and the cost target | `evidence/gates/GATE_LLM_001/2026-08-10-runware-deepseek-qualification/` |
| `GATE_STYLE_001` | **PASS** — canonical AIR `google:gemini@3.5-flash` passed seven owned/synthetic multi-reference sets for strict exact-shape output, canonical semantic validation, content separation, uncertainty/outliers, alias binding, crop guidance, bounded retry, latency, privacy disclosure, and cost | `evidence/gates/GATE_STYLE_001/2026-08-10-runware-gemini-style-qualification/` |

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

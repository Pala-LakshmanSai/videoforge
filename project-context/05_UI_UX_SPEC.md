# UI and UX specification

Status: compact 100%-zoom visual baseline implemented; isolated-model live-GPU and Pod-lifecycle UI below is normative vNext work, not yet implemented; historical `GATE_UI_001` closed 2026-08-09
Read when: designing or implementing any user-visible flow.

## Design objective

The UI should feel like a clean, lively, futuristic production console while remaining understandable to a non-developer. The backend can be complex; the primary layer must be visually calm, comfortably readable at Chrome 100%, and free of explanatory clutter.

Primary reference: `assets/ui/swipecut-ui-reference.jpg`. It is inspiration only. Do not copy its logo, name, sample content, exact trade dress, or proprietary text.

The user reconfirmed this direction on 2026-08-09 after rejecting the first fixture shell as too small, too dense, and too text-heavy, then rejected the later 20 px/60 px scale as oversized. The target is a medium production-console hierarchy: a prominent active-project command strip and project title, compact factual progress hero, clear metric cards, strong vertical pipeline, live artifact panel, and floating navigation dock. VideoForge must translate those concepts into its own routes, copy, data, and visual identity rather than copying the reference product.

On 2026-08-10 the user explicitly superseded the 18 px/52 px desktop density after comparing the same app at Chrome 100% and 80%. The 80% appearance is now the design target at real 100% zoom, implemented through component geometry rather than CSS `zoom` or a transformed shell. The compact desktop contract uses a 15 px root, 44 px normal controls, an 1184 px content canvas, 20 px top-level rhythm, and proportionally compact panels/media. Mobile keeps the same 15 px root, 44 px actionable floor, and a 16 px top-level rhythm.

The same review later refined the Create Project hierarchy: keep the active choice compact, open choices only on demand, remove nonessential technical hints and success confirmations, and expose the two primary compute lanes without presenting stale GPU availability as live. Each lane refreshes compatible RunPod Secure Cloud inventory in `EU-RO-1`; the user independently chooses the exact currently offered GPU for image generation and avatar generation. The active-project bar remains full-width; only its internal content and progress track are deliberately inset. Every visible select/disclosure uses the VideoForge surface language rather than a browser-native menu. Child choices expand inside the same bordered surface, never as visually detached boxes or an overlay that covers the following controls. The floating dock uses fine-pointer proximity magnification with a calm reduced-motion fallback. Following the user's macOS comparison on 2026-08-09, hover is scale-only: icon tiles grow from a larger resting size, their bottom edges stay fixed, neighboring scale tapers smoothly, and the item plus active-route backing geometry remains static.

The user's later surface-separation review applies across the whole application, not only Usage. Major sibling sections must never touch: use a consistent 20 px desktop and 16 px compact/mobile page rhythm, with explicit nonzero gaps inside card/list grids. Expanded generic disclosures place at least 12 px between their trigger and first visible child and between sibling fact cards. Structural surfaces need a clearly visible lavender edge supported by a dark depth shadow and restrained cobalt/violet halo. Keep the effect calm: major panels and cards receive the layered treatment, while nested controls and incidental dividers remain lighter so the UI does not become double-boxed or neon-heavy.

Reuse proven visual concepts from the user's ImageForge app where helpful. The compact, portable baseline is `evidence/source-briefs/LOCAL_BASELINES.md`; the absolute paths below are optional local evidence only, and their absence must never block a fresh chat, clone, build, or test:

- `/Volumes/ESD-USB/ImageForge/src/styles.css`
- `/Volumes/ESD-USB/ImageForge/src/components/AppChrome.tsx`
- `/Volumes/ESD-USB/ImageForge/src/components/primitives.tsx`
- `/Volumes/ESD-USB/ImageForge/src/screens/CreateScreen.tsx`
- `/Volumes/ESD-USB/ImageForge/src/screens/ProgressScreen.tsx`
- `/Volumes/ESD-USB/ImageForge/src/screens/LibraryScreen.tsx`
- `/Volumes/ESD-USB/ImageForge/src/screens/UsageScreen.tsx`
- `/Volumes/ESD-USB/ImageForge/src/screens/SettingsScreen.tsx`

Reuse design tokens and interaction lessons, not ImageForge naming or domain logic.

## Visual system

Initial design tokens:

| Token | Value/direction |
|---|---|
| Canvas | `#070916`; deepest `#050711` |
| Glass panel | `rgba(23, 26, 49, .72)` |
| Primary text | `#f7f4ef` |
| Muted text | `#9b9eb2` |
| Primary accent | coral/crimson `#ff3f57` to `#ff5969` |
| Secondary accent | cobalt/violet `#2f6fff` / `#8d5cff` |
| Success | `#4bd99f` |
| Control radius | about 12–15 px |
| Panel radius | about 21–24 px |
| Structural boundary | translucent lavender, visibly stronger than control/divider borders; current surface tiers use roughly 22%, 30%, and 48% alpha |
| Structural depth | dark 10–42 px shadow plus a restrained 1 px cobalt/violet outer halo and subtle inner highlight |
| Page section gap | 20 px desktop; 16 px compact/mobile; never zero between sibling layout groups |
| Base text | 15 px desktop and compact/mobile |
| Secondary text | normally 13–15 px in the compact shell |
| Micro labels | normally 12–13 px for short status/provenance labels |
| Control height | 44 px normal actionable floor |
| Minimum touch target | 44×44 px |
| Page title | roughly 28–40 px desktop |

- Clearly visible translucent lavender boundaries on structural panels/cards; lighter thin borders remain appropriate for controls and incidental dividers.
- Restrained red/blue ambient glow and modest blur.
- Bold clean sans-serif for content; monospace only for job IDs, stages, ETA, cost, and technical status.
- Compact but nonzero spacing and clear hierarchy.
- One dominant action per screen.
- Glow and gradient must never reduce readability.
- Major panels normally use 18–24 px padding and 14–20 px inter-section gaps.
- Shadow or glow reinforces a boundary but never replaces real padding or a nonzero layout gap. Avoid double-boxing nested content and avoid applying a heavy glow to every input.
- Do not simulate scale with CSS `zoom`; components themselves must use readable type, controls, media, spacing, and hit targets.
- Do not simulate the requested density by shrinking the whole page. Ordinary user-facing copy stays legible in the 14–16 px range; short status/provenance microcopy may use 12–13 px when it remains high contrast and nonessential to the primary action.

## Information density and content voice

Use three consistent information layers:

1. **Glance:** identity or preview, name, current actionable exception when one exists, and the primary action. A healthy preset card does not repeat ready/passed/version/date metadata.
2. **Inspect:** a `Details`, `References (N)`, or `Examples (N)` trigger opens a focused side sheet with user-facing settings and evidence.
3. **Audit:** collapsed sections inside that sheet contain immutable IDs, hashes, models, attempts, detailed cost, rights/retention, and version history.

Details are closed by default. On desktop the preferred inspect surface is a roughly 480–560 px side sheet that does not reflow the card grid; on mobile it becomes a full-screen sheet. Dense image galleries use a sheet/lightbox, not a small dropdown. Accordions within the sheet expose sections without producing one long wall of metadata. A disclosure that edits the current form expands in normal flow inside its parent border, so its child controls read as one component and cannot cover the next section.

Keep an active blocker, pending next check, incurred charge, required consent, budget approval, spend cap, and destructive action visible in the primary layer. These are never hidden merely to make the page look cleaner. Short success confirmation belongs in a toast; persistent panels are for actionable failure or an operation that is still pending.

Errors name the actual failed field or operation and the next useful action. Do not substitute a generic preflight message for a specific upload, preset, budget, profile, or provider error. Field validation stays adjacent to the field; mutation failures may use a concise accessible toast, and durable blockers remain inline until resolved.

Use direct nouns and outcomes instead of slogans or repeated implementation rationale. Preferred page titles are `Queue`, `New project`, the project title, `Review`, `Avatar Hub`, `Image Styles`, `Library`, `Usage`, and `Settings`. Friendly labels such as `Ready`, `Test passed`, `Retest suggested`, and `Needs review` belong in the primary layer; raw enum values remain available only in technical details.

## Information architecture

1. **Google sign-in / access denied**
   - Invite-only message, selected account, retry, and admin contact.

2. **Queue dashboard**
   - Queued, starting, running, needs attention, complete, cancelled.
   - Owner, created time, queue position, stage, progress, ETA, selected mode, estimated/actual cost.
   - New Project is the clear primary action.
   - The active project is visually dominant; secondary jobs remain large, scannable rows/cards rather than a tiny dense table.
   - Lane counts, revision IDs, worker health, and event history move behind project details unless they are the current blocker.

3. **Create project**
   - Title.
   - Voiceover dropzone with a short `Drop or choose final narration` prompt, accepted format names, and selected-file/upload state. Duration limits, channel count, sample rate, and other technical media rules remain strictly validated but are not advertised in the primary dropzone; show a precise field error only when the actual file violates one.
   - Required compact visual Avatar dropdown. Its closed trigger shows only the selected private thumbnail and name; opening it reveals the visual choices and search when the catalog is large enough to need it. Version and compatibility evidence remain in details or a real warning state. No per-project avatar upload. A native browser `<select>` or an always-expanded preset-card grid does not satisfy this requirement.
   - Selecting stores the exact version immediately. A later v2 does not silently replace selected v1; show `Newer version available`. Untested/stale/cancelled/failed compatibility shows increasingly strong warnings, but none blocks a ready source or starts a hidden test under the proposed MVP policy.
   - A `+ New avatar` shortcut. With no ready avatar, Generate is blocked by a clear `Create your first avatar` action; the persistent dock owns ordinary Hub navigation.
   - Required compact visual Image Style dropdown, preselected to Authentic Documentary Stock. Its closed trigger shows the selected cover/name and `Default` only when useful; opening it reveals the visual choices and search when useful. `+ New style` and reference/example details remain available without expanding every style into the form.
   - One simple `Apply extra keywords to every AI image` toggle, off by default, plus a bounded optional textarea. The toggle itself is the state; do not add persistent `Applied`, `Not applied`, success, or effective-settings confirmation panels. Show only a real validation error when enabled text is empty, invalid, or conflicts with output rules.
   - Do not expose an exact-script field in the first-shell web UI. The versioned request may retain nullable `optional_script` for backward compatibility, but this shell sends `null` and uses local ASR text as canonical.
   - Lowest cost / Balanced / Faster remains a suggestion for the two exact GPU choices; it never silently replaces either choice.
   - A compact Compute section exposes two independent app-native dropdowns: `Image generation · Mage-Flow INT8` (`image_media`) and `Avatar generation · EchoMimicV3-Flash FP8` (`avatar_primary`). Each list is populated from a fresh compatible RunPod Secure Cloud inventory receipt for `EU-RO-1` and shows exact GPU SKU/offering, VRAM, current quoted rate, availability, and measured timing when evidence exists. Loading, empty, stale, refresh-failed, and selected-offering-disappeared states are explicit. Options expand inside the same compute card rather than invoking a Chrome/OS menu.
   - The two choices are independent. Image selection is constrained to the exact Mage lane contract (`Comfy-Org/Mage-Flow` revision `d8c99241f6fa80fbd453014234af2bf337ea21e6`, `int8-convrot`, ComfyUI, 4 steps, guidance 1.0, 1280×720); avatar selection is constrained to the pinned EchoMimicV3-Flash FP8 lane contract. A GPU choice never changes the model, volume, region, or runtime contract. The server revalidates both exact offerings immediately before Pod creation; stale or vanished offerings block with `Refresh GPUs` instead of silently choosing another GPU.
   - Preflight appears as `Ready to generate` or a concise blocker count, plus cost range, spend cap, inventory-receipt age, and one `Generate video` button. Local voiceover decode/probe/checksum plus an immutable resumable upload reservation are required before Ready. One accepted Generate action starts the separate Mage and Echo Pods concurrently, each against only its own persistent `EU-RO-1` model volume. While they boot, the app overlaps durable voiceover upload and local ASR, deterministic scheduling, prompt compilation, and avatar-span audio slicing. No model work is dispatched before its durable input barrier. Passed immutable-contract facts move into `Review settings` rather than occupying success panels.

4. **Project progress**
   - Sticky full-width active-project command bar with title, phase, factual percent, ETA, and current cost; API/worker health is compact unless degraded. Use normal page-edge padding and inset the inner project/progress track itself. Do not center the whole bar inside a narrow max-width island.
   - Prominent but medium-scale project title and progress hero containing a compact ring, stage/status/ETA/cost cards, and one clear progress bar.
   - Parallel image and avatar lane cards. Each exposes truthful lifecycle progress: Pod creating → model volume attached → container ready → model volume manifest verified → model loading → warm-up → model ready → generating → outputs durable → Pod deleting → Pod deleted/absence verified. `Model ready` is authoritative only after offline volume verification, GPU load, and warm-up. The retained volume is shown separately and must never look deleted with the Pod.
   - Human stage rows: Prepare → Transcribe → Plan → Write image prompts → Generate media → Assemble → Technical check → Review. Independent lane boot and local preparation appear in parallel rather than as a false serial percentage. Raw stage and lifecycle IDs remain in details.
   - A large latest-artifact preview, not three generic composition explainers.
   - Concrete current action such as `EchoMimic: clip 18/52`, `Mage: image 42/80`, or `Deleting Mage Pod` rather than `working`.
   - Safe cancel, retry failed stage, archive, review, and download as allowed by current state.
   - Pause only if backend pause semantics genuinely exist.
   - Pinned inputs, models, immutable activity, hashes, and per-attempt cost are progressively disclosed.

5. **Review**
   - Lightweight chronological strip, not a full NLE.
   - Fast contact-sheet/filter views for full images, split companions, avatar clips, retries, and unreviewed/flagged items; reviewing one final result must not require opening 300 dialogs.
   - Each glance card shows thumbnail, time, layout, review state, and a concise phrase. Model/attempt, full phrase, QA evidence, cost, hashes, and pinned versions live in segment details.
   - Toggle the same avatar clip between full and split preview; never generate a second version.
   - Technically valid assets appear as selected drafts. A reviewer may flag an avatar clip as `Lip sync` or `Whole-frame/identity/motion/detail`; show the cost of an Echo retry before dispatch. Alternative repair/fallback models are not active production choices unless a later gated decision explicitly adds them.
   - Rendering completes as `Ready for review`, not a false creative pass. `Approve final` is explicit and records the reviewer/revision; generated pseudo-text, anatomy, relevance, or style defects remain human rejection reasons in MVP.
   - The final preview and filters are primary. Output codec/grammar/provenance facts move into `Technical details`; after approval, `Download MP4` and `Manifest` are direct actions.

6. **Avatar Hub**
   - First-class floating-dock destination containing private named Avatar Profile cards with an actual thumbnail and name. Healthy ready/passed/version/date metadata stays in `Details`; only an exceptional actionable state becomes a glance-layer badge. Initials or a generic silhouette are fallback-only when an authorized thumbnail genuinely fails.
   - Avatar and Image Style Hubs share the same card anatomy and media height: exactly two columns above 680 px and one column on mobile. A single avatar remains one half-width card on desktop rather than stretching across the row.
   - New-avatar flow: name → one private source upload → technical validation → source safe-area/centering review plus rights/likeness consent → `Approve and add to Avatar Hub`.
   - View, rename, create a new source version, optional test/retest, duplicate, and archive. Only the active ready version appears in the normal project selector; source dimensions, crop previews, compatibility evidence, version history, rights, retention, hashes, and exact IDs are progressive disclosure.
   - No built-in or silent avatar default. Recent ready profiles sort first, and the user explicitly selects one; duplicated projects may retain their pinned profile.
   - A new source is uploaded here once and never copied into each project. Optional compatibility tests are explicit, separately estimated, and do not block a structurally ready profile in MVP.

7. **Image Styles Hub**
   - Card hub for workspace/system styles with a real consented retained thumbnail, accepted generated cover, or deterministic palette/medium placeholder; name, a `Default` or exceptional draft/action badge only when useful, and a `References (N)` or truthful `Owned examples (N)` trigger. Summary, active version, and technical lifecycle move into details.
   - Every custom style exposes the actual authorized reference images for that exact version behind `References (N)`. The gallery supports a larger lightbox and on-demand alias, dimensions, supporting traits, outlier state, rights, and retention details.
   - The manually seeded built-in `documentary_stock_v1` has no uploaded runtime reference set. It may expose owned/generated `Examples (N)`, but must never call those images references or reuse the third-party Ranga research frames in the product.
   - New-style wizard: upload references → analyze → review/edit → optional Mage test → return to review → explicit publish. A completed preview never auto-publishes.
   - View, create new version, duplicate, test, archive; built-in default cannot be edited, deleted, or archived.
   - Before Analyze, require rights attestation plus plain consent that normalized copies go to Runware and standard processing is not zero-data-retention/non-confidential; distinguish VideoForge deletion from provider retention/deletion.
   - Analysis is asynchronous/resumable and keeps the uploaded reference mosaic available during review. Cost, overall/per-trait confidence, supporting reference aliases, outliers, provider failure, and retry are visible at the relevant step or behind details after publication.
   - Published v1 remains usable while a v2 draft is analyzing; never label the whole style unavailable because its next version is unfinished.

8. **Library**
   - Preview, download, manifest, archive, retention status.

9. **Usage**
   - Per-project/lane/model cost, Pod billed seconds, Pod creation, container-ready, volume-verification, model-load, warm-up, model-ready, inference, durable-upload, deletion/absence timings, retries, storage, and budget-cap events.
   - One-time style-analysis and optional test-preview costs remain separate from a video's generation cap.

10. **Settings/admin**
   - Team allowlist and roles.
   - RunPod/Runware credential status without revealing values.
   - Separate Mage/Echo retained-volume health, exact immutable manifests, and `EU-RO-1` lane policy; no cross-lane adoption action.
   - Scheduler bounds, cost cap, and optional per-lane GPU preference hints. Live availability and an explicit user selection still govern every paid run. `documentary_stock_v1` remains the fixed MVP new-project style default.
   - No instructions to use the provider console.

## Core components

- Floating navigation dock with Queue, New Project, active Progress, Avatar Hub, Image Styles, Library, Usage, and Settings; the active route is unmistakable. Desktop items rest at 76×62 px with 10 px dock padding, while icon tiles rest at 38×35 px with 24 px glyphs. On fine pointers above 820 px, only the icon tile scales: the pointer target peaks at 1.75×, immediate and second neighbors scale progressively less, and icons 240 px or farther remain exactly 1×. Every icon keeps the same bottom edge; link boxes, labels, dock padding, and the active-route backing remain static. Touch/coarse-pointer, widths at or below 820 px, and reduced-motion modes stay neutral. At 1024 px every destination remains directly reachable with visible focus and accessible names. Compact/mobile uses a labelled 4×2 dock without hiding either Hub or destructive/budget controls.
- Full-width top active-project command bar with an internally inset project/progress track and compact mobile treatment.
- Progress ring plus factual completed/total counts.
- Metric cards for stage, ETA, cost, queue, GPU.
- Stage timeline with queued/running/retrying/blocked/failed/cancelled/complete states.
- Two independent live GPU selectors for `image_media` and `avatar_primary`. Each shows a fresh `EU-RO-1` Secure Cloud inventory receipt, exact offering/SKU, VRAM, current rate, compatibility, and measured speed; neither selector may display a static priority list as current availability or silently substitute another GPU.
- Validated upload dropzones.
- Searchable visual Avatar selector and private reusable Avatar Profile cards with real thumbnails.
- Searchable visual Image Style selector and reusable style cards with covers.
- Version-bound reference/example mosaic, focus-trapped details sheet, keyboard lightbox, extracted-style review, and optional test-preview comparison.
- Cost estimator and hard-cap control.
- Live preview and signed download.
- Toasts for short confirmation; persistent inline panels for actionable failure or long-running pending work.

## Mandatory states

Design these before polishing the happy path:

- Empty queue.
- Uploading and upload failed.
- Style reference upload invalid/failed.
- Avatar Hub empty, source uploading, source invalid/too small, rights or likeness consent missing, validating, needs review, ready, optional test estimate/running/review, test failed, test cancelled/retryable, stale compatibility, archived selection, and version conflict.
- Style-analysis rights/disclosure consent missing.
- Style analyzing, low-confidence, outlier references, needs review, published, analysis failed/retryable, abandoned, and provider unavailable.
- Selected style archived/not ready or style version conflict.
- Optional test-preview estimate, starting, generating, accepted, and failed.
- Transcribing.
- Loading/refreshing live GPU inventory, no compatible offering, inventory refresh failed, stale receipt, and selected offering disappeared before final revalidation.
- Pod create requested, Pod creating, and Pod create failed or ambiguous/reconciling.
- Correct persistent model volume attaching, attached, manifest verifying, verified, unavailable, wrong lane, wrong region, or invalid manifest.
- Container starting and container ready.
- Model loading and model-load failed. Normal boot never downloads model files; a download state during ordinary generation is a blocking architecture violation.
- Warm-up running/failed and authoritative model ready.
- Generating with counts.
- Partial lane complete.
- Retrying a clip.
- Outputs uploading, durable, and local final MP4 saved/verified.
- Pod delete requested, deleting, delete ambiguous/reconciling, deleted, and independent provider-absence verified; model volume retained.
- Reconnecting/reconciling after callback loss.
- Cancel requested and cancel confirmed.
- Budget blocked.
- Insufficient provider balance.
- Ready for review with preview/contact sheet but no false creative-pass claim.
- Approved and downloadable with reviewer/provenance manifest.

Every click that starts asynchronous work must immediately disable duplicate submission and show the authoritative next check.

The project extra-keyword textarea may retain text when its toggle is off. The toggle is the only persistent applied-state indicator; do not add a separate applied/not-applied confirmation. Inactive text is not semantically validated and never blocks production. Turning the toggle on validates immediately: whitespace-only text is rejected; enabling requests for forbidden output blocks with plain feedback; negative phrases such as `no logo`, `no text`, and `no AI look` remain valid. Soft creative tension only warns. Any explanatory copy belongs behind on-demand details rather than occupying another persistent panel.

Opening `+ New style` from Create Project autosaves the complete draft and verified voiceover upload handle. Publishing or cancelling returns to that same draft; a newly published style is selected automatically, and no title/audio/avatar-selection/settings re-entry or voiceover re-upload is required.

Opening `+ New avatar` from Create Project follows the same no-loss rule: autosave title, verified voiceover upload handle, selected style, keyword text/toggle, mode, both exact GPU selections plus their inventory-receipt identity, cap, and seed. Saving or cancelling returns to that draft; a newly ready avatar is selected automatically. A stale receipt requires refresh before Generate, but never loses the rest of the draft. There is no voiceover re-upload and no hidden project-local avatar copy.

## Multi-user clarity

- Always show project owner.
- If another user holds an edit/revision lease, name that state and offer read-only review.
- Queue order and workspace concurrency limit are visible.
- Admin-only actions look and behave differently from ordinary actions.

## Accessibility and responsiveness

- WCAG AA contrast.
- Visible keyboard focus and full keyboard navigation.
- Status always pairs color with text/icon.
- Semantic labels on progress and icon buttons.
- Details sheets trap focus, close with Escape, restore focus to their trigger, and expose a clear labelled heading.
- Accordion triggers expose `aria-expanded`/`aria-controls`; reference lightboxes support Escape and previous/next keyboard commands.
- No substantive information or action is hover-only.
- Respect `prefers-reduced-motion`; status remains clear without animation.
- Dock proximity magnification is enhancement-only: it never carries information, never translates an icon or backing surface, never changes layout geometry, and is disabled at 820 px or below, for reduced motion, and for coarse/touch pointers.
- Operator transcript text may appear in the app but is never burned into output.
- Desktop-first at 1280–1920 px; fully usable at 1024 px.
- Floating navigation is keyboard reachable, reports the active route semantically, and keeps Avatar Hub/Image Styles Hub directly reachable at 1024 px.
- Mobile may emphasize queue/status/review, but cannot silently hide destructive or budget controls.
- On mobile the command bar remains full-width and compact; its internal progress inset may reduce, but title/status/progress must not collapse into unreadable microcopy or create horizontal overflow.
- At mobile widths, the progress hero becomes one column, galleries use two columns, and details/lightboxes become full-screen. Bottom safe-area/content padding prevents the floating dock from covering Generate, Approve, Cancel, or spend-cap controls.
- No supported viewport may have page-level horizontal overflow.

## Live-development contract

- Run the local hot-reload app in the user's actual Chrome from the first UI phase.
- Use fixture/mocked GPU states before RunPod integration so all flows are playable early.
- Until the vNext machine schemas, fixtures, persistence, and Pod adapters in `10_DATA_AND_API_CONTRACTS.md` are implemented and accepted, the live-GPU/Pod UI is fixture-only and paid Generate fails closed. Existing v1/v2 execution-profile forms must not be relabelled as this production architecture.
- Keep one stable `http://localhost:4173` server/tab; never silently move ports or reset the user's in-progress project draft during hot reload.
- In fixture/local mode only, show a compact `Fixture`/health control. Its on-demand details expose provider mode, commit, fixture ID, API health, synthetic-data label, and `$0` authorization. Do not consume a full persistent row with developer metadata, and hard-disable the control in production builds.
- Commit small working increments; hot reload shows local code changes immediately, while preview deployments can support remote checks later.
- Verify a baseline and after-change user journey by interacting like a human, checking browser console and failed network requests—not by screenshots alone.
- Keep a persistent feedback list and convert confirmed UI decisions into this context pack.
- Include the Avatar Hub, Avatar selector, Image Styles Hub, style wizard, and keyword-toggle states in the first fixture-backed shell so the user can shape both preset libraries in Chrome before provider integration.

## UI acceptance

The UI passes when the non-developer user can create/store a named avatar once, see every authorized preset thumbnail, select avatar/style versions from compact visual dropdowns without re-upload, inspect every authorized custom-style reference on demand, distinguish built-in generated examples from uploaded references, create/review/publish/select a style, opt into extra keywords without a redundant confirmation panel, refresh live compatible `EU-RO-1` inventory, independently select the exact Mage and Echo GPUs, and start/monitor/recover/review/download a fully automated final MP4 without asking what a technical status means. The primary layer is compact at real Chrome 100%, minimal, and free of repeated technical explanations; the full audit detail remains reachable; no button appears inert; navigation is clear; expanded content has real internal separation; the full-width command bar and its internal track scale cleanly; cost and compute/avatar/style state are truthful; ordinary boot never implies model download; both disposable Pods reach provider-verified absence after their outputs are durable while their separate model volumes remain retained; no supported viewport overflows or hides critical controls; and the user approves the design through the live Chrome gate.

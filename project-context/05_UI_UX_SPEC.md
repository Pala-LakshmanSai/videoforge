# UI and UX specification

Status: implemented large-scale minimal direction; `GATE_UI_001` awaits user approval
Read when: designing or implementing any user-visible flow.

## Design objective

The UI should feel like a clean, lively, futuristic production console while remaining understandable to a non-developer. The backend can be complex; the primary layer must be visually calm, large enough to read without zooming, and free of explanatory clutter.

Primary reference: `assets/ui/swipecut-ui-reference.jpg`. It is inspiration only. Do not copy its logo, name, sample content, exact trade dress, or proprietary text.

The user reconfirmed this direction on 2026-08-09 after rejecting the first fixture shell as too small, too dense, and too text-heavy. The approved hierarchy borrows the reference's active-project command strip, oversized project title, large progress hero, factual metric cards, strong vertical pipeline, live artifact panel, and floating navigation dock. VideoForge must translate those concepts into its own routes, copy, data, and visual identity rather than copying the reference product.

The same review later refined the Create Project hierarchy: keep the active choice compact, open choices only on demand, remove nonessential technical hints and success confirmations, and expose the two primary compute lanes without implying unverified GPU availability. The active-project bar remains full-width; only its internal content and progress track are deliberately inset. Every visible select/disclosure uses the VideoForge surface language rather than a browser-native menu. Child choices expand inside the same bordered surface, never as visually detached boxes or an overlay that covers the following controls. The floating dock is approximately 20% larger than the prior version and uses fine-pointer proximity magnification with a calm reduced-motion fallback.

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
| Control radius | about 18 px |
| Panel radius | about 28–30 px |
| Base text | 20 px desktop; 18 px compact/mobile |
| Secondary text | at least 16 px |
| Micro labels | at least 16 CSS px; short labels/status only |
| Control height | normally 60 px |
| Minimum touch target | 44×44 px |
| Page title | roughly 48–72 px desktop |

- Thin translucent lavender borders.
- Restrained red/blue ambient glow and modest blur.
- Bold clean sans-serif for content; monospace only for job IDs, stages, ETA, cost, and technical status.
- Generous spacing and clear hierarchy.
- One dominant action per screen.
- Glow and gradient must never reduce readability.
- Major panels normally use 28–42 px padding and 24–32 px inter-section gaps.
- Do not simulate scale with CSS `zoom`; components themselves must use readable type, controls, media, spacing, and hit targets.
- Do not render user-facing text below 16 CSS px. Short stage/status metadata may be visually quieter through color, weight, and letter spacing—not a tiny font.

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
   - Lowest cost / Balanced / Faster preset.
   - A compact Compute section exposes two independent app-native dropdowns: `Image generation` (`image_media`) and `Avatar generation` (`avatar_primary`). Each selects an immutable execution profile—not a raw per-job GPU—and shows truthful lane/profile status. Planned GPU candidates remain visible but disabled with `Benchmark required`; no production candidate becomes selectable until `GATE_GPU_001`. Options expand inside the same compute card rather than invoking a Chrome/OS menu. Optional repair/quality lanes remain behind details and appear only when provisioned. Never imply that one exact Serverless GPU is guaranteed per job. The resolved per-lane profile IDs are pinned before dispatch.
   - Preflight appears as `Ready to generate` or a concise blocker count, plus cost range, spend cap, and one `Generate video` button. Passed immutable-contract facts move into `Review settings` rather than occupying four success panels.

4. **Project progress**
   - Sticky full-width active-project command bar with title, phase, factual percent, ETA, and current cost; API/worker health is compact unless degraded. Use normal page-edge padding and inset the inner project/progress track itself. Do not center the whole bar inside a narrow max-width island.
   - Oversized project title and progress hero containing a large ring, stage/status/ETA/cost cards, and one clear progress bar.
   - Parallel image and avatar lane cards.
   - Human stage rows: Prepare → Transcribe → Plan → Write image prompts → Generate media → Assemble → Technical check → Review. Raw stage IDs remain in details.
   - A large latest-artifact preview, not three generic composition explainers.
   - Concrete current action such as “AvatarForcing: clip 18/52” rather than “working.”
   - Safe cancel, retry failed stage, archive, review, and download as allowed by current state.
   - Pause only if backend pause semantics genuinely exist.
   - Pinned inputs, models, immutable activity, hashes, and per-attempt cost are progressively disclosed.

5. **Review**
   - Lightweight chronological strip, not a full NLE.
   - Fast contact-sheet/filter views for full images, split companions, avatar clips, retries, and unreviewed/flagged items; reviewing one final result must not require opening 300 dialogs.
   - Each glance card shows thumbnail, time, layout, review state, and a concise phrase. Model/attempt, full phrase, QA evidence, cost, hashes, and pinned versions live in segment details.
   - Toggle the same avatar clip between full and split preview; never generate a second version.
   - Technically valid assets appear as selected drafts. A reviewer may flag an avatar clip as `Lip sync only` or `Whole-frame/identity/motion/detail`; show the resulting retry/fallback estimate before dispatch.
   - Rendering completes as `Ready for review`, not a false creative pass. `Approve final` is explicit and records the reviewer/revision; generated pseudo-text, anatomy, relevance, or style defects remain human rejection reasons in MVP.
   - The final preview and filters are primary. Output codec/grammar/provenance facts move into `Technical details`; after approval, `Download MP4` and `Manifest` are direct actions.

6. **Avatar Hub**
   - First-class floating-dock destination containing private named Avatar Profile cards with a large actual thumbnail and name. Healthy ready/passed/version/date metadata stays in `Details`; only an exceptional actionable state becomes a glance-layer badge. Initials or a generic silhouette are fallback-only when an authorized thumbnail genuinely fails.
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
   - Per-project/lane/model cost, GPU seconds, cold start, retries, storage, budget-cap events.
   - One-time style-analysis and optional test-preview costs remain separate from a video's generation cap.

10. **Settings/admin**
   - Team allowlist and roles.
   - RunPod/Runware credential status without revealing values.
   - Storage and GPU defaults.
   - Scheduler bounds, cost cap, and GPU-mode defaults. `documentary_stock_v1` remains the fixed MVP new-project style default.
   - No instructions to use the provider console.

## Core components

- Reference-inspired floating navigation dock with Queue, New Project, active Progress, Avatar Hub, Image Styles, Library, Usage, and Settings; the active route is unmistakable. Its desktop base items are approximately 94×74 px with about 12 px dock padding. On fine pointers, the hovered icon lifts and scales most, immediate and second neighbors scale progressively less, and layout boxes never move. Touch/coarse-pointer and reduced-motion modes remain stable. At 1024 px every destination remains directly reachable with visible focus and accessible names. Mobile uses a labelled 4×2 dock without hiding either Hub or destructive/budget controls.
- Full-width top active-project command bar with an internally inset project/progress track and compact mobile treatment.
- Progress ring plus factual completed/total counts.
- Metric cards for stage, ETA, cost, queue, GPU.
- Stage timeline with queued/running/retrying/blocked/failed/cancelled/complete states.
- Two primary execution-profile selectors for `image_media` and `avatar_primary`, each showing truthful lane status. Selected tested profiles may progressively disclose endpoint mode, ordered GPU priorities, availability, VRAM, current maximum rate, compatibility, and measured speed; planned candidates remain disabled until `GATE_GPU_001`.
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
- Waiting for GPU availability.
- GPU cold start.
- Container starting.
- Model loading.
- Generating with counts.
- Partial lane complete.
- Retrying a clip.
- MuseTalk repair.
- SkyReels fallback awaiting budget approval.
- Reconnecting/reconciling after callback loss.
- Cancel requested and cancel confirmed.
- Budget blocked.
- Insufficient provider balance.
- Ready for review with preview/contact sheet but no false creative-pass claim.
- Approved and downloadable with reviewer/provenance manifest.

Every click that starts asynchronous work must immediately disable duplicate submission and show the authoritative next check.

The project extra-keyword textarea may retain text when its toggle is off. The toggle is the only persistent applied-state indicator; do not add a separate applied/not-applied confirmation. Inactive text is not semantically validated and never blocks production. Turning the toggle on validates immediately: whitespace-only text is rejected; enabling requests for forbidden output blocks with plain feedback; negative phrases such as `no logo`, `no text`, and `no AI look` remain valid. Soft creative tension only warns. Any explanatory copy belongs behind on-demand details rather than occupying another persistent panel.

Opening `+ New style` from Create Project autosaves the complete draft and verified voiceover upload handle. Publishing or cancelling returns to that same draft; a newly published style is selected automatically, and no title/audio/avatar-selection/settings re-entry or voiceover re-upload is required.

Opening `+ New avatar` from Create Project follows the same no-loss rule: autosave title, verified voiceover upload handle, selected style, keyword text/toggle, mode, both execution-profile selections, cap, and seed. Saving or cancelling returns to that draft; a newly ready avatar is selected automatically. There is no voiceover re-upload and no hidden project-local avatar copy.

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
- Dock proximity magnification is enhancement-only: it never carries information, never changes layout geometry, and is disabled for reduced motion and coarse/touch pointers.
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
- Keep one stable `http://localhost:4173` server/tab; never silently move ports or reset the user's in-progress project draft during hot reload.
- In fixture/local mode only, show a compact `Fixture`/health control. Its on-demand details expose provider mode, commit, fixture ID, API health, synthetic-data label, and `$0` authorization. Do not consume a full persistent row with developer metadata, and hard-disable the control in production builds.
- Commit small working increments; hot reload shows local code changes immediately, while preview deployments can support remote checks later.
- Verify a baseline and after-change user journey by interacting like a human, checking browser console and failed network requests—not by screenshots alone.
- Keep a persistent feedback list and convert confirmed UI decisions into this context pack.
- Include the Avatar Hub, Avatar selector, Image Styles Hub, style wizard, and keyword-toggle states in the first fixture-backed shell so the user can shape both preset libraries in Chrome before provider integration.

## UI acceptance

The UI passes when the non-developer user can create/store a named avatar once, see every authorized preset thumbnail, select avatar/style versions from compact visual dropdowns without re-upload, inspect every authorized custom-style reference on demand, distinguish built-in generated examples from uploaded references, create/review/publish/select a style, opt into extra keywords without a redundant confirmation panel, select truthful image/avatar execution profiles, and start/monitor/recover/review/download a project without asking what a technical status means. The primary layer is large, minimal, and free of repeated technical explanations; the full audit detail remains reachable; no button appears inert; navigation is clear; the full-width command bar and its internal track scale cleanly; cost and compute/avatar/style state are truthful; no supported viewport overflows or hides critical controls; and the user approves the design through the live Chrome gate.

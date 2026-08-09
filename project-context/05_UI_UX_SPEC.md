# UI and UX specification

Status: approved large-scale minimal direction; exact implementation awaits live Chrome review
Read when: designing or implementing any user-visible flow.

## Design objective

The UI should feel like a clean, lively, futuristic production console while remaining understandable to a non-developer. The backend can be complex; the primary layer must be visually calm, large enough to read without zooming, and free of explanatory clutter.

Primary reference: `assets/ui/swipecut-ui-reference.jpg`. It is inspiration only. Do not copy its logo, name, sample content, exact trade dress, or proprietary text.

The user reconfirmed this direction on 2026-08-09 after rejecting the first fixture shell as too small, too dense, and too text-heavy. The approved hierarchy borrows the reference's active-project command strip, oversized project title, large progress hero, factual metric cards, strong vertical pipeline, live artifact panel, and floating navigation dock. VideoForge must translate those concepts into its own routes, copy, data, and visual identity rather than copying the reference product.

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
| Base text | 16–17 px |
| Secondary text | at least 15 px |
| Micro labels | 12–13 px; labels/status only |
| Control height | 50–56 px |
| Minimum touch target | 44×44 px |
| Page title | roughly 48–72 px desktop |

- Thin translucent lavender borders.
- Restrained red/blue ambient glow and modest blur.
- Bold clean sans-serif for content; monospace only for job IDs, stages, ETA, cost, and technical status.
- Generous spacing and clear hierarchy.
- One dominant action per screen.
- Glow and gradient must never reduce readability.
- Major panels normally use 28–36 px padding and 24–32 px inter-section gaps.
- Do not simulate scale with CSS `zoom`; components themselves must use readable type, controls, media, spacing, and hit targets.
- Avoid body/helper text below 15 px. Micro labels below that size are reserved for short stage/status metadata and must still meet contrast requirements.

## Information density and content voice

Use three consistent information layers:

1. **Glance:** identity or preview, name, human-readable status, progress/version, and the primary action.
2. **Inspect:** a `Details`, `References (N)`, or `Examples (N)` trigger opens a focused side sheet with user-facing settings and evidence.
3. **Audit:** collapsed sections inside that sheet contain immutable IDs, hashes, models, attempts, detailed cost, rights/retention, and version history.

Details are closed by default. On desktop the preferred inspect surface is a roughly 480–560 px side sheet that does not reflow the card grid; on mobile it becomes a full-screen sheet. Dense image galleries use a sheet/lightbox, not a small dropdown. Accordions within the sheet expose sections without producing one long wall of metadata.

Keep an active blocker, pending next check, incurred charge, required consent, budget approval, spend cap, and destructive action visible in the primary layer. These are never hidden merely to make the page look cleaner. Short success confirmation belongs in a toast; persistent panels are for actionable failure or an operation that is still pending.

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
   - Voiceover dropzone with format/duration validation and waveform/duration summary.
   - Required searchable visual Avatar selector showing the private thumbnail, name, active version, and compatibility badge; no per-project avatar upload. A native text-only `<select>` does not satisfy this requirement.
   - Selecting stores the exact version immediately. A later v2 does not silently replace selected v1; show `Newer version available`. Untested/stale/cancelled/failed compatibility shows increasingly strong warnings, but none blocks a ready source or starts a hidden test under the proposed MVP policy.
   - `Manage avatars` and `+ New avatar` shortcuts. With no ready avatar, Generate is blocked by a clear `Create your first avatar` action.
   - Required visual Image Style picker, preselected to Authentic Documentary Stock, with cover, summary, version, search, `Manage styles`, `+ New style`, and direct access to its reference/example gallery.
   - `Apply extra keywords to every AI image` toggle, off by default, plus a bounded optional textarea and effective-settings preview.
   - Optional script and image-keyword controls share one collapsed `Script and image keywords` section; `Not applied` remains visible when saved keyword text is disabled.
   - Lowest cost / Balanced / Faster preset.
   - Advanced tested execution-profile overrides behind disclosure, independently selectable for image/media and primary avatar (with repair/quality lanes visible only when provisioned); show ordered compatible GPU priorities without pretending one exact Serverless GPU is guaranteed per job. The resolved per-lane profile IDs are pinned before dispatch.
   - Preflight appears as `Ready to generate` or a concise blocker count, plus cost range, spend cap, and one `Generate video` button. Passed immutable-contract facts move into `Review settings` rather than occupying four success panels.

4. **Project progress**
   - Sticky active-project command track with title, phase, factual percent, ETA, and current cost; API/worker health is compact unless degraded.
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
   - First-class floating-dock destination containing private named Avatar Profile cards with a large actual thumbnail, active ready version, human-readable compatibility state, and last used/updated time. Initials or a generic silhouette are fallback-only when an authorized thumbnail genuinely fails.
   - New-avatar flow: name → one private source upload → technical validation → source safe-area/centering review plus rights/likeness consent → `Approve and add to Avatar Hub`.
   - View, rename, create a new source version, optional test/retest, duplicate, and archive. Only the active ready version appears in the normal project selector; source dimensions, crop previews, compatibility evidence, version history, rights, retention, hashes, and exact IDs are progressive disclosure.
   - No built-in or silent avatar default. Recent ready profiles sort first, and the user explicitly selects one; duplicated projects may retain their pinned profile.
   - A new source is uploaded here once and never copied into each project. Optional compatibility tests are explicit, separately estimated, and do not block a structurally ready profile in MVP.

7. **Image Styles Hub**
   - Card hub for workspace/system styles with a real consented retained thumbnail, accepted generated cover, or deterministic palette/medium placeholder; name, one-line summary, active version, separate draft-version state, reference/example count, and Default badge.
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

- Reference-inspired floating navigation dock with Queue, New Project, active Progress, Avatar Hub, Image Styles, Library, Usage, and Settings; the active route is unmistakable. At 1024 px every destination remains directly reachable with visible focus and accessible names. Narrow mobile navigation may use an explicit `More` surface, but it cannot make either Hub undiscoverable or hide destructive/budget controls.
- Top active-project command/progress track.
- Progress ring plus factual completed/total counts.
- Metric cards for stage, ETA, cost, queue, GPU.
- Stage timeline with queued/running/retrying/blocked/failed/cancelled/complete states.
- Execution-profile selector showing endpoint mode, ordered GPU priorities, availability, VRAM, current maximum rate, compatibility, and measured speed.
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

The project extra-keyword textarea may retain text when its toggle is off, but the UI must clearly say `Not applied`. Inactive text is not semantically validated and never blocks production. Turning the toggle on validates immediately: whitespace-only text is rejected; enabling requests for forbidden output block with plain feedback; negative phrases such as `no logo`, `no text`, and `no AI look` remain valid. Soft creative tension only warns. Its helper text: `Affects AI images only. It does not change avatar, timing, or layout.`

Opening `+ New style` from Create Project autosaves the complete draft and verified voiceover upload handle. Publishing or cancelling returns to that same draft; a newly published style is selected automatically, and no title/audio/avatar-selection/script re-entry or voiceover re-upload is required.

Opening `+ New avatar` from Create Project follows the same no-loss rule: autosave title, verified voiceover upload handle, selected style, optional script, keyword text/toggle, mode, execution-profile overrides, cap, and seed. Saving or cancelling returns to that draft; a newly ready avatar is selected automatically. There is no voiceover re-upload and no hidden project-local avatar copy.

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
- Operator transcript text may appear in the app but is never burned into output.
- Desktop-first at 1280–1920 px; fully usable at 1024 px.
- Floating navigation is keyboard reachable, reports the active route semantically, and keeps Avatar Hub/Image Styles Hub directly reachable at 1024 px.
- Mobile may emphasize queue/status/review, but cannot silently hide destructive or budget controls.
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

The UI passes when the non-developer user can create/store a named avatar once, see every authorized preset thumbnail, select it later by image and name without re-upload, inspect every authorized custom-style reference on demand, distinguish built-in generated examples from uploaded references, create/review/publish/select a style, understand whether extra keywords are applied, and start/monitor/recover/review/download a project without asking what a technical status means. The primary layer is large, minimal, and free of repeated technical explanations; the full audit detail remains reachable; no button appears inert; navigation is clear; cost and GPU/avatar/style state are truthful; no supported viewport overflows or hides critical controls; and the user approves the design through the live Chrome gate.

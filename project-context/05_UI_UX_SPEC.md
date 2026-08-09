# UI and UX specification

Status: approved direction; exact component implementation awaits live Chrome review  
Read when: designing or implementing any user-visible flow.

## Design objective

The UI should feel like a clean, futuristic production console while remaining understandable to a non-developer. The backend can be complex; the creation flow must not be.

Primary reference: `assets/ui/swipecut-ui-reference.jpg`. It is inspiration only. Do not copy its logo, name, sample content, exact trade dress, or proprietary text.

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

- Thin translucent lavender borders.
- Restrained red/blue ambient glow and modest blur.
- Bold clean sans-serif for content; monospace only for job IDs, stages, ETA, cost, and technical status.
- Generous spacing and clear hierarchy.
- One dominant action per screen.
- Glow and gradient must never reduce readability.

## Information architecture

1. **Google sign-in / access denied**
   - Invite-only message, selected account, retry, and admin contact.

2. **Queue dashboard**
   - Queued, starting, running, needs attention, complete, cancelled.
   - Owner, created time, queue position, stage, progress, ETA, selected mode, estimated/actual cost.
   - New Project is the clear primary action.

3. **Create project**
   - Title.
   - Voiceover dropzone with format/duration validation and waveform/duration summary.
   - Required searchable Avatar selector showing private thumbnail, name, active version, and compatibility badge; no per-project avatar upload.
   - Selecting stores the exact version immediately. A later v2 does not silently replace selected v1; show `Newer version available`. Untested/stale/cancelled/failed compatibility shows increasingly strong warnings, but none blocks a ready source or starts a hidden test under the proposed MVP policy.
   - `Manage avatars` and `+ New avatar` shortcuts. With no ready avatar, Generate is blocked by a clear `Create your first avatar` action.
   - Required Image Style picker, preselected to Authentic Documentary Stock, with cover, summary, version, search, `Manage styles`, and `+ New style`.
   - `Apply extra keywords to every AI image` toggle, off by default, plus a bounded optional textarea and effective-settings preview.
   - Optional script disclosure.
   - Lowest cost / Balanced / Faster preset.
   - Advanced tested execution-profile overrides behind disclosure, independently selectable for image/media and primary avatar (with repair/quality lanes visible only when provisioned); show ordered compatible GPU priorities without pretending one exact Serverless GPU is guaranteed per job. The resolved per-lane profile IDs are pinned before dispatch.
   - Preflight checklist, cost range, spend cap, and one Generate button.

4. **Project progress**
   - Sticky command track with title, phase, percent, ETA, current cost, API/worker health.
   - Parallel image and avatar lane cards.
   - Stage rows: ingest → timing → timeline → prompts → image/avatar generation → assembly → QA → ready.
   - Latest artifact preview.
   - Concrete current action such as “AvatarForcing: clip 18/52” rather than “working.”
   - Safe cancel, retry failed stage, archive, download.
   - Pause only if backend pause semantics genuinely exist.

5. **Review**
   - Lightweight chronological strip, not a full NLE.
   - Fast contact-sheet/filter views for full images, split companions, avatar clips, retries, and unreviewed/flagged items; reviewing one final result must not require opening 300 dialogs.
   - Each card shows time, timeline layout, exact phrase, asset, model/attempt, QA state, cost, regenerate/replace.
   - Toggle the same avatar clip between full and split preview; never generate a second version.
   - Technically valid assets appear as selected drafts. A reviewer may flag an avatar clip as `Lip sync only` or `Whole-frame/identity/motion/detail`; show the resulting retry/fallback estimate before dispatch.
   - Rendering completes as `Ready for review`, not a false creative pass. `Approve final` is explicit and records the reviewer/revision; generated pseudo-text, anatomy, relevance, or style defects remain human rejection reasons in MVP.

6. **Avatar Hub**
   - First-class sidebar destination containing private named Avatar Profile cards with thumbnail, active ready version, source dimensions, optional AvatarForcing compatibility state, and last used/updated time.
   - New-avatar flow: name → one private source upload → technical validation → source safe-area/centering review plus rights/likeness consent → `Approve and add to Avatar Hub`.
   - View, rename, create a new source version, optional test/retest, duplicate, and archive. Only the active ready version appears in the normal project selector; version history is progressive disclosure.
   - No built-in or silent avatar default. Recent ready profiles sort first, and the user explicitly selects one; duplicated projects may retain their pinned profile.
   - A new source is uploaded here once and never copied into each project. Optional compatibility tests are explicit, separately estimated, and do not block a structurally ready profile in MVP.

7. **Image Styles Hub**
   - Card hub for workspace/system styles with a consented retained thumbnail, accepted generated cover, or deterministic palette/medium placeholder; name, one-line summary, active version, separate draft-version state, reference count, and Default badge.
   - New-style wizard: upload references → analyze → review/edit → optional Mage test → return to review → explicit publish. A completed preview never auto-publishes.
   - View, create new version, duplicate, test, archive; built-in default cannot be edited, deleted, or archived.
   - Before Analyze, require rights attestation plus plain consent that normalized copies go to Runware and standard processing is not zero-data-retention/non-confidential; distinguish VideoForge deletion from provider retention/deletion.
   - Analysis is asynchronous/resumable and shows cost, overall/per-trait confidence, supporting reference aliases, outliers, provider failure, and retry.
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

- Persistent/collapsible desktop sidebar with Queue, New Project, Avatar Hub, Image Styles Hub, Library, Usage, and Settings; the active route is unmistakable. At 1024 px it collapses to labeled tooltips/icons without hiding either Hub or keyboard focus.
- Top command/progress track.
- Progress ring plus factual completed/total counts.
- Metric cards for stage, ETA, cost, queue, GPU.
- Stage timeline with queued/running/retrying/blocked/failed/cancelled/complete states.
- Execution-profile selector showing endpoint mode, ordered GPU priorities, availability, VRAM, current maximum rate, compatibility, and measured speed.
- Validated upload dropzones.
- Searchable Avatar selector and private reusable Avatar Profile cards.
- Searchable Image Style selector and reusable style cards.
- Reference mosaic/uploader, extracted-style review, and optional test-preview comparison.
- Cost estimator and hard-cap control.
- Live preview and signed download.
- Toasts for short confirmation; persistent inline panels for actionable failure.

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
- Respect `prefers-reduced-motion`; status remains clear without animation.
- Operator transcript text may appear in the app but is never burned into output.
- Desktop-first at 1280–1920 px; fully usable at 1024 px.
- Sidebar navigation is keyboard reachable, reports the active route semantically, and keeps Avatar Hub/Image Styles Hub accessible in collapsed mode.
- Mobile may emphasize queue/status/review, but cannot silently hide destructive or budget controls.

## Live-development contract

- Run the local hot-reload app in the user's actual Chrome from the first UI phase.
- Use fixture/mocked GPU states before RunPod integration so all flows are playable early.
- Keep one stable `http://localhost:4173` server/tab; never silently move ports or reset the user's in-progress project draft during hot reload.
- In fixture/local mode only, show a compact status ribbon with provider mode, commit, fixture ID, API health, and a clear synthetic-data label. It must not ship enabled in production.
- Commit small working increments; hot reload shows local code changes immediately, while preview deployments can support remote checks later.
- Verify a baseline and after-change user journey by interacting like a human, checking browser console and failed network requests—not by screenshots alone.
- Keep a persistent feedback list and convert confirmed UI decisions into this context pack.
- Include the Avatar Hub, Avatar selector, Image Styles Hub, style wizard, and keyword-toggle states in the first fixture-backed shell so the user can shape both preset libraries in Chrome before provider integration.

## UI acceptance

The UI passes when the non-developer user can create/store a named avatar once, select it later by image and name without re-upload, create/review/publish a style, select it, understand whether extra keywords are applied, and start/monitor/recover/review/download a project without asking what a technical status means; no button appears inert; navigation is clear; cost and GPU/avatar/style state are truthful; and the user approves the design in live Chrome.

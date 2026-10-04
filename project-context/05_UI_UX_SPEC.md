# UI and UX specification

Status: compact dark product UI; the authorized 2026-10-01 Progress redesign supersedes exact
geometry for that page. Tenant-private automatic Serverless states remain normative.
Read when: changing product surfaces, queue/progress behavior, or Chrome acceptance.

## Design objective

### Visible pipeline simplification — 2026-10-03

Hide Prepare project and Technical check from the numbered Progress timeline. Keep preparation,
final file/duration/audio/checksum validation, and their authoritative status internally. Fresh
motion projects display ten stages; legacy projects display nine. Transcription is stage1; context,
planning and image prompts are stages2–4. Header numbering, progress and side-panel labels use the
visible sequence. Elapsed wall time still includes preparation and waiting; row timing and legacy
ETA bind by stage identity rather than a filtered array position.

Machine status shows the actual active assigned GPU/CPU first. Once durable Cloud metadata reports
CLEAN or COMPLETE, retain the last recorded machine marked Compute released, with Media APIs
running when image, avatar or scene video generation is active. A missing GPU must never be
invented. Temporary Pods run transcription, batched audio spans and final assembly; provider API
work does not require a retained Pod. This adds startup latency but avoids idle compute charges.

### Progress page redesign — 2026-10-01

The user authorizes rearranging and resizing the Progress page while preserving all functionality
and reviewing the pull request before publication (`DEC_UX_006`). Use a wider responsive canvas:
stages and run controls on the left, preview and generation status in the center, saved prompts on
the right. Smaller screens use two columns, then one. Compact the summary, soften borders and
retain full saved prompts, stage actions, cancellation, refresh, deletion, and Review access.
Only markup and scoped CSS change; existing requests, handlers, timers, provider/recovery logic,
media identity and cost semantics remain intact. Other screens and navigation retain their layout.
Local appearance/interaction verification does not authorize production publication.

### Compact interaction pass — 2026-09-14

Keep routes, colors, and the media-first structure; Progress geometry follows the redesign above. Field labels replace repeated
section instructions. Stage rows show descriptions for current/problem stages, not completed or
pending stages. Preset traits and generation rules remain available in disclosures. Connected
computers show setup/installers under an add/update disclosure; first setup and required updates
remain expanded. Dropdowns dismiss on outside interaction or focus departure, retain keyboard
navigation, and wrap full option names. Unknown provider results retain explicit no-automatic-retry
copy. Never present missing cost data as zero or hardcode enabled generation as unavailable.

Provider-free acceptance and release status: `CURRENT_STATE.yaml`,
`evidence/acceptance/VF-10-09/2026-09-14-ui-ux-polish/acceptance.json`.

Preserve the current visual system, information architecture, routes, hubs, project flow, and
responsive behavior. The authorized Progress redesign changes presentation only. VideoForge should
look like a calm production product for a non-technical user:
large media previews, clear hierarchy, compact primary controls, honest progress/cost, and technical
detail available on demand.

Remove or replace infrastructure concepts that require user operation. Users do not select GPUs,
start/stop Pods, unlock a global session, choose a warm worker, or use RunPod console instructions.
They select creative inputs and **Generate video**. Projects have no maximum-spend input. Automatic scale-to-zero worker
behavior appears as truthful status/details only.

Every signed-in account has one default workspace. User-created projects, queue, Avatar Hub, Image
Styles, Library, Usage, and settings are private. Built-in styles are globally available read-only.
Do not expose another account's creator, project, queue item, media, preset, cost, provider job, or
activity through lists, URLs, counts, search, errors, previews, signed URLs, or realtime updates.

## Immutable output grammar

- Only full avatar, full image, and avatar-left/image-right split.
- Hard cuts only; slow smooth centered zoom on images.
- No captions, text overlays, titles, lower thirds, borders, watermarks, motion graphics, decorative
  graphics, title cards, or decorative transitions.
- Review shows the same native avatar clip in full/split compositions; it never suggests generating a
  second crop-specific avatar clip.

## Visual system to preserve

- Existing warm ivory page, dark ink text, muted gray secondary text, off-white cards, hairline
  neutral borders, warm accent, restrained green/amber/red semantic states, and soft shallow shadow.
- Inter for product UI; existing display serif only where already established. Do not introduce a
  dashboard-template visual reset.
- Desktop-first at 1280–1920px, fully usable at 1024px, and compact/mobile without page overflow.
- Floating navigation dock retains Queue, New Project, Progress, Avatar Hub, Image Styles, Library,
  Usage, and Settings. At 1024px all destinations remain directly reachable.
- Fine-pointer dock magnification above 820px is scale-only: 76x62px item, 38x35px tile, 24px glyph,
  pointer peak 1.75x, smoothly smaller neighbors, fixed bottom edge, no layout movement. Disable for
  touch/coarse pointer, reduced motion, and width <=820px.
- Existing full-width active-project command bar with an internally inset progress track remains.
- Two-column hub cards above 680px and one column below; a single avatar card does not stretch across
  a desktop row.

## Content voice

Lead with plain user outcomes: `Waiting`, `Preparing`, `Generating images`, `Generating avatar`,
`Assembling`, `Ready for review`. Put endpoint IDs, image/manifest hashes, worker identity, timing,
VRAM, and provider reconciliation behind **Technical details**. Never say `stopped` or `scale-to-zero`
unless backend/provider evidence supports it. Never imply technical QA judged creative quality.

Use short, direct copy throughout the app. Prefer one sentence per helper; errors state the blocker
and next action. Remove redundant explanations and confirmation steps; retain necessary cost facts.

## Information architecture

### 1. Login and admission

- Google-only sign-in, verified email, and one single-use invite during first admission only.
- Explicit invalid, expired, revoked, consumed, raced, email-mismatch, pending-verification, and
  identity-collision states without leaking whether another account exists.
- Successful admission creates the user's default workspace. Returning users never see invite UI.

### Team access

An account disclosure in the existing command bar shows the signed-in identity and Sign out.
Only authorized managers see Team access. `/access` provides invitation creation, one-time code
copy/dismiss, member search, current status, pending invitations, refresh, and explicit revoke/restore
confirmation. The responsive dark cards follow the current shell. Assistants receive a clear refusal
on direct navigation and cannot load the management API. Each assistant retains a private studio;
Team access never grants visibility into another account's projects or media.

### 2. Private queue/home

- Show only this account's projects with title, private thumbnail, state, stage, progress, ETA, cost,
  created time, and account-local order.
- At most one item for the account is active. Waiting entries can be reordered/cancelled only by this
  account. Reorder changes FIFO order inside the account; it does not promise global priority.
- Explain global capacity without exposing other users: `Waiting for production capacity`,
  `Up to 2 videos can generate at once`, and a privacy-safe ETA/range.
- Queue state comes from durable DB admission. A RunPod endpoint queue length is technical telemetry,
  not the product position.
- Empty, loading, stale/reconnecting, queued, admission-race, active, cancelling, failed, blocked,
  ready-for-review, approved, archived, and recovery states are explicit.

### 3. Create Project

- Title, validated voiceover picker/drop, visual Avatar Profile/Image Style selectors, optional keyword
  toggle/text and seed, estimate, one Generate button. Selecting audio autofills blank titles without
  .mp3/.wav; replacement updates unchanged suggestions, manual titles remain. Cost stays visible and
  exactly accounted; no user-configured maximum-spend field.
- No project-local avatar upload. `+ New avatar` autosaves the entire draft/upload handle, returns to
  it, and selects the new ready profile. `+ New style` behaves the same.
- Selectors show only the account's usable versions plus explicit built-ins. A foreign/removed ID
  becomes a generic unavailable state, not an existence leak.
- Default path selects built-in `documentary_stock_v1`; no avatar is silently selected.
- Create video automatically checks probe/checksum/duration, capacity and ownership before upload.
  No separate readiness button. Submission blocks duplicates and confirms the durable queue result.
- Preflight shows `Ready to generate` or concise blocker count, estimated variable range, cap, exact
  creative/model settings, and storage/consent facts. It does not expose GPU choices, Pod controls,
  endpoint configuration, or model-volume actions.
- After the scene plan is saved, Progress shows a Kie plus Fal provider-cost estimate from the
  planned image count and avatar frame duration. Show the quantities and label the amount as an
  estimate until actual provider billing is available; before planning, say when it will appear.
- Lowest cost/Balanced/Faster may remain as deterministic policy labels only after measured contracts
  exist; they cannot change a locked model/quality setting or silently add an unqualified GPU.

Keyword behavior: text may remain while toggle is off and is neither applied nor semantically
validated. Turning on validates immediately. Whitespace-only is invalid; forbidden requested output
blocks; negative phrases such as `no logo`, `no text`, and `no AI look` remain valid. The toggle is
the only persistent applied-state indicator.

### 4. Progress

- Total elapsed is wall-clock time from project creation (the Prepare project start) to now while
  production is active, or its persisted terminal time after success/failure/cancellation. Count
  parallel work once and include queue/handoff waits. Human review does not extend production
  time. Render-only retries retain their own attempt start. Individual stage timers stay unchanged.

- Human stage rows: Prepare -> Transcribe -> Plan -> Write image prompts -> Generate images /
  Generate avatar -> Assemble -> Technical check -> Review.
- Image/avatar lane cards may progress in parallel and show current counts such as `Image 42/80` or
  `Avatar clip 18/52`.
- Automatic worker lifecycle wording is read-only: `Waiting for worker`, `Worker starting`, `Verifying
  model`, `Loading model`, `Warming up`, `Model ready`, `Generating`, `Uploading results`, `Worker
  released`, `Scale-to-zero verified`. Do not show a Start/Stop/Recreate button.
- `Model ready` requires exact volume-manifest verification, GPU load, and real warm-up. A mounted
  volume, healthy container, webhook, or provider RUNNING state is insufficient.
- Queue delay, worker initialization, model-ready, inference, upload, render, and ETA are distinct.
  Never disguise worker boot as generation time.
- A large latest-artifact preview is primary. Raw lifecycle/attempt IDs and immutable hashes stay in
  details.
- Show exact action/blocker and retry implications. If a provider POST is ambiguous, use
  `Reconciling provider job`; do not display a duplicate retry button until recovery makes it safe.
- Cancel is safe/idempotent and becomes `Stopping future work` then `Reconciling active work`; it does
  not promise already incurred cost disappears.
- Pause appears only if real durable pause semantics exist.

### 5. Review

- Large final preview and chronological strip/contact-sheet filters for full images, split companion
  images, avatar clips, retries, flags, and unreviewed items; not a nonlinear editor.
- Each glance card shows thumbnail, time, layout, short phrase, and review state. Full phrase,
  model/attempt, cost, hashes, and QA live in details.
- Technically valid assets become selected drafts. A user may flag `Lip sync`,
  `Identity/motion/background/detail`, `Narration relevance`, `Anatomy/pseudo-text`, or `Style`.
- Any regeneration displays incremental estimated/capped cost and creates a new attempt. No hidden
  repair, enhancement, fallback, or model substitution.
- Generated-image review shows the exact saved positive prompt instead of internal IDs. Every scene
  provides an editable prompt and **Regenerate image** action, plus a Regenerate button on every
  accepted-image thumbnail. Images are reviewable as soon as accepted, including loaded later pages.
  New replacements use Fal Z-Image Turbo; the editor discloses the API charge. Enter submits; Shift+Enter adds a
  newline. Editing the prompt alone performs no work, and each scene retains its own draft.
- Regeneration creates only that scene's replacement using its pinned style and existing negative
  prompt. The old image remains selected until the replacement passes artifact validation. Pending
  and failed replacements do not discard accepted media or rerun the ordinary image/avatar pair.
- Existing final videos currently remain unchanged after image regeneration; the editor states
  this explicitly. Automatic rebuilding, fresh render identity, and stale approval handling remain
  pending scope confirmation and implementation. Other scenes and avatar footage remain unchanged.
  Repeated clicks and lost-response recovery must not create duplicate paid attempts.

- Final render is `Ready for review`. Explicit **Approve final** records reviewer/revision. Approved
  **Download MP4** and **Manifest** are direct private actions. MP4 downloads use the pinned
  voiceover filename, replacing its MP3/WAV suffix with `.mp4`, independently of project title.

### 6. Avatar Hub

- Account-private named cards with real authorized thumbnail/name. Healthy version/date/compatibility
  metadata is in details; show a badge only for an actionable exception.
- Flow: name and one private source upload -> visual/technical review -> add. The final action carries
  one concise inline rights/likeness confirmation; there is no standalone consent page or checkbox
  wall.
- View, rename, new immutable version, optional test/retest, duplicate, archive. Only active ready
  versions are normal new-project choices; pinned prior versions remain attached to existing work.
- The source is uploaded once to private R2 and never copied into each project. There is no global
  user-created catalog or cross-account visibility.

### 7. Image Styles Hub

- Account-private custom cards plus explicit global/system built-ins. Use real authorized cover or a
  deterministic palette/medium placeholder.
- Custom versions expose only their own account-authorized `References (N)` gallery. Global
  `documentary_stock_v1` has no uploaded runtime references and may label owned generated media only
  as `Examples (N)`; never show Ranga research frames.
- Wizard: upload -> visual review with concise inline rights/processing/retention disclosure ->
  explicit one-time analyze -> review/edit -> optional separately estimated Mage test -> explicit
  publish. There is no standalone consent page or checkbox wall. Preview never auto-publishes.
- Published v1 remains usable while v2 is draft/analyzing. Built-in default cannot be edited,
  deleted, or archived.
- Plain inline disclosure states that normalized references go through Runware to Gemini once for
  explicit style analysis and provider retention follows their terms; distinguish VideoForge
  deletion from provider retention. Clicking Analyze records the disclosure acknowledgement.

### 8. Library and Usage

- Library shows only account-owned previews/downloads/manifests/retention/archive states.
- Usage shows per-project/lane/model costs, queue wait, worker-init/model-ready/inference/upload/
  render timing, GPU/VRAM, attempts/retries, R2/volume allocation, cap events, and reconciliation.
- Fixed recurring retained-volume billing is an operational/shared service cost and is shown
  separately from the video's variable cost. Do not attribute another account's exact spend.
- Projected, conservative bound, observed, and settled cost are distinct labels.

### 9. Settings

- Account identity/default workspace, credential connection health without values, invite/admission
  support state, retention controls, and output defaults.
- A `Local worker` card shows `Not installed`, `Connecting`, `Online`, `Busy`, `Offline`, or
  `Update required`, plus last seen/version and only `Reconnect`/`Remove` management. Offer the
  detected Windows or Mac installer first but keep both links visible because user-agent detection
  is a convenience, not authority. Settings defaults to macOS/Windows paste-to-connect commands,
  with Copy, a 15-minute expiry, fresh-command action, and automatic Online refresh. The command
  grants one computer access to the signed-in account; keep it private. It installs the exact
  checksum-verified worker and pairs through the existing PKCE and OS credential store.
  Manual downloads and the existing `Connect this computer` approval remain under a disclosure.
  Never ask users to supply a URL, key, model, port, or path.
- Generate is blocked only when the account has no compatible online worker and links directly to
  this card. Offline stage truth is `Waiting for your computer`. Never display another tenant's
  device or borrow its capacity.
- Approved videos remain in private R2 until explicit **Delete** confirmation. That action deletes
  the exact durable R2 object; downloading never triggers automatic deletion.
- No provider console instructions, GPU selectors, Pod lifecycle, endpoint purge, volume mutation,
  model download/preparation, cross-mount, or fallback controls.
- Operations-only technical details may show immutable Mage/SoulX manifests, `EU-RO-1`, fixed
  Serverless bounds, and zero-worker state behind authorization; normal users see service health.

## Required Serverless states

- Durable queue accepted, duplicate submission recovered, fair-capacity waiting, admission pending,
  admitted, and lost-lease reconciliation.
- Serverless request not sent, outbox pending, submitting, provider ID bound, ambiguous/reconciling,
  queued, in progress, delayed, completed, timed out, failed, cancelled, and late-callback ignored.
- Waiting for Flex worker, worker initialized, exact volume verified, model loading, warm-up,
  model-ready, generating, result upload/receipt, local scratch cleanup, worker released, and zero
  workers verified.
- Wrong endpoint/image/model/volume/region/GPU/manifest/input/output/tenant identity; runtime download
  attempt; model-volume write; missing receipt; expired 30-minute async result; webhook-only result;
  TTL/init/execution timeout; duplicate-compute/cost risk; cap risk; and provider balance failure.
- Partial lane complete and accepted-asset barrier waiting.
- Scale-down observation stale/failed. Do not report zero endpoint jobs or zero total workers
  (`Active + Flex`) until independently proven.

Provider job details are never an authorization surface. Ordinary users do not see or control another
account's jobs even though endpoints and volumes are shared infrastructure.

## Multi-user clarity

- Use `Your video is waiting` and privacy-safe capacity language. Never display another account's
  queue title, creator, media, position, status details, or cost.
- At most one of the account's videos shows active progress. A second account can run concurrently
  without altering this account's ownership or controls.
- Users reorder/cancel only their own waiting work. Explain that order is within their own queue and
  fair rotation decides cross-account admission.
- Realtime channels, cached queries, browser history, predictable IDs, download URLs, and error text
  must pass the same isolation boundary as REST reads.
- Short edit/version leases name only this account's own conflicting session; no cross-account actor
  identity is exposed.

## Accessibility and responsiveness

- WCAG AA contrast; visible keyboard focus; semantic labels; full keyboard navigation.
- Pair color with text/icon. No substantive action or fact is hover-only.
- Details sheets trap focus, close with Escape, restore focus, and have labelled headings.
- Accordions expose `aria-expanded`/`aria-controls`; galleries/lightboxes support keyboard controls.
- Respect reduced motion. Dock magnification never carries meaning or changes layout geometry.
- Transcript may appear in the operator UI but is never burned into output.
- Mobile cannot hide Generate, Approve, Cancel, cost, retention, or security-critical controls.
- At mobile widths command bar remains readable, progress becomes one column, galleries use two
  columns where viable, sheets become full-screen, safe-area padding clears the dock, and no page
  has horizontal overflow.

## Live-development contract

- Use the stable `http://localhost:4173` hot-reload app in the user's real Chrome.
- Fixture/provider-free is default until each relevant production checkpoint passes. Fixture status
  is clearly labelled and production builds cannot enable fixture controls.
- Preserve drafts/uploads through hot reload and Hub round trips.
- Validate baseline and changed flows through actual Chrome interaction, console, and failed-network
  inspection, not screenshots alone.
- Add tenant A/B fixtures and Serverless lifecycle fixtures before live provider integration.
- Existing Pod/global-session UI may remain only behind historical replay/fixture quarantine while
  migration is in progress; it must never be relabelled production Serverless behavior.

## UI acceptance

The UI passes when two signed-in fixture accounts can each see only their own data, create/select
private reusable presets plus global built-ins, submit without infrastructure decisions, receive
fair private queue state, and run one video per account concurrently up to the global two-video
bound. Each can monitor truthful automatic worker and media stages, recover/cancel/retry without
duplicate submission, review the three-composition hard-cut output, approve, and privately download.
No manual Pod/GPU control or foreign data appears; cost and worker readiness/scale-down are truthful;
all existing visual/accessibility/responsive gates remain green in real Chrome.

## Historical Seedance7% rollout (2026-10-03; superseded for fresh coverage below)

At the original 7% rollout, pinned Seedance projects showed Generate scene videos immediately after Generate images in the numbered Progress list. Clips start after their own source image accepts and may overlap remaining image/avatar generation. Progress exposes accepted clip counts, saved uncertainty/failure and private paginated Generated videos playback. Legacy projects keep the existing stage count and two media tabs. New Project states7% generated coverage,720p16:9 and per-second cost; projected totals include footage and actual Runware task cost remains separate from unverified Kie/Fal invoices. Local requires the qualified0.1.46 release; Cloud uses the separately qualified Linux image.


## Published whole scene coverage control (2026-10-03)

Create provides a synchronized 0–100% Video footage coverage slider/number field, presets 0/7/15/25/50/75/100 and default 7%. The value means up to that percentage of the finished video as scene footage; avatars are separate. Coverage edits invalidate preflight and stale asynchronous responses. Preliminary cost/seconds precede scheduling, then requested/planned/accepted coverage and whole-scene shortfall appear in Progress/Review. Off skips the scene-video stage. Published source 89cfe121 and live Chrome controls pass, including custom23, keyboard24, invalid101 and mobile390px. Fresh generated whole-film playback/editorial acceptance remains open; legacy plans/outputs remain unchanged. Details: [combined plan](tasks/SEEDANCE_VIDEO_PLAN.md#whole-scene-replacement-follow-up).

## Voiceover Hub and script input — 2026-10-04

Create defaults to Upload voiceover. Upload script reveals script file/paste controls, a searchable voice dropdown ordered starred, saved, then other voices, and Generate voiceover. Both the Hub and picker match normalized voice-name prefixes: `b` shows B names, never voices whose country codes merely contain b. Search ignores case, accents and surrounding/repeated whitespace. The picker supports arrows, Enter, Escape, Tab and outside dismissal; reselecting the current voice preserves accepted narration. Generation is explicit; selection and editing never call TTS. The completed MP3 can be heard/downloaded before Create video. Changing inputs invalidates accepted audio; request identity is retained after a lost submission response. A saved provider job can be restored after refresh.

Voiceover Hub is in primary navigation. New libraries open All voices; existing collections open Saved. Counted filters, name search, clear/reset actions, paginated voice cards and distinct empty/error/loading states accompany private Save/Remove and Star/Unstar preferences. One closeable preview supports play/pause/end/error/retry. Optional ElevenLabs-ID import opens a compact dismissible panel; success clears stale search and opens Saved. A provider-key owner's imported library is visible only to that account; other imported voices require a workspace import. No credential is entered or returned in product UI. Mobile navigation fits its nine destinations into two rows.

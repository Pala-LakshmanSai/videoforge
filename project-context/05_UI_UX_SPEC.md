# UI and UX specification

Status: current compact 100%-zoom product UI is the preserved baseline; tenant-private automatic
Serverless states below are normative transition work
Read when: changing product surfaces, queue/progress behavior, or Chrome acceptance.

## Design objective

Preserve the current visual system, information architecture, routes, hubs, project flow, and
responsive behavior. The architecture transition is primarily backend/state-language work, not a UI
redesign. VideoForge should look like a calm top-tier production product for a non-technical user:
large media previews, clear hierarchy, compact primary controls, honest progress/cost, and technical
detail available on demand.

Remove or replace infrastructure concepts that require user operation. Users do not select GPUs,
start/stop Pods, unlock a global session, choose a warm worker, or use RunPod console instructions.
They select creative inputs, a spend cap, and **Generate video**. Automatic scale-to-zero worker
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

## Information architecture

### 1. Login and admission

- Email/password or Google, verified email, and one single-use invite during signup only.
- Explicit invalid, expired, revoked, consumed, raced, email-mismatch, pending-verification, and
  identity-collision states without leaking whether another account exists.
- Successful admission creates the user's default workspace. Returning users never see invite UI.

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

- Title, validated voiceover upload, visual Avatar Profile selector, visual Image Style selector,
  optional keyword toggle/text, optional seed, estimate, spend cap, and one Generate button.
- No project-local avatar upload. `+ New avatar` autosaves the entire draft/upload handle, returns to
  it, and selects the new ready profile. `+ New style` behaves the same.
- Selectors show only the account's usable versions plus explicit built-ins. A foreign/removed ID
  becomes a generic unavailable state, not an existence leak.
- Default path selects built-in `documentary_stock_v1`; no avatar is silently selected.
- Voiceover validates local/server probe, checksum, duration, and resumable private upload before
  Ready. Submission immediately disables duplicates and shows its durable queue result.
- Preflight shows `Ready to generate` or concise blocker count, estimated variable range, cap, exact
  creative/model settings, and storage/consent facts. It does not expose GPU choices, Pod controls,
  endpoint configuration, or model-volume actions.
- Lowest cost/Balanced/Faster may remain as deterministic policy labels only after measured contracts
  exist; they cannot change a locked model/quality setting or silently add an unqualified GPU.

Keyword behavior: text may remain while toggle is off and is neither applied nor semantically
validated. Turning on validates immediately. Whitespace-only is invalid; forbidden requested output
blocks; negative phrases such as `no logo`, `no text`, and `no AI look` remain valid. The toggle is
the only persistent applied-state indicator.

### 4. Progress

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
- Final render is `Ready for review`. Explicit **Approve final** records reviewer/revision. Approved
  **Download MP4** and **Manifest** are direct private actions.

### 6. Avatar Hub

- Account-private named cards with real authorized thumbnail/name. Healthy version/date/compatibility
  metadata is in details; show a badge only for an actionable exception.
- Flow: name -> one private source upload -> technical validation -> safe-area/centering and
  rights/likeness review -> approve and add.
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
- Wizard: upload -> consent -> analyze -> review/edit -> optional separately estimated Mage test ->
  explicit publish. Preview never auto-publishes.
- Published v1 remains usable while v2 is draft/analyzing. Built-in default cannot be edited,
  deleted, or archived.
- Plain consent states that normalized references go to Runware and standard processing is not
  confidential/ZDR; distinguish VideoForge deletion from provider retention.

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
- Mobile cannot hide Generate, Approve, Cancel, budget, retention, or security-critical controls.
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

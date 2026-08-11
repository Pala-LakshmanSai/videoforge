# Testing and acceptance

Status: required gates; numeric model thresholds marked proposed until Phase 0 review  
Read when: writing tests, accepting a milestone, or replacing planning assumptions with evidence.

## Test layers

1. Static/type/schema checks.
2. Unit and property tests.
3. Golden scheduler/FFmpeg tests.
4. Worker contract smoke with small real models.
5. Provider integration in test accounts.
6. End-to-end fixture workflow.
7. Ten-user/fault tests.
8. Human review in the user's Chrome.

Automated green tests do not replace visual/human acceptance for Mage, avatar realism, or UX.

Technical validity auto-selects draft assets and allows an automatic render, but never asserts generated-pixel creative perfection. The project ends `READY_FOR_REVIEW`; `APPROVED` requires a recorded user action after final video/contact-sheet review. No per-image vision API is implied.

## Completed Phase 0C local walking-slice baseline

**PASS on 2026-08-10.** The provider-free owned-audio slice ran through real local whisper.cpp,
deterministic scheduling, exact fixture-asset resolution, FFmpeg render, FFprobe, Range preview,
approval binding, hash-verified download, and installed-Chrome playback/seek at `$0`. After the user
rejected the first shaky zoom and requested a smoother v3 replacement, the exact
`ffmpeg-render-v3` file was reviewed and accepted as “good enough.” Canonical evidence is
`evidence/acceptance/VF-0C-08/2026-08-10-continuous-zoom-v3/`.

This baseline proves the local contracts and media path, not production durability. Fixture/local
state remains process-bounded; Postgres/R2/auth/restart recovery/provider transports are still
Phase 1 or later acceptance work.

## Scheduler gate

- Same inputs + seed + version produce identical `timeline-plan/v1`.
- The plan contains no generated asset IDs; `resolved-render-manifest/v1` binds accepted assets only after the barrier.
- Segment union is exact: full avatar requires avatar only, full image requires image only, split requires avatar plus right image.
- Every output frame is covered exactly once.
- No negative/zero scene or overlap/gap.
- Boundaries occur between words and near valid phrase/sentence points.
- Avatar clips remain within allowed bounds except documented opener adjustment.
- Total avatar converges to 21–22% within a reasonable tolerance.
- Full/split time is near equal and layouts alternate by rule.
- No forbidden composition enum.
- Property-test short audio, long silence, extremely fast/slow speech, missing punctuation, and 30+ minute input.

## Runware/DeepSeek gate

Use at least 40 representative narration scenes.

- 100% schema-valid or recovered by one item-level retry.
- Every requested scene ID returned exactly once.
- Sanitized project title appears once per batch, not per scene; it disambiguates but never overrides the exact phrase.
- Every item echoes its deterministic `in_image_shot_role` unchanged; DeepSeek never selects timeline composition or shot role.
- Cross-batch continuity is carried without a separate LLM call and does not invent facts.
- Literal subject/action matches the phrase.
- No invented factual contradiction, visible-text request, watermark, or forbidden style.
- Output remains concise enough for the planned token envelope.
- Provider-reported 30-minute-equivalent cost remains below $0.02.
- Live endpoint version/fingerprint confirms the approved 0731 target.
- Test at least the built-in documentary profile plus four distinct saved style-guidance blocks; selected style changes treatment without weakening narration relevance or duplicating its full suffix per item.

## Image Style analyzer and compiler gate

Analyzer fixtures:

- Coherent 3–8-reference set.
- One obvious outlier.
- Conflicting references with no honest consensus.
- Different subjects sharing one visual style.
- Similar subjects using substantially different visual styles.
- References containing a person, logo, watermark, visible instructions, EXIF/GPS, and private metadata.

Proposed pass criteria:

- Runware Gemini 3.5 Flash receives a complete request (`taskUUID`, user message, system prompt, images, inlined strict schema) and returns schema-valid `image-style-analyzer-output/v1`, or one idempotently reconciled retry recovers it.
- Shared medium, camera, image framing, lighting, color, texture, imperfection, continuity, positive, and negative traits are useful to a human reviewer.
- Recurring person/object/location/logo/text is not turned into a reusable prompt requirement.
- Outliers, overall/per-trait confidence, supporting reference aliases, and uncertainty are surfaced rather than hidden.
- Analyzer output has exactly one `SUPPORTED | UNCERTAIN | UNSUPPORTED` evidence entry for each of the 14 defined traits; duplicate, missing, or unknown traits fail.
- `ref_01...ref_N` are deterministically bound to ordered input derivatives and their hashes; unknown, duplicate, or out-of-range returned aliases are rejected.
- Canonical schema IDs resolve in local/CI validation and are fully inlined before the Runware call.
- Schema-valid but blank required creative strings/arrays fail the publish-time semantic validator; only explicitly optional negative/color-anchor/uncertainty/manual-evidence fields may be empty.
- First analysis target below $0.08; approved retry path below $0.15; usage/cost/model/profile hashes recorded.
- Built-in `documentary_stock_v1` is seeded without an external analysis call, preselected, immutable, non-deletable, and duplicable.
- A ready-style project performs zero Gemini/style-analysis calls.
- Published v1 remains selectable and unchanged while v2 is draft/analyzing/failed; atomic v2 publication alone moves the active pointer.
- Analyze is blocked until rights attestation and the Runware non-ZDR/non-confidential disclosure are accepted; VideoForge deletion and provider retention/deletion are presented and tested separately.
- Browser normalization strips EXIF/GPS and bounds dimensions/bytes; server checks reject forged MIME, malicious raster metadata, decompression bombs, and checksum mismatch without a paid image-processing dependency.
- Reference deletion never leaves an undisclosed retained card image; the hub falls back to an approved Mage cover or deterministic palette/medium placeholder.

Manual-edit provenance matrix (`DEC_STYLE_007`):

- First creative edit preserves the accepted analyzer artifact/evidence byte-for-byte, creates a
  distinct immutable `MANUAL_EDIT` artifact in the same `NEEDS_REVIEW` version, empties/nulls only
  the derived profile's inapplicable analysis fields, and records root/parent/derived hashes.
- Multiple edits form an unbroken immediate-parent chain back to one root source-analysis artifact;
  every artifact and edit record survives a fresh database/content-store reopen.
- Server-computed changed pointers cover only normalized creative differences, are sorted RFC 6901
  pointers, treat arrays atomically at the containing field, and reject an otherwise no-op edit.
- A candidate may change only `summary`, `visual_profile`, and `prompt_profile`; client-authored or
  retained analyzer confidence/evidence in derived bytes fails instead of being relabelled.
- Same actor/key/expected revision/canonical candidate replay returns the original response without
  another artifact or pointer move. Different bytes, revision, actor, or target under that identity
  fail with an idempotency conflict.
- Stale `If-Match`, stale review snapshot, source/current artifact drift, incompatible profile
  contract/version, semantic/guardrail failure, partial artifact/provenance failure, and hostile
  cross-workspace input leave current pointer/revision/publication state unchanged.
- Any edit invalidates the pending review snapshot. Publication requires a new authenticated review
  of the exact current derived hash/revision and records the reviewer separately from editor history.
- Publication pins the exact current derived bytes and freezes the version. Edit requests against
  `PUBLISHED`/`ABANDONED` fail; a post-publication edit starts a new version without mutating the old
  version, active historical artifacts, or project revisions pinned to them.
- Built-in styles remain non-editable; manual/duplicate sources never receive fabricated analyzer
  evidence. Provider calls, credentials, downloads, GPU/RunPod activity, and spend remain zero.

Compiler matrix:

- Empty keyword text + toggle off.
- Nonempty text + toggle off: absent from every DeepSeek/Mage request.
- Forbidden-looking text + toggle off: retained but does not block or undergo effective-prompt validation.
- Toggle on + empty/whitespace: rejected with a clear action.
- `add a logo`/caption request is blocked; `no logo`, `no text`, and `no AI look` are accepted negative refinements.
- Toggle on: normalized keywords appear exactly once in every compiled image prompt.
- Overlong/control-character text is bounded/blocked; hard-rule conflicts are blocked with plain feedback and soft creative tension only warns.
- Permanent no-text/logo/watermark/graphics guardrails always win.
- Same scene/style version/settings/compiler version produces identical components, exact final positive/negative UTF-8 strings, and hashes; enabled extras go only to Mage and disabled extras go to neither DeepSeek nor Mage.
- Analyzer-produced and user-edited style clauses pass the same hard-rule/crop-geometry validator before publication.
- Publishing style v2 or archiving the style cannot mutate a queued/running/ready revision pinned to v1.

## Mage acceptance suite

At least 40 prompts covering:

- People/skin.
- Hands and physical demonstrations.
- Food/produce/material texture.
- Tools and rural work.
- Interiors and retail/public settings.
- Macro evidence.
- Historical/period scenes.
- Wide environmental context.
- 8:9 split-safe framing.
- The built-in default and at least four substantially different published custom styles, using fixed neutral person/action/environment content for comparison.

Proposed pass criteria:

- At least 90% clearly relevant on first generation.
- No more than 5% obvious severe anatomy/text/watermark/AI-look failures after one bounded retry.
- Full-screen final zoom frames remain acceptably detailed at 1080p.
- Important subject survives full and split crop-safe tests.
- A human can distinguish intended custom styles without copied reference subjects, identities, logos, text, or exact compositions.
- 300-image cold job meets the approved measured cost and production envelope.
- No OOM/crash and peak VRAM leaves operational headroom.

The user makes the final blind quality judgment before resolution/upscaler lock.

## Avatar Hub contract gate

Use owned/synthetic sources for automated fixtures and separately authorized private sources for human acceptance.

- Create Project schema accepts only `avatar_profile_version_id`; reject `IMAGE_ASSET`, `avatar_image_asset_id`, raw avatar bytes, an unversioned parent ID, unknown fields, and mutable `latest` lookup.
- New Avatar validates magic bytes, supported format, byte/dimension/decompression bounds, checksum, orientation/color handling, and EXIF/GPS-free runtime/thumbnail outputs. Bad horizontal centering requires source replacement; no invisible browser crop is applied.
- Rights to use the image and rights/consent to animate the depicted likeness are explicit, authenticated, and required before `READY`.
- Active profile names are case-insensitively unique in one workspace; immutable IDs—not names—bind projects.
- Normal cards expose the active `READY` version of each accessible `ACTIVE` parent. A previously selected immutable v1 may remain valid after v2 activation. `UNTESTED`/`STALE`/`CANCELLED` optional compatibility is warned, not blocked; no silent/default avatar is chosen.
- Ready v1 remains selectable while v2 is drafted. Publishing v2 or renaming/archiving the parent cannot mutate a revision pinned to v1.
- Duplicate/new version never inherits a human compatibility verdict or rights/likeness attestation; source-byte reuse remains private to the same workspace.
- Archive between form selection and revision creation produces a clear preflight blocker. A revision already created from that version remains reproducible.
- Optional Test starts only after an explicit estimate/confirmation, is version-scoped/idempotent, records ambiguous dispatch/cost/verdict, and is never called when merely saving/selecting/reusing the profile.
- Project revision and `production-manifest/v2` contain matching parent/version/profile hash/runtime source checksum/preparation-validation profiles, exact compatibility state at preflight, and nullable evidence. `UNTESTED`/`RUNNING` require null evidence; terminal evidence status must equal the pinned preflight state. AvatarForcing and SkyReels attempts match that binding; MuseTalk retains its clip-source lineage.
- `+ New avatar` from a project draft preserves title, verified voiceover upload handle, selected style, keywords/toggle, mode, both primary execution-profile selections, cap, and seed; return/select requires no re-upload.

Pass: a named avatar can be stored once and reused by image/name without project-local upload, with immutable provenance and no unapproved provider charge.

## AvatarForcing exact-avatar suite

This is the global model/container/GPU qualification gate, not a required 12–20-clip run for every Avatar Profile. Use several representative ready Avatar Profile versions and 12–20 clips of 4–10 seconds total containing:

- Ordinary speech.
- Fast speech and sibilants.
- Plosives/labials and visible teeth.
- Smiles and neutral delivery.
- Pauses/silence.
- Head turns and restrained upper-body motion.
- Difficult beard/mustache/hair boundaries if relevant.
- Full-screen 1920×1080 and 960×1080 split crop review.

Measure cold start, model load, peak VRAM, frame time, accepted-output cost, lips, identity, background, body/motion, temporal stability, and upscale detail.

Proposed provisional lock:

- All jobs complete without OOM/NaN/crash.
- At least 90% first-pass clip acceptance.
- No severe identity/background/body failure.
- No visible lip offset greater than roughly two source frames in accepted clips.
- All clips become acceptable after at most the approved targeted retry/repair path.
- Planning cost remains compatible with the 30-minute cap.
- Technically valid clips become selected draft assets only after this global AvatarForcing production suite passes; the user/reviewer can flag them. Optional per-profile quick tests are confidence evidence, not this gate.
- Subjective lip-only versus whole-frame routing is explicitly user/reviewer-classified in MVP; no deferred visual-QA model is silently invoked.

The exact global-demotion threshold is an open user gate. Record evidence; do not silently set it in production.

## MuseTalk repair gate

- Test only an otherwise-good AvatarForcing clip with isolated lip failure.
- Lip alignment improves.
- Teeth/skin/identity are not visibly softened or changed.
- No seam, flicker, mask edge, or background/body change.
- If it fails, result is discarded and cannot become SkyReels input.

## SkyReels fallback gate

- The exact revision-pinned canonical Avatar Profile runtime source and same selected span audio are used; neither a failed derivative nor the raw retained original is accepted.
- Test full-screen final crop/detail and split crop.
- Record FP8/offload GPU fit, load, runtime, cost, and rejection reason.
- Budget reservation prevents cap breach.
- It is good enough to rescue whole-frame defects; otherwise return to user before inventing another automatic model.

## FFmpeg golden gate

- AvatarForcing source profile: pixel-exact full crop `832:468:0:6`; split crop `416:468:208:6` and placement x=0; image x=960.
- SkyReels source profile: pixel-exact full crop `1280:720:0:0`; split crop `640:720:320:0` and placement x=0; image x=960.
- Each accepted avatar asset declares exactly one source profile; the resolved-render schema rejects a profile/crop pair from the other model.
- No seam decoration.
- The current full-image zoom ends at 1.025, 1.03, or 1.035 according to scene length; the current
  split-right zoom ends at 1.025. Both begin at exactly 1.00.
- Zoom progression is monotonic quintic smootherstep at 30 fps, stays centered, has no
  frame-to-frame crop-direction reversal, and shows no visible integer-rounding shake. The v3
  FFmpeg golden path evaluates floating source-corner coordinates per frame and uses cubic
  interpolation for continuous subpixel sampling.
- Slow zoom is present on both `IMAGE_FULL` and the split-right image.
- Native 25 fps AvatarForcing and 24 fps SkyReels inputs convert directly/deterministically to 30 fps without duration drift; cadence is reviewed full-screen, no 24→25→30 double conversion occurs, and no optical-flow/interpolation model runs.
- Hard cuts at exact frame boundaries.
- One-frame and fractional-millisecond rounding fixtures.
- 1920×1080, 30 fps CFR, H.264, `yuv420p`, AAC 48 kHz.
- Resolved manifest binds the revision/timeline hashes, original voiceover checksum, `voiceover-minus16lufs-v1`, total frames, fixed output profile, and every accepted visual checksum.
- Audio within the preserve window is not gain-normalized; audio outside it reaches the −16 LUFS/−1.5 dBTP target within the documented measurement tolerance.
- Duration/A-V drift within the accepted one-frame/sample tolerance.
- No subtitle/data/debug stream.
- Only `APPROVED` creates `production-manifest/v2`; it records the reviewer/time and hash-binds the validated revision, timeline, resolved render, prompt, attempts, QA, cost snapshot, selected Avatar Profile/style/model summaries, and exact final MP4.
- Approval derives the reviewer from authentication, requires `Idempotency-Key` plus the exact review-candidate `If-Match` token/final checksum, and cannot approve a stale candidate racing a regeneration.

## RunPod endpoint and dispatch gate

- Preflight simulates RunPod's documented three/seven-day idle reductions (including `workersMax=0`) and restores the approved configuration through API only.
- Execution profile matches endpoint/config revision, container digest, ordered GPU priorities, volume/data center, timeout/TTL, current rate ceiling, and live compatibility.
- Lowest cost/Balanced/Faster resolves immutable per-lane profile IDs; an allowed Advanced override changes only the selected lane and the revision records it before dispatch.
- Default/too-short execution timeout, queue+run TTL, 30-minute result expiry, and signed-input URL expiry are exercised.
- Provider job/workflow IDs are persisted immediately; stale jobs reconcile before provider result retention expires.
- Ambiguous `/run` acknowledgement enters `DISPATCH_ACK_UNKNOWN`; it does not blindly redispatch.
- Duplicate provider workers contend for one execution claim; at most one performs costly inference and duplicate attempts/cost remain visible.
- Endpoint idle/drain returns active workers to zero without a console action.

Pass: one accepted result/lineage, no corrupt revision, truthful duplicate-cost evidence, and API-only recovery. Do not claim provider at-most-once billing until measured semantics prove it.

## Queue/fault gate

Simulate ten users and:

- Duplicate Start click.
- Duplicate/out-of-order callbacks.
- Lost callback and reconciliation.
- Worker crash mid-chunk after some uploads.
- Expired signed URL.
- RunPod no capacity.
- RunPod idle-reduced endpoint `workersMax=0`/other configuration drift.
- Ambiguous dispatch acknowledgement and duplicate worker execution claim.
- Runware invalid JSON/timeout.
- Style analyzer consent missing, timeout/ambiguous completion, invalid schema, outlier/low-confidence state, and duplicate Analyze click.
- Style publish/version conflict and archived selection.
- Avatar Hub empty/invalid upload, duplicate active name, missing likeness consent, duplicate create/validate/test, optional-test ambiguous completion/cancellation/retry, version conflict, archived selection, and archive between project-form selection and revision creation.
- Avatar ready-v1 selection while v2 is open; profile rename/archive cannot alter a pinned revision; explicit in-use deletion is blocked.
- Failed style analysis can retry; explicit abandon frees the one-open-draft invariant.
- OOM/model-load failure.
- Provider balance exhausted.
- User cancellation at queued/loading/generating/uploading/rendering.
- Workspace cap and project cap breach.
- Control-plane restart.

Pass: no duplicate accepted asset or corrupt state, any duplicate dispatch/charge is detected and reconciled rather than hidden, fair progress, recoverable state, and no worker left active after a drained lane.

## Security gate

- Uninvited Google account denied.
- Cross-workspace project/object access denied.
- Signed URL expires and is path-scoped.
- Callback signature/replay validation.
- Secrets absent from browser bundle, logs, fixtures, and repository.
- Malicious filename/URL/prompt cannot become a shell argument or SSRF.
- Cross-workspace Image Style/reference/version access and hash-existence probing denied.
- Cross-workspace Avatar Profile/version/source/thumbnail access and hash-existence probing denied; avatar bytes, signed URLs, EXIF/GPS, and likeness metadata never enter logs, public fixtures, analytics, or browser bundles.
- Avatar source deletion is blocked while queued/running/review candidates depend on it; explicit later erasure marks historical revisions non-regenerable instead of silently retaining pixels.
- EXIF/GPS stripped from analysis copies; malicious/decompression-bomb references rejected.
- Analyzer sees only server-created short-lived URLs; reference pixels/visible instructions cannot alter system behavior.
- Rate limits on mutation, signing, and callbacks.

## UI shell presentation gate

Automated fixture/browser checks and the user's real-Chrome review must jointly verify the approved visual direction and the later compact 100%-zoom density refinement. Screenshots can support comparison but never replace interaction, console, request, focus, and responsive checks.

Historical `GATE_UI_001`: **PASS**, user-approved 2026-08-09 at `evidence/gates/GATE_UI_001/2026-08-09-stabilization-audit/`. The user-directed 2026-08-10 density/disclosure refinement is technically green, remains the current implementation, and did not reopen the closed gate; later explicit visual feedback may still supersede it.

- Direct titles, one dominant action, and a calm glance layer replace slogans, repeated rationale, and walls of success messages.
- Root size is 15 px at every width; ordinary copy is 14–16 px, short secondary metadata may be 12–13 px, actions remain at least 44 px, and neither CSS `zoom` nor a shell transform simulates density.
- Top-level rhythm is 20 px desktop and 16 px compact/mobile. Generic disclosures keep 12 px from trigger to content and between fact cards. Every list/grid declares a nonzero gap; structural surfaces use the visible boundary and restrained shadow/halo without double-boxing controls.
- The active-project command bar spans the viewport with deliberate page-edge padding while its project/progress track is inset internally; it does not become a narrow centered island. Its compact mobile form, medium project title and factual progress hero, metric cards, vertical pipeline, and latest-artifact panel preserve authoritative counts/states without fabricating smooth work.
- The keyboard-reachable dock exposes the active route and every destination at 1024 px. Desktop items rest at 76×62 px, icon tiles at 38×35 px, and glyphs at 24 px. Fine-pointer hover above 820 px scales only the icon tile to approximately 1.75×, tapers monotonically through immediate and second neighbors across a 240 px radius, leaves far icons exactly 1×, keeps every icon bottom edge and item box fixed, and resets on leave. No lift/shift/surface transform channel exists and the active-route backing never transforms. Reduced-motion/coarse-pointer and widths at or below 820 px stay neutral. Compact/mobile is a labelled 4×2 dock with safe content padding.
- Avatar cards use an accessible authorized thumbnail or labelled fallback. Healthy cards show only image, name, and `Details`; both Hubs use equal media heights, two columns above 680 px, and one on mobile.
- Style cards use an allowed cover or labelled fallback. `References (N)` opens only version-bound authorized images; the built-in has zero uploaded references and calls owned media `Examples (N)`. No research asset ships.
- Galleries load without broken requests and disclose larger images plus metadata on demand. New Avatar/Style round trips retain imagery, exact pins, voiceover handle, and every other draft field.
- Closed preset selectors show image/name and optional `Default`. Choices stay inside the same app-native border, add search when useful, restore focus on Escape, and persist the exact version ID. Native, detached, covering, or always-expanded variants fail.
- The voiceover dropzone does not advertise duration bounds, channel count, sample rate, or other technical media rules. Valid files show concise selected/upload state; invalid files show an accurate field-specific error while the strict server/browser validation matrix remains unchanged.
- App-native `image_media` and `avatar_primary` profile controls keep options inside each compute card. Only immutable tested profiles are selectable; planned GPUs remain disabled as `Benchmark required` while `GATE_GPU_001` is open.
- The first-shell UI has no exact-script input and sends `optional_script: null`. Extra keywords use only the opt-in toggle and textarea; no persistent applied/not-applied success panel appears, while enabled empty/invalid/conflicting text still receives the precise existing error.
- Details are closed by default. Side sheets/accordions/lightboxes expose complete inspect/audit data, trap/manage focus correctly, close with Escape, restore focus, and do not depend on hover.
- Pending actions immediately disable duplicates and show concise progress/next-check state. Active blockers, charges, consent, spend caps, budget approvals, and destructive controls remain in the primary layer even when technical details are collapsed.
- Field errors identify the actual failing input; action errors identify the failed operation and next useful action. Short mutation errors use an accessible concise toast, while unresolved blockers remain inline and are not replaced by unrelated generic preflight copy.
- At 1920, 1440, 1280, 1024, 820, 680, 430, and 390 CSS-pixel widths, every leaf screen has no horizontal overflow or touching top-level sections, structural boundaries remain visibly differentiated, controls remain legible, reference galleries remain usable, expanded disclosures retain their internal gaps, and the floating dock does not cover Generate, Approve, Cancel, or budget controls.
- Status is conveyed with text/icon as well as color; focus contrast meets WCAG AA; reduced-motion mode retains complete status meaning.
- Fixture verification makes no unexpected provider request, all visual fixture assets are owned/synthetic and same-origin, and the compact development control truthfully exposes fixture ID, commit, API health, synthetic mode, and `$0` authorization on demand.

## Chrome acceptance journey

In the user's real Chrome:

1. Sign in.
2. At real Chrome 100%, verify the compact 15 px root/44 px action geometry matches the preferred 80%-zoom reference without CSS zoom or a transformed shell. Verify all leaf screens retain the 20/16 px top-level rhythm, generic disclosures retain at least 12 px internal separation, lists/grids have nonzero gaps, and structural boundaries remain layered at desktop and compact/mobile widths. Then verify dock keyboard/pointer navigation, scale-only proximity taper, fixed icon bottom edges, reset/no-layout-shift behavior, static active-route backing, reduced-motion neutrality, active route, 1024 px layout, and mobile safe area.
3. Verify authorized Avatar Hub imagery and minimal healthy cards; create/approve one private avatar and confirm its image/name plus inspectable exact pin in Create Project.
4. Open Image Styles, inspect the built-in owned/generated examples without calling them uploaded references, then open every reference image for a custom style and exercise the keyboard lightbox/details sheet.
5. Create a private Image Style from references, keep the uploaded mosaic visible through analysis/review, leave/resume analysis, review/edit it, optionally test, and publish it.
6. Create a project with real audio, select the stored avatar and new style through compact visual dropdowns, verify no avatar upload control/request or exact-script field exists, and confirm the dropzone omits proactive duration/channel/sample-rate details.
7. Enter extra image keywords, leave the toggle off and verify there is no separate applied/not-applied confirmation, then enable it and exercise one accepted negative refinement plus one precise conflict error.
8. See immediate preflight/pending state without duplicate submission or persistent non-actionable explanation panels.
9. Confirm both app-native profile menus stay inside their compute cards; inspect the command bar, progress hero, parallel lanes, pipeline, cold/model states, and artifact. Disabled unbenchmarked profiles remain unselectable and no onboarding analysis runs per project.
10. Expand and collapse project technical details, then verify the primary layer remains concise while IDs, pinned inputs, worker evidence, and costs remain reachable.
11. Open another user/session and verify ownership/fair queue plus avatar/style isolation.
12. Review full/split preview from the same clip and style-aware image prompts.
13. Force/recover one image failure and one avatar fallback path; verify the actionable blocker remains visible and the fallback used the pinned source.
14. Cancel a separate test project.
15. Render, seek, play audio, download, and verify pinned avatar/style/keyword components in the manifest.
16. Confirm the automatic result says `Ready for review`; use the contact sheet, flag/regenerate a visible defect, then explicitly approve the final revision.
17. Confirm video cost, separate one-time style/optional avatar-test costs, and retention.
18. From an in-progress project draft, open `+ New avatar`, save or cancel, and return with title/voiceover/style/keywords/compute/settings intact; the new ready avatar image is visible and selected without re-upload.
19. Repeat the draft-preserving round trip for `+ New style`, verify the new cover/reference gallery, and retain the avatar selection plus all execution-profile overrides.

No milestone is accepted solely from screenshots.

## Production SLO targets

- No-fallback 30-minute isolated-service p50 ≤30 minutes.
- Isolated-service p90 ≤45 minutes.
- Queue wait is reported separately at 1/2/5/10 concurrent users; do not apply isolated SLOs to a ten-user backlog with `workersMax=1`.
- Report p50/p90 only after at least 10 representative completed jobs with cold/warm labels.
- Marginal fast/no-major-fallback planning approximately $0.40–$0.98; modest-fallback envelope $0.50–$1.30 until measured.
- No silent cost above configured cap.
- First-pass AvatarForcing rejection and Mage retry rate displayed and reviewed after first 10 real projects.
- Style and Avatar Profile creation are outside project p50/p90; a ready style adds zero vision calls and a ready avatar adds zero onboarding/test calls or new pipeline stage.

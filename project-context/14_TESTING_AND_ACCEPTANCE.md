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
- Total avatar frames are strictly 21–22%; no looser tolerance is accepted.
- Full/split cumulative time differs by at most seven seconds and layouts alternate by rule.
- No forbidden composition enum.
- Property-test short audio, long silence, extremely fast/slow speech, missing punctuation, and 30+ minute input.
- Replay must reproduce byte-identical timeline/work/render JCS hashes.
- Every image-bearing segment owns one image slot/planned artifact and one prompt-batch binding;
  every avatar segment owns one short padded WAV/artifact/trim record; exact cost counts match with
  no missing or duplicate work.
- Decode every owned acceptance span as playable PCM s16le, 16 kHz, mono, at exact padded duration.
  Assert Echo dispatch policy never contains the full voiceover.
- Render work covers `[0,total_frames)` exactly once, uses hard cuts only, and requires slow smooth
  centered zoom on every image-containing segment.

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
  cross-object input leave current pointer/revision/publication state unchanged.
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

Run the exact `DEC_IMAGE_001` profile: `Comfy-Org/Mage-Flow` revision
`d8c99241f6fa80fbd453014234af2bf337ea21e6`, pinned stock headless ComfyUI, INT8 ConvRot, four
steps, guidance 1.0, and 1280×720 output. Earlier BF16 attempts do not qualify this profile.

### CP-06 bounded runtime qualification

CP-06 proves the exact runtime and persistent-volume lifecycle with at
least eight representative owned prompts spanning people/hands, material texture, indoor and wide
scenes, split-safe framing, and more than one pinned style, distributed across at least two fresh
Pods. CP-06 must satisfy the manifest, offline boot, identity, output, timing, cost, deletion, and
retained-volume checks below, but it does not close the full image/style quality gates.

### CP-11 full image and style qualification

The 40-prompt breadth and 300-image workload below belong to CP-11 qualification. They do not block
the bounded CP-06 runtime checkpoint. `GATE_IMAGE_001` and `GATE_STYLE_002` remain open after CP-06
until their full CP-11 evidence and required user review exist.

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
- One-time Mage volume preparation records and verifies the exact INT8 ConvRot transformer,
  Qwen3-VL BF16 encoder, and Mage VAE paths, SHA-256 values, sizes, model/ComfyUI/container
  revisions, configuration, and immutable complete marker on the dedicated `EU-RO-1` Mage volume.
- A normal disposable Mage Pod mounts only the Mage volume, reaches `model_ready` without model
  download/network-repository resolution, and records Pod-create/attach/container/manifest/load
  timings plus selected and actual GPU identity.
- A 300-image cold job meets the approved measured cost and production envelope, then its Pod is
  deleted while both approved model volumes remain.
- No OOM/crash and peak VRAM leaves operational headroom.

The user makes the final blind quality judgment before resolution/upscaler lock.

## Avatar Hub contract gate

Use owned/synthetic sources for automated fixtures and separately authorized user-supplied sources for human acceptance.

- Create Project schema accepts only `avatar_profile_version_id`; reject `IMAGE_ASSET`, `avatar_image_asset_id`, raw avatar bytes, an unversioned parent ID, unknown fields, and mutable `latest` lookup.
- New Avatar validates magic bytes, supported format, byte/dimension/decompression bounds, checksum, orientation/color handling, and EXIF/GPS-free runtime/thumbnail outputs. Bad horizontal centering requires source replacement; no invisible browser crop is applied.
- Rights to use the image and rights/consent to animate the depicted likeness are explicit, authenticated, and required before `READY`.
- Active profile names are case-insensitively unique in the one global catalog; immutable IDs—not names—bind projects.
- Normal cards expose the active `READY` version of each accessible `ACTIVE` parent. A previously selected immutable v1 may remain valid after v2 activation. `UNTESTED`/`STALE`/`CANCELLED` optional compatibility is warned, not blocked; no silent/default avatar is chosen.
- Ready v1 remains selectable while v2 is drafted. Publishing v2 or renaming/archiving the parent cannot mutate a revision pinned to v1.
- Duplicate/new version never inherits a human compatibility verdict or rights/likeness attestation; source-byte reuse remains inside the accepted-users-only global catalog and never becomes public or unauthenticated.
- Archive between form selection and revision creation produces a clear preflight blocker. A revision already created from that version remains reproducible.
- Optional Test starts only after an explicit estimate/confirmation, is version-scoped/idempotent, records ambiguous dispatch/cost/verdict, and is never called when merely saving/selecting/reusing the profile.
- Project revision and `production-manifest/v2` contain matching parent/version/profile hash/runtime source checksum/preparation-validation profiles, exact compatibility state at preflight, and nullable evidence. `UNTESTED`/`RUNNING` require null evidence; terminal evidence status must equal the pinned preflight state. EchoMimicV3-Flash attempts match that binding; active repair/quality profile fields are `null`.
- `+ New avatar` from a project draft preserves title, verified voiceover upload handle, selected style,
  keywords/toggle, mode, cap, and seed. It preserves tentative Mage/Echo choices only while the global
  session remains idle; if another user locks a session, return shows the inherited pair instead.
  Return/select requires no re-upload.

Pass: a named avatar can be stored once and reused by image/name without project-local upload, with immutable provenance and no unapproved provider charge.

## EchoMimicV3-Flash exact-avatar suite

This is the global model/container/GPU qualification gate, not a required 12–20-clip run for every
Avatar Profile. Use several representative ready Avatar Profile versions and 12–20 scheduled short
clips, normally 2–6 seconds each and never the full voiceover, containing:

- Ordinary speech.
- Fast speech and sibilants.
- Plosives/labials and visible teeth.
- Smiles and neutral delivery.
- Pauses/silence.
- Head turns and restrained upper-body motion.
- Difficult beard/mustache/hair boundaries if relevant.
- Full-screen 1920×1080 and 960×1080 split crop review.

Measure Pod create, volume attach, container ready, manifest verification, model ready, generation,
encode, upload, and Pod deletion separately, plus peak VRAM, frame time, accepted-output cost, lips,
identity, background, body/motion, temporal stability, and upscale detail.

Technical acceptance additionally requires:

- One-time Echo preparation records the exact pinned source/Flash/base/audio-encoder inputs and the
  VideoForge-prepared FP8 artifact, TorchAO/runtime toolchain, file paths, sizes, SHA-256 values, and
  immutable complete marker on the dedicated `EU-RO-1` Echo volume.
- A normal disposable Echo Pod mounts only the Echo volume and reaches `model_ready` without model
  download/network-repository resolution. It must not mount or read the Mage volume.
- Runtime evidence proves the accepted FP8 profile executes and uses no Long Video CFG. Each input
  binds the exact authorized avatar checksum and only its materialized scheduled span-audio checksum.
- The Echo GPU SKU locked from fresh live compatible inventory at global-session start equals the
  immutable profile and actual executing GPU for every inherited project; a provider substitution or
  stale/unavailable first selection fails before inference.
- Every result is a playable local MP4 with SHA-256/probe, exact duration/frame count, no
  OOM/NaN/crash, measured timings/VRAM/cost, and Pod deletion evidence that leaves zero Pods while
  both approved model volumes remain.

Proposed provisional lock:

- All jobs complete without OOM/NaN/crash.
- At least 90% first-pass clip acceptance.
- No severe identity/background/body failure.
- No visible lip offset greater than roughly two source frames in accepted clips.
- A failed clip follows only an explicitly approved bounded retry; no repair or other-model fallback
  is active.
- Planning cost remains compatible with the 30-minute cap.
- Technically valid clips become selected draft assets only after this global EchoMimicV3-Flash production suite passes; the user/reviewer can flag them. Optional per-profile quick tests are confidence evidence, not this gate.
- Subjective lip-only versus whole-frame routing is explicitly user/reviewer-classified in MVP; no deferred visual-QA model is silently invoked.

The exact global-demotion threshold is an open user gate. Record evidence; do not silently set it in production.

## Historical repair gate

- MuseTalk is not active. Historical evidence remains replayable; any new repair test requires a new decision and brief.
- Lip alignment improves.
- Teeth/skin/identity are not visibly softened or changed.
- No seam, flicker, mask edge, or background/body change.
- If it fails, result is discarded and cannot become SkyReels input.

## Historical fallback gate

- SkyReels is not active. Historical evidence remains replayable; any new fallback test requires a new decision and brief.
- Test full-screen final crop/detail and split crop.
- Record FP8/offload GPU fit, load, runtime, cost, and rejection reason.
- Budget reservation prevents cap breach.
- It is good enough to rescue whole-frame defects; otherwise return to user before inventing another automatic model.

## FFmpeg golden gate

- Historical AvatarForcing/SkyReels profiles remain replay-only. EchoMimicV3-Flash receives a new
  profile only after approved measured native dimensions, frame rate, and sample geometry. No crop
  is pre-seeded from a historical model; profile creation remains blocked until the measured Echo
  full/split pair is user-approved.
- Each accepted avatar asset declares exactly one source profile; the resolved-render schema rejects mismatched profile/crop pairs.
- No seam decoration.
- The current full-image zoom ends at 1.025, 1.03, or 1.035 according to scene length; the current
  split-right zoom ends at 1.025. Both begin at exactly 1.00.
- Zoom progression is monotonic quintic smootherstep at 30 fps, stays centered, has no
  frame-to-frame crop-direction reversal, and shows no visible integer-rounding shake. The v3
  FFmpeg golden path evaluates floating source-corner coordinates per frame and uses cubic
  interpolation for continuous subpixel sampling.
- Slow zoom is present on both `IMAGE_FULL` and the split-right image.
- Native 25 fps EchoMimicV3-Flash inputs convert directly/deterministically to 30 fps
  without duration drift; cadence is reviewed full-screen and no optical-flow/interpolation model runs.
- Hard cuts at exact frame boundaries.
- One-frame and fractional-millisecond rounding fixtures.
- 1920×1080, 30 fps CFR, H.264, `yuv420p`, AAC 48 kHz.
- Resolved manifest binds the revision/timeline hashes, original voiceover checksum, `voiceover-minus16lufs-v1`, total frames, fixed output profile, and every accepted visual checksum.
- Audio within the preserve window is not gain-normalized; audio outside it reaches the −16 LUFS/−1.5 dBTP target within the documented measurement tolerance.
- Duration/A-V drift within the accepted one-frame/sample tolerance.
- No subtitle/data/debug stream.
- Only `APPROVED` creates `production-manifest/v2`; it records the reviewer/time and hash-binds the validated revision, timeline, resolved render, prompt, attempts, QA, cost snapshot, selected Avatar Profile/style/model summaries, and exact final MP4.
- Approval derives the reviewer from authentication, requires `Idempotency-Key` plus the exact review-candidate `If-Match` token/final checksum, and cannot approve a stale candidate racing a regeneration.

## RunPod Pod and volume lifecycle gate

- Exactly two approved persistent `EU-RO-1` model volumes exist at separately recorded,
  manifest-derived capacities: one Mage INT8 ConvRot volume and one different Echo FP8 volume.
  Stable volume IDs, region, capacity, manifest hash, model
  role, preparation revision, and creation/verification evidence are durable.
- A one-time explicitly authorized preparation job is the only path allowed to acquire or prepare
  model bytes. It writes the complete marker only after exact path/size/SHA-256 and toolchain
  verification; interrupted or mutated preparation remains unusable.
- Mage and Echo Pod templates allow only their own exact volume ID. Cross-mount, shared volume,
  swapped manifest/model role, unexpected writable mutation, or mutable job input on a model volume
  fails closed.
- Only while no global session is locked, the app refreshes live inventory and rates, intersects them
  with each model's qualified compatibility matrix, and lets the user select Mage and Echo GPUs
  independently. The first accepted Generate serializably locks both inventory snapshots/times, exact
  GPU SKUs, rate ceilings, Pod templates/containers, model manifests, volume IDs/region, and timeouts
  for one shared session. Every later admitted project inherits that pair; per-project overrides,
  automatic switching, per-user pairs, and parallel sessions fail.
- A concurrent first-Generate race with different tentative pairs produces exactly one session and one
  locked pair. The winner atomically persists session, first project, both lane tasks, and create
  intents; every otherwise valid loser appends under the winner's pair after cap revalidation. No
  response path can produce a second pair or more than one Pod per lane.
- One journaled create-attempt request is issued for each required disposable Pod in parallel after its
  durable intent/idempotency fingerprint. The application key does not prove provider at-most-once
  creation; unknown acknowledgement reconciles before any later create. Record API acknowledgement,
  provider Pod ID, requested/actual GPU, volume attach, container ready, manifest verified,
  model-loading, and `model_ready` timestamps independently for both lanes.
- A normal boot is tested with model acquisition disabled and no model-repository credentials. Any
  attempted runtime download or mutable `main` resolution fails the gate.
- Ideal Pod-start-request-to-`model_ready` target is ≤2 minutes for each lane after preparation.
  The user's reported ImageForge 3–4-minute baseline is comparison context only and cannot pass this
  VideoForge gate. Report cold/warm distributions and every timing component.
- Ambiguous create or delete after a durable send permits only read/reconciliation of that exact
  attempt and Pod; never automatically repeat the mutation. A later create/delete is allowed only
  after authoritative evidence proves the earlier mutation was not applied and fresh policy
  authority permits it. Duplicate orchestrators contend for one session/lane lease and execution
  claim; duplicate cost is visible and only one accepted result advances the revision.
- Only the active video may expose eligible lane tasks, with at most one active chunk per lane.
  Waiting rows expose no task/attempt/outbox and may only keep an already-running Pod warm. With no
  waiter at active-lane completion, delete and prove that Pod absent independently even if the other
  lane remains active.
- New waiting work for an absent lane never creates or recreates a Pod. Only after the current video
  is terminal and that row is atomically promoted may the control plane create a new attempt for the
  lane's exact locked GPU and retained volume. Exact-GPU unavailability blocks the active lane;
  provider substitution or automatic reselection fails.
- Removing a fully waiting project prevents all of its claims/provider work and records actor/time and
  queue-version audit. Cancelling active work settles only that project's tasks, preserves charges and
  durable assets, then atomically promotes the next waiter; a lane deletes when cancellation leaves
  no active lane work and no waiting-only warm-retention hint.
- A control-plane restart restores the exact session pair, queue order/version, active claims, lane
  create/delete ambiguity, and Pod identities before new admission or dispatch. It neither unlocks
  selectors early nor creates a replacement while an earlier attempt is unproven.
- When queue and both lane work drain, cleanup deletes/reconciles both Pods and proves zero Pods before
  closing the session and restoring selectors. It must also prove the same two approved model volumes
  still exist with unchanged identities/manifests; zero-volume cleanup is a failure.

Pass: one accepted result/lineage per lane task, exactly one global locked pair, exactly one active
video, inert waiting rows, at most one Pod per lane, exact selected/actual GPU and model-volume
identity, warm-existing-only retention, independent lane drain and next-activation recreation
without substitution, no normal boot download or cross-mount, truthful cost/timing evidence, zero
Pods and two retained volumes at full drain, selectors unlocked only afterward, no corrupt revision,
and API-only restart recovery. Do not claim provider at-most-once creation/billing until measured
semantics prove it.

## Queue/fault gate

Simulate ten users and:

- Duplicate Generate click.
- Two or more simultaneous first Generate requests with different tentative GPU pairs; exactly one
  atomically locks and every accepted contender inherits it without creating another session/Pod.
- Concurrent append/reorder/remove on waiting projects, including reorder/remove racing the first lane
  claim, stale queue versions, and authenticated audit replay.
- An accepted user removing another user's waiting project and cancelling another user's active
  project; both are allowed, audited, and conflict-safe because creator is not an authorization tier.
- Duplicate/out-of-order callbacks.
- Lost callback and reconciliation.
- Worker crash mid-chunk after some uploads.
- Expired signed URL.
- RunPod no capacity.
- Stale live GPU inventory before the first lock, a locked GPU becoming unavailable, a missing lane
  waiting/recreating while the other lane stays active, or provider allocating a different GPU.
- Missing/corrupt/incomplete model-volume manifest, swapped volume IDs, cross-mount attempt, normal
  boot runtime-download attempt, volume/data-center mismatch, or accidental volume deletion.
- Ambiguous Pod create/read/stop/delete acknowledgement, duplicate Pod creation, and duplicate worker
  execution claim.
- Runware invalid JSON/timeout.
- Style analyzer consent missing, timeout/ambiguous completion, invalid schema, outlier/low-confidence state, and duplicate Analyze click.
- Style publish/version conflict and archived selection.
- Avatar Hub empty/invalid upload, duplicate active name, missing likeness consent, duplicate create/validate/test, optional-test ambiguous completion/cancellation/retry, version conflict, archived selection, and archive between project-form selection and revision creation.
- Avatar ready-v1 selection while v2 is open; profile rename/archive cannot alter a pinned revision; explicit in-use deletion is blocked.
- Failed style analysis can retry; explicit abandon frees the one-open-draft invariant.
- OOM/model-load failure.
- Provider balance exhausted.
- User cancellation at queued/loading/generating/uploading/rendering, with later queue work continuing
  and independent lane deletion only after that lane drains.
- Project cap breach and representative 30-minute all-variable target/ceiling breach.
- Control-plane restart during first lock, create ambiguity, active work, reorder/remove, independent
  lane drain, missing-lane recreation, and final session unlock.

Pass: no duplicate accepted asset, second global session, second Pod per lane, corrupt queue order, or
hidden charge; the first atomic lock and every queue mutation are recoverable/audited, explicit global
order—not fairness—governs both lanes, a drained lane deletes independently, exact locked-GPU restart
never substitutes, and full drain proves zero Pods with the two exact persistent model volumes intact.

## Security gate

- Public app admission and app access without a valid invite are denied. Better Auth may first create
  or resolve a verified but unadmitted identity; it receives no VideoForge data/actions.
- Invite validation, durable `app_admissions` binding, code consumption, and redemption audit are one
  atomic transaction. Exactly one contender wins a same-code race. Replay, email mismatch, expired,
  revoked, malformed, or already-consumed codes create no admission, grant no app access, and do not
  consume the code on mismatch/failure. Unadmitted auth-identity cleanup/retention is explicit.
- Raw invite codes are stored only as non-reversible verifiers, cleared from the form after submission,
  and absent from URLs, cookies, local/session storage, database plaintext, logs, traces, analytics,
  fixtures, errors, account views, and subsequent API responses.
- A unique normalized identity cannot produce separate Google and email/password accounts. A provider
  collision fails closed, does not auto-link or consume another invite, and directs the user to the
  already-bound login method. Later valid login never asks for an invite code.
- Unauthenticated project/object access is denied. Every accepted user receives the same authorization
  result for every global project, result, Avatar Profile, Image Style, queue, review, cancel, and
  settings action; creator/actor metadata never creates owner/admin/member privileges.
- Signed URL expires and is path-scoped.
- Callback signature/replay validation.
- Secrets absent from browser bundle, logs, fixtures, and repository.
- Malicious filename/URL/prompt cannot become a shell argument or SSRF.
- Unauthenticated Image Style/reference/version access and hash-existence probing are denied; accepted
  users see the same global catalog.
- Unauthenticated Avatar Profile/version/source/thumbnail access and hash-existence probing are
  denied; accepted users see the same global catalog. Avatar bytes, signed URLs, EXIF/GPS, invite
  codes, and likeness metadata never enter logs, public fixtures, analytics, or browser bundles.
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
- App-native `image_media` and `avatar_primary` controls keep options inside each compute card. Only
  while the global session is idle, they independently show freshly queried live, compatible Mage and
  Echo GPU choices with exact rate, VRAM, region/volume compatibility, and inventory timestamp.
  Unqualified choices remain disabled as `Benchmark required` while `GATE_GPU_001` is open. During a
  locked session they are unavailable and a read-only exact inherited-pair summary replaces them.
- The first-shell UI has no exact-script input and sends `optional_script: null`. Extra keywords use only the opt-in toggle and textarea; no persistent applied/not-applied success panel appears, while enabled empty/invalid/conflicting text still receives the precise existing error.
- Details are closed by default. Side sheets/accordions/lightboxes expose complete inspect/audit data, trap/manage focus correctly, close with Escape, restore focus, and do not depend on hover.
- Pending actions immediately disable duplicates and show concise progress/next-check state. Active blockers, charges, consent, spend caps, budget approvals, and destructive controls remain in the primary layer even when technical details are collapsed.
- Field errors identify the actual failing input; action errors identify the failed operation and next useful action. Short mutation errors use an accessible concise toast, while unresolved blockers remain inline and are not replaced by unrelated generic preflight copy.
- At 1920, 1440, 1280, 1024, 820, 680, 430, and 390 CSS-pixel widths, every leaf screen has no horizontal overflow or touching top-level sections, structural boundaries remain visibly differentiated, controls remain legible, reference galleries remain usable, expanded disclosures retain their internal gaps, and the floating dock does not cover Generate, Approve, Cancel, or budget controls.
- Status is conveyed with text/icon as well as color; focus contrast meets WCAG AA; reduced-motion mode retains complete status meaning.
- Fixture verification makes no unexpected provider request, all visual fixture assets are owned/synthetic and same-origin, and the compact development control truthfully exposes fixture ID, commit, API health, synthetic mode, and `$0` authorization on demand.

## Chrome acceptance journey

In the user's real Chrome:

1. Register one account with Google and one with email/password using distinct valid invite codes;
   verify each code is consumed once and cleared, then log out/in normally without another invite.
   Exercise replay/expiry/revocation, a same-code registration race, and a Google/email collision.
2. At real Chrome 100%, verify the compact 15 px root/44 px action geometry matches the preferred 80%-zoom reference without CSS zoom or a transformed shell. Verify all leaf screens retain the 20/16 px top-level rhythm, generic disclosures retain at least 12 px internal separation, lists/grids have nonzero gaps, and structural boundaries remain layered at desktop and compact/mobile widths. Then verify dock keyboard/pointer navigation, scale-only proximity taper, fixed icon bottom edges, reset/no-layout-shift behavior, static active-route backing, reduced-motion neutrality, active route, 1024 px layout, and mobile safe area.
3. Verify authorized shared Avatar Hub imagery and minimal healthy cards; create/approve one avatar and confirm its image/name plus inspectable exact pin in Create Project.
4. Open Image Styles, inspect the built-in owned/generated examples without calling them uploaded references, then open every reference image for a custom style and exercise the keyboard lightbox/details sheet.
5. Create a shared Image Style from references, keep the uploaded mosaic visible through analysis/review, leave/resume analysis, review/edit it, optionally test, and publish it.
6. Create a project with real audio, select the stored avatar and new style through compact visual dropdowns, verify no avatar upload control/request or exact-script field exists, and confirm the dropzone omits proactive duration/channel/sample-rate details.
7. Enter extra image keywords, leave the toggle off and verify there is no separate applied/not-applied confirmation, then enable it and exercise one accepted negative refinement plus one precise conflict error.
8. See immediate preflight/pending state without duplicate submission or persistent non-actionable explanation panels.
9. With the generation session idle, refresh both app-native GPU menus, select Mage and Echo GPUs
   independently, and confirm each menu stays inside its compute card. Race a second user's Generate
   with a different tentative pair; verify exactly one pair locks, both projects are admitted in one
   queue under it, and no second Pod per lane appears. Inspect parallel Pod create/volume/model-ready
   states and verify stale inventory blocks the first lock. Disabled unbenchmarked choices remain
   unselectable and no onboarding analysis runs per project.
10. Expand and collapse project technical details, then verify the primary layer remains concise while IDs, pinned inputs, worker evidence, and costs remain reachable.
11. Open additional accepted users and verify the same global avatar/style/project/result catalog and
    equal rights. Reorder and remove another creator's waiting project, verify actor/time/order audit,
    and confirm a claimed project cannot be reordered or removed by a stale action.
12. Review full/split preview from the same clip and style-aware image prompts.
13. Force/recover one image failure and one Echo failure. Verify the image follows only its approved
    bounded policy, while the Echo failure keeps an actionable blocker and stops without repair,
    fallback, tuning, or substitution.
14. Cancel a separate active test project from another admitted user. Verify the next waiting row is
    atomically promoted before any of its work starts. Drain one lane first and prove its Pod absent
    while the other lane stays active. Enqueue a new waiter and prove it neither starts work nor
    recreates the missing lane early; after next-project activation, only the exact locked GPU may
    recreate or wait.
15. Render, seek, play audio, download, and verify pinned avatar/style/keyword components in the manifest.
16. Confirm the automatic result says `Ready for review`; use the contact sheet, flag/regenerate a visible defect, then explicitly approve the final revision.
17. Confirm video cost, separate one-time style/optional avatar-test costs, and retention.
18. From an in-progress project draft, open `+ New avatar`, save or cancel, and return with title/voiceover/style/keywords/compute/settings intact; the new ready avatar image is visible and selected without re-upload.
19. Repeat the draft-preserving round trip for `+ New style`, verify the new cover/reference gallery,
    and retain the avatar selection plus tentative GPU choices only if still idle; if another user
    locked the session, show the inherited pair without losing the draft.
20. Drain the queue and both lanes, prove both Pods absent and both volumes retained, then verify live
    selectors unlock for a new session. Restart the control plane at locked, lane-draining, and fully
    drained boundaries and verify the same outcomes without duplicate creates or early unlock.

No milestone is accepted solely from screenshots.

## Production SLO targets

- No-fallback 30-minute isolated-service p50 ≤30 minutes.
- Isolated-service p90 ≤45 minutes.
- Queue/capacity wait is reported separately at 1/2/5/10 concurrent users; do not apply isolated
  SLOs to a backlog constrained by the one-session, one-Pod-per-lane cap.
- Report p50/p90 only after at least 10 representative completed jobs with cold/warm labels.
- Per-lane Pod-start-request-to-`model_ready` ideal target is ≤2 minutes after one-time preparation;
  report Mage and Echo separately. ImageForge's user-reported 3–4-minute baseline is not VideoForge
  evidence.
- For a representative 30-minute output, total variable per-video cost targets ≤$1.00 and has a hard
  MVP ceiling of ≤$2.00. Measure prompt, GPU boot/load/inference, processing, transfer, render, retry,
  and deterministic shared-session cost attribution. The accepted fixed cost of the two retained
  volumes is reported separately and excluded from this target/ceiling.
- No silent variable cost above the per-video configured cap or $2.00 MVP ceiling.
- First-pass EchoMimicV3-Flash rejection and Mage retry rate displayed and reviewed after first 10 real projects.
- Style and Avatar Profile creation are outside project p50/p90; a ready style adds zero vision calls and a ready avatar adds zero onboarding/test calls or new pipeline stage.

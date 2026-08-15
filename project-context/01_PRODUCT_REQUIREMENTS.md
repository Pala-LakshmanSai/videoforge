# Product requirements

Status: approved Serverless v2 requirements
Read when: scoping product work, adding a feature, or evaluating MVP/production acceptance.

## User and product promise

VideoForge is a dependable, invite-only production tool for 5–10 people. It converts a final English
voiceover into a ready-to-review 1920x1080 MP4 without a nonlinear editor, provider console, manual
Pod lifecycle, prompt writing, or model expertise.

Each admitted identity owns one default workspace. All user-created projects, queues, Avatar
Profiles, Image Styles, uploads, outputs, manifests, costs, and settings are private to that
account/workspace. Explicitly built-in presets may be global and read-only. There are no shared user
catalogs or cross-account project controls. A future team-sharing feature requires a new decision;
it is not inferred from invite-only access.

## Required happy path

1. Sign up with email/password or Google plus a single-use invite bound to the same verified email;
   later logins do not ask for it again.
2. Create or choose a named reusable Avatar Profile in the account's Avatar Hub.
3. Create a private project with title and voiceover; do not re-upload the avatar per project.
4. Select an immutable published Image Style. Built-in `documentary_stock_v1` is preselected.
5. Optionally enable project-wide extra image-prompt keywords.
6. Review validated inputs, exact pinned models/presets, estimated variable cost, and spend cap.
7. Select **Generate video** once. The server freezes the revision, enqueues it durably, and disables
   duplicate submission. It never asks the user to select/start/stop a GPU or Pod.
8. See private queue position, truthful stage/ETA/cost, lane progress, retry/blocker, and scale-to-zero
   state. Up to one project for this account and two projects globally may execute.
9. Review a lightweight chronological strip/contact sheet and retry or replace only an authorized
   failed asset.
10. Preview the assembled 1080p video, explicitly approve it, and download the MP4 plus provenance
    manifest through short-lived private URLs.

## Inputs and immutable revision

Required:

- `title`: 1–240 characters after trimming.
- `voiceover`: English WAV, MP3, M4A/AAC, or FLAC; 10 seconds–60 minutes; at most 1 GB; server-verified
  duration, decodeability, channels, sample rate, MIME/magic bytes, size, and SHA-256.
- `avatar_profile_version_id`: one `READY` account-owned version, or an explicitly global built-in.
- `image_style_version_id`: one published account-owned version, or an explicitly global built-in.

Optional:

- `optional_script`: versioned API-only compatibility field; the normal web form sends `null`.
- `extra_prompt_keywords`: at most 500 characters, image-only.
- `apply_extra_prompt_keywords`: explicit boolean, default false.
- `user_seed`: advanced deterministic variation input.
- `spend_cap_usd`: numeric finite job cap reserved before provider dispatch.

The server derives account/workspace ownership from the authenticated session and rejects foreign
IDs even if they exist. Create freezes all source hashes, exact Avatar/Image Style versions, model
profiles, scheduler/compiler versions, seed, output contract, account/workspace/project IDs, and cost
reservation into an immutable revision. A retry creates a new attempt, never mutates prior evidence.

## Output and editorial requirements

- 1920x1080, 30 fps, H.264 High, yuv420p, AAC 48 kHz stereo, web-faststart MP4.
- Exactly `AVATAR_FULL`, `IMAGE_FULL`, and `AVATAR_SPLIT_IMAGE`.
- Frame 0 full avatar; full/split appearances alternate; split boundary exactly x=960.
- One native SoulX clip is reused for full and split layouts.
- Avatar coverage 21–22%; normal spans 2–6 seconds, opener at most 7 seconds; natural word/clause
  boundaries only.
- Hard cuts and slow smooth centered image zoom only.
- No captions, overlays, titles, lower thirds, borders, watermarks, motion graphics, decorative
  graphics, title cards, or decorative transitions.
- Image prompts must directly depict narration and use deterministic shot-role variety; no pseudo
  text, logos, broken anatomy, style leakage, or unsupported claims in accepted output.
- Word/frame/source coverage is exact with no gaps or overlaps; final A/V duration matches.

## Private reusable libraries

Avatar Profiles and custom Image Styles are account-private, immutable-versioned reusable assets.
Their source media, derivatives, rights/consent, hashes, compatibility evidence, and history never
appear to another account. Projects pin an exact version and do not follow a later active-version
pointer. Archived versions remain valid for already-pinned work.

Global built-ins are explicit records with no account-owned source. `documentary_stock_v1` is
immutable and may show owned/generated examples, but third-party Ranga research frames are never
product assets. New style analysis occurs once per draft version, requires disclosure/rights consent,
and never runs during ordinary video generation.

## Queue, concurrency, and cancellation

- Durable admission is database-controlled: at most one active provider workload per account and two
  from different accounts globally; ordinary videos therefore remain capped at one/account and two
  globally. Explicit preset previews use the same slots and are eligible only after every video head.
- Fair selection rotates eligible accounts. FIFO applies within an account unless that account
  explicitly reorders its own waiting entries.
- A user sees and mutates only their own queue. Cross-account queue position may be expressed as a
  privacy-safe estimate, never by exposing other projects or identities.
- A waiting project or preset preview performs no inference and no hosted media work before admission.
- Cancellation is idempotent, stops future dispatch, reconciles any already-submitted exact provider
  jobs, preserves costs/evidence, and releases admission only after terminal reconciliation.
- No general endpoint queue purge is a product operation.

## Automatic compute requirements

VideoForge owns two RunPod queue-based Serverless endpoints in `EU-RO-1`: Mage and SoulX. Each uses
`workersMin=0`, `workersMax=2`, `REQUEST_COUNT=1`, handler concurrency 1, one GPU/worker, and only its
own sealed 50 GB volume at `/runpod-volume`. RTX 4090 is the sole initial GPU. A lane-specific 5090
qualification is required before adding it.

Normal workers verify and load the already-prepared exact model offline. They do not download,
quantize, repair, substitute, or cross-mount. User media lives only in private R2 and job-isolated
local scratch. Scale-to-zero and zero-worker state are automatic; the user never starts or stops
compute.

RunPod does not document client idempotency or exactly-once execution for `/run`. VideoForge must
persist predispatch authority, reconcile the returned provider job, accept at most one output, and
show any duplicate-compute/cost exposure. A webhook is not completion truth; signed R2 receipt plus
provider status reconciliation is. Async provider results expire after 30 minutes.

## Progress, review, and truthfulness

Show human stages: Prepare, Transcribe, Plan, Write image prompts, Generate images, Generate avatar,
Assemble, Technical check, Review. Each status comes from durable backend truth; a mounted volume or
healthy process is not `model_ready`. Show worker initialization/model-ready/inference/upload times,
selected/actual GPU, billed seconds, cost, retries, checksums, and terminal scale-to-zero proof under
details. Do not expose provider secrets or raw infrastructure controls.

Deterministic checks can establish media validity, not subjective quality. A valid render becomes
`READY_FOR_REVIEW`; only explicit user approval creates `APPROVED`. No automatic repair, enhancement,
fallback, or model substitution is active.

## Performance and economic requirements

- Production target: one accepted representative 30-minute video at best practical quality for
  `<= $1.00` variable provider cost, with a `$2.00` hard ceiling. This is a measurement gate, not a
  promise, permission, or reason to lower accepted quality.
- Two concurrent videos must remain isolated, fair, bounded, and recoverable for 5–10 accounts.
- Queue-to-start, cold/warm model-ready, inference, upload, render, and end-to-end timings are stored
  per attempt; projected cost is replaced with settled provider evidence when available.
- Fixed recurring volume cost is disclosed separately from per-video spend.
- A cap blocks undispatched work. It cannot erase already incurred provider work or falsely promise
  that a provider duplicate costs zero.

## Acceptance boundary

Production-ready means hosted identity/ownership, Neon truth, private R2, Cloudflare orchestration,
Cloud Run media jobs, both RunPod Serverless lanes, one complete real project, two-user concurrency,
5–10-account fairness/recovery, production-length quality/cost evidence, monitoring/runbooks, and
independent zero-worker proof all pass. Local fixtures, Pod samples, model-volume presence, or a
playable short MP4 alone do not prove this boundary.

# Avatar Hub

Status: provider-free lifecycle/UI foundation and SoulX bounded-worker technical sample exist; V2 tenant/
R2/Serverless production activation remains open
Read when: implementing reusable avatars, private source handling, project selection, compatibility
tests, SoulX dispatch, or renderer crop profiles.

## Product contract

Each authenticated account has a private Avatar Hub in its default workspace. User-created Avatar
Profiles, source images, derivatives, tests, versions, and audit details are visible and mutable only
inside that account/workspace. Only explicit immutable built-in profiles may be system-visible.

A named avatar is created once and reused. Ordinary Create Project must select one exact `READY`
`avatar_profile_version_id` from the Hub. There is no inline per-project avatar upload bypass and no
silent default. The project revision pins exact version/source hash/runtime compatibility snapshot;
later replacement, archive, retest, or deletion cannot alter it.

The only proposed active avatar model is exact SoulX-FlashHead Pro:

- source `Soul-AILab/SoulX-FlashHead@9bc03de06bb0de82cd6bc477804512ae06144bf2`;
- weights `Soul-AILab/SoulX-FlashHead-1_3B@59119b6c681230c3eeee157e224ae1941746711e#Model_Pro`;
- audio encoder `facebook/wav2vec2-base-960h@22aad52d435eb6dbaf354bdad9b0da84ce7d6156`;
- exact sealed manifest on the existing isolated 50 GB SoulX-only `EU-RO-1` volume;
- ordinary Serverless mount `/runpod-volume`, offline/read-only model contract, one RTX 4090 GPU;
- best approved Pro settings, no repair/fallback/model substitution.

No crop, sample, or compatibility result from an inactive runtime authorizes a SoulX production
profile.

## Invariants

- Profile identity is mutable only for name/lifecycle/current-ready pointer; version content is
  immutable after readiness/publication.
- Every user-owned row and asset has composite account/workspace ownership.
- Replacing source bytes creates a new version. It never mutates any existing ready version or
  queued/running/reviewed/approved project revision.
- A version becomes `READY` only after local media/source validation and required rights/consent.
  Model compatibility evidence is a separate `UNTESTED | TESTING | PASSED | FAILED | STALE` fact.
- Save/select never starts GPU work. Test is an explicit, separately estimated, admitted action.
- One native SoulX clip is reused for full-avatar and split-avatar renders. Crop/composition changes
  are renderer operations and never trigger a second avatar inference.
- The exact SoulX full/split renderer profiles remain inactive until their human review gate and
  decision are recorded. Technical MP4 validity alone cannot activate them.
- Avatar generation receives only deterministic scheduled short-span audio, normally 2–6 seconds;
  only the strong opening sentence may use the bounded seven-second exception. It never receives the
  full voiceover as an unscheduled job.

## Parent and version model

`avatar_profiles` is the private mutable identity:

- `account_id`, `workspace_id`, name, `ACTIVE | ARCHIVED`;
- `active_ready_version_id`;
- private cover/thumbnail asset;
- created/updated/archived actor and timestamps.

`avatar_profile_versions` is immutable creative/runtime source:

- positive version number and lifecycle;
- original source asset/checksum/media metadata;
- canonical normalized runtime source asset/checksum;
- deterministic transform chain and face/source measurements;
- rights/consent/retention record;
- runtime compatibility state, last attempt, tested model/container/manifest/crop profile, and time;
- source/profile canonical hashes.

Lifecycle:

```text
DRAFT -> VALIDATING -> NEEDS_REVIEW -> READY
                     |-> INVALID
READY -> archived only through parent lifecycle
```

At most one open draft exists per profile. A parent may keep one active ready version while a newer
draft is validated. `(account_id, workspace_id, normalized_name)` is unique for active private
profiles; names are not globally unique across accounts.

## Source intake

1. Create a workspace-private profile/draft and reserve exact tenant R2 upload.
2. Accept JPEG/PNG/WebP only after magic-byte/decode validation; reject animation, malformed media,
   unsafe dimensions/bytes/decompression, and unsupported color/orientation cases.
3. Honor orientation, strip EXIF/GPS, convert to a bounded sRGB canonical derivative, and record
   original/canonical hashes, geometry, crop/pad transform, tool versions, and output metadata.
4. Run deterministic face/source checks: exactly one usable face; adequate size/sharpness/exposure;
   neutral front/near-front framing; head/shoulder visibility; center/crop safety; no severe
   occlusion. Warnings remain visible for hats, glasses, beard/hair, busy backgrounds, or edge risk.
5. Require rights and consent attestation plus explicit original-retention choice.
6. User reviews the canonical source and either accepts it as `READY`, uploads a replacement draft,
   or abandons it. No GPU starts automatically.

Client preprocessing is convenience only; the server independently validates bytes and metadata.
The original is retained only according to the user's choice and reference safety.

## Optional SoulX compatibility test

Compatibility testing is not required merely to save/select a ready profile unless a later evidence-
based decision changes that policy. `UNTESTED` or `STALE` stays selectable with a clear warning.

When explicitly requested, one `preset_preview` action:

1. reserves its finite estimate/cost owner `AVATAR_PROFILE_VERSION`;
2. enters the same account-private fair admission system as video work, lower priority than eligible
   videos, and counts against the one-active/account and two-global provider-workload leases; these
   are admission limits, not GPU counts—two videos may use up to four total workers across both lanes;
3. materializes three fixed owned short audio fixtures covering ordinary speech/phonemes;
4. submits one bounded whole-preview batch to the SoulX Serverless endpoint;
5. uses the exact existing SoulX volume/runtime, RTX 4090, tenant signed inputs/outputs, unique scratch,
   and application-signed provenance receipt;
6. returns private native samples for human review and records `PASSED | FAILED` without changing the
   profile source bytes or publishing a crop;
7. drains workers to zero; merely leaving the Hub never retains compute.

A test cannot bypass another account's fair turn, attach Mage's volume, repair/download a model, use
an unqualified RTX 5090, or activate a profile/crop automatically.

## SoulX renderer profiles

The accepted bounded-worker evidence includes technically valid Ranga-style full and split
composition candidates made from one native SoulX output. Their exact filters/hashes are indexed by
`CURRENT_STATE.yaml.model_runtime_evidence.soulx`; treat them as review evidence, not active
production configuration, until `GATE_SERVERLESS_SOULX_001` and the explicit human crop decision
pass.

The active renderer contract, once approved, must pin:

- native source geometry/fps and crop profile version;
- full composition transform/position/background treatment;
- split-avatar crop scaled to exact `960x1080` on `x=0..959`;
- narration image on `x=960..1919`, clean seam, no border/label;
- one native clip ID/hash reused in both compositions;
- final A/V trim/pad policy, probe, and output hash.

No manual crop may be hidden inside worker inference. Renderer profiles are deterministic and
versioned per compatible avatar/runtime geometry.

## UI contract

Preserve the accepted visual-first Avatar Hub and two-column/equal-media card system. The current
workspace sees only its private profiles plus explicit built-ins. Healthy glance cards show image and
name; actionable states/warnings appear when needed. Version, source geometry, rights, compatibility,
test gallery, provenance, and archive/duplicate/new-version actions remain progressively disclosed.

New Avatar wizard:

```text
Name and private upload -> Validate/normalize -> Review -> Ready -> Optional compatibility test
```

It shows upload/validation/reconciliation/failure/retry, warnings, rights/consent, retention, optional
test estimate, fair waiting, worker initialization/model-ready/generation/upload, cancellation, and
review. No screen exposes GPU selection, Pod/worker start/stop, model volume, or another tenant.

Create Project contains the compact app-native visual Avatar dropdown. Opening lists explicit system
built-ins plus only this workspace's `ACTIVE` parents backed by a current `READY` version. Selection
stores the exact version ID immediately. `+ New avatar` autosaves the current project draft and
returns after readiness without re-uploading voiceover or losing style/settings.

## Records and API

Core records:

- `avatar_profiles`: tenant/system scope, name, lifecycle, active ready version, private cover, actor
  audit;
- `avatar_profile_versions`: immutable source/canonical assets, transformations, checks, rights,
  lifecycle, exact hashes, compatibility state;
- `avatar_profile_test_attempts`: admitted request, outbox/assignment, endpoint/runtime/volume,
  artifact receipts, samples, human verdict, timing/cost;
- `avatar_profile_assets`: original/canonical/thumbnail/test output with tenant R2 key/hash/retention;
- project revisions: exact selected version/hash and compatibility snapshot.

Workspace records use composite tenant FKs. A profile/version/asset from another account cannot be
listed, selected, referenced, tested, downloaded, archived, or inferred through error timing.

```text
GET    /v2/avatar-profiles
POST   /v2/avatar-profiles
GET    /v2/avatar-profiles/{id}
POST   /v2/avatar-profiles/{id}/versions
POST   /v2/avatar-profiles/{id}/versions/{version_id}/upload-reservations
POST   /v2/avatar-profiles/{id}/versions/{version_id}/validate
POST   /v2/avatar-profiles/{id}/versions/{version_id}/accept
POST   /v2/avatar-profiles/{id}/versions/{version_id}/test
POST   /v2/avatar-profiles/{id}/versions/{version_id}/abandon
POST   /v2/avatar-profiles/{id}/archive
POST   /v2/avatar-profiles/{id}/duplicate
```

Every mutation derives tenant/actor from the session, requires idempotency and optimistic revision
where relevant, and appends audit. Billed tests use predispatch/post-assignment authority and expose
possible ambiguous/duplicate compute honestly.

## Storage, privacy, and deletion

```text
tenant/{account_id}/workspace/{workspace_id}/avatar-profile/{profile_id}/version/{version_id}/
  original/
  canonical/
  thumbnail/
  tests/{attempt_id}/
  manifests/

system/avatar-profile/{profile_id}/version/{version_id}/...
```

Source images and test videos are private. Signed URLs are short-lived, tenant/method/key/type/size/
hash bound, and never logged with query strings. Browser/app/worker caches and job scratch cannot
cross accounts. Public buckets/CDN links are forbidden for user avatar media.

Avatar source/test inputs never enter `/runpod-volume`. The retained volume carries only the sealed
SoulX runtime. Serverless workers treat it read-only, redirect cache/temp/locks to unique job scratch,
upload only to exact tenant reservations, and scrub scratch after the attempt.

Archive hides a profile from new selection but preserves old revision resolution. A source referenced
by queued/running/review work cannot be deleted. Later explicit erasure warns that affected
revisions become non-regenerable and retains only minimum lawful hash/audit facts. Account deletion
does not authorize deletion or mutation of the shared infrastructure model volume.

## Cost and speed

Creating/validating a profile is local/hosted CPU plus private storage. A ready profile adds only a
database/R2 lookup to generation and avoids repeated upload/preprocessing; it does not eliminate
SoulX inference for new speech.

Optional tests are separately estimated Serverless work. Accepted bounded-worker evidence measured
roughly 20.268 seconds inference plus 0.894 seconds encode/mux for a 10-second sample, but total cold
readiness reached 672.035 seconds and is not a Serverless estimate. Current Flex rate, startup,
model-ready, inference, upload, possible duplicate exposure, and fixed volume billing are reported
separately.

Video generation batches every scheduled span for one admitted video into one bounded SoulX endpoint
request. Full/split reuse is renderer-only. Endpoint workers scale to zero after demand; the existing
50 GB SoulX volume continues its recorded `$3.50/month` charge.

## Acceptance

- `GATE_TENANCY_001`: private records, selection, errors, events, search, and cross-account negatives.
- `GATE_STORAGE_001`: private R2/signed URL/scratch isolation and retention.
- deterministic source validation plus owned fixtures for orientation, multiple/no face, too small,
  blur, corrupt/animated/oversized/decompression inputs, and archive/reference safety;
- exact immutable version pinning through Create Project save/reload/generation;
- `GATE_SERVERLESS_CONTRACT_001` before any live optional test;
- `GATE_SERVERLESS_SOULX_001` for exact RTX 4090 Serverless cold/warm/concurrent volume/output/
  receipt/cost/zero-worker proof and human quality/crop approval;
- `GATE_SOULX_LICENSE_001` before production activation;
- installed Chrome proves private Hub/wizard/dropdown/test gallery and no manual compute controls.

## Non-goals

- No inline project avatar upload, cross-tenant shared user catalog, face capture, avatar marketplace,
  identity cloning from unknown people, automatic crop approval, automatic compatibility inference,
  repair/fallback, full-voiceover generation, model-volume asset storage, or user GPU/worker control.

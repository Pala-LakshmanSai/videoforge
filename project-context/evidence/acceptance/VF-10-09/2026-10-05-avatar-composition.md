# Avatar composition and opening footage — 5 October 2026

Checkpoint V2-09 / VF-10-09. Branch `codex/avatar-composition-controls`.
Implementation `f0d9c67fd67a13cac8a76cfaaf6419902caa7080`.

## Behavior and compatibility

Fresh v12/v13 schedules pin both controls. Avatar On preserves precursor v6/v7 timings,
counts, full and split compositions. Opening footage replaces photos, including the right
side of avatar splits, while Avatar Off converts all slots to full-screen visuals and skips
avatar binding/readiness, span extraction, avatar generation and their costs/stages.
Opening On defaults to 3 minutes with custom 0.1–60 minutes; Off retains whole-film coverage.
FOOTAGE_COMPOSITION_V5 preserves optional whole-scene spreading after the opening. Crossing
suffixes count against remaining elapsed-time allowance. Historical v2–v11/V1–V4 pins stay immutable.
Render manifest/input v4 carries exact split-video lineage; older wire versions reject it.
Required footage cannot silently fall back to a photo. No new dependencies, models or provider lanes.

## Verification before publication

Scheduler67, render17, focused Web547 then product197/continuation61, Python contracts97/media52
passed. Actual FFmpeg split movement, frame/audio duration, no-avatar full-screen footage,
legacy-v3 rejection and insufficient footage guards passed. PGlite270/268/267/248 passed;
native270 rollback rehearsal restored exact functions/plans/segments, then production apply
preserved historical plan/segment hashes. Private helpers remain private; runtime grants remain.
Chrome6/6 passed desktop/mobile creation controls and prior routing/progress/edit paths.
Types, touched lint/format, contract sync123, context/schema, secret scan, production/staging
builds and quarantine passed. Static entry closure increased12,027bytes for the reviewed contract/control changes.

Broad CI37265452728 is not green:131 untouched formatting files, unchanged frozen-render import
order,16 inherited Chrome failures, and70 broad TypeScript test failures (including missing
fixtures, historical expectations and four5s timeouts). The three suites containing those four
runtime timeouts passed176/176 independently with one worker. Full-repository green is not claimed.

## Initial publication (superseded by the repair below)

Cloud qualification run37265534347 passed offline ASR/span/render and current renderer tests.
Private image sha256:673f0d0ece7e67dce4612fc0496e18361e2011739a408d472a13c275eff727a4;
source sha256:ca6be33cfd78b4ffc1898dc6ed8337ad594776ee7c54fbcf48658cadcfb7640b;
runtime sha256:924304a45aab36d074e74618e6b98d5d0b1bdd579e94238425ab49ddc8084200.
Exact qualified source files and unchanged pinned tools/model verified from registry layers.
Temporary GitHub publish token removed after publication.
Desktop0.1.50 run37265528986 passed Windows/macOS builds; both whole installer sizes/hashes
match immutable release manifest and execution bundle
sha256:61a635fd5664752a51c99502e6220ef6ed8b629e6c7512a04460a36119b6bde8.
Existing Windows unsigned-beta and macOS ad-hoc-beta trust remains.

Worker57ab1e7a-c32a-4707-b548-808979a03f3d serves100% with sourcef0d9c67f.
55bindings,27secrets,3Workflow registrations, account pooling and disabled CPU fallback preserved.
All30 public asset hashes match; anonymous private catalog returns401. Native migration270 active.
New Cloud authority copies every existing membership and policy, leaving previous authority intact.
No retained resource, model download, or provider replay was created by publication.

## Production acceptance

Live Chrome verified Avatar On by default, Off hiding picker/new-avatar link/requirement,
Opening Off hiding duration, custom3.2-minute opening with Avatar Off, correct remainder copy,
and eight-stage Avatar Off progress omitting spanning/avatar stages. Same-account queued project
keeps existing admission behavior without renting a machine while waiting.

Both native final exports, binary/motion/narration checks and cleanup now pass as recorded below.

## Live split-render repair and recovery

The initial Avatar On 180-second canary accepted all 35 scene videos and 11 avatar
clips, but final assembly failed definitively with `RENDER_ASSET_MISSING`. The
shared renderer expected-assets collector omitted videos used only by split
scenes. The earlier regression reused a full-scene asset, masking this defect.
A distinct split asset reproduces the failure; moving video collection outside
the composition branches fixes all callers. The corrected 42-test renderer
suite passes. Runtime 0.1.51 qualified and published before assembly recovery.
Migration 0271 extends the existing changed-bundle recovery guard to this
definite failure; its three focused checks preserve owner, exact input/output,
cleanup, attempt-limit, and idempotent retry fences. No saved media is regenerated.
This is recovered acceptance, not an uninterrupted production run.


## Corrected production release

Source `b5ed9f70d195b7bdb75fd9d17f3e6af3574f1e04`, Worker
`7c5820ff-20a2-4fb2-b206-2736e49b119c` at100%; native271/272 applied after
exact rollback rehearsals and historical plan/timeline preservation checks.
Cloud run37268791624 and Desktop run37268787652 both succeeded.
Qualified private image sha256:5aa154074f980361c1f5d769723fc030639b770513471e55c3fc59afeffd5f62;
source sha256:dfdb8712665dea2f8faff94a2fedd353a5a2d2af29a7221fd8e5504347c050ee;
runtime sha256:66caa4042e74fc2ecd1a78afe0c1378c7207d8851fda63cd0b4127ae509ba307.
Desktop0.1.51 execution bundle sha256:4953496f49efeb1cb3c1946d82ccde33b0e7da2413782addcf835884e043e177;
Windows279627757bytes and macOS414292959bytes whole-download hashes matched the
immutable manifest. Existing beta signing trust is unchanged. Exact runtime source
files/tools/model verified; temporary package publication secret removed.
All30 public assets, private anonymous401,55bindings/27secrets/3Workflow identities,
account pooling, and disabled CPU fallback verified. Legacy completed avatar project
still returns200 with avatar/render SUCCEEDED.

Migration272 reuses the existing235/237 tenant-scoped cleanup-only rule for account-wide
render recovery/status. A historical Sept30 UNKNOWN/no-Pod-ID reservation remains
STOPPING with its USD0.20 debit and global resource slot. It is not declared CLEAN or
free. The current failed render still requires its own cleanup. Six focused migration
checks and independent review pass: changed/unchanged bundle, owner/tenant, exact saved
inputs, prior outputs, active work, current rental cleanup, retry cap, idempotency and
rollback. Native271+272 rehearsal produced ELIGIBLE only with the changed runtime and
preserved historical UNKNOWN/debit and failed output identities.

One supported Cloud render retry accepted original failed attempt
97c53fd3-8ed5-4b02-84bf-41caea3ae1ca and created retry1491e5f2-bd63-4863-a56c-764395e5f4f8.
Its single new900s rental used the corrected qualified image and is CLEAN. Whole saved
API-job/video-job rows, timeline and render-plan hashes match before recovery; original
failed attempt including null output receipt/checksum remains exact and replay_count0.

## Final binary, composition and cost proof

Avatar On:180seconds,1920x1080,H264,30fps,5400frames,93961665bytes, one audio stream.
All41segments retain6full-screen avatars,5avatar/video splits and30full-screen videos;
all35former-photo regions move, with zero remaining photo slots. Native v4 lineage is
valid and original narration correlation0.9990301095 at zero offset. The first split
frame was visually inspected: usual presenter at left and moving bee footage at right.

Avatar Off:20.333008seconds,1920x1080,H264,30fps,610frames,10953398bytes. Four full-screen
segments:2videos covering the6s opening and whole crossing scene,2still scenes afterward;
zero avatar clips, spanning jobs, avatar costs or avatar pipeline stages. Remaining
25% calculation retains whole crossing suffix behavior (28.14% actual for this short
example). Native v4 lineage and every moving region pass; original narration
correlation0.9992132673 at zero offset. Both complete files match native checksum/size
and fully decode. Off played to ended=true/error=null, approved and visible in Library.
On reached ended=true/error=null at180s/1080p in real Chrome, with normal playback and
seeking observed. Played ranges were0–134.873194,159.946259–161.355129 and170.734965–180s;
this is not uninterrupted whole-film browser playback. Complete native-file decode is
separate proof. Both test exports are approved and visible in Library.

At2026-10-05T05:57:33Z, all8new rentals CLEAN, each<=900s, complete RunPod inventory0Pods,
active account provider leases0, unfinished uploads0, no regeneration/TTS/extra project.
Conservative full started/reserved test allowanceUSD6.3823638667 versus USD8 cap,
including full LLM reserves, Fal job-lifetime upper bound, generated video allowances
and all CPU rentals. This is not invoice/storage/egress proof. Historical UNKNOWN
liability is separate and preserved. Test dispatch and temporary compute are finished.

Repair broad CI37268748685 retains131 identical formatting failures, the same frozen
render import-order failure and16 identical Chrome failures (28passed); Workerd passes.
TS77failures include the same70 plus7additional5s timeouts in unchanged files. Those
exact7 tests pass locally with one worker, unchanged5s timeout,713–1321ms each; hosted
runner cause is not proven. Full-repository green is not claimed. Installed Local
end-to-end, representative long-form/concurrent latency, invoices and generalized
image-quality acceptance remain separate gates; no zero-delay
provider SLA is established. Private detailed evidence stays under `.videoforge/avatar-composition-20261005/`.


## Durable handoff

Acceptance/migration272 commit `fd032b2a6255c96912e15b6bd93dff7873bcbfef` pushed.
Project Memory guarded writes and exact fresh hash readbacks passed: project51,root44,
index71,coverage66. Other project rows and historical avatar recovery evidence are exact;
the current description now preserves avatars and marks the old v10/v11 policy historical.
No local memory or Obsidian update. Production remains b5ed9f70/Worker7c5820ff at100%
with native272; no further provider dispatch or retained paid compute is required.

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

## Published artifacts

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

Full exports, playback, finite-scope cost and cleanup results are pending.

## Live split-render repair (in progress)

The initial Avatar On 180-second canary accepted all 35 scene videos and 11 avatar
clips, but final assembly failed definitively with `RENDER_ASSET_MISSING`. The
shared renderer expected-assets collector omitted videos used only by split
scenes. The earlier regression reused a full-scene asset, masking this defect.
A distinct split asset reproduces the failure; moving video collection outside
the composition branches fixes all callers. The corrected 42-test renderer
suite passes. Runtime 0.1.51 must qualify and publish before assembly recovery.
Migration 0271 extends the existing changed-bundle recovery guard to this
definite failure; its three focused checks preserve owner, exact input/output,
cleanup, attempt-limit, and idempotent retry fences. No saved media is regenerated.
Initial release is not final acceptance; the repaired canary will be reported as
recovered, not an uninterrupted production run.

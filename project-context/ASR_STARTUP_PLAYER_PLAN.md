# ASR startup timeout and Progress narration player

V2-09 / VF-10-09, baseline production `d4b4a516` / Worker `31b8f412`.
User request: investigate the transcription failure, fix its responsible mechanism,
add playback below costs and above the progress bar, verify and publish using multiple agents.

## Evidence and scope

Exact ASR failure: 301.445 seconds after placement verification, no worker heartbeat,
phase or saved result. Controller seeds the heartbeat at placement and expires after
300 seconds; pinned runtime allows 600 seconds for startup. Align only STARTING with
that bound, retain 300 seconds for active execution and existing rental/authority deadlines,
and persist specific startup/heartbeat/deadline codes. Original deleted Pod startup logs
are unavailable; do not claim a parser or provider-network root cause. Preserve runtime pins.

Reuse the checksum-verified private range streamer for the current revision's accepted
MP3/WAV source. Enforce tenant ownership, locked current revision, committed receipt,
exact source hash/size/type/key and retained recovery lineage. Show one accessible native
player after costs and before the horizontal bar, for uploaded and generated narration.
Playback retry must never retry generation. Preserve accepted media, costs, provider
identities, v40/profile10, QA defaults false, Cloud/Desktop pins and Workflow resources.

## Ownership and validation

Parent owns controller tests/fix, context, integration, live Chrome and publication.
UI worker owns Progress regressions; backend worker owns scoped source route/stream tests.
Read-only investigator owns incident evidence and finite recovery preflight.
Require prepatch failing regression, controller/source/UI/native SQL/installed Chrome
proof, TypeScript projects, builds/firewalls, context/secrets/diff and canonical aggregate.
Compare inherited failures against baseline; never call a failed aggregate green.
Live proof requires exact screenshot audio load/play/pause/seek, source checksum/full decode,
and foreign/anonymous rejection. No fresh paid validation without separate finite authority.

## Authority and rollback

User authorizes local fixes and qualified production publication. Keep failed attempts
and cleaned rentals immutable. Before any paid validation, ask once with GPU/rate/disk,
finite cap, one bounded same-project recovery and a verified preparation-only hold.
No TTS/images/avatar/video/render work belongs to that validation; prior caps do not transfer.
Rollback is the baseline application; retain source and history. No migration or native
package release is required for this controller/UI change. CURRENT_STATE.yaml owns proof.

# Repeated zero-duration transcription repair — 6 October 2026 IST

Checkpoint V2-09 / VF-10-09. User requests exact demo9 diagnosis, durable prevention and production publication. Production baseline is `34cdd788e802cb26b30dfecb4b2271ef86493c08` / Worker `052d3dd9-89e6-454f-bec0-f7e32bb6f8e8` at 100%. Preserve unrelated primary-checkout changes.

## Exact cause

The inspected 1,167,020 ms narration failed twice with `ASR_OUTPUT_INVALID`, using the same source checksum, Cloud image and runtime. Both original rentals are CLEAN with independently recorded cleanup timestamps. No scene-generation requests had begun.

Exact saved-source reproduction with pinned whisper.cpp 1.8.4/base.en and four CPU threads fails in chunk 0 at canonical word 828: `word 828 has no duration after source-bound clamping`. At 317,900 ms, Whisper emits two consecutive zero-duration words, then a 10 ms word followed by an ordinary positive-duration word. The existing parser inserts 10 ms for each zero-duration word, shifts the following short word's start beyond its unchanged end, then rejects its own repaired timestamps. A blind retry repeats the deterministic content-dependent failure. Browser/device origin is not the mechanism; no person-specific failure-rate claim is established by shared-account records.

## Repair and prevention

The shared parser carries only the existing bounded zero-duration repair into immediately consumed short-word intervals, until original timestamps catch up. All words remain ordered and present. Repair-origin propagation stops at 100 ms; backward movement before that origin, unrelated overlaps after catch-up, malformed offsets and source bounds remain rejected. A separated zero-duration group starts a new repair origin.

One positive job regression reproduces the failed sequence and verifies exact preserved words/times; negative parser regressions reject unrelated and unbounded overlaps. This parser serves both Cloud and personal-worker paths. Desktop release metadata advances consistently to 0.1.52; historical 0.1.51 installers remain immutable.

Local checks: 41 transcription tests pass after the exact new regression fails on baseline. Media-local checks: 120 run, 119 pass, one explicitly skipped platform check. Exact full saved-source transcription succeeds with 3,007 words across two chunks, original narration hash unchanged. Ruff and diff checks pass. The private Linux qualification archive reuses existing accepted span/render fixtures plus the exact failed narration; no public media, credential or signed capability is committed.

## Release gates

Pending: exact Linux offline ASR/span/render qualification and private-image readback; both desktop package builds and release-manifest readback; production configuration preservation/publication; supported saved-project transcription recovery and exact cleanup; real Chrome production readback. No full-video, invoice or universal-outage guarantee follows from transcription repair. Existing broad CI, Local device installation, long-film/editorial and historical UNKNOWN cleanup gates remain separate.

Private operational evidence stays under `.videoforge/demo9-failure-20261006/`; the repository carries only this durable sanitized record. No inference or paid compute was started for local/offline checks. Ordinary saved-project Cloud processing retains DEC_CLOUD_BILLING_001 and its original no-replay and cleanup rules.

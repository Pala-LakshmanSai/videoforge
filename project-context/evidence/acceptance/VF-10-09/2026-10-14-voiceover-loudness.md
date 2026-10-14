# Generated voiceover loudness repair — 14 October 2026

Checkpoint V2-09 / VF-10-09. Production baseline: `d72220c3c73c73c79cad1ccbe273bf4cacd9d3f1`, Worker `0c375aa3-8781-4471-b9e2-51d2fe54301b`, native ledger302. The user authorized diagnosis, repair and application publication. Release source/version and final checks are recorded in CURRENT_STATE.yaml after publication.

## Cause and scope

Two retained, authenticated production MP3s reproduce sustained attenuation and abrupt resets before editing or rendering. Their downloaded bytes match saved SHA-256/length receipts. One 1205.525-second file falls from about -20 LUFS to -43/-45 LUFS for minutes, returning at about600s; a 1460.663-second file falls from about -25 to -38/-40 LUFS and resets near690/1380s. Previously both standalone archival and script narration accepted unchanged J1TTS MP3s after syntax/duration validation without measuring speech level. This is the confirmed source and missing application safeguard; internal provider synthesis behavior is not proven.

Private original/processed audio and checksum/analysis proof remain outside Git in `.videoforge/voiceover-loudness-20261014/`. No customer speech or identities are embedded here. The regression fixture is a synthetic two-tone fade/reset with pauses.

## Repair and acceptance

Both generated-audio callers share bounded streaming decode/measurement and MPEG gain correction, preserving spectral data, samples and timing. Two downloads must retain exact SHA-256/length; failures cannot finalize. Existing accepted audio/uploads/provider identities stay immutable. Private output metadata records original checksum and processing version. See `apps/web/src/server/hosted/VOICEOVER_AUDIO.md` for limits and decoder provenance.

Focused audio/intake/provider/privacy tests:78 passed. Actual Workerd static-WASM execution passes the synthetic fixture, both retained20/24-minute files and a local one-hour MP3, with exactly two mocked GETs and no submission. Output byte lengths match input; hour file57,585,206 bytes, processed in22.827s. Decoder binary reproduction, TypeScript, web lint and production Cloudflare build pass. Full web suite:3392 passed,1 skipped,4 timeout failures in unrelated prompt/continuation/cost suites; all108 tests in those three suites pass when rerun with one worker. Context, secret scan, changed script lint, diff review and final audio decode/measurements pass. Production release checks remain pending.

No new TTS generation or paid compute; existing resource state is preserved and global paid-resource inventory is not reaudited. Final video rendering, fresh paid provider generation and provider-internal synthesis cause are outside this proof. Rollback is the exact prior Worker version; no database migration is introduced.

Actual Workerd outputs fully decode with FFmpeg. EBU R128 loudness range:20-minute22.0→3.2 LU;24-minute13.7→5.0 LU;one-hour22.0→3.1 LU. Output true peaks:-2.0,-5.4,-2.0 dBFS respectively. ffprobe confirms unchanged byte size, duration, codec, sample rate and channels for all three. These are local retained-source results, not a fresh provider run.

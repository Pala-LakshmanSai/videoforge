# Standalone voiceovers — 7 October 2026

Checkpoint V2-09 / VF-10-09. User authorizes design, implementation, testing and production publication.

## Acceptance

- A dedicated Voiceovers dock destination accepts a title, pasted script or UTF-8 text file, and an existing exact voice selection. Voices remains the reusable catalog.
- Reuse saved J1TTS jobs, workload limits and uncertain-submission no-replay rules. Generate only MP3; never start video stages.
- Validate and retain completed MP3 bytes in private R2, with measured duration, size and checksum. Playback/download survive provider file expiry.
- Library has Videos and Voiceovers; voiceover cards show creator, title, voice, date, duration, size and listen/download/confirmed-delete.
- Centralized Library uses the same toggle and only the existing verified, admitted demo9 identity can inspect or delete cross-account outputs. Ordinary accounts remain private.
- Generation reload/recovery, admission changes, errors, duplicate submissions, tenant denial, range playback and deletion retries are covered. Desktop/mobile Chrome verifies visual and functional behavior.

## Scope and release

Use existing components, APIs and database security patterns. No new provider, video processing path, or paid GPU. Parent audits all Luna worker changes before release. Preserve the dirty primary checkout and all concurrent production changes. Release only qualified source and additive migration with exact baseline/readback. Paid live canary requires a bounded existing-plan operation; no subscription/top-up or arbitrary retries.

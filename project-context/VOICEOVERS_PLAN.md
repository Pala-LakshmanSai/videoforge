# Standalone voiceovers — 7 October 2026

Checkpoint V2-09 / VF-10-09. User authorizes design, implementation, testing and production publication.

## Acceptance

- A dedicated Voiceovers dock destination accepts a title, pasted script or UTF-8 text file, and an existing exact voice selection. Voices remains the reusable catalog.
- Reuse saved J1TTS jobs, workload limits and uncertain-submission no-replay rules. Generate only MP3; never start video stages.
- Validate and retain completed MP3 bytes in private R2, with measured duration, size and checksum. Playback/download survive provider file expiry.
- Library has Videos and Voiceovers; voiceover cards show creator, title, voice, date, duration, size and listen/download/confirmed-delete.
- Centralized Library uses the same toggle and only the existing verified, admitted demo9 identity can inspect or delete cross-account outputs. Ordinary accounts remain private.
- Generation reload/recovery, admission changes, errors, duplicate submissions, tenant denial, range playback and deletion retries are covered. Desktop/mobile Chrome verifies visual and functional behavior.

## Queue and usability follow-up — 7 October 2026

- Submit successive scripts without waiting for earlier MP3s. A successful queue response means the request is durable and its background observer is confirmed.
- Reset the composer after confirmed acceptance, retain the selected voice, and show a persistent private queue with live status, recent results, listen/download and Library access.
- Keep an uncertain submission tied to its original request ID until reconciled; never silently resubmit a paid request.
- Reuse existing database FIFO/capacity claims and background Workflow; no schema or video-pipeline change unless verified necessary.
- Download names derive from the entered title, preserving readable spaces/Unicode and removing unsafe filename characters. Applies to existing outputs too.
- Keep the queue list bounded and independently scrollable on desktop and mobile; retain visible heading, counts and Library access. Keyboard users can focus and scroll the list.
- Verify multiple queued jobs, returning later, error/reload behavior, title-based downloads and desktop/mobile presentation.

## Scope and release

Use existing components, APIs and database security patterns. No new provider, video processing path, or paid GPU. Parent audits all Luna worker changes before release. Preserve the dirty primary checkout and all concurrent production changes. Release only qualified source and additive migration with exact baseline/readback. Paid live canary requires a bounded existing-plan operation; no subscription/top-up or arbitrary retries.

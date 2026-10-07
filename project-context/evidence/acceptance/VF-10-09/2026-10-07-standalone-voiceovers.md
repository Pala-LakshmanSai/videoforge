# Standalone voiceovers — 7 October 2026

Checkpoint V2-09 / VF-10-09. User authorized a dedicated script-to-MP3 section, both library toggles, exact-demo9 centralized access, audited Luna delegation, and production publication.

## Implementation

`/create-voiceover` reuses catalog selection and the durable J1TTS queue. Title, script paste/text upload, generation state, inline audio and MP3 download use the existing visual system. Voices remains the catalog. Both libraries add Voiceovers with creator, title, voice, script, date, duration, size, playback, download and confirmed output deletion.

Additive migration 0289 atomically binds only standalone jobs to immutable private audio receipts. Video narration cannot be promoted into this library. Forced RLS, admitted sessions and the fixed owner guard enforce tenant scope. Ordinary video intake remains unchanged.

Generation retains the UUID across navigation/reload and uncertain responses. GET status never submits paid work. A known provider ID survives a failed database receipt. Retrieval retries reuse that ID; MP3 parsing, bounded size/duration, R2 readback and checksum precede readiness. Expired archive claims clean abandoned exact-prefix objects. Lost commit acknowledgments preserve possibly committed audio. Deleted outputs retain provider audit identity.

## Qualification before publication

- Full web suite: 223 files, 3,254 passed, one skipped.
- Focused form/library/API/script-pipeline checks: 89 passed before final UI-only refinement; follow-up deletion checks 19 passed.
- Web and Worker TypeScript checks and web ESLint passed.
- Production/staging builds and provider/native/fixture quarantine passed. Measured entry closure grows only 314/301 bytes for lazy route dispatch, migration identity and workflow ARCHIVING state; no provider code moves into the entry.
- Native PostgreSQL migration rehearsal and runtime-role proof passed, including private cross-account denial, demo9-only centralized access, queue/archive grants and immutable identity. Everything rolled back: ledger 288, 16 existing jobs, no persistent test table or fixtures.
- Migration SHA-256: `9480e3ab4b122133428d14c69f7cce7deefa3d383494280af0e1cff5ee7d3f79`.
- Parent reviewed desktop/mobile screenshots. Installed Chrome exercises creation, both library states, delete confirmation, existing Voices navigation, responsive overflow and request recovery; the desktop CTA is checked against dock bounds.
- Context validation and tracked secret scan passed.
- Canonical `CI=1 TURBO_FORCE=true pnpm verify` stops at inherited repository formatting debt (119 files before changed-file formatting). This is not a claim of globally green CI.

Private operational evidence: primary checkout `.videoforge/standalone-voiceovers-20261007/`. Production identity and live acceptance follow after publication. Existing video work and workflow instances must remain intact; no GPU work is needed for this feature.

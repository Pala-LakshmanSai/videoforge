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

## Live acceptance

Initial executable `3f8a777b` / Worker `0a7c6cdf-09e2-4f5f-9d77-a98d35250428` received 100% traffic. Native migration 289 applied at the rehearsed hash. All 37 public assets matched SHA-256 and length; private unauthenticated route returned 401. All 55 bindings/27 secret names and existing Workflow resource identities were preserved. Existing running instances were not restarted.

One synthetic 92-character narration, job `13d0c2cc-4b33-4ac8-878e-787f945db603`, generated through the actual Chrome form and J1TTS. Verified private MP3: 125,013 bytes, 7.755465 seconds, 44.1kHz mono; checksum `cde717ad8ec0c0c7babd00242d14e102136005d0838f7098a1de8b6336c46781`. Chrome played to ended=true/error=null; HTTP attachment download, 206 range playback, receipt checksum and full ffmpeg decode passed. Native Chrome's Download button was exercised, but its saved-file location was not independently confirmed; inspection of chrome://downloads was browser-policy blocked, with no workaround attempted.

Actual private and demo9 centralized cards, metadata and creator filter passed. Another admitted account received centralized403 and foreign-audio404; its private list omitted the canary. Anonymous audio401 and cross-origin delete403 passed. The confirmed central-library Delete action removed only the test output; follow-up UI empty state, audio404 and native tombstone/provider-identity retention passed. No video project, GPU rental or media pipeline was created for this test. One J1TTS generation consumed; its invoiced incremental charge is not established.

The live check found a transient copy defect: the durable uncertain flag displayed a warning during a normal pending POST. A display-only `unconfirmed && !busy` guard fixes it without changing request identity/recovery, with a deferred-POST regression (5 standalone tests passed). Final UI-only publication follows; no second live generation is needed.

# V2-09: script Create settings rejection

User authorized diagnosis, a global fix, and production publication on 2026-10-06.
Work is isolated on `codex/script-project-settings-fix`, based on `eb8056fc`.
The other production repair chat confirmed its work complete and no deployment overlap.

## Evidence and cause

The affected ready avatar has a VERIFIED `image/webp` runtime source at a valid tenant
avatar source key. Avatar Hub accepts JPEG, PNG, and WebP, but the shared API readiness
reader accepted only JPEG/PNG. Script intake therefore rejects it with
`AVATAR_RUNTIME_SOURCE_NOT_QUALIFIED` before creating a project or narration. The UI's
"no avatar video yet" metadata reflects that failed readiness check, while the checklist
only checks selection. A generic script error concealed the rejected setting.

The native API job materializer independently had the same JPEG/PNG restriction.
Fal's current FlashHead audio-to-video page explicitly accepts WebP reference images:
https://fal.ai/models/fal-ai/flashhead/audio-to-video (verified 2026-10-06).

## Minimal repair

Reuse Avatar Hub's existing `IMAGE_TYPES` in the shared API readiness reader, covering
catalog, preflight, script Create, and voiceover Create. Migration 0279 adds WebP only
to the API avatar materializer. Legacy SoulX PNG qualification, immutable preset/source
hashes, tenant scope, audio validation, spend, and no-replay guards remain authoritative.
Script errors now name the actual rejected setting instead of asking for a futile refresh.

## Verification and remaining gates

Before repair, the new intake regression reproduced HTTP 409 for VERIFIED WebP while
PNG/JPEG passed. After repair, all 224 focused web tests passed. The database flow
reproduces the old WebP rejection, applies 0279, materializes WebP avatar jobs, claims
once, accepts outputs, and reaches render; malformed audio still rejects without jobs.
The exact affected account also reproduces `AVATAR_RUNTIME_SOURCE_NOT_QUALIFIED`
with the previous executable validator and passes the repaired validator in native
Postgres READ ONLY transactions with the same presets, Cloud authority, and composition.
Native 0279 rollback passes with unchanged function grants. All five database tests,
web types, touched-file lint, and both web/Cloudflare builds pass. Canonical verification
retains inherited failures: 127 formatting warnings and missing local uv 0.8.13.

Production publication is verified at executable `f98c59331dcf016a15af8a116cca16a66dffcdef`,
Worker `40cc0991-de69-44b7-b0dd-3bad8fb4175e` at 100%, native migration 279. Native
readback confirms exactly the expected function-definition change and identical grants.
All 36 public assets match local byte counts/SHA-256; the two dotfiles are ignored build
metadata. Installed Chrome verifies Create, enabled script voice selection, catalog HTTP
200, all available avatar readiness flags, and Cloud ready with no console errors. The
browser is signed into a different admitted workspace from the incident; the incident
account's exact presets are independently proven by native read-only validation.
No production Create POST or paid provider canary is sent for acceptance.

The existing native ledger retains historical migrations no longer present in the active
repository manifest. Do not assume a contiguous chain or rerun old migrations. Publication
checks the known latest 278 entry, exact existing function bytes, and locked ledger count,
then atomically appends 279. Previous rows remain untouched.

The isolated branch is pushed. Both preceding ASR and prompt repairs are ancestors.
Guarded Worker publication preserves all 55 bindings, 27 secrets, six resource bindings,
three Workflow identities, Desktop 0.1.52, qualified Cloud runtime pins, and current jobs.
Remaining inherited CI, provider/full-film, editorial, and invoice gates are separate.

## Provider and shutdown state

No narration, Fal, Kie, Runware, or paid compute was started for this repair. Existing
user work is running independently; preserve its jobs and request identities. Previous
cancelled/archived projects are not resumed. Cloud runtime pins and Desktop 0.1.52 stay
unchanged; no Cloud worker-image or Desktop release is needed for this web/SQL fix.

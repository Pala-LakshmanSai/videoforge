# Centralized Library — production acceptance, 2026-10-05

Checkpoint V2-09 / VF-10-09, profile `v2_09_centralized_library`, decision `DEC_LIBRARY_001`.
Implementation `e81dacc1e2a9db2d3798a13645ba8bc8c481519e`; visible creator attribution and
release authorization `abd49b6e0da3f3290bf26a72c764a7993223d981`, branch `codex/centralized-library`.

## Result and boundaries

Centralized Library appears immediately after Library in the exact designated owner's dock. Every
card visibly shows its creator's name and email, with search, creator filtering, totals, newest-first
48-row pagination, unavailable states, responsive thumbnails and accessible native-video dialog.
It includes retained successful USER/ACTIVE project renders across creators and revisions, under
existing output/result/checksum/receipt fences. Archived projects and deleted outputs remain excluded;
final human approval is unnecessary. Existing private Library, presets, inputs and costs remain private.
No cross-user edit/delete or generation controls were added.

Migration275 installs a fixed SECURITY DEFINER read function with actual verified/admitted/non-revoked
session and exact-email checks, frozen search path and unchanged RLS policies. PUBLIC EXECUTE is
revoked; the existing restricted runtime role alone receives EXECUTE. The API repeats qualification,
uses existing rate protection, hides storage keys and rechecks access on every watch/download. Shared
MP4 serving preserves SHA256/size/type, byte ranges, saved filename and attachment behavior.

## Source reconciliation and publication

Before publication, the entire concurrent voice-filter release through `2dfc1bf9` was merged, including
its executable `77781a02`. Only startup/current-state conflicts occurred and both task records were
preserved. Fresh production/schema/configuration readback preceded mutation; publication compared
traffic again before deployment to prevent overwriting a concurrent release.

Native migration275 and ledger registration committed atomically. Migration SHA256 is
`14de61538cff8dfc7b7d443c001caec448a2abb45c77e6494ff0109892c97c51`.
Definer owner has BYPASSRLS; runtime does not have BYPASSRLS/public-schema CREATE.
Readback proves SECURITY DEFINER true, runtime EXECUTE true and PUBLIC EXECUTE false.

Initial executable `abd49b6e` was published at 100% as Worker
`89477b1c-dce3-49ab-9867-1316afc16fac`. All 36 public asset lengths/hashes matched. Build metadata was
excluded from public-asset enumeration. All55 bindings,27 secret names,3 Workflow identities,
routes/domain/crons/redaction/runtime pins were preserved. Matching three registrations were
published without creating instances or restarting the healthy continuation driver.

During acceptance the voice-dropdown chat merged `abd49b6e`, then published combined executable
`3fe3eadd4b95ee87b5bed4d032a291fae33f985b` / Worker
`7a495e15-b324-4d15-992f-73833a4b57a6`. Its acceptance `d33b0a0e` was fast-forwarded here.
Live status readback confirms that source/version. Its release record verifies37 public assets and
unchanged server code after build-path normalization. Centralized Library was rechecked on the newer
release; no second deployment overwrote those dropdown changes.

## Verification

- Combined246 focused Vitest checks passed: centralized SQL/API/UI, completed-render, original
  product/team/private Library/dock plus voice catalog filters. Four installed-Chrome journeys at
  desktop1440/mobile320 verify owner-only dock, every-card name/email, no overflow, search/filter,
  empty states, full playback, Escape/focus restoration and exact synthetic MP4 filename/checksum.
- 18 migration checks,19 config/bundle checks including one-byte rejection, Web/Worker types,
  owned ESLint, production/staging builds and quarantine, context/contracts/secrets/diff pass.
  Precisely measured static ceilings increased293 production/390 staging bytes; quarantine remains.
- Actual native restricted-runtime calls return30 retained outputs across5 creators for qualified
  owner sessions and deny every tested foreign/missing session; exact-attempt filtering returns1.
  The live authenticated owner API returns200; foreign list/watch/download each return403.
  Four anonymous centralized/private endpoints return401.
- Signed-in production Chrome shows30 cards from5 creators, all with visible name/email and no
  horizontal overflow. Search isolates1 retained output; another creator filter isolates1 video and
  all-creator reset restores30. A20.333008-second1920x1080 video plays fully, ended=true/error=null.
  Published voice filter controls remain present: Female yields362 voices and reset succeeds.
- Authenticated live download returns200, video/mp4, attachment,10,953,398 bytes. SHA256 matches
  the authoritative output receipt:
  `4313454e0527f05e8637ddb39bbab7e541ee6c9e42bce6c06827637eef0cd7b8`.
  Watch range100–199 returns206 and exactly matches that100-byte slice.
- Native Chrome's saved download is blocked by organization policy. Browser protections were not
  changed. A saved production-file checksum is unclaimed; HTTP checksum and native synthetic-download
  proof remain distinct. This browser-policy limitation does not justify changing the application.
- Canonical `pnpm verify` remains red for inherited132-file formatting, missing repository-local
  uv0.8.13 and occupied unrelated4173 Workerd startup. Existing server was preserved; focused
  acceptance does not claim full-CI green.

Private release proofs are under the primary checkout's
`.videoforge/centralized-library-20261005/release/`, including native migration/auth, asset/anonymous,
registration and download-HTTP receipts. Synthetic logs are under this worktree's
`.videoforge/centralized-library-preview/`. Neither private sessions nor real creator identities,
credentials, signed URLs or storage keys are committed to acceptance or Project Memory.

## Authority, spend and remaining gates

The user's2026-10-05 instruction authorizes creator attribution and production publication while
preserving concurrent voice filters. New provider inference/rentals/retained resources USD0.
No paid compute, generation or Workflow instance was started/replayed; no healthy driver restart.
Unrelated provider inventory/shutdown was not refreshed and is not claimed.

The scoped application release is complete. Native saved-file verification remains browser-policy
blocked. Inherited broad-CI, Local, long-form concurrency/provider, editorial and invoice gates remain
separate. Rollback preserves the additive migration; revoke its runtime grant if authorization fails.

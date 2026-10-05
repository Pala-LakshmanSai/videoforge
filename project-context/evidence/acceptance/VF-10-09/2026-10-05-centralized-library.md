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

GPT Space Project61/Root51/Index81/Coverage76 guarded updates and readbacks preserve the concurrent
voice-dropdown release, historical evidence and unrelated projects. Acceptance source `12ce6a20`
is pushed; subsequent commits contain only memory/handoff evidence.

## UI and confirmed deletion follow-up

The subsequent user instructions authorize the UI correction, per-video Delete and production
publication. Search/creator focus now highlights the whole control rather than drawing inner vertical
outlines. The section fills its parent, hero copy can shrink and totals stack at1100px, with no overflow
at977/320px. Every card retains Watch/Download plus a clearly named Delete control. Confirmation
shows the exact title/creator/email and permanent removal from both libraries; Cancel restores focus,
pending disables repeat actions and failures remain retryable. Projects and input media stay saved.

Additive276 supplies one fixed exact-owner/session-checked plan/finalize RPC, with no PUBLIC EXECUTE
or RLS change. It accepts only eligible completed renders, binds the three artifact keys to the exact
tenant/workspace/project/revision/render-attempt prefix, reuses existing R2 delete/head/paginated-list
absence verification, then atomically records retention deletion and its audit event. Repeated deletes
are idempotent. Same-origin/owner/native-session/rate checks protect DELETE independently of the UI.

29 focused checks plus the final four API/SQL checks and six installed-Chrome journeys pass at1440,
977 and320px: focus geometry, creator details, search/filter, full playback, download checksum,
confirmation/cancel/one-video deletion and other-manager denial. Types/lint, context/secrets, both
production/staging quarantines and18 config tests pass. Migration manifest adds exactly116 bytes to
each measured static closure; one-byte overflow rejection remains intact. Native transaction checks
prove all30 prefixes, foreign denial, one idempotent audit event and list hiding; rollback preserves
all30 original outputs with zero R2 deletion. Native276 committed atomically; SECURITY DEFINER/runtime EXECUTE true, PUBLIC EXECUTE false.
Actual restricted runtime plan/finalize/retry passes with rollback restoring all30 originals. Planning
uses row locks and requires an ordinary read/write transaction even when no rows are mutated.

Executable `17c3608b1389f3304ebb0046b8627c9bb597d3ef` is published at100% as Worker
`befa8996-f301-4d9c-83a1-b261b6959278`. All35 public asset hashes/lengths match;55 bindings,
27 secrets and3 Workflow identities/configuration are preserved. Signed-in production shows30 Delete
controls, exact creator/title confirmation, Cancel/focus restoration, one focus highlight and no977px
overflow; hero totals stack. Retained20.333008-second1080p playback still ends without error, MP4
HTTP checksum matches, and voice themed listboxes remain functional. Foreign DELETE403, missing
origin403 and nonexistent output404 pass. Six Chrome fixture journeys verify actual confirmation
and deletion behavior; no real production user video was deleted for acceptance. Native saved-download
policy limitation and inherited broad-CI/provider/Local/editorial/invoice gates remain unchanged.
New paid work/resources/Workflow instances/driver restarts zero; unrelated inventory unrefreshed.

Final compatibility correction: four of five creator IDs are database-generated UUIDs with legacy
version/variant bits. The API now validates PostgreSQL UUID shape rather than imposing v1–v5 bits;
all creator filters remain usable while malformed values stay rejected. A regression covers such
creator and attempt IDs. No new schema or permission expansion accompanies this correction.

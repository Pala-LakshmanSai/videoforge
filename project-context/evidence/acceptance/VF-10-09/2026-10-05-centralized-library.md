# Centralized Library — local acceptance, 2026-10-05

Checkpoint V2-09 / VF-10-09. Implementation `e81dacc1e2a9db2d3798a13645ba8bc8c481519e` on `codex/centralized-library`,
base `610b7bed`. Profile `v2_09_centralized_library`; decision `DEC_LIBRARY_001`.

## Result

The dock gains Centralized Library only for the exact verified designated owner. Its collection
includes every retained successful USER/ACTIVE project render across creators and revisions, subject
to the same exact output/result/checksum and render-only receipt fences as private Library. Archived
projects and explicitly deleted outputs remain excluded. No final human approval is required.
The responsive page has live video thumbnails, creator attribution, global search/creator filters,
48-row pagination, totals, unavailable states, native playback, watch/seek and MP4 downloads.
Keyboard dismissal returns focus to the triggering control. Thumbnails begin loading only when
visible; existing hosted rate protection remains intact. No editing/deletion or generation changes.

## Access and artifact boundaries

Migration 275 is additive: fixed SECURITY DEFINER read function, exact admitted/verified/non-revoked
session and email gate, frozen search path, no direct tenant-policy expansion. PUBLIC EXECUTE is
revoked; only the current restricted runtime role receives EXECUTE. Existing private Library and
project authorization queries stay unchanged. API repeats the owner guard, rate limit and native
session check. Lists hide R2 object keys; same-origin authenticated watch/download endpoints recheck
access every time and reuse the existing SHA256/size/type/range/Content-Disposition serving logic.
No bearer output links, input/preset/cost access or provider calls are introduced.

## Verification

- 223 focused Vitest checks passed: centralized SQL/API/UI, completed-render guard, original product,
  team access, private Library and hosted dock. Real PGlite session function and FORCE RLS/runtime
  role prove 51 renders across two creators, 48+3 nonduplicating pagination, full retained history,
  search/filter, exact attempt, output/result/hash/retention/receipt guards, and denied manager/member,
  alias, missing, unverified, expired and revoked sessions. Range206 and attachment naming pass.
- Four installed Chrome journeys passed at desktop1440 and mobile320: owner-only dock, no overflow,
  search/creator/empty states, keyboard playback to ended=true/error=null, Escape/focus restoration,
  native filename and SHA256-identical synthetic MP4 downloads; another manager cannot see or fetch
  the collection. Synthetic data/media only. Playwright-routed download initially canceled; a real
  loopback fixture HTTP transport fixed the test. No product/security-control workaround was added.
- 18 migration smoke/hardening checks and 19 production-config/bundle checks passed. One-byte growth
  rejection remains tested; precisely measured lazy-route static closure ceilings were updated by
  +293 production/+390 staging bytes. Dynamic server/client and GPU quarantine remain intact.
- Web/Worker typechecks, owned ESLint, production/staging builds and bundle quarantine pass.
  Context validation, migration manifest hash, contracts, tracked-secret scan and diff checks pass.
- Native read-only preflight: migration ledger remains274; new function absent; neondb_owner has
  BYPASSRLS, runtime has no BYPASSRLS/no public-schema CREATE and retains schema USAGE. Existing
  session function owner matches. No native DDL or migration was applied.
- Canonical `pnpm verify` was attempted and remains red: inherited formatting across132 files,
  repository-local uv0.8.13 missing, and existing unrelated4173 server blocks canonical Workerd
  startup. Existing server was preserved. Focused acceptance does not establish full-CI green.

GPT Space project/index/coverage updates58/78/73 preserve prior production evidence and other projects;
guarded readbacks confirm the new exact-owner decision and local-only publication gate.

Private local logs/screenshots are under `.videoforge/centralized-library-preview/`; Chrome fixture
screenshots are copied there. They are review aids, not evidence of actual cross-user production data.

## Remaining gates and authority

Production migration275, actual restricted-runtime function qualification, live all-user collection,
retained full-film watch/seek and exact downloaded-file identity remain pending approval/publication.
See [bounded proposal](../../../CENTRALIZED_LIBRARY_PLAN.md). Stop on source/schema/config drift or
any authorization/artifact failure. Production baseline source4660b1b9/Worker9872d035 is historical
last-verified evidence and must be refreshed before publication, never overwritten blindly.

New provider inference/rentals/retained-resource allocation: zero. No generation, continuation driver,
provider task or paid compute was started/restarted. Unrelated live provider inventory/shutdown was
not refreshed and is not claimed. No current-task external mutation or release approval exists.

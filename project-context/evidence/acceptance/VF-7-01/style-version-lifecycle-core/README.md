# VF-7-01 Image Style lifecycle-core evidence

Checked 2026-08-11 against implementation commit
`9df8486edff87c4c432490d9875ff7fe35aaa41c`.

## Result

PASS at `$0` in provider mode `fixture`. No credential, network, provider, browser, model, cloud,
or external-object-store activity occurred. Tests used only injected SQL plus fresh, in-memory, and
temporary local PGlite databases.

- Adds workspace-scoped parent/version reads, deterministic catalog/version ordering, and archived
  catalog filtering without breaking exact historical resolution.
- Atomically binds an eligible `DRAFT` or `FAILED` version's `ANALYZING` transition to its exact
  version-owned task, execution attempt, reservation, dispatch outbox, and specialized attempt.
- Preserves exact replay results and rolls back all rows plus lifecycle state on typed failure.
- Rejects fabricated transitions, wrong contracts, malformed payloads, drifted RFC 8785 JCS hashes,
  changed analyzer provenance/disclosure, direct draft publication, and mutation after publication.
- Publishes only `NEEDS_REVIEW`, moves the active pointer atomically, keeps prior published versions
  historically resolvable, and allows explicit optimistic abandonment only for non-running drafts.
- Proves failed-analysis retry, one-open-version release, and post-reopen writes.

## Verification

- Focused Image Style lifecycle tests: PASS, 5/5 tests.
- Targeted `@videoforge/control-plane` lint, typecheck, and build: PASS.
- `TURBO_FORCE=true pnpm verify`: PASS, including 136 control-plane tests, 163 web tests,
  115 pipeline tests, 43 provider-sandbox tests, 50-file contract sync, six Python 3.12 worker
  suites, local Workerd parity, context/schema validation, secret scan, stable builds, and 38/38
  installed-Chrome journeys.
- `git diff --check`: PASS before implementation commit.

This task adds no reference upload, EXIF handling, route, UI, Gemini composition, provider call,
Mage preview, project runtime composition, cloud mutation, or schema redesign. `GATE_STYLE_002`
remains open.

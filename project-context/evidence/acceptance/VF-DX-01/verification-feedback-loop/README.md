# VF-DX-01 verification feedback-loop evidence

Status: technical pass at `$0` on 2026-08-11.

## Result

- Clean baseline: `ea8588d`; implementation: `cb1895e`.
- Same machine and warm dependencies: Apple M4, Darwin 25.3.0 arm64, Node 22.23.2, pnpm 11.5.2,
  Python 3.12.13, uv 0.8.13, FFmpeg 8.1.1, Chrome 151.0.7922.77.
- Forced full baseline: `231.43s`.
- Forced full final: `154.95s`, or `66.95%` of baseline (`33.05%` faster). Target: at most
  `162.00s` / `70%`.
- Consecutive warm `pnpm verify:fast`: `5.70s`, then `5.08s`. Target: at most `120s` each.
- Full Turbo graph: 28 unique tasks, one control-plane test task, one build task for each of seven
  packages; the no-emit test-fixtures build declares no outputs and web declares both real output
  directories.
- Package tests no longer invoke recursive builds. `pnpm verify` no longer invokes `db:check`
  separately. Workerd overlaps only port-free fast checks; installed Chrome runs afterward.

## Preserved inventory

One forced canonical run executed 698 tests/journeys: config 5, test fixtures 12, TypeScript
contracts 53, Python contracts 42, control plane 164, pipeline 115, provider sandbox 43, web 163
across 20 files, root scripts 6, Python workers 56 across six explicit suites, local Workerd 1, and
installed Chrome 38. All passed; intentional skips remained zero. Baseline executed the same unique
inventory but redundantly executed all 164 control-plane tests a second time.

## Commands

- `/usr/bin/time -p env TURBO_FORCE=true pnpm verify` at `ea8588d`
- `pnpm verify:graph`
- two consecutive `/usr/bin/time -p pnpm verify:fast`
- `/usr/bin/time -p env TURBO_FORCE=true pnpm verify` with implementation present
- `pnpm contracts:check`
- `pnpm context:validate`
- `pnpm secret:scan`
- `pnpm audit:dependencies`
- `pnpm exec prettier --check ...`
- `git diff --check`

`verify:fast` remains a feedback-only command. Only canonical `pnpm verify` includes Workerd and
installed-Chrome evidence.

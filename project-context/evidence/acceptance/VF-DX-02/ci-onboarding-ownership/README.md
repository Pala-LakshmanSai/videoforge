# VF-DX-02 CI and onboarding ownership evidence

Status: local technical pass at `$0` on 2026-08-11. Hosted CI is unverified because no push or
workflow dispatch was authorized.

## Result

- GitHub Actions is split into static/contracts/security, TypeScript, Python, Workerd, and branded-
  Chrome jobs plus one fail-closed required aggregate.
- Each execution job publishes timing. Workerd and Chrome emit JUnit plus bounded Playwright
  evidence; only their owning jobs install browser/media prerequisites.
- `pnpm doctor` passed 17 checks. `pnpm doctor --json` emitted deterministic
  `videoforge.doctor/v1`, 11 environment names, no values, fixture mode, provider calls disabled,
  and `$0` authority.
- Owned start/stop/restart passed. A foreign port listener was refused and remained alive. Dead
  stale ownership was refused and retained for explicit recovery. A second stop was idempotent.
- Final forced canonical verification passed in `149.49s` with 713 tests/journeys, Workerd 1/1,
  installed Chrome 38/38, zero failures, and zero skips.

## Commands

- `pnpm ci:static`, `pnpm ci:typescript`, `pnpm ci:python`
- `CI=1 pnpm --filter @videoforge/web test:cloudflare`
- `CI=1 TURBO_FORCE=true pnpm verify`
- `pnpm doctor`, `pnpm doctor --json`, owned/foreign/stale `pnpm dev:stop` scenarios
- `node --test scripts/tests/*.test.mjs`
- `pnpm audit:dependencies`, `pnpm context:validate`, `pnpm secret:scan`
- `pnpm exec prettier --check .`, `git diff --check`

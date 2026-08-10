# VF-1-01 durable relational foundation

Status: technically verified; VF-1-01 complete

Commit `6d0b66fac9fd44537bbfccd789f2023f3bcaf064` completes the first provider-free
durable control-plane foundation. It adds `@videoforge/control-plane`, one committed additive
PostgreSQL migration, query-library-neutral repository contracts, a reusable 13-behavior adapter
contract harness, and PGlite migration/constraint tests. It also makes the repository's Turbo
output declarations truthful and integrates `pnpm db:check` into `pnpm verify`.

The migration inventory is:

- 30 public tables: 29 domain tables plus `videoforge_schema_migrations`;
- 116 indexes, including all 26 required named custom indexes;
- 663 catalog constraints: 194 checks, 75 foreign keys, 304 not-null constraints, 30 primary keys,
  and 60 unique constraints;
- 10 non-internal invariant triggers;
- migration SHA-256
  `sha256:263d2c3853b3ed6809ad3b52acddce19c6849ca8100d229ceb9cb26d3ef3f92e`.

The 16 PGlite tests pass against fresh databases and cover migration idempotency, exact inventory,
workspace isolation, active-name and open-draft uniqueness, terminal active pointers, immutable
published preset payloads, exact locked revision snapshots, task/attempt/cost/outbox idempotency,
monotonic append-only events, nonnegative owner-bound costs, one accepted result with duplicate
attempt visibility, rollback without orphans, archive lineage, and the reusable repository harness.

`TURBO_FORCE=true pnpm verify` passed from zero Turbo cache hits. It included formatting, lint,
typechecking, database checks, all existing unit/contract/worker suites, schema/context validation,
secret scanning, builds, route-tree stability, and installed-Chrome Playwright regression coverage
(34 passed, 8 intentionally skipped). No intentional output-free task emitted Turbo's
"no output files found" warning. The high-severity dependency audit found no known vulnerabilities.

The task used only owned synthetic data in local PGlite. No `DATABASE_URL`, Neon connection,
Cloudflare mutation, credential, provider call, model download, LAN/public listener, or external
spend was used. The accepted UI, fixture API behavior, and local renderer were not changed.

`VF-1-02` is the next dependency in the execution plan, but no exact `tasks/VF-1-02.md` brief is
present. Work therefore stops at this clean handoff until that brief and its authority envelope
exist; no runtime, Cloudflare, or adapter work is inferred from the summary plan.

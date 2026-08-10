# VF-1-01A relational audit hardening

Status: technically verified; VF-1-01A complete

Commits `0afa613708b684a9a933858e77f60730771bef5f` and
`36bf1ae0b66524f8d1c158b301eaa77ebea04a92` close the authorized VF-1-01
adversarial-audit findings without rewriting the committed baseline migration. The additive
`0002_relational_audit_hardening.sql` migration has SHA-256
`sha256:b6824f935b40ff89902ab1f20007e2f7e71dcbf61be59cabf0968aa0fb639ca5`.

The hardening makes migration installation and verification exact: SQL bytes are hashed before
execution, the stored version/name/filename/hash chain must be the exact manifest prefix, DDL is
installed in `public`, invariant functions use fixed schema resolution, and runners serialize with
a transaction-scoped advisory lock. The corrective migration closes lifecycle/boundary,
active-pointer, immutable snapshot, accepted-result, owner, event-ordering, nullable composite-key,
workflow discriminator, tested execution-profile provenance, billed preset linkage, and unresolved
`UNKNOWN` state gaps.

The final migrated inventory is:

- 30 public tables and 120 indexes;
- 699 catalog constraints: 203 checks, 84 foreign keys, 316 not-null constraints, 30 primary keys,
  64 unique constraints, and 2 constraint triggers;
- 17 non-internal invariant triggers;
- both committed migration ledger entries with exact manifest hashes.

The repository surface exports 13 immutable canonical behavior scenarios with no caller-authored
scenario body or skip control. All 13 fixed runner bindings and disposal paths execute. The
workspace-isolation body has full fixture-adapter semantic execution, including a leaking-adapter
negative. The remaining 12 bodies deliberately wait for the first concrete adapter in `VF-1-02`;
claiming those as end-to-end adapter executions now would be tautological. The itemized repository
re-audit closed findings 1–7 and found no new high-priority defect; this concrete-adapter boundary is
the sole intentional non-blocking deferral.

All 49 control-plane tests pass. `TURBO_FORCE=true pnpm verify` passed with zero Turbo cache hits,
including formatting, JavaScript/Python lint, typechecking, database/root/package tests,
context/schema validation, secret scanning, builds, route-tree stability, and installed-Chrome
Playwright coverage (34 passed, 8 intentional compact-project skips). The dependency audit reported
no known high-severity vulnerability, and `git diff --check` passed.

Concurrency-sensitive SQL now carries the required advisory/row locks, and the local PGlite
regressions pass. This evidence does not overstate PGlite as real multi-session PostgreSQL
contention proof; that provider/database integration remains outside this task.

All data was owned and synthetic in local PGlite. No `DATABASE_URL`, Neon connection, Cloudflare
mutation, credential, provider call, model download, LAN/public listener, or external spend was
used. The accepted UI and local rendering behavior were preserved.

`VF-1-02` is dependency-ready in the sequence, but no exact `tasks/VF-1-02.md` brief or new local
authority exists. Work therefore stops at this clean handoff before runtime, adapter, cloud, or
provider work is inferred.

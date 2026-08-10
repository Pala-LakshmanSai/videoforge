# VF-1-08 metadata export and restore smoke

Status: technically verified; VF-1-08 complete

Commit `866a5ddf4bce994f5521e93bf9b5ea8f288d96cf` adds a scheduler-invokable,
provider-free metadata snapshot primitive and a transactional clean-database restore path. The
portable snapshot covers the exact five-entry migration ledger and all 31 relational tables while
keeping private media bytes and secret-shaped fields outside the artifact.

## Deterministic export and restore proof

- Export runs in a repeatable-read, read-only transaction with a fixed UTC/ISO session and requires
  the exact committed table inventory and migration ledger.
- Every row is captured as PostgreSQL `jsonb` text, deterministically ordered by its complete row
  document. Each table has a SHA-256 and the complete canonical snapshot has a SHA-256.
- Two exports of the same source serialize identically. A fresh migrated PGlite database restores
  every table, re-exports to the exact same serialized snapshot, reopens from disk, and resolves the
  same locked revision hash through the canonical repository.
- Circular nullable relationships are restored in a bounded second pass after all rows exist. The
  recovery coordinator then observes the accepted attempt, rejected child attempt, dead-letter
  outbox entry, workflow event, and exact reserved cost from the reopened database.
- Reapplying the exact snapshot is an idempotent resume with zero inserted rows. A different
  non-empty destination fails closed.

## Failure and recovery proof

Truncated JSON, unsupported snapshot versions, an incompatible migration digest, reordered table
entries, altered row bytes, and secret-shaped outbox payloads are rejected with stable error codes
and recovery guidance before any destination data is committed. An injected failure while
inserting project revisions rolls the entire restore transaction back; the unchanged snapshot then
restores successfully on retry. Restore uses ordinary foreign-key-safe insertion and does not
disable triggers or require superuser privileges.

The snapshot checksum is integrity evidence for a locally controlled artifact, not a signature or
an authenticity claim. Production scheduling, encrypted backup storage, cloud backup APIs, and
private media export remain explicitly outside VF-1-08.

## Audit and verification

The post-implementation audit found no network transport, ambient environment read, credential,
provider, cloud-storage, deployment, or spend path in the backup module. The table plan has a
runtime completeness assertion, dynamic values are parameterized, identifiers come only from the
committed schema constants, source export is read-only, and destination changes share one
transaction. No high or medium finding remained.

The final uncached `TURBO_FORCE=true pnpm verify` exited 0 at the implementation commit with zero
Turbo cache hits. It passed formatting, JavaScript/Python lint, typecheck, database and package
tests, 47-file contract synchronization, context/schema validation, tracked-file secret scan,
generated-route/build stability, local Workerd parity (1/1), and installed Chrome (36/36, zero
skips). The control-plane suite passed 116/116, including all four focused export/restore tests; the
pipeline suite passed 37/37 and the web suite passed 148/148.

Separate `pnpm context:validate`, `pnpm secret:scan`, `pnpm audit:dependencies`,
`git diff --check`, and clean-worktree checks passed. The dependency audit reported no known
vulnerabilities. All database state was local and synthetic. Provider calls remained disabled,
external spend was `$0`, and no remote, cloud/account, credential, model-download, deployment,
public-tunnel, or LAN mutation occurred.

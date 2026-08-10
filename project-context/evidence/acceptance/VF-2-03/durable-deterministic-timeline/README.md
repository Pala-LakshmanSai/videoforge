# VF-2-03 durable deterministic timeline

Status: technically verified; VF-2-03 complete

Implementation commit `6359bd2969fc086ad81d845dd10b9937c46e1c5d` persists and resolves the
accepted deterministic scheduler output without changing its composition, phrase-boundary,
avatar-share, layout-alternation, crop/rate, or frame-rounding behavior.

## Deterministic plan and lineage proof

- `scheduler-v1` now exposes one frozen behavior-bearing configuration. Its RFC 8785/JCS hash is
  `sha256:de668ac00cfd22ce85b91917c7a6febe740b586de71803ccf518da89a187ee7d` and
  includes the existing 30 fps, duration, avatar target, alternation/shot-role, seeded scoring, and
  500 ms selected-span context rules.
- The service validates and hashes the exact locked revision and transcript, derives deterministic
  segment/plan/artifact/span identities, schedules once, stores exact canonical `timeline-plan/v1`
  bytes, and atomically binds artifact metadata, plan rows, segment rows, selected spans, and the
  optimistic timing-head advance.
- Persisted lineage binds the exact revision config hash, transcript document hash, scheduler
  version, scheduler config hash, explicit seed, input fingerprint, canonical plan hash, source
  voiceover identity, every segment boundary, and every selected padded span/trim fact.
- Exact retry replays without duplicates. A stale head rolls every metadata write back while
  leaving only harmless unreferenced content-addressed bytes.
- Resolution requires an exact timing-input lookup and independently verifies the artifact object
  key, byte size, binary hash, canonical document hash, UTF-8 JSON, schema, and byte-for-byte JCS
  encoding before returning a plan.

## Coverage, silence, and restore proof

- Additive migration `0007_timeline_phrase_boundary_coverage.sql` has SHA-256
  `03affbba4464fcc02bc6e034353ec9ea9df80d7238496e957e5ea1c78ae98f27`. It corrects the prior
  word-edge-only assumption so leading, inter-phrase, and trailing silence remain part of an exact,
  contiguous source-audio union while segment edges still require canonical phrase boundaries.
- A 40-second transcript with leading, inter-phrase, and trailing silence persisted with exact
  frame/source/word coverage and selected-span ownership, exported through the seven-entry
  migration ledger, restored into a fresh database, and resolved to byte-identical canonical plan
  bytes.
- Short, silent, fast, slow, unpunctuated, and 30-minute fixtures passed under seeds `0`, `982341`,
  and `4294967295`. Every generated plan was byte-identical on replay and covered frames, source
  audio, and words exactly once with legal composition/slot and avatar alternation facts.

## Audit findings closed

The corrective audit closed every reproduced finding before acceptance:

1. Previously implicit behavior constants are now a single immutable, content-hashed scheduler
   configuration.
2. Canonical scheduler output now has one atomic durable persistence service instead of caller-built
   low-level commands.
3. Exact resolution verifies stored canonical bytes rather than trusting relational identity alone.
4. Source coverage now admits legal silence only through exact phrase/source boundaries; the
   historical word-edge mismatch is repaired additively without rewriting prior migrations.
5. Stale-head, input-drift, corrupted-object, migration-upgrade, idempotent replay, and restore
   paths fail closed or converge without orphan accepted metadata.
6. All six required timing-shape fixture classes, including the 30-minute boundary, execute as
   deterministic property coverage without retuning the accepted scheduler grammar.

No high or medium audit finding remains. Source inspection found no cloud, remote/account mutation,
credential access, provider call, model download, deployment, or spend path.

## Verification

The final `TURBO_FORCE=true pnpm verify` exited 0 on implementation commit
`6359bd2969fc086ad81d845dd10b9937c46e1c5d`, with zero Turbo cache hits. It passed formatting,
JavaScript/Python lint, TypeScript checks, database and migration suites, generated parity,
context/schema validation, tracked-file secret scan, stable generated routes, local Workerd parity,
and installed Chrome.

- Control plane: 131 passed, 0 failed, 0 skipped.
- Pipeline: 39 passed, 0 failed, 0 skipped.
- Web unit/integration: 148 passed, 0 failed, 0 skipped.
- Canonical contracts: TypeScript 53 passed; Python 42 passed.
- Python workers: 56 passed across six explicit suites.
- Local Workerd: 1 passed.
- Installed Chrome: 36 passed, zero skips.
- Synchronized canonical files: 50.

The required read-only dependency registry audit reported no known vulnerabilities. Secret scan and
diff check passed. No remote/cloud/account mutation, credential operation, provider call, model
download, publication, or external spend occurred.

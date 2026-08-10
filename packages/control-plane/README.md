# `@videoforge/control-plane`

Provider-free durable-control-plane contracts for VideoForge.

This package owns the additive PostgreSQL migration chain, relational vocabulary, migration
executor boundary, and domain-oriented repository contracts. PGlite is used only by local and CI
contract tests. It is not a production database adapter, a Neon connection, or recovery proof.

The first migration implements `DEC_DB_001` and `DEC_QUEUE_001`: Postgres is authoritative while
external queues remain execution transports. Migrations are append-only; consumers apply the
committed SQL in manifest order and reject checksum drift.

# Canonical prompt plan binding and safe manual Retry — 7 October 2026

Checkpoint V2-09 / VF-10-09. Baseline context3d6fd1f8,
executable4b2c9f7d / Workerc10de8bb / native286. Worktree
`codex/prompt-plan-binding` preserves unrelated current-pricing work.

## Cause and exact evidence

The screenshot's gardening project completed ASR, context and deterministic planning:
41 timeline segments,35 image scenes,11 avatar spans and four prompt batches.
The prompt run failed in231ms, with zero durable provider claims, zero reported
prompt cost and `provider_may_have_charged=false`. Its ASR rental is CLEAN.

Preparation's plan document included `literal_character_limits`; the dispatcher's
separate document omitted them. The integrity check therefore rejected a valid
immutable plan before its first claim or provider POST. Exact original replay shows:

- Saved/preparation hash: `sha256:dff23c07fa5cdbbbb0d85d207603b72fabfb3581933eda150d2ad605a8522a6d`.
- Old dispatch hash: `sha256:3d7a724c7192b54bdd91cd41d8bf202666dd126920e0cf43b946e021be299c0f`.
- Fixed dispatch hash matches the saved hash; exact input hash and immutable v39 policy recover.

Earlier qualification constructed persisted bindings using the dispatcher's own
hasher, so it missed the production preparation boundary. The regression now hashes
the actual preparation document before actual dispatch and recovery, including the
152-scene full-stage test. No upstream context/planner contract mismatch was found.

## Repair and prevention

One exported serializer now owns preparation, dispatch and recovery. Legacy/v38
fixed hashes remain unchanged. Modified scene budgets still fail before a claim.

Ordinary retries excluded `HOSTED_PROMPT_INPUT_INVALID`, so fixing serialization
alone would leave this run stranded. Explicit authenticated Retry now reconstructs
and verifies the original input/plan before passing its immutable proof to native
preparation. Additive287 repeats zero-claim/receipt/accepted-progress/cost checks,
fully released reservation and current generation/tenant/revision checks under
cancellation-compatible locks. It reuses existing bounded fresh-attempt/reservation
accounting. It does not admit this error into automatic continuation or replay
unknown/charged work. Duplicate clicks cannot consume the old evidence twice.

## Qualification

96 focused Web tests pass, including5 actual Retry-route integration cases and
legacy, budget-tamper, saved recovery and full-stage dispatch. Native test chain
passes12 tests; one existing real-Postgres concurrency test is skipped. Native287
covers mismatched proof, claims/receipts/progress/cost, missing release, cancelled/
cancelling owners, bounded retries, original ledger preservation and repeat-click
rejection. Web/Worker types, touched lint/format, both builds, bundle firewall,
context validation and secret scan pass. Independent review finds zero remaining
correctness findings.

The real original database passes APPLY287+prepare in a rollback-only transaction:
preparation returns created=true for the exact original run; rollback restores
its complete original row and native286. A separate migration rollback rehearsal
preserves all checked prompt/profile/request row fingerprints, historical journal,
forced RLS and existing function permissions. Neither rehearsal sends a provider
request or commits project changes.

Canonical aggregate remains non-green on117 formatting files and Python lint;
these are classified baseline debt. No full-film, provider availability, generated
image quality, editorial or invoice acceptance is implied by provider-free checks.

Private proofs live under primary checkout `.videoforge/prompt-plan-binding-20261007/`:
`original-runs-private.json`, `original-plan-private.json`, `original-red-private.json`,
`original-green-private.json`, `native-original-rollback-private.json`,
`native-release-dryrun-private.json`, `runtime-baseline-private.json` and release
write-ahead intents/readbacks. Private source/identity rows remain outside Git.

## Release gate

Publish only the qualified source with additive287, preserving all55 bindings,
27 secret names, three Workflow identities and qualified Cloud/Desktop0.1.52 pins.
Register the changed server code. The sole active admission is this exact failed,
zero-claim project; it has no executing provider/CPU work and its ASR rental is CLEAN.
Adopt the existing sleeping coordinator only after proving this identity, zero DUE
work and unchanged historical liabilities. Never create a replacement instance or
restart project media. Worker rollback is the retained c10de8bb version; additive287
keeps old rows and remains harmless with predecessor code.

New inference/media/compute spend isUSD0 at qualification. Production traffic,
asset hashes, native readback, coordinator adoption, real Chrome and any separately
approved original-project paid completion remain delivery gates until recorded.

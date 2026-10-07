# V2-09 prompt-stage and pipeline reliability follow-up

User authority, 2026-10-07: audit the entire image-prompt stage and pipeline, use multiple
Luna workers, fix actual causes, preserve functionality, and publish qualified changes.

## Baseline and scope

Managed branch `codex/gpt6-luna-prompt-writer`, baseline `cee3bca5ca9f98143c464daa22a10b9eb1b0658a`.
Production executable `eae84263703aa8900bf3aeca466bc90d53d03612`, Worker
`aa60628f-571d-4503-bef1-7ab31a314bc1`, schema283, Runware `openai:gpt@6-luna`, requestv38.
Preserve sealed historical requests, accepted prefixes, tenant fences, provider identity,
cost ceilings and UNKNOWN no-replay behavior. Preserve unrelated primary-checkout edits.

The existing 152-scene qualification has mixed provenance. It proves reviewed prompt outputs
and compiler/Kie acceptance, not a fresh uninterrupted full stage or a full film.

## Audit findings and ownership

- Root: bounded idempotent persistence of a known response after transient database failures;
  release coordination, context and acceptance evidence.
- Luna native worker: additive migration serializing prompt claims with project cancellation;
  native negative/race tests. Cancellation must not discard an in-flight paid request.
- Luna contract worker: request/validation/budget audit and fresh provider-free prompt lifecycle proof.
- Luna CI worker: reproduce stale fixture/Chrome expectations and infrastructure faults, then fix
  only verified mismatches without weakening production contracts or broad formatting.

## Verified findings and current checks

The consumed v38 final batch contained a source-grounded 174-character scene whose actual Kie
prompt would be 777/800 characters. The shared hard cap was 168, so six excess characters caused
an unnecessary correction. Fresh policy `runware-luna-grounded-v2`, sealed requestv39/profile9,
will carry per-scene budgets derived from the actual pinned compiler/role/layout. Policyv1/v38
must remain frozen and recoverable; never broaden a whole batch to its most permissive scene.

Known-response persistence now retries only the exact idempotent database receipt, at most three
attempts with 250/500ms waits, including Neon/pg disconnect errors and a lost COMMIT reply.
Permanent validation/tenant failures stop immediately. Integrated route/transport tests:29 pass,
including SQLSTATE40003 lost-COMMIT recovery. Each persistence-failure case requires one provider
POST and zero provider replay.

Additive migration0284 serializes initial, next and corrective claims with owner cancellation on
the generation request before the prompt run. PGlite sequential cases: 2 pass. Native PostgreSQL
two-connection contention: 1 test passes both transaction winners; each losing operation blocks
then refuses safely. Disposable test databases are dropped; production application is recorded separately below.
Migration SHA-256 `5e18e230202d9d22f5a364fc14f635f8b8a9dccb0e7a54fb5a2927799b66e085`.

Migration0285 profile9/v2 compatibility passes PGlite and disposable native PostgreSQL. Old
profile8/v1 remains pinned and rejects v2 redispatch. Exact scene budgets are derived and enforced
by the trusted compiler/runtime; native claims seal exact request bytes/hash, rather than duplicate
compiler logic. Existing capability ACLs are retained; no new grants or schema objects.
Focused downstream Web checks:49 pass. Pipeline tests:323 pass. Control-plane build/typecheck,
current production Worker build and bundle quarantine, active-runtime firewall, context validation
and tracked-file secret scan pass. Final frozen checks:121 prompt/recovery tests,324 pipeline tests,
all21 package build/lint/typecheck tasks, and44 installed-Chrome desktop/compact journeys pass.
These focused results do not replace the open canonical gate.

An actual production progress read reproduced nine HTTP500s from Worker aa606 with
`permission denied for table execution_profiles`. Migration0286 grants only `id` and `revision`
to the runtime and reconciler; configuration/account columns and table-level SELECT remain
denied. Forced account RLS is retained, with own/foreign-tenant tests passing on PGlite and
native PostgreSQL. Migration SHA-256
`2769934a3536a5f8ec0ed4890203b146db42ef968546f92a0ef102912343425d`.

Production native migrations284–286 were applied after a rollback-only dry-run and fresh idle
preflight. All existing profile/run/claim/checkpoint/request row hashes, historical journal rows,
capability ACLs and forced RLS were preserved. Native head286 is live; the existing Worker remains
v38. The same actual production progress page now loads its completed project, and its existing
final movie plays and accepts a native scrubber seek in Brave. This is an existing-film check,
not fresh v39 media qualification. Private preimage/commit and Worker-error proofs are retained
under `.videoforge/prompt-pipeline-20261007/` in the primary checkout.

Read-only production preflight, 2026-10-07 02:05 UTC: schema283, Worker aa606 at100%, existing
continuation driver0c4 RUNNING, no active generation requests or live prompt claims. RunPod
complete inventory contained zero Pods; the historical STOPPING/UNKNOWN row remains unresolved.
Runware available credit USD10.41507. Current eligible GPU: NVIDIA RTX PRO 4500 Blackwell Server
Edition, LOW availability, USD0.72/hour plus 100GB ephemeral disk: USD0.7338888889/hour all-in.
This is a timestamped offering, not a reservation. No retained volume is proposed.

Canonical `pnpm verify` was executed and stopped at its static phase: baseline formatting and
Python lint failures remain. This is not a green canonical release gate. Current worker checks:
media-local120 (one intentional skip), avatar-fixture17, transcribe41 and span-audio14 pass.
Image-media184 has one immutable Mage publication-pin mismatch; avatar-primary55 has three
SoulX publication-pin mismatches. Current source candidates differ from the published image
contracts; changing those historical hashes would not publish or qualify a new image. Preserve
the immutable evidence and keep candidate qualification separate.

Earlier installed-Chrome diagnostic run:42/44 pass, with two empty-body HTTP500 responses.
Server stdout was not retained, so source-edit timing does not establish their cause. The final
frozen-source repeat with retained server stdout passes44/44, including cross-tenant download404.
This repeat closes the browser gate without inventing a cause for the earlier diagnostic failures.

## Acceptance and stop conditions

Trace before editing. Add regression checks for cancellation winning before claim, claim winning
before cancellation, transient/lost-COMMIT receipt persistence, partial invalid output, known safe
capacity retry, UNKNOWN no replay, reload recovery, tenant isolation, and next-stage handoff.
Run focused checks, canonical provider-free verification, and actual Chrome acceptance. Treat
synthetic fault proof, live prompt qualification, full-film/editorial proof and provider billing
as separate gates. Publish only qualified source and verify Workflow registration/runtime adoption.

Fresh v39 dry-run:152 scenes,16 batches, at most32 paid POSTs (one initial and at most one targeted
correction per batch), conservative wire/token bound USD0.319488. A new qualification proposal
is capped at USD0.35 within the historical USD6 total; it has not been approved or executed yet.
Old v34 remains unresolved and must not be replayed. The live harness requires a fresh authority,
append-only request intents and saved raw/normalized receipts before validation, and stops the
entire run on UNKNOWN, invalid corrected output or cap risk.

Full-film preflight remains separate: the revoked installed worker is0.1.45, not pinned0.1.52,
and has no usable local configuration. A44.6s offline plan gives9 images,3 avatar spans (9.67s),
and one6s video clip, but the configured API estimates are not a combined hard dollar fence.
DEC_COST_001 intentionally leaves ordinary project spend uncapped, and DEC_CLOUD_BILLING_001 uses ongoing Cloud pay-per-use. These decisions do not authorize unbounded operator release tests. Cloud caps are per rental; a separate finite operator media proposal and fresh full-film proof remain open.

No new paid call or compute launch has occurred in this follow-up. Prior USD6 prompt-test cap has
USD3.099707 conservative liability-inclusive usage; earlier one-POST authorities are consumed.
Never replay unresolved v34 HTTP524. Complete safe work and read-only preflight before presenting
one exact finite cap for any fresh live prompt/media/compute qualification. Existing historical
STOPPING/UNKNOWN Cloud cleanup and liability remain unresolved; do not claim zero active rentals
without current provider evidence. External outages and unknown paid outcomes remain explicit
manual-attention stops; "flawless" is not a guarantee that external services cannot fail.

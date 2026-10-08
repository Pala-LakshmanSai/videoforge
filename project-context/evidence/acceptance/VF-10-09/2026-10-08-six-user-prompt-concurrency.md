# V2-09 / VF-10-09: six simultaneous prompt stages

Status: PASS. Six isolated tenant/project runs completed using the production prompt handler, native PostgreSQL persistence and live Runware Luna. Executable `e9c8146730bc6f5bb58957741df640fbb0f5eb83` remains deployed on Worker `2e14f1a4-3f6c-4c76-bda5-1835f376c67d` at100%, native298. This qualification found no new product defect requiring a runtime change.

## Authority and boundary

User approved a fresh USD3 combined cap for six different users generating only this stage simultaneously, each input at most120 seconds. Used six synthetic accounts/projects with108-second narration inputs and18 scenes each. Existing videos were not resumed or mutated. No TTS, ASR, images, video, inspection, render or GPU work was executed.

The isolated database contains exact repository migrations through298 and explicit production runtime-role permissions. The unchanged shared `writeProjectPrompts` handler runs with six tenant scopes, independent PostgreSQL connections, transaction-local account identity and real row-level security. Only the Neon wire driver is replaced with local PostgreSQL; the production transaction executor, planner, provider transport, claim/receipt/save/finalization functions and compiler remain unchanged. The existing downstream handoff is omitted at the test boundary. Prepared synthetic timing/context documents are inputs, not generated stages.

This proves the isolated production-code prompt stage, not six browser logins or six full production films. Fresh production source/configuration readback binds the test to the currently deployed executable.

## Live result

| Check | Result |
| --- | --- |
| Independent tenants/projects | 6 / 6 |
| Input duration | 108 seconds each |
| Accepted prompts | 108 / 108;18 per project |
| Requests and succeeded native receipts | 12 / 12;2 batches per project |
| Maximum simultaneous users requesting Luna | 6 through one key |
| First-wave dispatch spread / six-way overlap | 17ms /10.126 seconds |
| Second-wave dispatch spread / six-way overlap | 519ms /9.809 seconds |
| HTTP results | All12 returned200 |
| Corrective or replay POSTs | 0 |
| Cross-tenant receipt/scene negative checks | 12 passed |
| Saved compiler-v7 prompts passed to Kie adapter locally | 108; maximum691 characters |
| Native cost accounting | Six independently balanced reserved/settled/released totals |
| Estimated new prompt spend | USD0.015454 of USD3; pinned rates, not invoice reconciliation |
| Unknown liabilities / active requests at completion | 0 / 0 |
| Downstream execution delta | 0 |

Actual provider request interval:2026-10-08T01:44:51.253Z–01:45:45.902Z. A first-wave barrier starts all six provider requests together; durable start/end events measure real network overlap. The second wave also independently overlaps across all six users. A task-wide exclusive launch record prevents a restart from obtaining another USD3 budget;12 POSTs at a conservative USD0.25 maximum each bound the whole qualification. Native receipt readback settles each reservation, preserving raw provider responses and exact wire/request hashes.

## Regression and production checks

- New `apps/web/src/server/hosted/hosted-prompt-concurrency.test.ts` checks six reverse-completing outputs with colliding scene IDs, duplicate claims, exact receipt/cost binding, foreign receipt rejection and unknown-response recovery without another POST.
- Full isolated native rehearsal completed108 prompts. While all six responses were held in flight, a duplicate route call returned202 and made no additional POST. Completed-run replay also made zero POSTs. All108 saved prompts compiled successfully; downstream state stayed unchanged.
- Focused prompt/transport/compiler suite:103 passed. Real PostgreSQL concurrent claim/cancellation regression:1 passed, no skip. Web TypeScript, changed-file lint/format and context validation passed. Runtime source is unchanged from the earlier full341-pipeline/3356-web qualification; those results are retained rather than presented as newly rerun.
- Fresh production readback passed12 checks: executable/bindinge9c81467, Worker2e14f1a4 at100%, coordinator46133fd0 running, native298, freshv43/profile13, CPU300000 and unchanged bindings. Luna application policy has no configured inflight ceiling or start delay. The live six-way test supplies actual provider acceptance evidence beyond that configuration.
- Reconciled stale current documentation with existing `DEC_QUEUE_003`: one workload per account, no cross-account admission ceiling. Provider-specific capacity and cooldown safeguards remain. No runtime admission change was needed.

The first synthetic rehearsal bypassed upstream context validation and repeated a fact in two categories. Both auditors verified real upstream context extraction rejects that shape before persistence. The fixture was corrected; no product behavior was changed to accommodate invalid test data.

Private receipts, native rows, source/bundle hashes and overlap events are retained under `.videoforge/prompt-six-concurrency-20261008/live_1791423882686/`. The separate fixture result is `fixture_1791423820673/`. No private identities, keys or raw responses are published here.

## Completion

The deployed fix passed the requested six-user load. Regression coverage and this evidence are the new repository changes; no executable, migration, Workflow registration or existing project was changed. The disposable local PostgreSQL process is shut down after proof capture. This bounded test does not guarantee external-provider availability or establish full-film throughput.

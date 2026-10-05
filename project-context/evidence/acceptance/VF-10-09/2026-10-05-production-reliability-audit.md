# Production reliability audit — 5 October 2026

Checkpoint **V2-09 / VF-10-09**. The audit reproduced and repaired two silent handoff gaps in the current Kie/Fal production path, verified the actual native runtime permission, and published the repair. This is a completed audit with named open gates, **not an all-green repository or zero-delay guarantee**.

Executable source: `332b7092ee45f6e5379cec7099c29c6ae85c5c09`, branch `codex/production-reliability-audit`. Production Worker: `37d37bb8-d0df-44f7-a679-fce8171a8651`, 100% traffic. Native migration **274**. Desktop **0.1.51** and qualified Cloud image `sha256:5aa154074f980361c1f5d769723fc030639b770513471e55c3fc59afeffd5f62` remain pinned. The primary checkout's unrelated changes were preserved.

## Confirmed findings and repairs

| Finding | Exact trigger and effect | Repair and prevention |
|---|---|---|
| Scene clips can remain PREPARED indefinitely | Images/avatar API jobs succeed, but the coordinator stops before the first scene-video submission. The continuation due query omitted this state. | Extend the shared due query to dispatch the existing Workflow for saved PREPARED video jobs. Regression fails on the old query and passes on the repair. Original database claims retain submission authority. |
| Accepted media can stop before rendering | Runtime is RENDERING and all media is ready, but the coordinator stops before creating a RENDER attempt. The sweep omitted this handoff. | Use the existing native readiness function and require no RENDER attempt of **any** state. Dispatch the existing Workflow. Do not replay a failed, running, cancelled or completed render attempt. |
| Runtime cannot directly execute readiness helper | A rehearsal showed the new sweep predicate would fail under the deployed runtime role, although owner-side checks passed. | Add migration274's single scoped EXECUTE grant. Function body remains exact; foreign-account readiness returns false; direct writes and operator recovery remain denied. Test both the full migration chain and actual deployed credential. |
| HTTP deployment alone leaves old Workflow registrations | Worker versions upload/deploy does not publish the separate Workflow registrations. The durable observer still reported the older Workflow version. | Run the official trigger publication once with exact existing routes/domain/cron configuration. Verify all three Workflow identities. Restart only the idle `hosted-continuation-driver`, preserving its original parameters; verify its new registered version and successful tick. Add this release check to the implementation playbook. No generation or provider Workflow was restarted. |
| Hono security advisory | Dependency audit reported an advisory on the installed Hono version. | Update the existing dependency from4.13.5 to4.13.7; lockfile and application checks pass. Production dependency audit reports no known vulnerabilities at this check time. |

Shared recovery guards exclude archived/terminal/cancelled work, failed prerequisite CPU stages, uncertain API work and existing render attempts from the new handoff arm. Existing submitted-task observation remains intact. No new coordinator, retry policy, model, quality downgrade or dependency was introduced. Opening footage, avatar composition/toggle, coverage distribution, immutable saved prompts and hard-cut/no-graphics grammar remain unchanged.

Verification fixtures were also repaired where they had drifted: the Queue script-project schema, relocated Queue filter assertion, exact historic migration239 scope, full-catalogue test timeout, additive SELECT allowlist, current bundle-size expectations, and obsolete Chrome empty-Queue copy. Frozen historical activation/image identities were not rewritten to hide failures.

## Coverage of the application

| Surface | Checks and current result |
|---|---|
| Authentication, private tenants and presets | Broad web/control-plane tests; fixture two-account workflow and foreign404; live private catalog and ten navigation surfaces. Anonymous private catalog401. No cross-tenant exposure found by these checks. |
| Create/upload/script/voiceover | Web and control-plane coverage; J1TTS single-UUID observation, persisted script state and recoverable context paths traced. No pending native script run. Live opening Off hides minutes; Avatar Off hides selector and requirement; Cloud reports ready. |
| ASR/context/planning/prompts | Pipeline, contract and worker suites; exact accepted-plan lineage and native prerequisite checks. Successful stages are preserved, unknown paid outcomes are not replayed. |
| Images, scene videos and avatars | Shared provider claims, account-pool pacing, observe/accept/receipt flow and coordinator recovery reviewed. Both newly reproduced handoff gaps are covered. Existing natural camera policy is preserved. |
| Local and Cloud CPU handoff/render | Control-plane, media-worker, actual runtime-role SQL, Workerd and compact real Chrome fixture journey pass on current changed paths. No active native generation, held lease or provider waiter. Local production device is offline; fresh installed-device production is not qualified by this audit. |
| Composition and final artifact | Pipeline284 tests, media119 tests, exact retained MP4 download200/attachment/hash/10,953,398bytes; real production Chrome full20.333008s playback ends without media error at1920×1080. Reused accepted output, not a fresh paid render. |
| Queue, cancel, retry and cleanup | Durable workload/claim/lease guards and control-plane734 tests; no occupied provider slot or unfinished multipart upload in inventory. Historical uncertain cleanup liability preserved rather than retried. |
| Background driver/deployment | Native274 actual runtime query across9 accounts due0; new Worker minute cron observed `outcome=ok`, no exceptions; fresh observer version `fd1c81e7-6e60-40f7-a9c8-30e377a30319` RUNNING, successful continuation tick, error-null. |
| Dependencies, contracts, types and packaging | Production dependency audit clean;123 canonical contract files synced; all12 type and12 package lint tasks and root lint pass; both builds/quarantine and isolated Workerd pass. Full dev dependency audit retains one high advisory below. |

## Verification counts

These are final suite outcomes, not a sum of duplicated reruns. Focused subsets overlap broad suites.

| Check | Result |
|---|---|
| Control plane |734 pass,0 fail,12 skipped;746 total |
| Web |3031 pass,8 fail,1 skipped;3040 total;203/205 files pass |
| Pipeline |284 pass |
| Contracts |TypeScript115 pass; Python97 pass |
| Media worker |119 pass,1 skipped |
| Transcription / audio spans / avatar fixture |39 /14 /17 pass |
| Historical image worker |183 pass,1 fail |
| Historical primary avatar worker |52 pass,3 fail |
| Scripts |548 pass,27 fail,1 skipped;576 total |
| Broad Chrome fixture suite |25 pass,19 fail;44 total |
| Isolated repaired Chrome runtime journey |PASS; two private accounts, preparation→worker wait→render→complete, empty Queue, foreign404, exact private MP4 and decoding/time advance;20.7s |
| Changed recovery/workflow suites |52 pass across6 files; separate changed web40 pass across4 files |
| SQL migration checks / script guards |2 /21 pass |
| Workerd |1 pass in isolated run |

Canonical `pnpm verify` remains **red**:130 inherited format violations, absent owned managed-uv path, and an initial occupied Workerd port. Independent package/worker checks cover surfaces hidden by that early exit. The port collision was corrected by stopping only the owned fixture, and Workerd then passed. Running Workerd while broad Chrome still owned the shared fixture also contaminated one Chrome artifact; an isolated final Chrome runtime journey passed after fixing stale copy. The complete44-test Chrome suite was not rerun after that repair.

Remaining web failures are one frozen Attempt85 activation pin and seven historical RunPod bridge fixtures. Historical worker failures concern immutable image/SoulX build hashes and source fixtures. Script failures include retired qualification modules/assets, manifest/lineage fixtures and five unavailable native-Docker tests. Broad Chrome failures include stale copy, navigation/viewport counts, selectors/state assumptions and the isolated artifact contention. These are unresolved qualification/test debt, not proof that every failed check is harmless or that full CI is green.

## Remaining production limits and follow-up gates

1. **Provider latency, credits and quotas:** current Runware read-only preflight reportedUSD8.06519 againstUSD0.25 floor at08:05:44UTC. Kie/Fal/J1 current credits and external endpoint quotas were not verified. Queueing, outages, inference time, unknown submissions and insufficient funding can still delay or stop work. Recovery cannot safely turn an uncertain paid request into a duplicate request.
2. **Local execution:** the configured Windows device0.1.45 is offline. Local work requires a connected compatible device. Desktop0.1.51 publication remains available; fresh installed-device acceptance was not performed here.
3. **Capacity and long-form timing:** provider/database admission controls were inspected, not load-qualified. One J1 lane paces at60s; Fal/Runware video slots are bounded. No fresh paid full-film, concurrent long-form or daily-throughput benchmark was run. Existing bounded/retained artifact evidence does not prove those limits.
4. **Verification debt:** canonical format/tooling, historical pins, missing native Docker/protected qualification fixtures and broad Chrome failures remain. These block an automatic all-green release claim and should be handled as separate micro-checkpoints, preserving immutable evidence.
5. **Dev dependency advisory:** `braces<=3.0.3` retains a high deeply-nested-pattern stack-exhaustion advisory in dev/build transitive dependencies; advertised patched3.0.4 was unavailable from the configured registry during the audit. Do not invent a lockfile artifact or add an unverified override. Track and update when an installable verified patch exists. Production-only audit is clean. [Advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
6. **Historical liability:** one2026-09-30 Cloud cleanup ledger remains STOPPING/UNKNOWN with no Pod identity; exact uncertainty is retained. Fresh work is isolated from this historical record. Complete live RunPod inventory shows zero Pods, but this does not settle the old invoice/debit.
7. **Editorial and browser limits:** automatic universal realism/defect-free AI output is not proven. Native Chrome download-history inspection was policy blocked; the application download response/hash and live playback are independently verified. No browser security bypass was attempted.

No additional production-halt defect was reproduced on the audited current path. That conclusion applies to the evidence above, not every future input or external failure.

## Publication, rollback and spend

Source/Worker100%/native274,55 bindings,27 secrets and three stable Workflow identities verified. Thirty public payload hashes match the owned build; anonymous catalog401. Trigger publication preserved routes, custom domains, cron schedules and Worker traffic; a returned domain-array reorder required semantic readback, not a repeated mutation. Driver refresh occurred only after fresh native active generations/leases/waiters all0. Final observer matches the new registration; its early queued receipt was reconciled read-only to RUNNING. The new Worker's cron was observed independently. [Official trigger-publication behavior](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/), [Workflow restart behavior](https://developers.cloudflare.com/workflows/build/trigger-workflows/).

Rollback: Worker `6e60d1c0-c8a3-49d8-8d8a-b101e94b5c9d` / source `a5ff97e7d1e5b02f346ddb297f58a3eda421ab57`. Publish matching Workflow registrations when rolling back. The additive readiness read grant is compatible with that Worker; do not delete migration history. Any later revocation requires a compensating migration after the older Worker is active. Never restart generation/provider Workflows or rewrite accepted media to perform rollback.

**New paid projects0, provider inference0, rentals0, model downloads0; no paid replay.** Complete RunPod inventory at08:23:56UTC shows0 Pods. Native active workload leases/waiters/generations are0. Existing services/storage may retain normal billing; this audit does not claim an invoice total or zero account charges. Private original logs and credentials remain outside Git under `.videoforge/production-reliability-audit-20261005`; the adjacent JSON contains safe proof and log hashes.

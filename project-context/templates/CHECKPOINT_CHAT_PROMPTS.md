# VideoForge v2 checkpoint chat prompts

Use exactly one implementation prompt at a time and complete checkpoints in order. After its
handoff, use the paired audit prompt in a separate read-only chat. Do not paste the whole file.

Every prompt assumes `/Users/lakshmansai/Documents/videoforge`. A checkpoint request authorizes only
the operations stated in that prompt. Historical provider approval, spend caps, credentials, and
resources grant no authority. External checkpoints always finish provider-free work first and stop
once for one exact combined proposal before mutation or spend; the user supplies the numeric maximum
cumulative finite spend.

## V2-00 implementation — architecture and roadmap reset

```text
Work on VideoForge checkpoint V2-00 only: architecture, reference, and roadmap reset.

Use concise, factual updates. Read AGENTS.md, project-context/00_START_HERE.md, MANIFEST.yaml, CURRENT_STATE.yaml, only the selected read profile/task brief, and V2-00 in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md. If the narrow V2-00 brief/profile is missing, create, select, and validate it first. Audit current HEAD before editing; preserve completed code, migrations, evidence, model artifacts, and accepted outputs.

This authorizes local context/planning changes only. Do not access credentials, call providers, mutate remote resources, publish, deploy, download models, allocate workers, or spend: $0.

Replace every active roadmap and reusable checkpoint prompt with the V2-00 through V2-13 sequence. Reconcile the active decisions, architecture, queue, storage, model/provider, cost, testing, gates, and current-state selectors around: tenant-private data; one active video/account; two different accounts active globally; fair durable admission; two queue-based RunPod Serverless endpoints in EU-RO-1; existing separate sealed Mage and SoulX 50 GB volumes at /runpod-volume; workersMin=0; private R2 artifacts; job-local scratch; no ordinary GPU/Pod controls; preserved UI, transcript, scheduler, renderer, and Ranga grammar.

Mark old global-session, manual-Pod, Pod-bound authority, cross-user catalogs, Echo, Auto/fallback/repair, and historical Serverless paths as superseded or replay-only without deleting history. Pin official Serverless semantics: no exactly-once promise, at-most-one accepted canonical output, observable duplicate-compute/cost risk, durable outbox plus /status reconciliation before the 30-minute async-result expiry, measured TTL/execution/init timeouts, and no routine queue purge.

Run context/schema validators, contradiction scans, focused doc checks, and git diff --check. Update CURRENT_STATE truthfully, record $0/no-provider/no-worker state, make one bounded green commit, and hand off exact commands/exits, commit, remaining gates, and next checkpoint. Do not implement V2-01 application code.
```

## V2-00 independent audit

```text
Independently audit VideoForge V2-00 at current HEAD. Read AGENTS.md, the three startup files, the exact selected brief/profile, V2-00 in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md, the diff, and handoff evidence. Read-only only: do not edit, commit, access credentials, call providers, mutate resources, or spend.

Verify all active planning sources agree on V2-00 through V2-13, tenant privacy, per-account=1/global=2 fair admission, two scale-to-zero Serverless lanes, existing isolated volumes, private artifacts/scratch, preserved foundations/UI/Ranga rules, and correct non-exactly-once RunPod handling. Search for contradictory active global-session, manual-Pod, Echo, GPU-selector, cross-tenant, /workspace, fallback, or old-checkpoint instructions; historical evidence may remain only when clearly non-operative.

Return PASS or FAIL, evidence-backed P0/P1/P2 findings with file:line references, commands/exits, unproven claims, CURRENT_STATE truth, provider/spend/worker truth, and whether V2-01 is safe. Do not repair anything; missing proof is FAIL.
```

## V2-01 implementation — tenant-private identity and data

```text
Work on VideoForge checkpoint V2-01 only: tenant-private identity and data cutover.

Use concise, factual updates. Read mandatory startup context, CURRENT_STATE's selected brief/profile, and V2-01 in the authoritative checkpoint file. Create/select a missing narrow brief/profile and validate it. Verify the committed V2-00 audit is green; stop on dependency or context conflict.

This authorizes bounded local application, schema, test, and context changes only. No credentials, providers, cloud mutation, deployment, model work, GPU/workers, or spend: $0.

Implement additive account_id/workspace_id ownership for projects, revisions, assets, Avatar Profiles/versions, Image Styles/versions, queue/jobs, attempts, outputs, costs, approvals, and audits. Backfill historical data into an explicit inaccessible legacy/system scope. Require a trusted server principal for every repository/API operation; a client-supplied owner never grants access. Enforce database constraints plus query/RLS-equivalent guards. Bind each invite-only identity to one account/default workspace. User-created hubs and results are private; only explicit immutable built-ins are globally readable.

Preserve current UI geometry while making libraries, searches, routes, settings, costs, and status tenant-scoped. Prove fresh/upgrade/restore migrations and a two-account adversarial matrix for read/write/update/delete/search, guessed IDs, hashes/existence, stale sessions, signed-URL requests, audit reads, and built-in visibility. Run focused tests, canonical verification, secret scan, context/schema validators, git diff --check, and installed-Chrome two-account isolation.

Update evidence/gates/CURRENT_STATE, state exact provider/spend/worker truth, commit one green checkpoint, and stop before V2-02.
```

## V2-01 independent audit

```text
Independently audit VideoForge V2-01 at current HEAD. Read mandatory context, selected brief/profile, V2-01 acceptance, diff/migrations, and evidence. Read-only: no edits, credentials, provider calls, cloud mutation, or spend.

Verify V2-00 is green; all user-created records and every repository/API/query path require trusted account/workspace scope; historical rows are not exposed; built-ins alone are global; migrations work fresh/upgrade/restore; and cross-tenant metadata, existence, cost, status, output, preset, audit, and signed-URL access fail. Inspect actual tests and installed-Chrome isolation proof rather than accepting summaries.

Return PASS/FAIL, P0/P1/P2 findings with exact references, commands/exits, missing proof, CURRENT_STATE/provider/spend/worker truth, and whether V2-02 is safe. Do not fix findings.
```

## V2-02 implementation — private artifacts, R2 ports, and scratch

```text
Work on VideoForge checkpoint V2-02 only: tenant-private artifacts, R2 port contracts, and scratch isolation.

Read mandatory context, the selected narrow profile/brief, and V2-02 acceptance. Verify V2-01 is committed and independently green. If selectors are missing, create/select/validate them before editing.

This authorizes provider-free local application/worker/schema/context work only. No credentials, real R2/cloud/provider calls, deployment, worker allocation, model/volume mutation, or spend: $0.

Add additive v3 artifact contracts and persistence. Derive immutable object keys from trusted account/workspace/project/revision/lane/job/artifact identity; never accept a raw client key. Implement short-lived method/path/content-type/content-length/checksum scoped upload/download ports, single-use or bounded replay policy, durable commit receipts, expiry, retention, deletion ownership, and hash/probe metadata. Prevent enumeration and cross-tenant copy/move/dedup disclosure.

Define worker inputs as scoped ports only. Keep both model volumes read-only at /runpod-volume. Route mutable caches and outputs to job-keyed local scratch; deny symlink/path traversal/cross-mount access; erase scratch on success, failure, cancel, timeout, signal, and refresh. Add fake-R2 and filesystem adversarial tests for forged keys, URL replay/expiry, length/hash mismatch, partial upload, stale receipt, duplicate callback, crash cleanup, symlink escape, and two concurrent tenants with identical filenames.

Run migrations, TypeScript/Python fixture parity, focused/canonical tests, secret scan, validators, and git diff --check. Update evidence/gates/CURRENT_STATE, state $0/no-provider/no-worker truth, commit, and stop before V2-03.
```

## V2-02 independent audit

```text
Independently audit VideoForge V2-02 at current HEAD. Read mandatory context, the exact V2-02 brief/profile and acceptance, implementation diff, schemas, tests, and evidence. Perform no edits, credential access, provider calls, mutations, or spend.

Verify trusted tenant-derived object identity, least-scope expiring ports, durable commit receipts, non-enumeration, checksum/length enforcement, retention/deletion ownership, /runpod-volume read-only policy, job-local scratch, terminal cleanup, and path/symlink/cross-mount negatives. Confirm no real R2 proof is claimed from fakes and no historical global key remains live.

Return PASS/FAIL, prioritized exact findings, commands/exits, unproven claims, CURRENT_STATE/provider/spend/worker truth, and V2-03 safety. Do not repair.
```

## V2-03 implementation — fair queue and two active slots

```text
Work on VideoForge checkpoint V2-03 only: fair per-account queue and two global active slots.

Read mandatory context, selected brief/profile, and V2-03 acceptance. Verify V2-02 is committed and green; create/select/validate missing narrow activation records before editing.

This authorizes local provider-free application/schema/UI/context work only. No credentials, providers, cloud mutation, GPU/workers, or spend: $0.

Replace active singleton-session/manual shared ordering with account-owned durable queue entries, a database-enforced one-active-provider-workload-per-account lock, and exactly two global capacity leases held by different accounts. Ordinary video work therefore remains capped at one active video/account and two active videos globally. Represent explicit Mage/SoulX preset previews as separate tenant-owned requests using the same locks/slots; they are eligible only when no video head is eligible and never alter the video fairness cursor. Use deterministic fair account rotation. A user may reorder/cancel only their own waiting entries without changing account rotation or another account's order. Promotion, cancel, retry, terminal release, lease expiry/reclamation, and restart reconstruction must be atomic and auditable. Waiting work performs no ASR, prompt, storage mutation, GPU dispatch, render, or other provider action.

Users may view, cancel, or reorder only their own waiting projects; their reorder cannot jump another account in fair rotation. Active work cannot be moved. Preserve the UI design while showing private factual queue/stage state; remove ordinary GPU selection and Pod Start/Stop/Delete concepts.

Prove simultaneous submits from 5-10 accounts, same-account double-submit, two different-account winners, no third slot, video-over-preview priority, preview capacity/account locking, video-account starvation bounds (previews may intentionally wait while any video head is eligible), owned reorder/cancel without fair-rotation drift, release/retry, lease theft/expiry, crash between promotion and commit, restart, stale actor/version, and two-account Chrome journeys. Run focused/canonical tests, migration checks, validators, and diff check. Update evidence/gates/CURRENT_STATE, record $0/no-provider/no-worker truth, commit, and stop before V2-04.
```

## V2-03 independent audit

```text
Independently audit VideoForge V2-03 at current HEAD. Read mandatory context, selected V2-03 records, acceptance, migrations/diff, and evidence. Read-only only; no edits, credentials, providers, mutations, or spend.

Verify database truth enforces one active provider workload/account and two workloads globally from different accounts; ordinary videos remain capped at one/account and two globally. Verify explicit preset previews share the same locks/slots, never outrank any eligible video, never alter the video fairness cursor, and create no work before admission. Verify deterministic video-account rotation, atomic promotion/release/recovery, and tenant-only reorder/cancel without account-rotation drift. Inspect high-contention and crash tests plus real-Chrome private queue proof. Confirm UI has no ordinary GPU/Pod controls.

Return PASS/FAIL, P0/P1/P2 findings with references, commands/exits, missing proof, CURRENT_STATE/provider/spend/worker truth, and V2-04 safety. Do not fix.
```

## V2-04 implementation — provider-free Serverless v3 transport and recovery

```text
Work on VideoForge checkpoint V2-04 only: provider-free Serverless v3 transport, authority, outbox, receipts, and recovery.

Read mandatory context, selected brief/profile, official pinned RunPod Serverless sources, and V2-04 acceptance. Verify V2-03 is committed and green. Create/select/validate missing narrow records before implementation.

This authorizes bounded local application/worker/schema/context work only. Do not access credentials, call RunPod, create endpoints, publish images, touch volumes, allocate workers, or spend: $0.

Create additive v3 endpoint deployment, pre-dispatch authority, dispatch outbox, request attempt, provider assignment, signed VideoForge provenance receipt, progress, durable output receipt, cancellation, reconciliation, and cost contracts with TypeScript/Python parity. Bind tenant/revision/lane batch, endpoint/config/image/model/volume hashes, input hashes, deadline, and spend ceiling before dispatch. After a unique RunPod job ID is returned or reconciled, persist its assignment to the token/attempt before accepting status/output. Record worker ID when exposed, runtime GPU/driver/CUDA probes, intended region/volume, ready timings, and output hashes in a separate signed provenance receipt. Do not call this provider hardware attestation. Generalize the context validator's historical CP-06-only provider-authority branches into strict V2 checkpoint-generic read-only/paid validation without weakening exact operations/resources/rates/cap checks.

Persist a stable dispatch token/outbox before fake /run. Never promise exactly once or no duplicate billing: accept at most one canonical durable output and expose bounded duplicate compute/cost. Reconcile fake /status before the 30-minute result window expires; a signed R2 receipt is truth and webhooks are advisory. Measure/pin TTL, execution timeout, init timeout, scaler, idle, polling, and retry contracts; TTL includes queued/running life. Model workersMin=0 as zero Active workers and autoscaled Flex; workersMax counts Active+Flex. Forbid routine /purge-queue.

Test fake /run/status/cancel, response loss before/after provider acceptance, duplicate delivery/execution/output, webhook loss/replay, stale/forged callbacks, worker death, timeout/TTL, cancellation races, restart, accepted-unit resume, cost conservation, and tenant/endpoint/volume/GPU mismatches. Preserve Pod contracts as replay-only. Run migrations, fixture parity, focused/canonical tests, validators, and diff check. Update evidence/gates/CURRENT_STATE, state $0/no-provider/no-worker truth, commit, and stop before V2-05.
```

## V2-04 independent audit

```text
Independently audit VideoForge V2-04 at current HEAD. Read mandatory context, exact V2-04 profile/brief and acceptance, official pinned semantics, schemas/migrations/diff, tests, and evidence. Read-only: no edits, credentials, provider calls, mutations, or spend.

Verify two-phase authority, outbox-before-/run, stable token, persisted unique `provider_assignment` before status/output acceptance, separate signed observed-fact receipt, /status reconciliation, 30-minute result-window handling, at-most-one accepted output, visible duplicate-compute/cost risk, measured timeout/scaler contracts, correct min/max worker meaning, cancellation/restart, and an enforced no-purge rule. Confirm replay-only Pod schemas cannot authorize v3 dispatch and adversarial tenant/endpoint/image/volume/GPU/cost cases fail closed.

Return PASS/FAIL, exact prioritized findings, commands/exits, unproven claims, CURRENT_STATE/provider/spend/worker truth, and V2-05 safety. Do not repair.
```

## V2-05 implementation — provider-free cutover and runtime firewall

```text
Work on VideoForge checkpoint V2-05 only: provider-free application cutover, truthful UI, and runtime firewall.

Read mandatory context, selected brief/profile, and V2-05 acceptance. Verify V2-04 is committed and green. If activation selectors are absent, create/select/validate the narrow records first.

This authorizes local application/worker/UI/context changes only. No credentials, provider calls, cloud mutation, publication, model/volume work, GPU/workers, or spend: $0.

Wire tenant-private identity/artifacts, fair two-slot admission, existing transcript/scheduler/prompt/render foundations, and fake Mage/SoulX Serverless v3 lane batches into the complete app. Each admitted video owns independent stage state; CPU preparation begins only after admission; each exact lane dispatches only after its manifest and authority are durable. Preserve accepted units across bounded retries. Show factual private states such as queued, preparing, waiting for worker, initializing, generating images/avatar, rendering, complete, failed, and canceled.

Make legacy global session, shared catalogs, Pod create/delete/controllers, user GPU selectors, Echo, old Serverless, Auto routing, fallback/repair/substitution, broad object keys, and cross-tenant callbacks unreachable from ordinary production imports, routes, flags, and build output. Keep explicitly isolated replay fixtures only. No fake state may look live.

Prove two tenant projects active concurrently plus waiting projects, lane independence, response loss/duplicate delivery, restart/cancel, accepted-unit resume, asset barriers, exact renderer output, cross-tenant negatives, cost attribution, and zero fake workers after drain. Run import/firewall scans, focused/canonical verification, migrations, secret scan, validators, diff check, and installed-Chrome two-account journeys. Update evidence/gates/CURRENT_STATE, record $0/no-provider/no-worker truth, commit, and stop before V2-06.
```

## V2-05 independent audit

```text
Independently audit VideoForge V2-05 at current HEAD. Read mandatory context, selected records, V2-05 acceptance, diff/build graph, tests, and Chrome evidence. Read-only only; no edits, credentials, providers, mutation, or spend.

Verify the active app uses tenant-private v3 paths end to end, admits at most two different accounts, dispatches no waiting work, preserves successful units, reports truthful states/costs, renders the three locked compositions, and drains fake workers. Prove ordinary production cannot import or route to manual Pod/global session/GPU selector/Echo/legacy Serverless/Auto/fallback/repair/broad-key paths; fixture/replay code must be isolated and visibly non-live.

Return PASS/FAIL, P0/P1/P2 exact findings, commands/exits, unproven claims, CURRENT_STATE/provider/spend/worker truth, and V2-06 safety. Do not fix.
```

## V2-06 implementation — hosted production-shaped staging

```text
Work on VideoForge checkpoint V2-06 only: hosted auth, Neon, R2, Cloudflare orchestration, and Cloud Run CPU media staging.

Read mandatory context, selected brief/profile, V2-06 acceptance, and pinned official service sources. Verify V2-05 is committed and green. Create/select/validate missing narrow activation records.

This request authorizes provider-free activation, bounded local application/infrastructure/context work, local tests/builds, and narrowly scoped read-only identity/quota/region/current-rate lookups through already configured Cloudflare, Neon, Google, and email credentials at a $0 cap. Do not print secrets. No resource/config/secret/OAuth/DNS mutation, deployment, email delivery, paid request, retention change, or spend is authorized yet. RunPod calls are not authorized.

First finish production adapters/manifests for Cloudflare-hosted app/API and durable orchestration, Better Auth email/password plus Google and atomic invite admission, Neon PostgreSQL, private tenant R2, and scale-to-zero Cloud Run Jobs containing pinned whisper.cpp and FFmpeg/FFprobe. Implement least-privilege secrets, signed artifact ports, migrations/rollback, callbacks plus polling, restart/replay/cancel/expiry/retention, backups, observability, and exact local/container parity. Keep GPU transport fake and disabled.

Before any external mutation or paid use, ask once with one combined proposal listing every exact create/change/deploy/secret/OAuth/email/test/delete/retain operation; account/project/region/domain/resource sizing; current finite and recurring rates; intended retained resources; rollback/cleanup; estimate and stop conditions; and request that I supply a numeric maximum cumulative finite external spend. Do not invent a cap or reuse authority. Record approval and proceed only while the proposal remains exact; stop on drift or cap risk.

After approval, deploy only the approved staging resources. Prove two real invited accounts with isolated DB rows/objects, auth/reset/admission negatives, migration/backup/restore, signed large transfer, hosted owned ASR/render, restart/replay/cancel/timeout, durable hashes/probes, secret isolation, no Mac dependency, and real-Chrome staging. Record immutable deployment/config identities, timings, settled finite cost, ongoing charges, rollback, and zero RunPod workers. Update evidence/gates/CURRENT_STATE, commit, and stop before V2-07.
```

## V2-06 independent audit

```text
Independently audit VideoForge V2-06 at current HEAD using repository and supplied immutable deployment evidence only. Read mandatory context, exact V2-06 records/acceptance, diff, tests, and handoff. Do not edit, access credentials, make live provider calls, mutate resources, or spend; a separate explicit read-only audit grant would be required for live verification.

Verify bounded checkpoint-specific authority and cap, exact approved versus actual resources/rates/recurring charges, tenant-isolated Better Auth/Neon/R2, least-privilege secrets, hosted Cloudflare orchestration, scale-to-zero Cloud Run ASR/render parity, durable recovery/cancel/backup/restore, Chrome proof, and RunPod-disabled/zero-worker truth. Local fixtures cannot prove deployment.

Return PASS/FAIL, P0/P1/P2 findings with exact references, commands/exits, unproven live claims, CURRENT_STATE and spend truth, rollback state, and V2-07 safety. Do not repair.
```

## V2-07 implementation — Mage Serverless qualification

```text
Work on VideoForge checkpoint V2-07 only: exact Mage-Flow INT8 ConvRot Serverless qualification on the existing sealed Mage volume.

Read mandatory context, selected brief/profile, V2-07 acceptance, exact prior Mage manifest/evidence, and pinned official RunPod Serverless sources. Verify V2-06 is committed and green. Create/select/validate missing narrow records.

This request authorizes provider-free activation, local worker/application/context changes, local builds/tests, and narrowly scoped read-only RunPod EU-RO-1 inventory, resource-identity, quota, and current-rate lookups through configured credentials at $0. Do not print secrets. No publication, endpoint/template mutation, model download/preparation, volume mutation, GPU job, worker allocation, or spend is authorized yet. The existing Mage-only 50 GB volume remains retained and must not be deleted, rebuilt, cross-mounted, or written.

First convert the exact qualified Mage runtime into a queue handler for one complete video image batch. Use only /runpod-volume, offline sealed-manifest verification, real initialization warm-up, application-read-only model files, job-local scratch, scoped R2 ports, durable per-unit resume, v3 authority/provenance receipt, terminal cleanup, and no runtime download/quantization. Build immutable image definition and negative tests for wrong bytes/path/volume/GPU/region, writes, cache escape, malformed authority, duplicate delivery, cancel, timeout, and two readers.

Pin the initial endpoint to EU-RO-1, exact Mage volume, exact immutable image digest, RTX 4090 only, one GPU/Flex worker, workersMin=0, workersMax=1, and measured scaler/idle/TTL/execution/RUNPOD_INIT_TIMEOUT values. Qualify one worker first; then apply a separately hashed workersMax=2 configuration only for the bounded concurrent-reader proof. Before publication, endpoint mutation, or GPU use, ask once with one combined proposal containing exact publish/create-or-update/submit/status/cancel/scale-down/retain/delete-if-failed operations; both staged endpoint configs; artifact lineage; endpoint/config/image/volume/model/GPU identity; current rates and existing volume charge stated separately; finite estimate; cleanup/rollback; stop conditions; and request my numeric maximum cumulative finite spend. Do not invent or reuse a cap.

After exact approval, publish and qualify only that proposal. Run owned samples plus a realistic complete image batch, cold and warm, and two simultaneous read-only workers. Prove outputs durable before provider expiry, status reconciliation, cancellation/duplicate behavior, unchanged volume hash, no model-volume writes, peak VRAM, init/load/warm/inference/upload timings, settled cost, and independent workers=0 after drain while the endpoint and both intended volumes remain. Stop on mismatch, cap risk, failed output, uncertain cleanup, or unplanned duplicate compute. Update evidence/gates/CURRENT_STATE, commit, and stop before V2-08.
```

## V2-07 independent audit

```text
Independently audit VideoForge V2-07 at current HEAD from repository and immutable paid-run evidence. Read mandatory context, exact V2-07 records/acceptance, Mage lineage, diff/tests, authority, and handoff. No edits, credentials, live provider calls, mutations, or spend.

Verify the exact sealed Mage bytes and existing volume were neither rebuilt nor written; /runpod-volume and local scratch contracts; immutable image/endpoint/config; staged RTX 4090-only EU-RO-1 Flex qualification at min=0/max=1 before the separately hashed max=2 concurrent-reader configuration; measured timeouts; complete-batch handling; outputs/receipts/status reconciliation; at-most-one acceptance and duplicate-cost visibility; actual rates/cost versus cap; unchanged two-volume inventory; and workers=0 after drain. Fixture proof cannot substitute for the real run.

Return PASS/FAIL, exact prioritized findings, commands/exits, unproven claims, CURRENT_STATE/spend/worker truth, and V2-08 safety. Do not repair.
```

## V2-08 implementation — SoulX Serverless qualification

```text
Work on VideoForge checkpoint V2-08 only: exact SoulX-FlashHead Pro BF16 Serverless qualification on the existing sealed SoulX volume.

Read mandatory context, selected brief/profile, V2-08 acceptance, exact prior SoulX manifest/evidence, review-only Avatar Profile/crop evidence, first-party code/weights terms, and pinned official RunPod sources. Verify V2-07 is committed and green. Create/select/validate missing narrow records.

This request authorizes provider-free activation, local worker/application/context work, local builds/tests, and narrowly scoped read-only RunPod EU-RO-1 inventory/resource/quota/current-rate queries through configured credentials at $0. Do not print secrets. No publication, endpoint mutation, model download/preparation, volume mutation, GPU job, allocation, or spend is authorized yet. The existing separate SoulX-only 50 GB volume must remain sealed, retained, unmodified, and never cross-mounted.

First resolve and record exact first-party code/weights access, commercial-use, hosted-service, redistribution, and container-publication terms; do not publish or claim production clearance while GATE_SOULX_LICENSE_001 is ambiguous. Then wrap the exact qualified Pro BF16 runtime as one complete-avatar-lane queue handler. Use /runpod-volume, offline manifest verification, real load/compile warm-up, exact selected-span padding/trim/A-V/output contracts, source-specific full/split review candidates that activate only after explicit approval, scoped R2 ports, resumable durable clips, v3 authority/provenance receipt, job-local scratch, and terminal cleanup. No enhancement, repair, fallback, substitute, runtime download, full-voiceover request, or model-volume cache write.

Pin the initial endpoint to EU-RO-1, exact SoulX volume/image/model, RTX 4090 only, one GPU/Flex worker, workersMin=0, workersMax=1, and measured scaler/idle/TTL/execution/RUNPOD_INIT_TIMEOUT values; account for the previously long cold initialization rather than inheriting defaults. Qualify one worker first, then use a separately hashed workersMax=2 configuration only for bounded concurrent-reader proof. Before any publication, endpoint change, or GPU use, ask once with the exact combined proposal: publish/create-or-update/submit/status/cancel/scale-down/retain/delete-if-failed operations; both staged configs; lineage and endpoint/config/image/volume/GPU identities; current rates and existing retained charge separately; samples/batch; estimate; cleanup/rollback; stop conditions; and a numeric maximum cumulative finite spend supplied by me. Do not invent or reuse a cap.

After exact approval, run owned 2/4/6/approximately-10-second clips and a realistic lane batch, cold/warm and two simultaneous read-only workers. Show playable native/full/split MP4s and require explicit visual approval of each active Avatar Profile composition. Record hashes/ffprobe/A-V duration, durable receipts, init/load/compile/inference/upload timings, VRAM, duplicate/cancel/status behavior, unchanged volume hash, settled cost, and independent workers=0 after drain with both intended volumes retained. Stop on mismatch, bad output, cap risk, uncertain cleanup, or unplanned duplicate compute. Update evidence/gates/CURRENT_STATE, commit, and stop before V2-09.
```

## V2-08 independent audit

```text
Independently audit VideoForge V2-08 at current HEAD from repository and immutable paid-run evidence. Read mandatory context, exact V2-08 records/acceptance, SoulX lineage/crop approval, diff/tests, authority, and handoff. No edits, credentials, live provider calls, mutations, or spend.

Verify exact first-party deployability evidence or explicit unresolved-risk decision, exact Pro BF16 bytes and existing SoulX volume, no write/download/cross-mount, /runpod-volume plus isolated scratch, exact span/A-V contracts, immutable endpoint/config/image, staged RTX 4090 EU-RO-1 min=0/max=1 then separately hashed max=2 with measured long-init handling, playable sample and realistic batch proof, two readers, visual crop approval, receipts/status reconciliation, duplicate-cost visibility, actual cost versus cap, two retained unchanged volumes, and workers=0. Technical output without required visual approval is FAIL.

Return PASS/FAIL, P0/P1/P2 exact findings, commands/exits, missing proof, CURRENT_STATE/spend/worker truth, and V2-09 safety. Do not repair.
```

## V2-09 implementation — short real hosted end-to-end project

```text
Work on VideoForge checkpoint V2-09 only: one short real hosted end-to-end project.

Read mandatory context, selected brief/profile, V2-09 acceptance, and accepted V2-07/V2-08 endpoint evidence. Verify V2-08 is committed, independently green, and visually approved. Create/select/validate missing narrow records.

This request authorizes provider-free activation, bounded local app/context changes and tests, owned short-input preparation, and narrowly scoped read-only current inventory/rate/resource-identity lookups through configured hosted-service and RunPod credentials at $0. Do not print secrets. No mutation, deployment, generation request, GPU/CPU job, or spend is authorized yet. No fallback, repair, model/GPU substitution, or manual edit.

First run the complete provider-free dry journey and freeze one owned approximately 60-90 second input, tenant/revision, word transcript, scheduler-v2 manifest, prompt/image/avatar work counts, R2 paths, exact endpoint authorities, cost estimate, failure/cancel plan, and final render contract. Use the qualified Mage and SoulX endpoints, real prompt provider only if explicitly included, hosted ASR/render, private R2, durable barriers, status reconciliation, and no operator intervention after Generate.

Before the first live call, ask once with a combined proposal naming every exact provider request and any config mutation; account/region/endpoints/config/image/volume/model/GPU identities; current per-service rates; work counts; finite estimate; existing recurring charges separately; cleanup/rollback; stop conditions; and request my numeric maximum cumulative finite spend. Do not invent/reuse a cap. Record exact approval and stop if anything changes.

After approval, run once. Show the playable 1080p MP4 in real Chrome with download/seek proof, immutable lineage, hashes/ffprobe/A-V/frame duration, actual worker/GPU identities, all stage/cold/warm/inference/upload/render timings, retries or duplicate compute, itemized settled cost, cross-tenant negative proof, and both endpoints at workers=0 after drain with only intended retained resources. Ask for the user's visual acceptance before promotion. Update evidence/gates/CURRENT_STATE, commit, and stop before V2-10.
```

## V2-09 independent audit

```text
Independently audit VideoForge V2-09 at current HEAD from repository and immutable live-run evidence. Read mandatory context, exact V2-09 records/acceptance, predecessor endpoint approvals, diff/tests, authority, output, and handoff. No edits, credentials, live calls, mutations, or spend.

Verify one owned short project completed through real hosted auth/storage/ASR/scheduler/prompts/Mage/SoulX/barrier/render without fixture assets or manual edits; exact identities and lineage; private tenant access; playable technical output; actual timings/cost versus approved cap; duplicate/retry accounting; user visual decision; and workers=0 after drain. Local or partial-provider proof is insufficient.

Return PASS/FAIL, exact findings, commands/exits, unproven claims, CURRENT_STATE/spend/worker truth, and V2-10 safety. Do not repair.
```

## V2-10 implementation — real 3-5 minute Ranga-style pilot

```text
Work on VideoForge checkpoint V2-10 only: one real 3-5 minute Ranga-style automatic pilot.

Read mandatory context, selected brief/profile, V2-10 acceptance, exact pinned Ranga forensic/visual evidence, and the visually accepted V2-09 run. Verify V2-09 is committed and independently green. Create/select/validate missing narrow records.

This request authorizes provider-free activation, bounded local app/context/test work, owned-input preparation, and narrowly scoped read-only current inventory/rate/resource-identity lookups through configured credentials at $0. Do not print secrets. No mutation, deployment, provider generation, worker/job allocation, or spend is authorized yet. Do not change scheduler timing/layout with an LLM, add B-roll video, repair/fallback/substitute models, or manually edit the final.

First freeze one owned final 3-5 minute voiceover, exact tenant/revision/Profile/Style versions, scheduler-v2 work manifest, prompt/image/avatar counts, composition/crop contracts, R2 lineage, expected timings/cost, review rubric, shutdown, and rollback. Preserve the current deterministic grammar: frame-zero full avatar; normal 2-6 second spans; 21-22% avatar; near-even full/split; near-strict alternation; clean speaker-left 50/50 split; first evidence around 3-6 seconds; first split by 18 seconds; hard cuts; slow centered image zoom; no prohibited graphics.

Before the first live provider call, ask once with an exact combined proposal listing all generation/ASR/render/storage operations and any mutation; exact accounts, regions, endpoint/config/image/volume/model/GPU identities and current rates; work counts; estimate; recurring charges separately; cleanup/rollback; stop conditions; and request my numeric maximum cumulative finite external spend. Do not invent or reuse a cap. Record approval and continue only while exact.

After approval, generate without operator editing. Review every cut and asset for direct literal evidence, documentary realism, crop, lips/head/background, pacing, zoom, A/V, and prohibited graphics. Produce metric report and contact sheets; semantic score target mean >=1.8 with no zero in the opening minute or critical claims and zero accepted pseudo-text/logo/anatomy/style defects. Show the playable final in real Chrome, hashes/probes, full timings, retries/duplicate compute, settled itemized cost, and independent workers=0 after drain. Obtain explicit user visual acceptance. Update evidence/gates/CURRENT_STATE, commit, and stop before V2-11.
```

## V2-10 independent audit

```text
Independently audit VideoForge V2-10 at current HEAD from repository, pinned Ranga evidence, and immutable run/review artifacts. Read mandatory context, exact V2-10 records/acceptance, authority, output, metrics, and handoff. No edits, credentials, live provider calls, mutations, or spend.

Verify the final is a real automatic 3-5 minute owned project with no fixture/manual edit; deterministic composition/cadence/geometry metrics; literal-evidence score and defect rubric; exact profile/style/crop lineage; playable A/V proof; actual timing/cost/cap accounting; user visual acceptance; tenant isolation; and workers=0 after drain. Do not claim identical Ranga natural motion from still-image zoom.

Return PASS/FAIL, P0/P1/P2 exact findings, commands/exits, missing proof, CURRENT_STATE/spend/worker truth, and V2-11 safety. Do not repair.
```

## V2-11 implementation — concurrency, fairness, autoscaling, and recovery

```text
Work on VideoForge checkpoint V2-11 only: two-user concurrency, 5-10-user fairness, autoscaling, and recovery proof.

Read mandatory context, selected brief/profile, and V2-11 acceptance. Verify V2-10 is committed, independently green, and visually accepted. Create/select/validate missing narrow records.

This request authorizes provider-free activation, bounded local app/context/tests, preparation of owned short projects, and narrowly scoped read-only hosted/RunPod inventory, identity, quota, and current-rate lookups through configured credentials at $0. Do not print secrets. No mutation, deployment, live request, worker allocation, or spend is authorized yet. Do not rely on RunPod queue fairness or use /purge-queue.

First pass provider-free 1/2/5/10-account contention, fair rotation, same-account serialization, two-global-slot, no-third-slot, restart, lease expiry, response-loss, duplicate-delivery, worker-death, cancel/timeout, stale webhook, R2 receipt, retry resume, and cost-conservation tests. Freeze two real simultaneous owned projects plus additional queued fixtures, exact work counts, fault injection points, endpoint timeout/scaler bounds, budget estimate, stop-dispatch and cleanup plan.

Before any live call or config mutation, ask once with one combined proposal naming exact endpoint/config changes if any, submissions/status/cancel/fault operations, accounts/regions/images/volumes/models/GPU offerings/current rates, project counts/durations/work, finite estimate, existing recurring charges separately, rollback/cleanup, stop conditions, and request my numeric maximum cumulative finite external spend. Do not invent or reuse a cap. Record exact approval; stop on proposal drift or cap risk.

After approval, prove two different accounts generate concurrently while each account remains at one active workload and ordinary video work remains at one active video/account; all further demand rotates fairly and previews never outrank eligible videos. Demonstrate endpoint scaling within bounds with locked `REQUEST_COUNT=1`, no waiting-work dispatch, recovery from the named failures, at-most-one accepted output with any duplicate compute/cost visible, per-tenant artifacts/costs, valid outputs, and real-Chrome private status. Reconcile durable receipts within result windows. End with zero endpoint jobs, zero total workers (`Active + Flex`), no pending provider work, intended resources only, and settled itemized cost. Update evidence/gates/CURRENT_STATE, commit, and stop before V2-12.
```

## V2-11 independent audit

```text
Independently audit VideoForge V2-11 at current HEAD from repository and immutable load/fault evidence. Read mandatory context, exact V2-11 records/acceptance, tests, authority, outputs, raw event/cost tables, and handoff. No edits, credentials, live calls, mutations, or spend.

Verify two different accounts truly ran concurrently; one-active-workload/account and two-global limits; fair 5-10-account video rotation plus lower-priority preview behavior; owned reorder/cancel without rotation drift; zero waiting dispatch; exact `0→1→2→0` endpoint scaling with locked `REQUEST_COUNT=1`; no more than four total workers (`Active + Flex`) across both endpoints; measured timeouts; recovery from each required fault; durable receipts/status reconciliation; no exactly-once claim; canonical-output and duplicate-cost accounting; tenant isolation; actual cost versus cap; no pending endpoint jobs; and zero total workers (`Active + Flex`) after drain. Synthetic contention cannot prove the live portion.

Return PASS/FAIL, exact prioritized findings, commands/exits, unproven claims, CURRENT_STATE/spend/worker truth, and V2-12 safety. Do not repair.
```

## V2-12 implementation — production-length quality, speed, and economics

```text
Work on VideoForge checkpoint V2-12 only: representative 20-30 minute quality, speed, and economics qualification.

Read mandatory context, selected brief/profile, V2-12 acceptance, pinned Ranga metrics, and all accepted live benchmark evidence. Verify V2-11 is committed and independently green. Create/select/validate missing narrow records.

This request authorizes provider-free activation, bounded local benchmark/context/test work, preparation of one owned production-length project and quality suites, and narrowly scoped read-only current provider inventory/rate/resource lookups through configured credentials at $0. Do not print secrets. No mutation, generation, worker allocation, or spend is authorized yet. RTX 4090 remains the qualified production GPU; RTX 5090 is not fallback and cannot enter either endpoint list without its own exact compatibility/quality/timing/VRAM/cost proposal and approval.

First freeze the representative 20-30 minute voiceover, exact manifests and work counts, exact Mage 40-prompt/300-image subject/style/crop quality suite, same-content five-style suite, representative SoulX avatar/crop/span suite, expected concurrency, stage SLOs, cost model, Ranga review rubric, fault bounds, cleanup, and stop conditions. Use measured Serverless billing across initialization, execution, and idle rather than Pod rates or optimistic arithmetic. Separate variable generation cost from retained-volume and other fixed monthly charges.

Before the production-length 4090 run, ask once with an exact combined proposal naming every provider request/config mutation, exact endpoints/images/volumes/models/regions/GPU/current rates, input duration/work counts, estimate, recurring charges separately, rollback/cleanup, stop conditions, and request my numeric maximum cumulative finite external spend. Do not invent/reuse a cap. If evidence later justifies an optional 5090 comparison, treat it as a separate bounded qualification proposal with its own user-supplied numeric cap and explicit endpoint isolation; never silently substitute it or combine unapproved work.

After each approved wave, return raw p50/p90 and wall-clock cold/warm init/load/inference/upload/ASR/render timings, throughput, VRAM, retry/duplicate cost, quality contact sheets/clips/final MP4, hashes/probes, Ranga metrics, actual rate, settled itemized variable cost, fixed monthly charges, zero endpoint jobs, and zero total workers (`Active + Flex`) after drain. Evaluate the <=$1 representative 30-minute variable target and $2 hard ceiling honestly; do not lower accepted quality or hide fixed/duplicate costs to pass. Obtain explicit quality/economics go/no-go, update evidence/gates/CURRENT_STATE, commit, and stop before V2-13.
```

## V2-12 independent audit

```text
Independently audit VideoForge V2-12 at current HEAD from repository and immutable production-length benchmark evidence. Read mandatory context, exact V2-12 records/acceptance, raw outputs/tables, authorities, quality decisions, and handoff. No edits, credentials, live calls, mutations, or spend.

Verify representative 20-30 minute scope and work counts; actual Serverless billing and current rates; cold/warm p50/p90 timing; Mage/SoulX and final-video quality; Ranga metrics; retries/duplicate compute; fixed versus variable cost; honest <=$1 target/$2 ceiling result; user quality/economics decision; and workers=0. If 5090 was used, require independent exact-lane compatibility, endpoint isolation, explicit authority/cap, quality parity, VRAM/timing/cost proof, and no automatic fallback.

Return PASS/FAIL, P0/P1/P2 exact findings, commands/exits, missing proof, CURRENT_STATE/spend/worker truth, and V2-13 safety. Do not repair.
```

## V2-13 implementation — security, production release, and operations

```text
Work on VideoForge checkpoint V2-13 only: security hardening, production release, and operating proof.

Read mandatory context, selected brief/profile, V2-13 acceptance, accepted security/cost/quality evidence, and release source pins. Verify V2-12 is committed, independently green, and explicitly approved. Create/select/validate missing narrow records. Do not expand product features.

This request authorizes provider-free activation, bounded local security/release/runbook/context changes, tests, and narrowly scoped read-only production identity/inventory/quota/current-rate lookups through configured credentials at $0. Do not print secrets. No deploy, DNS/OAuth/secret/resource mutation, email, provider request, worker allocation, or spend is authorized yet.

First complete threat model and tenant-boundary review; dependency/container/secret scans; CSP/CSRF/session/rate-limit/invite/quota/abuse controls; least-privilege credentials; database/R2 backups and restore drills; data retention/deletion; audit/cost/queue/endpoint alerts; SLO dashboards; incident, secret-rotation, lost-callback, stuck-request, duplicate-cost, provider-outage, rollback, and volume-disaster runbooks. Pin release artifacts/config and exact smoke/rollback plan. Ordinary production must expose no manual Pod/GPU controls or legacy runtime.

Before any production mutation or paid smoke, ask once with a combined proposal listing every exact deploy/promote/domain/DNS/OAuth/secret/email/config/smoke/rollback/delete/retain operation; accounts/projects/regions/resource sizes/images/endpoints/volumes/GPU/current rates; finite estimate and all recurring charges/retention consent; stop conditions; and request my numeric maximum cumulative finite external spend. Do not invent or reuse a cap. Record exact approval and stop on any change or cap risk.

After approval, promote only pinned artifacts. Prove deployment and rollback, two invited users' private Chrome journeys, one bounded generation, playback/download, restart/reconcile, backup/restore, alerts, cancel, queue drain, next-job readiness, settled finite cost, ongoing charges, no pending provider jobs, and both endpoints at workers=0 with exactly the intended retained volumes/resources. Archive or firewall obsolete entrypoints without deleting history. Update final evidence/gates/CURRENT_STATE, commit, and hand back production with operator URLs/runbooks and honest remaining risks. Push only if explicitly requested.
```

## V2-13 independent audit

```text
Independently audit VideoForge V2-13 at current HEAD and supplied immutable production evidence. Read mandatory context, exact V2-13 records/acceptance, security/release artifacts, authority, smoke evidence, and handoff. Read-only only: no edits, credential access, live provider calls, mutations, email, or spend unless a separate exact read-only audit is explicitly authorized.

Verify every predecessor/gate, tenant isolation, auth/session/invite controls, secrets and least privilege, dependencies/images, quotas/abuse limits, backups/restores, retention/deletion, observability/alerts/SLOs, incident/rollback drills, pinned deployment, real-Chrome invited-user smoke, output lineage/cost, recurring-charge disclosure, legacy runtime firewall, no pending jobs, and workers=0 with only intended retained resources. Missing production proof is FAIL, not deferred success.

Return final PASS/FAIL, evidence-backed P0/P1/P2 findings with exact references, commands/exits, unproven claims, CURRENT_STATE/provider/spend/worker truth, rollback readiness, and whether VideoForge is production ready. Do not repair or praise.
```

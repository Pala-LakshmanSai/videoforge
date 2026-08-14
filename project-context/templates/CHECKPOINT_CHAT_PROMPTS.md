# Checkpoint chat prompts

Use one implementation prompt at a time, in order. Do not paste the whole file into a chat. After
the implementation chat finishes, open a separate audit chat and paste the audit prompt at the end
of this file with the same checkpoint ID.

Every prompt assumes repository `/Users/lakshmansai/Documents/videoforge`. Paste the selected prompt
unchanged. For `CP-06` through `CP-12`, the prompt itself authorizes bounded provider-free
activation/local work and its named read-only inventory/rate preflight, but no mutation, model
download, paid compute, or spend. The implementation chat completes that safe preflight and then
asks once for the exact GPU/resource choice, a numeric finite-action cap, and any recurring retained
resource billing that needs consent. No cap from another checkpoint or chat transfers.

## CP-01 implementation prompt

```text
Work on VideoForge checkpoint CP-01 only: Global-session vNext contracts and legacy dispatch firewall.

Use caveman updates: brief, factual, development-focused. First read AGENTS.md, project-context/00_START_HERE.md, MANIFEST.yaml, CURRENT_STATE.yaml, the selected read profile/task brief, and the CP-01 section of project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md. Audit current HEAD and dependencies before editing. If CP-00 is not committed/green or context conflicts, stop and reconcile; do not guess.

This message authorizes bounded application/context code changes for CP-01 only. Provider calls, credentials, cloud/remote mutations, model downloads, image publication, GPU use, and spend are not authorized: $0.

Implement versioned provider-free contracts, additive persistence, valid/invalid fixtures, and tests for the singleton global generation session, immutable session GPU pair, live inventory receipts/rate ceilings, global queue entry/version, isolated Mage/Echo volume manifests, lane demand, Pod lifecycle/model-ready/delete/absence, durable outputs, and cost. Preserve v1 bytes, old migrations, and historical evidence. Add a production dispatch/import firewall so Serverless /run, endpoints, workersMin/Max, Auto GPU, AvatarForcing, MuseTalk, SkyReels, repair/fallback, and legacy worker registries cannot reach vNext paid dispatch.

Prove concurrent idle-start has one winner; waiting-only reorder/remove; cross-volume, stale GPU, wrong actual GPU, false model-ready, ambiguous create/delete, false stop, and routine volume deletion fail closed. Keep fixture mode default. Use small green commits. Run focused tests, migration fresh/upgrade/restore, schema parity, verify:fast, canonical pnpm verify, secret scan, context/schema validators, diff check, and real Chrome only if visible state changes.

At handoff: update CURRENT_STATE and context, record exact commands/evidence/commit, keep all gates honest, server stopped unless I am reviewing, and confirm no provider call/resource/spend. Do not start CP-02.
```

## CP-02 implementation prompt

```text
Work on VideoForge checkpoint CP-02 only: Shared admission, simple global queue, and idle-only GPU UX.

Use caveman updates. Read AGENTS.md, mandatory context, CURRENT_STATE's exact selected profile/brief, and CP-02 in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md. Verify CP-01 is committed and green. Do not work around an incomplete dependency.

This message authorizes bounded local application/context changes for CP-02. External provider calls, real OAuth/email, credentials, deployment/cloud mutation, model download, GPU use, and spend are prohibited: $0.

Implement one global shared app boundary for 5-10 admitted users with equal rights. Add provider-free email/password and Google auth fixtures plus the one-time invite-admission boundary; existing admitted users are never prompted again. Enforce the locked policy: one unique single-use code per intended email, verified email before access, Google verified email equality, and atomic code consumption/admission. Implement the durable singleton generation session and global queue: first idle Generate atomically locks the two receipt-bound GPU selections; while active/queued, selectors are locked and everyone only sees Add to queue plus the locked pair/rates. All admitted users may add, optimistic-reorder, or remove WAITING entries; active entries cannot move/delete. Record actor and old/new order. No roles, multi-workspace UI, advanced fairness, per-user Pod pairs, GPU switching, or parallel projects.

Reuse ImageForge's current live selector presentation/receipt-recheck ideas, not its Tauri/device-local queue. Test invite races/replay, concurrent idle starts, queue-version conflicts, restart/recovery, and 10 simultaneous users. Preserve accepted UI geometry. Verify in real Chrome with multiple sessions. Run all focused and canonical checks, update context/CURRENT_STATE, commit one bounded milestone, and stop before CP-03. No provider calls/resources/spend.
```

## CP-03 implementation prompt

```text
Work on VideoForge checkpoint CP-03 only: Production-grade word transcript.

Use caveman updates. Read mandatory context, CURRENT_STATE's selected brief/profile, and CP-03 in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md. Confirm CP-02 is green. Start by auditing the existing whisper.cpp/word-timing implementation; promote it instead of rebuilding it.

This message authorizes bounded local application/worker/context code for CP-03 only. No cloud deployment, provider credentials/calls, paid API, GPU, model download, or spend: $0. The existing pinned local whisper model may be used; adding/changing a model requires asking.

Containerize identical Mac-development and future Cloud Run Job behavior for probe/hash, normalization, 30-minute-class audio, deterministic chunk overlap/reconciliation, word/phrase timestamps, durable receipt/idempotency/restart, and R2-port fixtures. Preserve original voiceover for final render. Add compact transcript inspection only if needed; do not redesign the UI.

Test owned short, noisy, silence, malformed, and long fixtures; monotonic words, bounded timestamps, phrase/audio coverage, chunk boundaries, replay/restart, and Mac/container contract parity. Manually spot-check owned timing. Run focused/canonical checks and real Chrome if UI changes. Update CURRENT_STATE/evidence/context, commit, and stop before CP-04. Do not claim hosted production until CP-08.
```

## CP-04 implementation prompt

```text
Work on VideoForge checkpoint CP-04 only: Three-composition scheduler and complete work plan.

Use caveman updates. Read mandatory context, selected profile/brief, CP-04 in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md, and the locked Ranga reference metrics. Verify CP-03 is green. Audit and extend the existing deterministic scheduler; do not replace working foundations.

This message authorizes local application/pipeline/context changes only. No external provider calls, credentials, model downloads, GPU use, cloud mutation, or spend: $0.

Produce exact 30fps/source-time coverage for IMAGE_FULL, AVATAR_FULL, and AVATAR_SPLIT_IMAGE. Enforce no gaps/overlaps/word cuts, 21-22% avatar target, near-even full/split cumulative shares, normal 2-6 second avatar spans, seven-second opener maximum, hard cuts, slow image zoom requirement, and deterministic varied shot roles. Materialize padded selected-span WAVs with trim metadata, image slots, prompt batches, artifact IDs, cost counts, and immutable work/render manifests. Never send full voiceover to Echo; no LLM selects timing/layout.

Test long and boundary-heavy owned fixtures, deterministic replay, exact coverage, zero missing/duplicate work, playable span WAVs, and a visible timeline inspection. Run focused/canonical checks and Chrome if visible. Update evidence/context/CURRENT_STATE, commit, and stop before CP-05.
```

## CP-05 implementation prompt

```text
Work on VideoForge checkpoint CP-05 only: Provider-free complete MVP orchestration and legacy cutover.

Use caveman updates. Read mandatory context, selected brief/profile, and CP-05 in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md. Verify CP-01 through CP-04 are committed and green.

This authorizes bounded local application/worker/context changes. No credentials, provider/cloud calls, model downloads, image publication, GPU use, or spend: $0.

Wire the proven transcript/scheduler/FFmpeg foundations to fake-backed live inventory, paired GPU lock, singleton session, global queue, two synthetic Pod lanes, truthful container/volume/load/warmup/model-ready states, prompt fixtures, durable asset barriers, cost, independent lane drain/delete/absence, recovery/cancel, final MP4 playback/download. Run one active video at a time. A waiter may keep an existing synthetic Pod warm but may not start work or recreate an absent one; recreate only after next-project activation. With no waiter at lane completion, delete immediately; close/unlock only after both absences.

Cut the active app to vNext and quarantine Serverless, old BF16 Mage, Auto, AvatarForcing/MuseTalk/SkyReels, repair/quality/fallback, and historical crops behind provider-free legacy replay. Preserve old migrations/evidence/v1 bytes.

Acceptance: three queued synthetic projects; reorder/remove waiting; crash/restart; stale callback; wrong Pod/GPU/volume; independent drain; final playable MP4s; negative legacy import scan; canonical verify and real Chrome multi-session journey. Update CURRENT_STATE/context/evidence, make bounded green commit(s), server stopped, and stop before CP-06.
```

## CP-06 implementation prompt

```text
Work on VideoForge checkpoint CP-06 only: Exact Mage INT8 on a persistent RunPod volume.

Use concise, factual updates. Read mandatory context, CP-06 in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md, and the current /Volumes/ESD-USB/ImageForge worker source. Verify CP-05 is green. If the CP-06 task brief/read profile or selectors are missing, create the narrow brief/profile, select them in MANIFEST.yaml and CURRENT_STATE.yaml, validate them, and continue in this chat. Do not stop merely because activation records were absent.

This request authorizes bounded provider-free CP-06 activation, local application/worker/context changes, local builds/tests, and narrowly scoped RunPod inventory and rate queries through already configured credentials. Before Phase A work, set implementation_authorized_in_current_task=true, current_task=VF-9-24Q, and in_progress_checkpoint=CP-06. Record task_stage=read_only_preflight; application_code_changes_authorized=true; provider_calls_authorized=true; maximum_external_spend_usd=0; provider_authority with mode=read_only, provider=runpod, cap_usd=0, this prompt's timestamp, non_transferable=true, and allowed_operations=[inventory_lookup, rate_lookup, quota_lookup, resource_identity_lookup, resource_absence_lookup]; and matching live_development calls/spend fields while provider_mode remains fixture. Credential access is true only for those calls; every mutation/download/publication/GPU/retention flag remains false. Read-only calls may return EU-RO-1 compatible GPU offerings, identifiers, availability, rates, network-volume pricing, and absence proof only. They must not print secrets or create/change/delete/publish/download/allocate anything. No registry publication, RunPod mutation, model download, GPU allocation, image publication, or paid action is authorized yet. Never copy, adopt, or delete ImageForge resource IDs, volumes, Pods, secrets, or outputs.

Resolve known ImageForge source drift during local preflight: VideoForge DEC_IMAGE_001 and normative model/RunPod documents remain product authority. For reusable mechanics, worker/README.md says BF16, while src/imageforge_worker/constants.py and the tested runtime/health contract select int8-convrot; scripts/prepare_mageflow_volume.py also defaults --revision to None while runtime constants pin d8c99241f6fa80fbd453014234af2bf337ea21e6. Within ImageForge, tested generation/runtime code plus locked container inputs outrank the one-time preparation helper and README prose. Reconcile every adapted VideoForge layer before publication, require exact pinned revisions, and stop promotion if executable runtime sources conflict.

Adapt the exact current Mage INT8 ConvRot contract: Comfy-Org/Mage-Flow revision d8c99241f6fa80fbd453014234af2bf337ea21e6, pinned ComfyUI revision, exact three-file set, 4 steps, guidance 1.0, 1280x720, byte manifest and headroom derivation, local-files-only verification, actual GPU check, real warm-up, and truthful health. Finish the VideoForge-owned worker, preparation tool, negative tests, immutable image definition, and local verification before the external boundary.

Then make one combined authorization request. Present the exact publish/create/prepare/Pod/sample/delete operations; immutable image target; exact selected compatible GPU offering and current rate or a short exact choice list; derived EU-RO-1 Mage volume size; current recurring retained-volume rate; finite checkpoint cost estimate; stop conditions; and a requested numeric maximum cumulative external spend through handoff. Ask for the GPU choice, volume size approval, explicit consent to retain the volume at its ongoing rate, and paid execution authorization in that single request. The finite cap excludes continuing retained-volume billing. Do not choose a cap for me. Accept an unambiguous current-chat amount such as $3, USD 3, or 3.00 and normalize it to numeric 3.0; reject only missing, conflicting, stale, or placeholder authority. After approval, record task_stage=bounded_mutation and provider_authority.mode=paid. Before mutation, persist provider=runpod; model_id=Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot; exact resource targets; authorized_operations=[publish_worker_image, create_mage_template, create_mage_volume, download_prepare_mage_volume, create_mage_pod, generate_owned_samples, publish_owned_sample_outputs, delete_mage_pod, delete_mage_template, verify_zero_pods, retain_mage_volume]; authorization timestamp; non_transferable=true; numeric cap; and set application-code, credential, mutation, model-download, worker-image-publication, sample-output-publication, GPU-use, and Mage-volume-retention authority true. Set live_development.provider_mode=sandbox and persist mage_gpu_offering_id, mage_gpu_rate_usd_per_hour, mage_volume_size_gb, mage_volume_rate_usd_per_gb_month, and ongoing_retention_charge_usd_per_month in CURRENT_STATE. Then continue without asking again unless scope, rate, capacity, availability, or cap risk changes.

After approval, publish the immutable VideoForge worker; create and prepare only the approved Mage-only EU-RO-1 volume; create, verify, and delete fresh Pods on only the selected GPU; and run at least eight representative owned prompts across required subject/style/crop categories through at least two fresh Pods. Return PNGs/contact sheet, hashes/probes, image/manifest/digest/GPU/rate/VRAM, create-to-model-ready/inference/upload/delete timings, settled finite-action cost, ongoing retained-volume rate, and independent zero-Pod proof. Ordinary boot must pass with model registries blocked and wrong/missing volume must fail. Stop immediately on cap risk, ambiguity, mismatch, failed output, or uncertain cleanup. Update evidence/gates/context/CURRENT_STATE and commit. Do not start Echo or leave any Pod running.
```

## CP-07 implementation prompt

```text
Work on VideoForge checkpoint CP-07 only: Exact EchoMimicV3-Flash FP8 persistent-volume runtime and renderer crop lock.

Use concise, factual updates. Read mandatory context, CP-07 in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md, and pinned Echo preflight evidence. Verify CP-06 is green. If the CP-07 task brief/read profile or selectors are missing, create, select, and validate the narrow provider-free activation records and continue in this chat.

This request authorizes bounded provider-free CP-07 activation, local application/worker/context changes, local builds/tests, and read-only RunPod EU-RO-1 GPU inventory/rates and network-volume pricing through already configured credentials. The read-only scope has a $0 cap and may not print secrets or mutate, publish, download, allocate, or spend. No image publication, volume mutation, model download/preparation, Pod/GPU allocation, or paid action is authorized yet. No fallback, repair, model substitution, Long Video CFG, full-voiceover job, uncarded pickle, or cross-mount.

Complete local preflight first: build the VideoForge-prepared FP8 artifact definition from pinned first-party Flash/Wan/audio lineage; implement exact short-span padding/trim/output contracts, project-isolated scratch, offline manifest verification, real warm-up semantics, negative tests, and immutable image definition. Normal Pod boot must load only from a separate Echo-only EU-RO-1 volume with no runtime download or first-request quantization.

Then ask once with a combined proposal containing the exact publish/create/prepare/Pod/sample/delete operations, artifact lineage, immutable image target, exact selected compatible GPU offering/current rate or short exact choice list, derived Echo volume size, recurring retained-volume rate, finite checkpoint estimate, stop conditions, and requested numeric maximum cumulative external spend through handoff. In the same request ask for the GPU choice, volume approval, explicit consent to retain it at the ongoing rate, and paid execution authorization. The finite cap excludes continuing retained-volume billing. Do not invent a cap. Record approval and continue without another confirmation unless the proposal changes or cap risk appears.

After approval, publish the image; create/prepare only the approved Echo volume; run owned 2, 4, and 6 second avatar samples through fresh Pods on only the selected GPU; delete every Pod; and retain the volume. Show playable MP4s with hashes/ffprobe/A-V duration, GPU/rate/VRAM, manifest/digest, cold/warm model-ready/inference/upload/delete timings, settled finite-action cost, ongoing volume rate, and zero-Pod/two-volume proof. Measure native geometry and propose Echo-only full/split crops; do not activate crops until I review/approve them. Stop on ambiguity, mismatch, cap risk, output failure, or uncertain cleanup. Update gates/evidence/context/CURRENT_STATE, commit, and leave no Pod running.
```

## CP-08 implementation prompt

```text
Work on VideoForge checkpoint CP-08 only: Durable hosted staging, invite auth, storage, workflow, and CPU jobs.

Use concise, factual updates. Read mandatory context and CP-08 in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md. Verify CP-07 is accepted. If the CP-08 task brief/read profile or selectors are missing, create, select, and validate the narrow provider-free activation records and continue in this chat.

This request authorizes bounded provider-free CP-08 activation, local application/worker/context changes, local builds/tests, and narrowly scoped read-only account inventory/rate queries through already configured Cloudflare, Neon, Google, email, and Google Cloud credentials. Read-only calls may inspect existing resource identities, compatible regions/quotas, and current rates only; they must not print secrets, mutate resources/configuration, deploy, send email, allocate compute, or spend. No cloud mutation or paid action is authorized yet. RunPod GPU work is not authorized by this prompt.

Deploy private staging: Cloudflare UI/API/Workflow, Neon Postgres, private R2, Better Auth email/password + Google, the locked one-time invite admission policy, and a scale-to-zero Cloud Run Job containing whisper.cpp + FFmpeg. One global shared app, all admitted users equal rights. Jobs use official API invocation, exact R2 inputs/outputs, idempotency, progress/poll/reconcile/cancel, long timeout, and no GPU-lane work. Benchmark representative audio/render before choosing region/vCPU/RAM/timeout. Keep fixture mode safe/default and live GPU dispatch disabled.

Complete all local contracts, adapters, deployment manifests, rollback plan, provider-free tests, and exact resource/cost preflight before the external boundary. Then ask once with a combined proposal naming every create/change/deploy/secret/OAuth/email operation, exact account/project/region/sizing choices and current rates, recurring storage/database/domain charges and retention consent, finite checkpoint estimate, stop conditions, and requested numeric maximum cumulative external spend through handoff. Do not invent a cap. Record approval and continue without another confirmation unless scope, price, sizing, or cap risk changes.

After approval, deploy only the approved resources. Prove signup/login/reset/admission, migration/backup/restore, restart recovery, signed URL/large transfer, CPU job replay/cancel/timeout, artifact hash/probe, secret isolation, and production-mode composition without process-local claims. Run canonical checks and real Chrome staging acceptance. Record current prices, settled finite-action spend, ongoing charges, evidence, deployment/rollback, context/CURRENT_STATE, and commit. Stop before CP-09.
```

## CP-09 implementation prompt

```text
Work on VideoForge checkpoint CP-09 only: One real automatic VideoForge video.

Use concise, factual updates. Read mandatory context and CP-09 in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md. Verify exact Mage/Echo profiles, Echo crops, and hosted staging are accepted. If the CP-09 task brief/read profile or selectors are missing, create, select, and validate the narrow provider-free activation records and continue in this chat.

This request authorizes bounded provider-free CP-09 activation, local application/context changes and tests, owned-input preparation, and read-only current RunPod/hosted-service inventory and rate queries through already configured credentials. The read-only scope has a $0 cap and permits no secret output, mutation, publication, model download, API generation, Pod/job allocation, or spend. No real run is authorized yet. No unbounded retry, fallback, repair, model substitution, or GPU substitution.

Use one owned 60-90 second input. While truly idle, select exact Mage/Echo GPUs and atomically open one session. Run hosted ASR/scheduler/prompts while both Pods boot; use only real Runware, qualified Mage INT8, Echo FP8 short spans, R2 barriers, approved crop, and Cloud Run FFmpeg. No fixture asset or manual edit. Delete a lane immediately if it finishes with no queued demand. Download/show the final 1080p MP4.

Complete owned-input validation, local dry run, exact work counts, shutdown plan, and duration-based estimate first. Then ask once with a combined proposal naming every paid provider operation, the exact selected Mage/Echo GPU offerings and current rates or a short exact choice list, hosted-service rates, input duration/work counts, finite estimate, stop conditions, and requested numeric maximum cumulative spend through handoff. State the already-approved retained-volume rates separately. Ask for the exact GPU pair and paid run authorization together. Do not invent a cap. Record approval and continue without another confirmation unless the proposal changes or cap risk appears.

After approval, run once within the exact proposal. Return immutable end-to-end lineage, actual Pod/GPU/volume/model identities, every timing/cost component, final hash/ffprobe, Chrome play/seek/download result, zero-Pod proof, and retained-volume proof. Stop on first serious failure, mismatch, cap risk, or uncertain cleanup. Ask for my quality decision before promotion. Update gates/evidence/context/CURRENT_STATE and commit; do not start CP-10.
```

## CP-10 implementation prompt

```text
Work on VideoForge checkpoint CP-10 only: Real shared-session queue MVP.

Use concise, factual updates. Read mandatory context and CP-10 in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md. Verify CP-09 output is accepted. If the CP-10 task brief/read profile or selectors are missing, create, select, and validate the narrow provider-free activation records and continue in this chat.

This request authorizes bounded provider-free CP-10 activation, local application/context work and tests, preparation of 2-3 owned short projects, and read-only current GPU/hosted-service inventory and rate queries through already configured credentials. The read-only scope has a $0 cap and permits no secret output, mutation, generation call, Pod/job allocation, or spend. No live session is authorized yet. No GPU/model/rate substitution or extra Pod pair.

Prove the exact MVP: first idle user selects both GPUs; other users only enqueue; all see one global queue and locked pair; waiting entries can be reordered/removed by any admitted user; active cannot. Run one video at a time. Waiting entries perform no ASR, prompt, model, render, or Pod-create work. They may keep an existing lane Pod warm. Prove independent lane deletion when no waiter, late enqueue after one lane absence without early recreation, same-session GPU recreation only after the next project activates and revalidates, unavailable GPU blocker, final queue drain, both-Pod absence, retained volumes, and unlocked next session.

Complete provider-free queue/race/fault validation and the exact bounded session estimate first. Then ask once with a combined proposal naming every paid provider operation, exact selected Mage/Echo GPU offerings and current rates or a short exact choice list, project durations/work counts, hosted-service rates, finite session estimate, stop conditions, and requested numeric maximum cumulative spend through handoff. State retained-volume rates separately. Ask for the exact GPU pair and live session authorization together. Do not invent a cap. Record approval and continue without another confirmation unless scope/rates/availability/cap risk change.

After approval, use multi-session real Chrome plus durable event/cost lineage. Prove no duplicate work/Pod, no cross-project scratch/callback/R2 leak, one final MP4 per project, restart recovery, and correct boot/project/idle/cpu/storage cost attribution. Stop on cap risk, mismatch, ambiguity, or uncertain cleanup. Update evidence/context/CURRENT_STATE, commit, and leave zero Pods.
```

## CP-11 implementation prompt

```text
Work on VideoForge checkpoint CP-11 only: 5-10-user reliability, quality, speed, and 30-minute cost qualification.

Use concise, factual updates. Read mandatory context and CP-11 in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md. Verify CP-10 is accepted. If the CP-11 task brief/read profile or selectors are missing, create, select, and validate the narrow provider-free activation records and continue in this chat.

This request authorizes bounded provider-free CP-11 activation, local application/context work and tests, and read-only provider inventory/rate queries through already configured credentials. The read-only scope has a $0 cap and permits no secret output, mutation, generation call, Pod/job allocation, or spend. Split paid testing into named waves; no wave cap carries forward. Keep one global session, one active video, one Pod per lane, no fallback/repair, and no advanced fairness.

Run provider-free 1/2/5/10-user race/fault/security tests first. Then separately qualify Mage 40 prompts and representative 220-320-image workload, Echo 12-20 exact-avatar clips, and one representative 30-minute or equivalently accounted long-form video. Measure queue wait; cold/warm boot/model-ready; accepted throughput; reject/retry; Cloud Run ASR/render; R2; p50/p90; session boot, project inference, idle, and fixed storage costs. Target <=$1 variable cost and evaluate hard $2 ceiling honestly.

Complete all provider-free tests and prepare every paid wave's exact inputs/work counts before its boundary. For each wave, ask once with a combined proposal naming the operations, exact selected GPU offering(s)/current rates or short exact choice list, hosted-service rates, estimate, stop conditions, and requested numeric maximum cumulative spend for that wave through its handoff. State retained-volume rates separately. Ask for exact choices and paid-wave authorization together; do not invent a cap. After approval, run that wave without another confirmation unless its proposal changes or cap risk appears, then stop for user review before proposing the next wave.

Return contact sheets/clips/full MP4, hashes/probes, raw benchmark tables, actual rates/VRAM, all gates, quality decision points, and zero-Pod/two-volume proof after every paid wave. Tune only from measurements. Update context/CURRENT_STATE/evidence and commit an honest go/no-go. Do not release production.
```

## CP-12 implementation prompt

```text
Work on VideoForge checkpoint CP-12 only: Production release and operating proof.

Use concise, factual updates. Read mandatory context and CP-12 in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md. Verify every required gate is closed or explicitly accepted by the user and CP-11 is green. If the CP-12 task brief/read profile or selectors are missing, create, select, and validate the narrow provider-free activation records and continue in this chat.

This request authorizes bounded provider-free CP-12 activation, local release/context/runbook changes and tests, and narrowly scoped read-only production account/inventory/rate queries through already configured credentials. The read-only scope has a $0 cap and permits no secret output, deployment, DNS/OAuth/secret/resource mutation, generation call, Pod/job allocation, or spend. No production activation is authorized yet. Do not expand features.

Promote pinned staging artifacts/config to production. Configure domain, OAuth, locked invite operations, secrets, backups, retention, monitoring, cost/Pod alerts, rollback, and incident runbooks. Run real Chrome signup/login, idle GPU selection, enqueue/reorder/remove, one bounded generation, playback/download, restart/reconcile, automatic independent lane shutdown, queue drain, and next-session unlock. Archive/quarantine obsolete active entrypoints without rewriting history.

Complete canonical CI, release manifest, exact mutation/rollback plan, smoke inputs, read-only inventory/rates, and finite estimate first. Then ask once with a combined proposal naming every production mutation and smoke operation, exact accounts/projects/regions/resource sizing and rates, exact GPU pair/current rates or short exact choice list, recurring service/retention charges, stop conditions, and requested numeric maximum cumulative release spend through handoff. Ask for exact choices, recurring-charge consent, and production activation together. Do not invent a cap. Record approval and continue without another confirmation unless scope, rates, availability, or cap risk changes.

After approval, prove deployment and rollback, security/restore drill, invited-user acceptance, output hash/probe, settled finite-action cost, ongoing charges, zero Pods, and exactly two retained intended volumes. Document invite issue/revoke, blocked-session repair, ambiguous Pod reconciliation, secret rotation, restore, and separately authorized volume deletion. Update final context/CURRENT_STATE, commit/push only if explicitly requested, and hand back a usable production MVP.
```

## Independent audit prompt for any checkpoint

```text
Independently audit VideoForge checkpoint <CP-ID> at the current repository HEAD. Do not implement fixes, edit files, call paid providers, access credentials, mutate cloud resources, or spend money.

Read AGENTS.md, project-context/00_START_HERE.md, MANIFEST.yaml, CURRENT_STATE.yaml, the exact selected read profile/task brief, the <CP-ID> section of project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md, and the implementation handoff/evidence. Treat fixture/local success as provider-free only. Preserve history and private inputs.

Verify dependency completion, scope/authority, actual diff/commits, contracts/migrations, relevant focused tests, canonical verification, context/schema validators, secret scan, and real Chrome evidence when visible behavior changed. For paid checkpoints, verify recorded immutable provider evidence: exact model/container/volume/GPU/rate, timings, hashes/probes, settled cost versus cap, Pod delete/absence proof, and intended retained volumes. Do not perform a live provider check unless I separately authorize credential access and a read-only audit.

Specifically audit the global MVP invariants: one shared equal-rights app; gated one-time admission; one singleton session; GPU selection only while truly idle; immutable session pair; global waiting-only reorder/remove; one active video; independent lane shutdown at zero demand; no silent substitution; queue-drain zero Pods; separate retained volumes; no active Serverless/Auto/AvatarForcing/MuseTalk/SkyReels/repair/fallback path; and no cross-project artifact/scratch/callback leak.

Return:
1. PASS or FAIL for <CP-ID>.
2. Evidence-backed P0/P1/P2 findings with exact file:line or artifact references.
3. Commands actually run and exit codes.
4. Claims not proven.
5. Whether CURRENT_STATE is truthful and the next checkpoint is safe to start.

Do not praise or repair. If any required proof is missing, fail the checkpoint clearly.
```

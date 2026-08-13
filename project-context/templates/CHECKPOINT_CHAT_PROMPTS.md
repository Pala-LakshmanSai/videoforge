# Checkpoint chat prompts

Use one implementation prompt at a time, in order. Do not paste the whole file into a chat. After
the implementation chat finishes, open a separate audit chat and paste the audit prompt at the end
of this file with the same checkpoint ID.

Every prompt assumes repository `/Users/lakshmansai/Documents/videoforge`. Replace any
`<CAP_USD>` placeholder with a number only after deciding that checkpoint's maximum external spend.
If no number is supplied, provider/cloud mutation authority is `$0` and absent.

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

Use caveman updates. Read mandatory context, exact new task brief/read profile, CP-06 in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md, and current /Volumes/ESD-USB/ImageForge worker source. Verify CP-05 is green. Before any external action, show the exact intended image/template/volume/model/GPU operations, current live rates, derived volume capacity, stop conditions, and total cap. Wait if the brief or authority is incomplete.

Provider/cloud/model-download/image-publication authority for this checkpoint exists only if I replace <CAP_USD> with a number and explicitly say authorized in this chat. Maximum cumulative external spend: $<CAP_USD>. Never exceed it. Never copy/adopt/delete ImageForge resource IDs, volumes, Pods, secrets, or outputs.

Adapt exact current ImageForge Mage INT8 ConvRot: Comfy-Org/Mage-Flow revision d8c99241f6fa80fbd453014234af2bf337ea21e6, pinned ComfyUI revision, exact three files, 4 steps, guidance 1.0, 1280x720, local-files-only manifest verify, actual GPU check, real warm-up, truthful health. Publish immutable VideoForge worker, derive/create/prepare one Mage-only EU-RO-1 volume, query live compatible GPUs, require exact choice, create/verify/delete fresh Pods, and retain only the volume. Run representative owned prompts through at least two fresh Pods.

Return PNGs/contact sheet, hashes/probes, image/manifest/digest/GPU/rate/VRAM, create-to-model-ready/inference/upload/delete timings, settled cost, and independent zero-Pod proof. Ordinary boot must pass with model registries blocked and wrong/missing volume must fail. Stop immediately on cap risk, ambiguity, mismatch, or failed output. Update evidence/gates/context/CURRENT_STATE and commit. Do not start Echo or leave any Pod running.
```

## CP-07 implementation prompt

```text
Work on VideoForge checkpoint CP-07 only: Exact EchoMimicV3-Flash FP8 persistent-volume runtime and renderer crop lock.

Use caveman updates. Read mandatory context, exact selected brief/profile, CP-07 in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md, and pinned Echo preflight evidence. Verify CP-06 is green. Before external work show exact prepared artifact lineage, image/template/volume/GPU operations, live rates, derived capacity, stop conditions, and cap.

External authority exists only if I replace <CAP_USD> and explicitly authorize it here. Maximum cumulative external spend: $<CAP_USD>. No fallback, repair, model substitution, Long Video CFG, full-voiceover job, uncarded pickle, or cross-mount.

Build the VideoForge-prepared FP8 artifact from pinned first-party Flash/Wan/audio lineage. Normal Pod boot verifies and loads from a separate Echo-only EU-RO-1 volume and warms before model_ready; no runtime download or first-request quantization. Implement exact short-span padding/trim/output contracts and project-isolated scratch. Publish image, derive/create/prepare the Echo volume, query exact live compatible GPUs, run owned avatar samples at 2, 4, and 6 seconds on fresh Pods, and retain the volume.

Show playable MP4s with hashes/ffprobe/A-V duration, GPU/rate/VRAM, manifest/digest, cold/warm model-ready/inference/upload/delete timings, settled cost, and zero-Pod/two-volume proof. Measure native geometry and propose Echo-only full/split crops; do not activate crops until I review/approve them. Stop on first ambiguity/mismatch/cap/output failure. Update gates/evidence/context/CURRENT_STATE, commit, and leave no Pod running.
```

## CP-08 implementation prompt

```text
Work on VideoForge checkpoint CP-08 only: Durable hosted staging, invite auth, storage, workflow, and CPU jobs.

Use caveman updates. Read mandatory context, exact brief/profile, and CP-08 in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md. Verify CP-07 is accepted. First inventory required Cloudflare, Neon, Google OAuth, email, R2, and Cloud Run mutations/costs/secrets. Do not mutate until the task brief names exact authority and I approve it.

External/cloud authority exists only with explicit approval and maximum cap $<CAP_USD>. RunPod GPU work is not authorized by this prompt.

Deploy private staging: Cloudflare UI/API/Workflow, Neon Postgres, private R2, Better Auth email/password + Google, the locked one-time invite admission policy, and a scale-to-zero Cloud Run Job containing whisper.cpp + FFmpeg. One global shared app, all admitted users equal rights. Jobs use official API invocation, exact R2 inputs/outputs, idempotency, progress/poll/reconcile/cancel, long timeout, and no GPU-lane work. Benchmark representative audio/render before choosing region/vCPU/RAM/timeout. Keep fixture mode safe/default and live GPU dispatch disabled.

Prove signup/login/reset/admission, migration/backup/restore, restart recovery, signed URL/large transfer, CPU job replay/cancel/timeout, artifact hash/probe, secret isolation, and production-mode composition without process-local claims. Run canonical checks and real Chrome staging acceptance. Record current prices/actual spend, evidence, deployment/rollback, context/CURRENT_STATE, and commit. Stop before CP-09.
```

## CP-09 implementation prompt

```text
Work on VideoForge checkpoint CP-09 only: One real automatic VideoForge video.

Use caveman updates. Read mandatory context, exact brief/profile, and CP-09 in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md. Verify exact Mage/Echo profiles, Echo crops, and hosted staging are accepted. Before spend, show current live GPU pair/rates, duration-based estimate, exact inputs, cap, expected lane shutdown, and stop conditions.

This real run is authorized only if I replace <CAP_USD> and explicitly approve. Maximum cumulative external spend: $<CAP_USD>. No unbounded retry, fallback, repair, model or GPU substitution.

Use one owned 60-90 second input. While truly idle, select exact Mage/Echo GPUs and atomically open one session. Run hosted ASR/scheduler/prompts while both Pods boot; use only real Runware, qualified Mage INT8, Echo FP8 short spans, R2 barriers, approved crop, and Cloud Run FFmpeg. No fixture asset or manual edit. Delete a lane immediately if it finishes with no queued demand. Download/show the final 1080p MP4.

Return immutable end-to-end lineage, actual Pod/GPU/volume/model identities, every timing/cost component, final hash/ffprobe, Chrome play/seek/download result, zero-Pod proof, and retained-volume proof. Stop on first serious failure/cap ambiguity. Ask for my quality decision before promotion. Update gates/evidence/context/CURRENT_STATE and commit; do not start CP-10.
```

## CP-10 implementation prompt

```text
Work on VideoForge checkpoint CP-10 only: Real shared-session queue MVP.

Use caveman updates. Read mandatory context, exact brief/profile, and CP-10 in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md. Verify CP-09 output is accepted. Prepare 2-3 owned short projects and a bounded session cost estimate before asking for external authority.

Live authority exists only if I replace <CAP_USD> and explicitly approve. Maximum total session spend: $<CAP_USD>. No GPU/model/rate substitution or extra Pod pair.

Prove the exact MVP: first idle user selects both GPUs; other users only enqueue; all see one global queue and locked pair; waiting entries can be reordered/removed by any admitted user; active cannot. Run one video at a time. Waiting entries perform no ASR, prompt, model, render, or Pod-create work. They may keep an existing lane Pod warm. Prove independent lane deletion when no waiter, late enqueue after one lane absence without early recreation, same-session GPU recreation only after the next project activates and revalidates, unavailable GPU blocker, final queue drain, both-Pod absence, retained volumes, and unlocked next session.

Use multi-session real Chrome plus durable event/cost lineage. Prove no duplicate work/Pod, no cross-project scratch/callback/R2 leak, one final MP4 per project, restart recovery, and correct boot/project/idle/cpu/storage cost attribution. Stop on cap/ambiguity. Update evidence/context/CURRENT_STATE, commit, and leave zero Pods.
```

## CP-11 implementation prompt

```text
Work on VideoForge checkpoint CP-11 only: 5-10-user reliability, quality, speed, and 30-minute cost qualification.

Use caveman updates. Read mandatory context, exact brief/profile, and CP-11 in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md. Verify CP-10 is accepted. Split paid testing into explicit waves; show each wave's exact cap and stop after it for review. No cap carries to another wave.

Provider work is unauthorized until I approve each named wave and replace its <CAP_USD>. Keep one global session, one active video, one Pod per lane, no fallback/repair, no advanced fairness.

Run provider-free 1/2/5/10-user race/fault/security tests first. Then separately qualify Mage 40 prompts and representative 220-320-image workload, Echo 12-20 exact-avatar clips, and one representative 30-minute or equivalently accounted long-form video. Measure queue wait; cold/warm boot/model-ready; accepted throughput; reject/retry; Cloud Run ASR/render; R2; p50/p90; session boot, project inference, idle, and fixed storage costs. Target <=$1 variable cost and evaluate hard $2 ceiling honestly.

Return contact sheets/clips/full MP4, hashes/probes, raw benchmark tables, actual rates/VRAM, all gates, quality decision points, and zero-Pod/two-volume proof after every paid wave. Tune only from measurements. Update context/CURRENT_STATE/evidence and commit an honest go/no-go. Do not release production.
```

## CP-12 implementation prompt

```text
Work on VideoForge checkpoint CP-12 only: Production release and operating proof.

Use caveman updates. Read mandatory context, exact release brief/profile, and CP-12 in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md. Verify every required gate is closed or explicitly accepted by the user and CP-11 is green. Present exact production mutations, rollback, release smoke inputs, current rate/cap, and stop conditions before activation.

Production authority exists only if I replace <CAP_USD> and explicitly approve it. Maximum release-smoke external spend: $<CAP_USD>. Do not expand features.

Promote pinned staging artifacts/config to production. Configure domain, OAuth, locked invite operations, secrets, backups, retention, monitoring, cost/Pod alerts, rollback, and incident runbooks. Run real Chrome signup/login, idle GPU selection, enqueue/reorder/remove, one bounded generation, playback/download, restart/reconcile, automatic independent lane shutdown, queue drain, and next-session unlock. Archive/quarantine obsolete active entrypoints without rewriting history.

Prove canonical CI, deployment and rollback, security/restore drill, invited-user acceptance, output hash/probe, settled cost, zero Pods, and exactly two retained intended volumes. Document invite issue/revoke, blocked-session repair, ambiguous Pod reconciliation, secret rotation, restore, and separately authorized volume deletion. Update final context/CURRENT_STATE, commit/push only if explicitly requested, and hand back a usable production MVP.
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

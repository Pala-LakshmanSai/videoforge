# VideoForge v2 fast completion checkpoints

Status: authoritative completion roadmap reconciled to the exact 2026-09-03 repository state

This file is the handoff map for new chats. V2-00 through V2-06 are accepted foundations and must
not be reimplemented. From V2-07 onward, use the product and certification tracks below: make small
green provider-free integration commits while live qualifications proceed as separately sealed
atomic gates. Use the paired read-only audit prompt at material integration and certification
boundaries.

## Locked product destination

VideoForge is a private hosted video-production app for 5–10 invited accounts. Every account owns
one default workspace and its own durable projects, revisions, voiceovers, Avatar Profiles, Image
Styles, queue rows, generation state, retries, costs, outputs, downloads, and paired personal-worker
state. Browser state is a view of server truth, not the source of truth. Cross-account reads,
writes, queue control, object discovery, callbacks, logs, or result access are forbidden.

Production compute is autoscaling only:

| Lane | Exact runtime | Production shape |
|---|---|---|
| Images | Mage-Flow INT8 ConvRot | Queue-based RunPod Serverless, `EU-RO-1`, existing sealed Mage 50 GB volume at `/runpod-volume`, RTX 4090, `workersMin=0`, target `workersMax=2` |
| Avatar | SoulX-FlashHead Pro BF16 | Separate queue-based RunPod Serverless endpoint, existing sealed SoulX 50 GB volume at `/runpod-volume`, RTX 4090, `workersMin=0`, target `workersMax=2` |

Postgres owns admission and fairness: at most one active provider workload per account and two
different accounts globally. Additional work waits durably and fairly. Users never select GPUs or
start, stop, create, or delete Pods/workers. RunPod scales from zero on admitted demand and drains
back to zero. Model volumes are application-read-only; tenant media uses private R2 and job-local
scratch.

The output grammar remains full avatar, full image, or avatar-left/image-right split; hard cuts;
subtle centered image zoom; no captions, text overlays, borders, title cards, motion graphics,
watermarks, or decorative transitions. The representative 30-minute variable-cost target is
`<= $1.00`; the hard ceiling is `<= $2.00`. The two retained-volume charges are fixed infrastructure
reported separately.

## Exact current state

Repository truth at the 2026-09-03 handoff:

- source `ffcc89c2` remains the historical accepted Stage 5 baseline. Current source `21d11528` /
  Worker `426c9d0e…` contains v15 and is deployed. Fresh project `0cb767d9…` passed the immediate
  disk gate, completed Stages 1–3, then stopped at Cloudflare HTTP 503 `exceededCpu` during Stage 4
  before Stage 5. No retry or provider retrieval occurred; the project and authority are consumed.
  Provider-free repair `ac0344d3` narrows the lazy planning validator chunk from 2,727,968 to
  327,179 bytes with unchanged contracts and adds a 512 KiB bundle gate. It is not deployed; v15
  remains live-unqualified;
- V2-07 Attempt64 is closed `NOT_QUALIFIED` after `RUNPOD_ZERO_NOT_CONFIRMED`; exact cleanup and
  three stable reads prove zero compute/disposables with both retained volumes unchanged, and its
  proposal, authority, cap, and run are consumed and non-reusable;
- repair `1283a23` bounded-polls asynchronous cancellation shutdown and passed independent audit,
  but later authenticated-envelope source `9ef6efa` changed the Mage handler/image bytes. Every
  previous Mage image-bound qualification is therefore invalid for activation;
- a fresh immutable Mage image build/publication record, sealed deployment snapshot, atomic live
  qualification, and independent audit remain required; there is no current candidate, live
  authority, cap, provider permission, GPU permission, or spend permission;
- historical RunPod rates, capacity, billing, and the combined `$7/month` retained-volume planning
  charge are not current execution truth. Refresh them read-only before any new exact proposal.

### Complete and reusable — do not rebuild

| Capability | Status | Reuse in |
|---|---|---|
| Invite-only Google auth, account/default-workspace tenancy, Neon FORCE RLS, private R2 | Hosted and independently accepted | V2-09 onward |
| Fair queue: one workload/account, two different accounts globally, 5–10-account provider-free contention | Green | Live proof only in V2-11 |
| Serverless v3 authority, outbox, assignment, signed receipts, result reconciliation, recovery | Green provider-free | V2-07/V2-08 adapters |
| Word-level voiceover transcript with pinned `whisper.cpp 1.8.4 base.en` | Green, including chunk/reconcile/restart receipts | V2-09 integration only |
| `scheduler-v2` voiceover splitting and all three compositions | Green; 30-minute fixture measured 21.05% avatar coverage | V2-09 integration only |
| Prompt/style path and `documentary_stock_v1` | Green foundation | V2-09/V2-10 |
| Mage exact model bytes, sealed volume, and historical Pod samples | Preserved foundation; prior image invalid after envelope change | V2-07 fresh image and qualification |
| SoulX exact model bytes, sealed volume, and Pod native/full/split samples | Preserved foundation; prior image candidate invalid after envelope change | V2-08 fresh image, visual/license, and qualification |
| Direct FFmpeg renderer and account-owned macOS/Windows personal media worker | Hosted live accepted | V2-09 onward |
| Current UI and visible feature set | Accepted; preserve it | Infrastructure truth only |

### Still missing

- one fresh immutable Mage image and exact accepted Serverless qualification after the authenticated-envelope change;
- SoulX deployability record, user crop/visual approval, and Serverless handler/endpoint proof;
- a real hosted adapter from tenant admission through transcript/scheduler/prompts to Mage/SoulX,
  durable asset barrier, render plan, personal-worker render, review, and download;
- one automatic short real project and one 3–5-minute Ranga-style project;
- live two-user Serverless autoscaling while additional users wait fairly;
- one representative production-length quality/cost measurement;
- essential security, spend guards, backup/rollback, observability, and invited-team release proof.

## Architecture cleanup map

Do not mass-delete legacy code before the first real hosted E2E. Preserve committed migrations and
immutable evidence. Remove or narrow surfaces only when their replacement is proved.

| Surface | Current treatment | Removal checkpoint |
|---|---|---|
| Singleton global session, global user catalogs, manual Pod lifecycle, per-user GPU selectors, Pod-bound envelopes | Database write-fenced, runtime-firewalled, compatibility/fixture only | Keep migrations immutable; remove remaining public exports and production imports only after the V2-09 provider-free bridge and short hosted E2E are green |
| `FakeServerlessEndpoint` and fixture execution profiles | Useful provider-free test adapter; never production transport | Keep in test/fixture entrypoints; production bundle firewall in V2-09/V2-13 |
| Hosted `gpu_transport: DISABLED_FAKE_ONLY` and missing fair-admission/GPU composition | Truthful today but blocks real production | Replace with qualified endpoint adapters and durable hosted orchestration in V2-09 |
| Production build mode mismatch that can emit fixture client while Worker expects production | Open P1 | Fix and bundle-scan in V2-09 before deploy |
| Old Pod qualification/operator scripts | Not imported by the production Worker; some still support evidence | Archive/remove only after V2-08/V2-09 import-graph proof |
| Fixture/developer controls | Keep for development | Strip or fail-closed from production bundle in V2-13 |

Never rewrite old migrations or delete evidence required by an active gate. Never promote the fake
runtime as the real adapter.

## Fast verification policy

The goal is visible progress without repeating unchanged proof.

For every checkpoint:

1. Run only focused tests for changed modules, the touched workspace typecheck/build, and
   `git diff --check`.
2. Run context/schema validators only when context, contracts, schemas, gates, or selectors change.
3. Run one real-Chrome happy path only when visible behavior changes.
4. For paid work, prioritize exact identity, durable output/receipt, settled cost, volume integrity,
   and zero endpoint jobs/zero total workers after drain.
5. Run the canonical provider-free aggregate at V2-09 integration and V2-13 release, or earlier only
   when a shared contract/runtime change makes focused proof insufficient.
6. Reuse accepted unchanged evidence. Do not rerun a broad suite to increase a test count.
7. Allow one narrow repair cycle for the observed checkpoint failure. A second unrelated failure is
   a small named repair checkpoint, not an expanding multi-day chat.

Tenant isolation, authority/cap checks, artifact lineage, model-volume protection, and paid-compute
cleanup are never reduced. P0/P1 blocks promotion. P2 is recorded for V2-13 unless it directly
breaks the checkpoint outcome.

## Product track and certification track

Provider-free implementation for V2-08 through V2-13 may proceed in parallel immediately. This
includes handlers behind fixture transport, hosted composition, UI, security, cost guards,
observability, runbooks, and focused integration tests. Mark every unqualified lane and live path
fail-closed; provider-free progress is never described as deployed, live-qualified, or production
ready. Prefer one bounded integration commit per working day.

Live acceptance remains serial and release-gated:

1. V2-07 Mage atomic certifications;
2. V2-08 SoulX atomic certifications after Mage live PASS;
3. V2-09 through V2-12 bounded live acceptance in dependency order;
4. V2-13 final smoke, independent drain, and release.

For each lane, seal atomic evidence separately for compute/output identity, cancel/timeout, and
max-two/concurrent readers. Successful atomic evidence remains reusable for 24 hours
only when image digest, complete source hash, endpoint-template/config hash, volume-manifest hash,
GPU hash, and region hash are identical and no relevant dependency or acceptance contract changed;
each atomic record also binds that run's disposable provider endpoint identity. A later
unrelated failure does not erase matching successful evidence. Expired or mismatched evidence must
be rerun only for the affected atomic gate. Final release always requires a fresh bounded two-lane
smoke and independent zero-job/zero-worker drain/inventory readback.

## Aggressive overlapping order

This is a best-case plan, not a guarantee. It assumes provider capacity, timely spend approval and
visual review, and no second unrelated provider defect.

| Day | Checkpoints | Visible result |
|---|---|---|
| Day 1 | Product: V2-08/V2-09 provider-free. Certification: V2-07 atomic gates | SoulX handler and hosted bridge advance while Mage capacity is pursued |
| Day 2 | Product: V2-10–V2-13 preparation. Certification: Mage/SoulX serial gates | Product integration and hardening continue without claiming live activation |
| Day 3+ | Live V2-09–V2-12 gates; V2-13 final smoke/drain/release | Release only after both lanes and all live dependencies pass |

Expected active work is roughly 25–36 hours across the seven checkpoints. Provider cold starts,
capacity, visual rejection, or a new integration defect can extend elapsed time. Do not hide a
failed gate to preserve the calendar.

## Dependency map

```text
V2-00..V2-06 accepted foundations
  -> product track: V2-08..V2-13 provider-free implementation in parallel
  -> certification track: V2-07 Mage -> V2-08 SoulX -> V2-09..V2-12 live gates
  -> V2-13 final two-lane smoke + independent drain -> invited-team release
```

## V2-00 through V2-06 — complete; do not reopen

- V2-00: architecture/context reset.
- V2-01: tenant-private identity and data.
- V2-02: tenant-private artifacts, signed transfer, and scratch.
- V2-03: fair one/account, two-global admission.
- V2-04: Serverless v3 contracts, authority, outbox, receipts, and recovery.
- V2-05: provider-free runtime cutover and legacy firewall.
- V2-06: hosted auth/Neon/R2/Workflow plus macOS/Windows personal media workers.

If a successor exposes a regression in one of these, repair only the reproduced regression inside
the current checkpoint. Do not restart the old checkpoint or its full test matrix.

## V2-07 — close Mage Serverless qualification

**Timebox:** capacity-dependent; keep each live gate atomic and bounded.

**Starting point:** Attempt64 is closed clean and non-reusable. Its post-cancel repair is audited,
but the later authenticated-envelope verifier changed the Mage handler/image bytes, so the prior
published image and all image-bound qualification evidence are invalid for activation. V2-07 is
`NOT_QUALIFIED` with no current candidate or live authority.

**Work:**

- reconcile current HEAD/context, the authenticated-envelope bytes, and the audited Attempt64
  cancellation repair; never reuse an earlier attempt, proposal, authority, cap, or image digest;
- prepare and audit a fresh immutable Mage image definition from current committed source without
  redownloading/changing the model or writing, cross-mounting, or deleting either retained volume;
- finish provider-free and narrowly scoped read-only inventory/rate preflight, then stop once for an
  exact image-publication/deployment/atomic-qualification operations, rates, estimate, cleanup, and
  stop-condition proposal with a fresh user-supplied finite cap;
- after exact approval, execute only the bound atomic gate once, with no blind retry or redispatch;
- accept only durable 1280×720 outputs, tenant artifact readbacks, signed v3 receipts, exact timing/
  VRAM/cost, unchanged Mage manifest, terminal jobs, zero total workers, and intended volumes only.

**Essential proof:** fresh image digest and sealed-source readback, candidate validator, any test
directly touched by a repair, exact paid evidence, settled cost, and independent drain/inventory
readback. Do not rerun hundreds of unchanged tests.

**Stop live work:** identity drift, cap risk, missing durable receipt, unexpected second dispatch,
volume uncertainty, cleanup uncertainty, or a second unrelated failure. V2-08 live activation
remains blocked until Mage audit PASS; V2-08 through V2-13 provider-free product work may continue.

## V2-08 — SoulX Serverless and visual activation

**Timebox:** 4–6 hours best case.

**Starting point:** exact SoulX Pro BF16 bytes, sealed 50 GB volume, and owned native/full/split Pod
samples exist. The former image candidate is historical and invalid for activation after the
authenticated-envelope byte change. Provider-free handler/integration work and exact crop approval
are preserved; a fresh image, Serverless live activation, deployability record, and cost are open.

**Work:**

- first show the existing native/full/split samples at `$0` and obtain explicit visual/crop
  acceptance or one precise rejection note;
- record exact first-party code/weight terms and the user's explicit risk decision without claiming
  clearer permission than the source artifacts provide;
- wrap only the exact existing runtime as a Serverless v3 whole-span-batch handler using
  `/runpod-volume`, signed private artifact ports, job-local scratch, durable per-span resume, and
  one native clip reused for full/split render compositions;
- publish/configure a max1 `EU-RO-1` RTX 4090 scale-to-zero endpoint only after one exact proposal and
  fresh cap; do not download/repair/enhance/substitute the model or mutate the volume;
- set `RUNPOD_INIT_TIMEOUT` deliberately and require cold `MODEL_READY` below the documented
  seven-minute unhealthy threshold;
- qualify cold and warm max1 execution for one small representative 2/4/6/10-second span batch,
  native/full/split playback, exact A/V, receipt/readback, timings/VRAM/cost, focused request/status/
  reconcile/cancel/invalid-output/timeout behavior, unchanged volume, and workers=0. Reuse the
  accepted Pod samples for avatar/phoneme/head-motion/hair/hat/background breadth.

**Essential proof:** focused handler/contract tests, one synthetic batch, exact image/config readback,
init-timeout/cold/warm/focused-fault evidence, ffprobe/hash/receipt checks, user visual approval,
settled cost, and drain. A PASS permits bounded max1 V2-09/V2-10 dispatch. Move SoulX max2 live proof
to V2-11 so V2-08 does not duplicate concurrency testing.

## V2-09 — real hosted bridge and one short E2E

**Timebox:** 5–6 hours best case.

**Outcome:** one owned 30–60-second project goes from Generate to a private playable MP4 with no
manual media edit or fake GPU asset.

**Work:**

- fix hosted production-mode/client-mode truth and extend the emitted production-bundle firewall;
- compose hosted tenant repositories, fair admission, durable account/workspace-owned tenant project/
  stage state, Serverless outbox/runtime, real Mage/SoulX adapters, private R2 artifact barrier, and
  personal-worker render-plan materialization;
- reuse the existing word transcript, scheduler-v2 voiceover spans, three compositions, prompt path,
  and renderer; do not reimplement them;
- keep the fake adapter only in fixture/test entrypoints and remove legacy public/root exports from
  the production graph only after transitive-import proof, the provider-free bridge, and the short
  hosted E2E are green;
- pass one provider-free journey plus success, one resume/cancel, and a focused foreign-tenant
  negative matrix over the newly composed assignment, callback, signed-R2-port, artifact-barrier,
  render-plan, and result paths;
- complete one exact deployment/live proposal and cap, then run one short owned project through the
  actual hosted app and real Chrome.

**Essential proof:** touched-package tests/typecheck/build, production bundle scan, canonical
provider-free aggregate once, one Chrome Generate/play/seek/download journey, exact lineage and
ffprobe, the changed-surface tenant-negative matrix, itemized cost, and workers=0.

**Working-app milestone:** after V2-09 PASS, the product is a functional single-video private beta.
Do not call it 5–10-user ready until V2-11.

## V2-10 — automatic 3–5-minute Ranga-style pilot

**Timebox:** 3–5 hours best case.

**Outcome:** one real final voiceover produces an operator-free 3–5-minute MP4 using the existing
deterministic scheduler and exact model lanes.

**Work and proof:**

- freeze one owned voiceover, Avatar Profile version/crop, Image Style version, expected work counts,
  cost estimate, and review rubric before paid execution;
- after one exact proposal/cap, run once with no manual timeline or asset substitution;
- review every cut for literal relevance, documentary realism, crop/lips/background, hard cuts,
  slow zoom, prohibited graphics, A/V, and the pinned cadence/composition metrics;
- show the final in real Chrome with metric report, hashes/probes, retries, settled itemized cost,
  user visual decision, and workers=0.

Use existing scheduler metric tests. Do not run the 300-image suite here. Fix only defects actually
observed in this pilot, with one reproduction test per fix.

## V2-11 — live two-user autoscaling, fairness, and essential recovery

**Timebox:** 3–4 hours best case.

**Outcome:** two different accounts can generate concurrently; a same-account second job and every
additional account wait durably/fairly; both endpoints return to zero.

**Work and proof:**

- reuse the already-green provider-free 10-account admission evidence and rerun only its focused
  contention test if queue code changed;
- stage/pin max2 only after each exact lane has passed max1; `REQUEST_COUNT=1`, handler concurrency 1,
  and Postgres admission remain locked;
- deliberately exercise two simultaneous read-only workers on Mage and two on SoulX against each
  exact shared sealed volume; prove unchanged pre/post manifests and exact max1/max2 config readback/
  restoration;
- run two short owned projects from two accounts concurrently, show a same-account second request
  waiting and a third account queued, then show fair promotion and private status;
- exercise one essential failure/recovery path chosen from the real run plus cancel/reconciliation;
  do not execute the exhaustive historical fault matrix;
- prove no cross-tenant state/artifact/cost, at most two active videos and four total GPU workers,
  accepted-output uniqueness/duplicate-cost visibility, valid results, terminal jobs, and both
  endpoints `0 -> demand/max2 -> 0`, with zero endpoint jobs and zero workers after drain.

This checkpoint closes 5–10-user admission/readiness even though only two videos run simultaneously.

## V2-12 — production-length quality, speed, and economics

**Timebox:** 4–6 hours best case.

**Outcome:** one owned automatic video with final duration between 29 and 31 minutes plus accumulated
accepted checkpoint evidence provides an honest first production-length quality/cost decision.

**Work and proof:**

- freeze exact work counts, endpoint configs, cost forecast, quality rubric, cap, and stop threshold;
- execute one 29-31-minute run only after exact approval; stop before dispatch if the conservative
  estimate exceeds the approved cap or `$2` hard ceiling. A shorter run cannot close the
  production-length quality or economics gate;
- review the output and report queue, cold/warm, init/inference/upload/render timings, retries/
  duplicates, settled variable cost, and fixed volume/storage charges separately;
- evaluate the `$1` target and `$2` ceiling without hiding failed attempts, local device occupancy,
  or fixed charges;
- use real checkpoint outputs for style/image/avatar quality. The 300-image/five-style suite and ten
  artificial jobs are deferred; accumulate ten organic beta jobs later for p50/p90 confidence and
  run a broad style suite only if real samples reveal a style problem.

**Stop:** quality rejection, cost ceiling miss, uncertain cleanup, or model/config drift. Present the
measured dominant cost and a bounded decision; do not silently change models, GPU, resolution,
composition, or quality.

## V2-13 — invited-team production release

**Timebox:** 3–5 hours best case.

**Outcome:** the exact accepted system is safely usable by 5–10 invited accounts with two concurrent
videos, autoscaling GPU lanes, durable account/workspace-owned tenant state, caps, recovery, and no
developer-operated Pod lifecycle.

**Work:**

- close essential auth/session/origin/rate-limit, tenant/R2/callback/SSRF/path/upload, secret/log,
  cost-amplification, and legacy-runtime production-bundle risks; no P0/P1 may remain;
- add per-project and global spend stops, quotas, queue/endpoint/worker/drain alerts, concise stuck-
  job/provider-outage/billing/rollback runbooks, backup readback, and pinned rollback identities;
- ensure production builds use hosted client/API truth and contain no fixture controls, fake GPU
  profile, manual Pod/GPU controls, or legacy public dispatch exports;
- run canonical provider-free verification once, secret/container/dependency scans, one backup/
  rollback readback, one release-current hosted control-plane restart/reconcile with no duplicate
  dispatch or foreign result, and one production Chrome smoke; perform a disposable restore only if
  V2-09 through V2-13 changed schemas/migrations, otherwise cite accepted V2-06 restore evidence;
  deploy only after one exact proposal/cap;
- hand off exact production URL/commit/image/endpoint/config identities, invitations, operating
  steps, settled cost, recurring charges, terminal jobs, zero workers, and remaining non-blocking P2s.

This closes the project for invited production use. Broader cross-browser/accessibility matrices,
ten-job statistics, exhaustive provider fault injection, and sample-driven aesthetic tuning continue
from real usage without reopening the architecture.

## Every-checkpoint handoff contract

Each implementation chat must report:

1. checkpoint and outcome;
2. base and handoff commit;
3. changed files/modules;
4. exact focused validations and exits;
5. Chrome/live evidence only where required;
6. remaining P0/P1/P2 and successor safety;
7. provider authority/cap, actual spend, endpoint jobs/workers, retained volumes, and recurring cost;
8. `CURRENT_STATE.yaml` selector for the next checkpoint.

The paired audit chat is read-only and does not fix. It returns PASS/FAIL with exact evidence. A P0
or P1 returns to the same checkpoint for one narrow repair and re-audit; otherwise move forward.

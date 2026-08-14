# Implementation and live-development playbook

Status: normative development experience  
Read when: starting/resuming coding, handing work between chats/agents, running the app in Chrome, or preparing a commit.

## Outcome

Development must feel continuous and inspectable: the user can keep one stable Chrome tab open, see each working increment through hot reload, and report breakage while it is introduced. Backend/model uncertainty is isolated behind fixtures and adapters rather than blocking the visible app.

The active production target has exactly two independent GPU lanes: ImageForge-aligned Mage-Flow
INT8 ConvRot and EchoMimicV3-Flash Turbo FP8. Each has its own persistent `EU-RO-1` model volume and its
own disposable Pod. No model volume, Pod, manifest, cache, lock, or adoption path is shared.

MVP application state is global and shared for 5–10 admitted users: one catalog, project list,
queue, result library, and singleton generation session. Every user has equal rights; there are no
roles or tenants. Only the first Generate while idle selects one exact Mage/Echo GPU pair. Until the
queue drains and both Pods are absent, later users can only add, reorder, or remove waiting projects,
and all work inherits that pair. Exactly one project runs at a time.

Production whisper.cpp word transcription and FFmpeg render/probe use pinned Cloud Run Jobs invoked
through authenticated REST with private R2 artifacts. Mac execution is development/provider-free
parity only and never production evidence.

Heavy x86 container builds and storage/RAM-intensive verification run on the public repository's
standard GitHub-hosted `ubuntu-24.04` runner, not on the user's Mac. Build-only workflows use
ephemeral runner storage, upload no image/model/output artifact or cache, and publish nothing.
Larger billed runners require separate authority. Production services, workers, models, and retained
data must be hosted and must never depend on the user's Mac. This is `DEC_BUILD_001`.

`21_IMPLEMENTATION_EXECUTION_PLAN.md` owns task order and safe parallelism. `CURRENT_STATE.yaml` selects the next wave.

## First-session order

Implementation starts only when the user authorizes it.

1. Initialize a Git repository. It may be public under `DEC_BUILD_001`; never publish third-party
   Ranga/UI research assets, private style references, generated outputs, secrets, or model weights.
2. Create the contract-first monorepo described in `12_DEVELOPMENT_PLAN.md`.
3. Add `.env.example` with names/placeholders only; real provider mode remains disabled.
4. Implement these stable root commands before feature work:
   - `pnpm doctor` — verify pinned Node/pnpm/Python/FFmpeg versions, required fixture files, env-name completeness, port ownership, and local prerequisites without printing secrets or calling providers.
   - `pnpm doctor --json` — emit the same exit-code-equivalent checks as deterministic `videoforge.doctor/v1` JSON. It exposes environment names and prerequisite/ownership facts only, never values.
   - `pnpm dev` — start or reuse the fixture web app on exactly `http://localhost:4173`; never silently choose another port. If an unrelated process owns the port, fail with its PID/process name and recovery guidance.
   - `pnpm dev:status` — query `GET /api/health` and report URL, PID/process owner, mode, commit, health, and active fixture without starting a duplicate server. The health response exposes no secrets.
   - `pnpm dev:stop` — stop only the supervisor recorded by VideoForge after its process tree, strict ports, commit/mode, and provider-free health identity still match. Missing, stale, foreign, or ambiguous ownership never receives a signal or force-kill.
   - `pnpm dev:open` — open or focus the stable route in the user's real Chrome after the health check passes.
   - `pnpm test` — local unit/schema tests.
   - `pnpm python:sync` — use exactly `uv 0.8.13` and `uv.lock` to install the complete Python 3.12 contracts/worker workspace; no package may use a second installer workflow.
   - `pnpm python:lint` — run locked Ruff checks and formatting verification without syncing or downloading dependencies.
   - `pnpm test:chrome` — Playwright smoke against the running stable URL.
   - `pnpm secret:scan` — detect tracked secrets without echoing values.
   - `pnpm verify:fast` — non-release, provider-free feedback gate covering format/static/type/generated/contract checks plus deterministic package, script, and worker suites through one non-duplicating Turbo graph. It excludes local Workerd and installed-Chrome journeys and must never be cited as release evidence.
   - `pnpm verify` — canonical provider-free aggregate containing every `verify:fast` check, local Workerd parity, and all installed-Chrome journeys. Workerd may overlap only port-free fast checks; installed Chrome runs after the Workerd server releases the strict loopback port. It must not call external providers and starts/stops only test servers it owns, never the user's unrelated process.
   - `pnpm context:validate` — invoke both `project-context/scripts/validate-context.sh` and `project-context/scripts/validate-schemas.sh`; after the monorepo installs pinned Ajv, this is network-free.
   - `pnpm local:doctor` — separately verify real local-media tools and the explicitly fetched Whisper model; ordinary `doctor`/`verify` must not download it.
   - `pnpm test:local-slice` — run the provider-free real-media acceptance slice only when its local prerequisites are present.
5. Convert the context schemas into shared TypeScript/Zod and Python/Pydantic contracts, with golden cross-language fixtures.
6. Open the real app in the user's Chrome and keep it available during user-visible work.
7. Update `CURRENT_STATE.yaml` with branch/base commit, URL/server state, active task owner, last green commands, and one exact `recommended_next_task` ID/profile/budget for the next chat.

When `recommended_next_task` names a file under `project-context/tasks/`, that brief is the
implementation contract for the next chat. Read its one named profile, do not broaden it into the
next phase, and update the same snapshot to the following task only after a committed green
handoff.

If a command cannot yet exist, the current milestone owns creating it. Do not invent a different ad-hoc start command in every chat.

## Current architecture implementation order

This order is binding. Do not jump directly from historical scripts to another paid sample:

1. Version provider-free contracts/fixtures for one global admission boundary, singleton generation
   session, optimistic shared queue, inherited GPU pair, two model-volume bindings, Pod
   reconciliation/readiness, lane demand, durable results, cost, and session-close absence proof.
   Preserve every existing v1 byte; do not claim the blueprint is already implemented.
2. Complete invite-only signup and the shared queue/session UI in fixtures: email/password or
   Google, one unique single-use email-bound invite for new users, verified-email equality, equal
   rights, idle GPU selectors, and queue-only behavior while a session is open.
3. Build the pinned Cloud Run Job media worker plus Mac parity path for whisper.cpp and FFmpeg.
   Validate REST execution contracts and R2 barriers provider-free before any deployment; region
   and sizing remain benchmark-gated.
4. Build pinned offline Mage and Echo workers. Ordinary boot may not download a model, install a
   package, or compile source. Missing/corrupt/wrong/cross-model manifests fail closed. Reuse only
   matching ImageForge mechanics, not its resource identities or desktop ownership model.
5. Under separate explicit provider authority, provision and prepare one new VideoForge Mage volume
   and one new VideoForge Echo volume in `EU-RO-1`. Do not reuse ImageForge IDs, secrets, or volume.
6. Implement idle-only compatible inventory, atomic pair/session lock, one-project dispatch,
   queue inheritance, exact Pod create/reconcile/reuse, independent zero-lane-demand deletion, and
   session close only after queue-empty plus both-Pods-absent. A warm Pod may survive for waiting
   demand, but waiting work never starts before its entry becomes the only active project.
7. Qualify CPU, Mage, and Echo paths with bounded owned samples; then run queued Generate-to-MP4 in
   real Chrome. Preserve model-ready/generation/render timings, cost, hashes/probes, independent
   lane-deletion proof, and final zero-Pod/session-closed proof.

Every real-provider task is bounded by one exact brief. Volume creation/preparation and ordinary Pod
generation are different mutations and require explicit authority for the one being performed.

For `CP-06` through `CP-12`, a pasted checkpoint implementation prompt is also provider-free
activation authority. If its selected profile or brief does not exist yet, create the narrow
profile/brief, update both selectors, validate them, and continue local work in the same chat. Do
not turn missing selectors into a user round trip. Missing paid authority blocks only the first
external mutation or paid action, not local inspection, implementation, tests, image builds that do
not publish, or the prompt's explicitly authorized read-only inventory/rate preflight.

For CP-06, the `mage-image` workflow's default `publish=false` path is Phase A build-only
qualification on a standard public runner. `publish=true` is a separate Phase B mutation and may run
only after its exact authorization is persisted. Never fall back to local x86 emulation on the
user's Mac when the hosted build fails; fix the hosted workflow or source instead.

## Repository/deployable shape

```text
apps/web/                  React/Vite UI + same-origin Hono Worker API
workers/image-media/       Python: target Mage INT8 Pod service and existing fixture adapters
workers/avatar-primary/    Python: target EchoMimicV3-Flash Turbo FP8 Pod service
workers/media-local/       Shared ASR/render contract: Cloud Run Job production + Mac dev parity
packages/contracts/        JSON Schema, Zod/Pydantic generation, fixtures
packages/config/           Versioned non-secret runtime profiles
packages/test-fixtures/    Owned/synthetic deterministic fixture assets
project-context/           Product/architecture truth
```

The Cloudflare Vite plugin serves the SPA and Hono `/api/*` from one Worker project and one origin.
Workflows/R2/Neon bindings attach to that deployment. Cloud Run transcription/timeline preparation
may overlap GPU boot; final Cloud Run render begins after its asset barrier. Mage and Echo remain
separate Python runtimes because their models, dependencies, manifests, volumes, compatible GPUs,
readiness, demand, and deletion lifecycles differ.

Use digest-pinned prebuilt images and measure pull/cache behavior and cold-start impact. Large model
files stay on their lane's exact persistent RunPod volume, not inside giant container images. The
ordinary worker verifies the canonical volume manifest and loads locally/offline. Only a separately
authorized one-time preparation tool may populate model files.

## Development modes

| Mode | External spend | Purpose |
|---|---:|---|
| `fixture` | $0 | Default UI/human/Playwright work with deterministic states |
| `local` | $0 | Local whisper/FFmpeg and local contract tests |
| `sandbox` | Explicit task cap only | Small Runware/RunPod viability or integration fixture |
| `staging` | Explicit account-mutation and task caps | Isolated production-like Cloudflare/Neon/R2/OAuth acceptance after VF-1-06 |
| `production` | Global/project caps | Only after gates, credentials, and deployment approval |

Default is `fixture`. Provider authority has three explicit modes:

- `none`: `provider_calls_authorized: false`, no credential access, no external call, and `$0`.
- `read_only`: `provider_calls_authorized: true`, a named provider and allowlisted inventory/rate
  operations through already configured credentials, no secret output, no remote mutation,
  publication, model download, compute allocation, or spend, and a numeric cap of `0`.
- `paid`: `provider_calls_authorized: true`, a positive numeric finite-action cap, exact provider and
  model/resource scope, non-transferable authority, user-authorization timestamp, cleanup evidence,
  and every selected rate/resource identity required by the checkpoint.

The implementation prompts for paid checkpoints authorize bounded local work plus only their named
`read_only` preflight. After local preflight, present one combined paid proposal and ask once. It
must name every mutation, the exact selected GPU offering and current rate when applicable, the
derived volume capacity and recurring retained-volume rate when applicable, explicit retention
consent, a numeric maximum cumulative checkpoint spend, estimates, and stop conditions. The finite
cap covers actions through checkpoint handoff; continuing retained-volume billing is separate and
must be disclosed and approved. Approval of the exact proposal is then recorded in the task brief
and `CURRENT_STATE.yaml`; no second confirmation is needed unless the selected offering becomes
unavailable, its rate changes beyond the approved ceiling, scope expands, or the cap may be crossed.
Standing local authority in `CURRENT_STATE.yaml` may advance only exact dependency-ready
provider-free briefs through its recorded terminal task. It never implies sandbox/staging/provider
activation, credentials, remote publication, or external spend.

## Stable fixture scenarios

The app exposes a development-only scenario selector and deterministic IDs:

- `invite_sign_in`
- `invite_access_denied`
- `signup_email_invite_required`
- `signup_google_invite_required`
- `signup_invite_invalid`
- `signup_invite_redeemed`
- `returning_user_no_invite_prompt`
- `happy_generating`
- `project_create_ready`
- `avatar_hub_empty`
- `avatar_profile_uploading`
- `avatar_profile_invalid`
- `avatar_profile_ready`
- `avatar_profile_archived_during_draft`
- `avatar_profile_newer_version_available`
- `avatar_test_cancelled`
- `style_analyzing`
- `style_v2_analyzing_v1_active`
- `style_needs_review`
- `style_analysis_failed`
- `extra_keywords_not_applied`
- `extra_keywords_conflict`
- `preset_roundtrip_draft_preserved`
- `gpu_cold_start`
- `mage_gpu_inventory_loading`
- `echo_gpu_inventory_loading`
- `gpu_inventory_stale`
- `gpu_selection_unavailable`
- `global_idle_gpu_pair_selectable`
- `global_session_gpu_pair_locked`
- `global_queue_waiting_reorder`
- `global_queue_version_conflict`
- `global_queue_waiting_deleted`
- `global_queue_active_mutation_rejected`
- `mage_lane_demand_zero_echo_active`
- `mage_lane_recreated_on_next_activation_same_session_gpu`
- `global_session_closing_waits_for_pod_absence`
- `mage_volume_manifest_mismatch`
- `echo_volume_manifest_mismatch`
- `cross_model_volume_rejected`
- `mage_model_loading`
- `echo_model_loading`
- `both_models_ready`
- `mage_pod_delete_pending`
- `echo_pod_delete_pending`
- `image_partial_failure`
- `avatar_lip_failure`
- `budget_blocked`
- `dispatch_ack_unknown`
- `callback_reconciling`
- `cancel_requested`
- `project_ready_for_review`
- `project_approved`

Fixtures use owned/synthetic assets only. The selected scenario is visible in development UI and addressable by a stable route/query in Playwright; refresh and `dev:open` reproduce it. It never ships enabled in production.

In local/fixture mode, a compact development-only `Fixture`/health control exposes provider mode, commit, fixture ID, API health, synthetic-data status, and `$0` authorization on demand without consuming a persistent full-width ribbon. It is tree-shaken or hard-disabled in production builds. Hot reload must preserve the current project draft, selected preset versions, active route, and fixture ID unless the edited contract makes that state invalid; if invalidated, show the reason instead of silently resetting.

## Walking vertical checkpoints

Existing detailed phases remain authoritative, but each layer must end with something runnable:

1. **Shared shell:** new email/Google identity redeems an invite once; returning user enters without
   another prompt. All admitted users see the same avatar/style catalogs, projects, queue, results,
   progress, and usage in Chrome fixtures.
2. **Provider-free session:** idle user selects two synthetic exact GPUs and Generate atomically
   opens one session. A second user sees no selectors, adds a waiting entry, reorders/deletes waiting
   entries with versioned audit, and cannot move/delete the active entry.
3. **CPU short slice:** 30–120 seconds of owned fixture audio runs through the shared media-worker
   contract: Mac parity first, then separately authorized Cloud Run Job transcription/render with R2
   barriers, deterministic timeline, fixture GPU assets, probed MP4, and Chrome playback.
4. **Mock durable slice:** persisted global session/queue/revision/outbox/cost reservation, two mock
   lane callbacks, positive/zero lane-demand transitions, independent synthetic Pod deletion, final
   render/download, and session close only after both Pods are absent.
5. **Real image/avatar slices:** under separate caps, qualify exact Mage INT8 and Echo FP8 workers on
   their own volumes with the idle-selected session pair. Preserve `model_ready`, accepted output,
   durable barrier, reuse, and zero-demand deletion evidence for each lane.
6. **Queued fast path:** first Generate starts both exact Pods while Cloud Run transcription,
   scheduling, prompts, and span audio advance. A second project inherits the pair but stays inert
   until the first is terminal. Existing Pods may remain warm for that waiter. A missing Pod is
   recreated only when the second project activates; each Pod deletes independently when active
   lane work ends without a waiter. Cloud Run FFmpeg returns both probed MP4s; queue drain plus
   both-Pods-absent closes the session. Measure short samples before any long project.

Do not build temporary provider calls that bypass task/attempt/outbox contracts and later require a rewrite.

## Live Chrome loop

At the beginning of every user-visible task:

1. Run `git status --short`; preserve unrelated edits.
2. Read `CURRENT_STATE.yaml`, run `pnpm doctor`, then run `pnpm dev:status`.
3. Reuse the healthy owned server. Start `pnpm dev` only when none is active; never kill or replace an unrelated port owner automatically.
4. Use `pnpm dev:open`, navigate to the exact task route, and select the deterministic fixture.
5. Before editing, complete the narrow baseline journey and inspect both the browser console and failed network requests; record pre-existing failures.
6. Implement a narrow increment; run targeted tests and repeat the same journey like a user. Hot reload must not erase the draft under review.
7. Keep truthful loading/blocked/failure states visible; no click may appear inert.
8. Run `pnpm verify` before a coherent commit, then update current state/handoff with the exact route, fixture, commit, checkpoint result (`accepted | changes_requested | not_reviewed`), and issue/task references for unresolved user feedback.

A screenshot is evidence of appearance, not proof that a workflow works. Pair it with interaction, state, and automated evidence.

## Task and ownership protocol

- One concrete outcome per `templates/IMPLEMENTATION_TASK_BRIEF.md`.
- Record task ID, milestone, dependencies, decision/gate IDs, base commit, owned files/modules, collision notes, commands, live route/scenario, external-call authorization, spend cap, cleanup, rollback, acceptance, and evidence path.
- Parallel agents own disjoint files/modules. Shared schemas, state machines, and root UI shell are serialized or explicitly coordinated.
- Make small working commits; do not claim a release from uncommitted/local-only evidence.
- Provider/model work records exact generation session, queue entry/version, lane demand,
  lane/model/checkpoint/container, volume/manifest, session inventory receipt, selected and actual
  GPU/rate, Pod identity, input/output hashes, model-ready and inference timings, cost per accepted
  output, and delete/absence proof—not just a screenshot or paper claim. CPU work likewise records
  Cloud Run job/revision/execution, region/sizing, R2 manifests, timings, cost, and validation.

## Definition of done for an implementation task

- Requested behavior works from the stable Chrome URL when user-visible.
- Relevant unit/schema/integration/Chrome tests pass.
- The baseline and after-change journey have no new unexplained console errors or failed network requests.
- No secret/private/reference asset entered Git or browser bundles.
- Real providers stayed within explicit authorization. No Pod remains with zero session-lane demand;
  a drained test session has both paid Pods independently proven absent and is closed. The two
  intended model volumes remain and their identities are recorded.
- Cost, retry, provenance, and failure states are truthful.
- Both `project-context/scripts/validate-context.sh` and `project-context/scripts/validate-schemas.sh` pass if context/contracts changed.
- `CURRENT_STATE.yaml` records last green evidence and the next bounded tasks.
- A small commit exists when the repository has been initialized.

## Handoff rule

`CURRENT_STATE.yaml` is the only mutable snapshot. Git history and gate evidence are the durable
log. Never append chat diaries to the mandatory context. A new chat reads the root loader, start
file, manifest, current state, the recommended task's one profile, and its task brief. A recorded
base/evidence commit is an ancestor check, not permission to reset away newer clean context-only
handoff commits.

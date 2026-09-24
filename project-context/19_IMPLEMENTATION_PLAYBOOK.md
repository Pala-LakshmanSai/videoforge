# Implementation and live-development playbook

Status: binding VideoForge V2 execution method
Read when: starting or handing off any implementation, audit, provider, or release checkpoint.

## Outcome

Ship the accepted VideoForge UI as a production-ready private 5–10-user application. Users upload
voiceover, choose their private reusable avatar/style, and click Generate once. They never select,
start, stop, or clean up Pods/GPUs/workers.

Every account/workspace owns durable private project, revision, media, preset, queue, progress,
retry, cost, output, download, and paired-device state. The browser projects server truth; no
singleton global user context or browser-only production state is authoritative.

The production target is:

- invite-only Better Auth with one default private workspace per account;
- Cloudflare Worker/Workflow control plane, Neon Postgres, private tenant R2;
- signed tenant-owned Windows/macOS workers for pinned whisper.cpp and FFmpeg;
- Postgres fair admission: one active provider workload/account and two globally from different
  accounts; videos retain one/account and two/global caps, and explicit previews use the same slots
  below every eligible video;
- fresh image generation through Kie Market `z-image` and avatar spans through Fal
  `fal-ai/flashhead/audio-to-video`, using the pinned Avatar Hub source and selected voiceover;
- durable Postgres admission and provider task identity before output acceptance; uncertain paid
  submissions are never automatically repeated;
- existing RunPod jobs retain their pinned transport, receipts, cleanup, and retained-volume rules;
- deterministic word-timed Ranga-style scheduler and direct FFmpeg output.

Fresh generation has no GPU availability dependency. Historical model volumes are not fresh-path
inputs and remain subject to their original retention and cleanup rules. Final render and ASR use
the paired tenant-owned personal worker.

## Start every task narrowly

1. Read `AGENTS.md`, `00_START_HERE.md`, `MANIFEST.yaml`, and `CURRENT_STATE.yaml`.
2. Resolve the selected checkpoint/profile/brief. Read only that checkpoint section and profile.
3. Check `git status --short`; preserve unrelated edits.
4. Verify predecessor gates/commit/evidence. Missing selectors may be created narrowly; a failed
   predecessor is a stop, not a reason to work ahead.
5. State owned files and avoid collisions. One checkpoint, one concrete outcome.
6. Default to fixture/provider-free mode. Never infer provider authority from an older checkpoint.
7. Implement the smallest coherent vertical slice, validate it, inspect in real Chrome when visible,
   update context/current state, and make one green commit.
8. Use one narrow repair cycle for an observed checkpoint failure. A second unrelated failure becomes
   a named micro-checkpoint instead of expanding the current chat indefinitely.

Only V2 task briefs live in the working tree. Git history records removed planning files; retain
repository evidence only when an active foundation, gate, artifact identity, cost fact, or audit
depends on it.

## Implementation order

The dependency order is binding even if exact checkpoint labels change:

1. Reset/validate V2 context and new task prompts.
2. Add tenant-private account/default-workspace schema, repositories, authz, and fixture UI.
3. Add private R2 object reservations, signed URLs, provenance receipts, and isolated scratch.
4. Add fair durable queue/admission/recovery: one/account and two/global.
5. Add durable Kie/Fal task submission, persisted provider identities, private output acceptance,
   and no-replay recovery; preserve exact reconciliation for historical RunPod attempts.
6. Cut application/runtime/UI provider-free paths fully to V2; remove manual GPU/Pod controls and
   prove failure/restart/cancellation states.
7. Deploy/qualify isolated hosted auth/Neon/R2/Cloudflare staging plus signed personal workers.
8. Integrate Kie image and Fal audio-to-video generation with the existing tenant queue and receipts.
9. Render accepted API media on the paired personal worker; complete Chrome playback/download and
   Review regeneration acceptance.
10. Measure API cost and verify provider-task settlement and GPU dispatch remains disabled.
11. Complete security, operations, and invited-production release review.

Do not jump from a Pod-era sample to endpoint publication, or from a short sample to full-length
economics/security claims.

## Stable commands

Preserve the existing root developer contract:

- `pnpm doctor` / `pnpm doctor --json` — prerequisites, env names, ownership; no secret values or
  provider calls.
- `pnpm dev` — own/reuse exactly `http://localhost:4173`; do not silently choose a port.
- `pnpm dev:status` — report owned process/mode/commit/fixture without starting another server.
- `pnpm dev:stop` — stop only the exact VideoForge-owned process tree; never force-kill ambiguity.
- `pnpm dev:open` — open/focus the stable route in real Chrome after health passes.
- `pnpm test`, `pnpm python:sync`, `pnpm python:lint`, `pnpm test:chrome`.
- `pnpm secret:scan`.
- `pnpm verify:fast` — provider-free developer feedback, not release evidence.
- `CI=1 TURBO_FORCE=true pnpm verify` — canonical provider-free aggregate.
- `pnpm context:validate` — context and schema validation.
- `pnpm local:doctor` / `pnpm test:local-slice` — explicit local media parity only.

Canonical verify never contacts providers or proves hosted/live gates.

## Repository/deployable shape

```text
apps/web/                  React/Vite UI + same-origin Cloudflare API
workers/image-media/       Historical Mage runtime + RunPod handler + fixture adapter
workers/avatar-primary/    Historical SoulX runtime + RunPod handler + fixture adapter
workers/media-local/       Provider-neutral Whisper/FFmpeg execution core + personal-worker adapter
apps/media-worker-desktop/ Native Windows/macOS packaging, signing, release manifest, and autostart
packages/contracts/        JSON Schema, TypeScript/Python parity, fixtures
packages/config/           Versioned non-secret runtime/endpoint profiles
packages/test-fixtures/    Owned/synthetic deterministic assets
project-context/           Normative decisions, gates, checkpoint state, evidence
```

Keep existing Mage and SoulX artifacts isolated for historical job reconciliation. Fresh API
generation uses no model volume, GPU worker, or runtime download; private output and receipt
contracts remain shared.

## Development and authority modes

| Mode | External spend | Purpose |
|---|---:|---|
| `fixture` | `$0` | Default UI/contracts/fairness/fault work |
| `local` | `$0` | Local whisper/FFmpeg and worker unit/smoke parity |
| `sandbox` | Exact task cap | Bounded provider/model integration only |
| `staging` | Exact mutation/task caps | Isolated hosted service acceptance |
| `production` | Approved release/project caps | Only after all release gates |

Authority:

- `none`: no credential access, provider/network mutation, publication, allocation, or spend.
- `read_only`: exact allowlisted inventory/rate/config reads through configured credentials, `$0`, no
  secret output or mutation.
- `paid`: exact provider/resource/operation list, current rates, finite cap, timestamp, cleanup, and
  non-transferable user approval.

For an external checkpoint, complete local/provider-free work and authorized read-only preflight
first. Then ask once with the exact API/deployment operations, immutable source/config identities,
current provider rates, finite spend cap, stop conditions, and cleanup. Include GPU rates and retained
volume charges only when the operation touches historical RunPod resources. Record approval and
continue without another question unless scope, rate, cap, or capacity changes.

No earlier CP/VF authority transfers. No provider mutation occurs because an architecture document
was approved.

## Provider-free fixture matrix

Keep deterministic two-account fixtures for:

- invite signup/login and unauthorized/expired/replayed invite;
- private project/Avatar/Style lists and foreign-ID negatives;
- tenant R2 upload/download expiry/hash/type/size/prefix failures;
- one active/account, two active/global, fair waiting, own reorder/cancel, starvation/race recovery;
- Kie image and Fal audio-to-video task submission, provider status/result observation, timeout,
  cancellation, uncertain-response no-replay, and duplicate-output quarantine;
- worker claim/renew/cancel/result states for the paired personal media worker;
- wrong tenant/provider task/media type/checksum, private object-port violations, and scratch leak;
- historical RunPod reconciliation and zero-worker/retained-volume evidence as separate fixtures;
- short integrated final MP4 and Ranga-style timeline.

Fixtures use owned/synthetic media only, remain visibly marked in development, and are hard-disabled
from production.

## Live Chrome loop

For every user-visible checkpoint:

1. Reuse the healthy owned server and exact fixture route.
2. Run the baseline journey before editing; inspect console and failed network requests.
3. Implement one narrow increment without resetting the user's draft on hot reload.
4. Exercise loading, success, blocked, error, refresh/reconnect, stale multi-tab, keyboard/focus, and
   compact layout states as relevant.
5. Verify tenant privacy with two sessions/accounts. Never show another tenant's identity/project/
   queue/result/cost.
6. Repeat the journey and run automated installed-Chrome acceptance.

Screenshots prove appearance only. Record interaction, state transition, console/network, and final
artifact evidence. Preserve the accepted visual system; remove only obsolete manual compute controls.

## Kie/Fal provider implementation rules

- Claim each API job in Postgres before submission and persist returned Kie/Fal task identity.
- Promise at most one accepted output, never provider exactly-once execution/billing.
- Poll and persist status; verify private media structure, bytes, and checksum before acceptance.
- Treat uncertain paid submission as terminal unless the same provider task identity is recovered;
  never create a replacement call automatically.
- Use tenant signed R2 reservations, unique job scratch, application-signed receipts, exact checksum/
  media validation, and durable DB lineage.

## Historical RunPod reconciliation rules

Apply these only to attempts already pinned to `RUNPOD`:

- Persist the original predispatch authority/outbox, exact job binding, and signed receipt. Never
  replay the identity through Kie/Fal.
- `/runpod-volume` remains application-read-only; retain lane isolation and original cleanup rules.
- Reconcile terminal jobs and prove zero endpoint jobs/workers before claiming compute shutdown.
- Report retained-volume billing separately from compute and API costs.

## Task ownership and evidence

Each task brief records checkpoint, dependency/gates, base commit, owned files/modules, collision
notes, exact commands, Chrome route/fixture, provider authority/cap, rollback, acceptance, and evidence
path. Parallel agents own disjoint files; shared migrations/schemas/root shell serialize.

Provider evidence records exact provider/model/task identity, tenant-safe input/output hashes, artifact
receipt, possible duplicate exposure, settled cost, and validation. For historical RunPod attempts,
also retain endpoint/template/container/volume manifest, selected/actual GPU and rate, worker shutdown,
and retained-volume state. Hosted CPU evidence records deployment/job region/sizing, R2 manifests,
timing, cost, and validation.

## Definition of done

- Requested checkpoint behavior works at its intended layer and no later gate is claimed.
- Focused tests for changed surfaces, touched workspace typecheck/build, and diff checks pass.
  Canonical provider-free verify is required at V2-09 and V2-13, or earlier only for a shared
  contract/runtime change that focused proof cannot cover.
- User-visible behavior passes the real-Chrome journey with no new unexplained console/network error.
- Tenant isolation and required negative/fault cases pass.
- No secret/private/reference asset/model weight/signed URL entered Git or browser bundles.
- External work stayed within exact authority/cap; ambiguity/cost is truthful; API tasks are settled
  and released. For historical RunPod work, reconcile workers to zero and report retained-volume
  billing separately.
- Context/schema validators pass after context/contracts change.
- `CURRENT_STATE.yaml` records exact commit, commands/evidence, remaining gates, provider/spend state,
  compute shutdown state, and one next checkpoint/profile/brief.
- A small coherent commit exists.

## Handoff

`CURRENT_STATE.yaml` is the only mutable snapshot; Git/evidence are durable history. A new chat reads
the root loader, startup files, one selected profile, one checkpoint section, and one task brief.
Every handoff states checkpoint, commit, validations, remaining gates, provider/spend state, zero-
worker state, and continuing volume cost. Never reset away newer clean context-only handoffs or turn
an unrun gate into confirmed fact.

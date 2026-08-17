# Implementation and live-development playbook

Status: binding VideoForge V2 execution method
Read when: starting or handing off any implementation, audit, provider, or release checkpoint.

## Outcome

Ship the accepted VideoForge UI as a production-ready private 5–10-user application. Users upload
voiceover, choose their private reusable avatar/style, and click Generate once. They never select,
start, stop, or clean up Pods/GPUs/workers.

The production target is:

- invite-only Better Auth with one default private workspace per account;
- Cloudflare Worker/Workflow control plane, Neon Postgres, private tenant R2;
- signed tenant-owned Windows/macOS workers for pinned whisper.cpp and FFmpeg;
- Postgres fair admission: one active provider workload/account and two globally from different
  accounts; videos retain one/account and two/global caps, and explicit previews use the same slots
  below every eligible video;
- one RunPod queue Serverless Mage endpoint and one separate SoulX endpoint;
- `workersMin=0`, `workersMax=2`, one RTX 4090 per worker;
- existing isolated 50 GB `EU-RO-1` Mage and SoulX volumes at `/runpod-volume`, treated read-only;
- deterministic word-timed Ranga-style scheduler and direct FFmpeg output.

RTX 5090 is not fallback until each lane qualifies it. No superseded manual-compute or alternate-
runtime transport is active. The two prepared volumes are reused; V2 work does not recreate or
redownload them.

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

Only V2 task briefs live in the working tree. Git history records removed planning files; retain
repository evidence only when an active foundation, gate, artifact identity, cost fact, or audit
depends on it.

## Implementation order

The dependency order is binding even if exact checkpoint labels change:

1. Reset/validate V2 context and new task prompts.
2. Add tenant-private account/default-workspace schema, repositories, authz, and fixture UI.
3. Add private R2 object reservations, signed URLs, provenance receipts, and isolated scratch.
4. Add fair durable queue/admission/recovery: one/account and two/global.
5. Add v3 Serverless envelopes, outbox/assignment/reconciliation, fake transport, and old-Pod
   firewall.
6. Cut application/runtime/UI provider-free paths fully to V2; remove manual GPU/Pod controls and
   prove failure/restart/cancellation states.
7. Deploy/qualify isolated hosted auth/Neon/R2/Cloudflare staging plus signed personal workers.
8. Publish/configure/qualify Mage Serverless against the existing Mage volume under exact authority.
9. Publish/configure/qualify SoulX Serverless against the existing SoulX volume under exact authority.
10. Run one owned short integrated Generate-to-MP4 project in installed Chrome.
11. Run a real 3–5-minute Ranga-style pilot and close human quality/crop gates.
12. Prove two-user concurrency, 5–10-user fairness, recovery, production-length speed/economics, and
    only then consider separate RTX 5090 qualifications.
13. Complete security/operations/release review and production cutover.

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
workers/image-media/       Mage runtime + RunPod Serverless handler + fixture adapter
workers/avatar-primary/    SoulX runtime + RunPod Serverless handler + fixture adapter
workers/media-local/       Provider-neutral Whisper/FFmpeg execution core + personal-worker adapter
apps/media-worker-desktop/ Native Windows/macOS packaging, signing, release manifest, and autostart
packages/contracts/        JSON Schema, TypeScript/Python parity, fixtures
packages/config/           Versioned non-secret runtime/endpoint profiles
packages/test-fixtures/    Owned/synthetic deterministic assets
project-context/           Normative decisions, gates, checkpoint state, evidence
```

Keep Mage and SoulX dependencies/images/endpoints separate. Both use tenant artifact contracts but
never share model volume, cache, lock, scratch, or runtime. Ordinary boot loads exact sealed bytes
offline; one-time preparation tools are outside the normal handler and not part of this V2 reset.

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
first. Then ask once with the exact publication/configuration/request/delete or retention operations,
immutable artifacts, endpoint settings, existing volume identities/rates, selected RTX 4090 rate,
finite spend estimate/cap, continuing fixed billing, stop conditions, and cleanup. Record approval and
continue without another question unless scope/rate/cap/capacity changes or ambiguity appears.

No earlier CP/VF authority transfers. No provider mutation occurs because an architecture document
was approved.

## Provider-free fixture matrix

Keep deterministic two-account fixtures for:

- invite signup/login and unauthorized/expired/replayed invite;
- private project/Avatar/Style lists and foreign-ID negatives;
- tenant R2 upload/download expiry/hash/type/size/prefix failures;
- one active/account, two active/global, fair waiting, own reorder/cancel, starvation/race recovery;
- whole-video Mage/SoulX batches, lane-zero-work, cost/cap blocked;
- outbox before dispatch, ack unknown, unique assignment, status polling, webhook missing/duplicate/
  forged/out-of-order, provider-result expiry, duplicate output quarantine;
- worker allocating/container/volume/model/warm/ready/generating/uploading states;
- wrong tenant/endpoint/image/model/volume/manifest/GPU, model-volume write attempt, scratch leak;
- timeout/cancel/retry/restart and zero-worker/fixed-volume truth;
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

## Provider implementation rules

- Persist predispatch authority/outbox before `/run`; bind post-assignment before accepting status/
  output.
- Promise at most one accepted output, never provider exactly-once execution/billing.
- Poll status and persist facts; async provider results expire after 30 minutes and webhook is not
  sole truth.
- Measure/set TTL, execution timeout, idle policy, and `RUNPOD_INIT_TIMEOUT`. TTL includes queue/run.
- Never call queue purge in ordinary code.
- Use tenant signed R2 reservations, unique job scratch, application-signed receipts, exact checksum/
  media validation, and durable DB lineage.
- `/runpod-volume` is application-read-only. Redirect cache/config/temp/locks; verify pre/post hashes.
- Qualify two concurrent readers before live `workersMax=2`.
- After paid tests, reconcile terminal jobs and prove zero endpoint jobs plus zero total workers
  (`Active + Flex`). Report the two retained 50 GB
  volumes and ongoing `$7/month` planning cost separately.

## Task ownership and evidence

Each task brief records checkpoint, dependency/gates, base commit, owned files/modules, collision
notes, exact commands, Chrome route/fixture, provider authority/cap, rollback, acceptance, and evidence
path. Parallel agents own disjoint files; shared migrations/schemas/root shell serialize.

Provider evidence records exact endpoint/template/container/model/volume manifest, request/assignment,
selected/actual GPU/rate, tenant-safe input/output hashes, cold/warm readiness, inference/upload,
artifact receipt, possible duplicate exposure, settled cost, zero-worker proof, and retained-volume
state. Hosted CPU evidence similarly records deployment/job region/sizing, R2 manifests, timing, cost,
and validation.

## Definition of done

- Requested checkpoint behavior works at its intended layer and no later gate is claimed.
- Focused tests and canonical provider-free verify pass; hosted/live evidence is added only when run.
- User-visible behavior passes the real-Chrome journey with no new unexplained console/network error.
- Tenant isolation and required negative/fault cases pass.
- No secret/private/reference asset/model weight/signed URL entered Git or browser bundles.
- External work stayed within exact authority/cap; ambiguity/cost is truthful; paid workers/jobs are
  reconciled to zero and retained-volume billing is explicit.
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

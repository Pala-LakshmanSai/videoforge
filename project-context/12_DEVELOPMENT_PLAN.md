# Development plan

Status: compact index for the VideoForge v2 production roadmap
Read when: selecting work, checking dependencies, or deciding what may be reused.

## Canonical sequence

`22_PROJECT_COMPLETION_CHECKPOINTS.md` is the authoritative roadmap. Only V2 task briefs live in the
working tree; Git history records removed planning files. Committed migrations and evidence required
by active foundations/gates remain immutable. `CURRENT_STATE.yaml` selects one exact V2 checkpoint,
task brief, and read profile.

```text
V2-00  architecture, reference, and roadmap reset
V2-01  tenant-private identity and data
V2-02  tenant-private artifacts, R2 ports, and scratch isolation
V2-03  fair per-account queue and two global active slots
V2-04  provider-free Serverless v3 transport, authority, outbox, and recovery
V2-05  provider-free application cutover, truthful UI, and runtime firewall
V2-06  hosted auth, Neon, R2, Cloudflare, and signed tenant-owned Windows/macOS media workers
V2-07  Mage Serverless qualification on the existing sealed Mage volume
V2-08  SoulX Serverless qualification on the existing sealed SoulX volume
V2-09  one short real hosted end-to-end project
V2-10  one real 3-5 minute Ranga-style pilot
V2-11  two-user concurrency, fair queue, autoscaling, and recovery
V2-12  20-30 minute quality, speed, and economics qualification
V2-13  security hardening, production release, and operations proof
```

Implement in order. Do not make a later checkpoint compensate for an incomplete predecessor.
Provider-free evidence never proves a live provider path, and technical output does not replace a
required visual acceptance.

## Production destination

- Private invited product for 5-10 people. Each account has one default workspace and can see only
  its own user-created presets, projects, assets, jobs, costs, and outputs. Explicit built-in
  defaults are the only globally readable product records.
- At most one active provider workload per account and two from different accounts globally;
  ordinary videos therefore remain capped at one/account and two globally. A durable account-fair
  queue selects work. Explicit preset previews use the same slots and are eligible only after all
  video heads. Users may reorder/cancel only their own waiting entries without changing account
  rotation or another account's order. Waiting work causes no provider action.
- Two independent RunPod queue Serverless endpoints in `EU-RO-1`: Mage-Flow INT8 ConvRot and
  SoulX-FlashHead Pro BF16. Each endpoint uses its existing separate sealed 50 GB volume mounted at
  `/runpod-volume`, one GPU per Flex worker, `workersMin=0`, and a qualified bounded maximum.
- Ordinary users never select GPUs or start/stop Pods. The application admits jobs; RunPod creates
  and removes Flex workers from demand. Endpoint deployment choices belong to operators.
- Private R2 carries tenant-scoped inputs and outputs. Model volumes are application-read-only and
  never contain user media. Every request uses job-keyed local scratch erased on all terminal paths.
- Preserve the existing word transcript, deterministic three-composition scheduler, prompt/style
  system, renderer, UI design language, and qualified model bytes. Replace active ownership,
  queueing, dispatch, storage, and production hosting around them.
- Preserve the Ranga edit grammar: full avatar, full image, and clean avatar-left/image-right split;
  hard cuts; subtle centered image zoom; no captions, titles, overlays, borders, motion graphics,
  watermarks, or decorative transitions.

## Execution discipline

Work contract-first and provider-free. Use additive migrations and v3 contracts; never rewrite
committed migrations or reinterpret foundation evidence as current authority. The live cutover must
make every superseded global-session, manual-compute, Pod-bound dispatch, alternate-runtime,
fallback/repair, automatic-GPU, and cross-tenant path unreachable in ordinary production.

Every checkpoint ends with focused negative tests, canonical verification, context/schema
validation, `git diff --check`, real Chrome acceptance when behavior is visible, truthful gates, a
small green commit, and refreshed `CURRENT_STATE.yaml`. Handoffs state the exact commit, commands and
exits, unresolved gates, provider/spend state, and active-worker truth.

For external checkpoints, finish local work and allowlisted read-only price/inventory preflight at
`$0` first. Before the first external mutation or paid request, obtain one exact combined approval
covering operations, resource identities/configuration, current rates, recurring charges, cleanup,
stop conditions, and a numeric maximum cumulative finite spend supplied by the user. Authority is
checkpoint-specific and never transfers. Stop on proposal drift or cap risk.

RunPod delivery is not exactly once. Persist the outbox/dispatch token before `/run`, reconcile
`/status` into a durable signed R2 receipt within the 30-minute async-result window, accept at most
one canonical output, and expose bounded duplicate-compute/cost risk. Never use queue purge as
ordinary recovery. TTL, execution timeout, initialization timeout, scaling, and idle policy must be
derived from measurements rather than defaults.

## Safe parallelism

After v3 contracts lock, disjoint Mage and SoulX worker modules may be developed in parallel.
Serialize migrations, tenant/queue state, transport contracts, root UI, provider mutations,
production configuration, integration commits, and checkpoint promotion through one owner. Runtime
may execute two videos only when they belong to different accounts and both hold valid global slots.

# Avatar result recovery — 5 October 2026

Checkpoint V2-09 / VF-10-09. User authorizes repair, production publication and verification.

## Observed cause and recovery

The user project `4a683415-d936-4bee-9a4f-e8b041228844` submitted its avatar at
03:43:35 UTC. Fal later reported COMPLETED, inference 10.684 seconds and a 432502-byte
MP4 lasting 3.84 seconds. Exact provider completion/queue time was not exposed.
Cloudflare Workflow `hosted-api-69b81150-6d1c-42e9-ac49-8c3e32538ef5`, API step29,
stalled 03:46:01.042–03:56:01.615 and failed with WorkflowInternalError after the
implicit ten-minute attempt timeout. Automatic retry succeeded at03:56:06.431.
The internal platform trace does not identify a particular database/storage operation.

Native acceptance retained original Fal request `01a10a28-e983-7fc0-a1e1-925be36ba492`,
its pinned account/version and output checksum
`sha256:c53ad6366822043f0c5a6867f8a6ae264778b60fba6ca45b5aced29161f74d7e`.
Generation and ASR/SPAN_AUDIO/RENDER all succeeded. All three existing project rentals
were CLEAN by03:57:25.664733 UTC. No operator replay/restart was needed.

## Prevention and checks

Shared API coordinator uses explicit two-minute attempts, two-second constant retry,
maximum30 retries. This removes reliance on the ten-minute default while preserving
roughly an hour of transient recovery allowance. Existing claim, receipt, cancellation,
UNKNOWN, account pinning and accepted-artifact guards remain unchanged. No new dependencies.
[Cloudflare step defaults and configuration](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/).

Five focused suites /54 checks pass, including interrupted result observation followed
by acceptance on the same request, unchanged accepted images and zero paid POST/claim.
Web/Worker types, owned ESLint/Prettier, context and tracked secret checks pass.
Production/staging builds and quarantine pass; exact static closures 2818355/2820274
bytes add470 bytes each for the timeout/retry policy. No quarantine exception changed.
Earlier broad-CI baseline failures remain separately documented in configurable-opening acceptance.

No new provider submissions, paid test rentals, migrations or resource mutations.
Existing project cost/liability retains its original lifecycle. This is regression and
production-deployment proof, not a live injected Cloudflare outage or new paid canary.
External outages and provider queue delays remain possible; no zero-delay guarantee.

## Publication

Published source `417e7225287d42aa7132733fe27be964bb559d36`, Worker
`c38d4bd0-cc92-403b-9aef-1b22f70a6e3b` at100%. Exact source/status and30 public asset
hashes verified, anonymous private catalog401. All55bindings,27secret names and3Workflow
identities retained; qualified Cloud pins and disabled CPU fallback preserved. Uploaded
bundle contains the exact two-minute/30-retry/two-second constant policy.

Real Chrome: original33.033008-second final video played through to ended=true/error=null;
fresh post-deployment Review loaded API healthy, same artifact readyState4, opening12/12s.
The owner's editorial approval remains pending. Retained user's original Library tab.

No new paid canary or injected platform stall: existing project recovered before this
publication; the new policy is proven by regression, build and published-source checks.
Adjacent preexisting display issue: Progress stage7 still says First3minutes for custom
openings, while top-level Progress and Review correctly show0.2minutes. It does not alter
saved12-second opening or render and is outside this coordinator-latency repair.
Private incident evidence: `.videoforge/avatar-delay-20261005/` (primary checkout).
Rollback target: Worker `dad79410-a3c0-48c9-aac7-e4c94ef7e8a9`.

# Testing and acceptance

Status: binding V2 acceptance strategy; live provider gates remain open unless explicitly closed
Read when: implementing, auditing, promoting staging, qualifying Serverless, or releasing.

## Evidence hierarchy

Each layer proves only itself:

1. **Schema/static:** types, schemas, canonical hashes, generated parity, lint, build.
2. **Unit/property:** deterministic logic, scheduler invariants, cost/time calculations.
3. **Database/repository:** additive PostgreSQL migrations under PGlite, constraints, transactions,
   tenant ownership, fairness, recovery.
4. **Provider-free integration:** fake Runware/Cloud Run/RunPod/R2, outbox, ambiguity, callbacks,
   artifact validation, fault recovery.
5. **Runtime smoke:** exact immutable worker image boots with synthetic/local fixtures; no provider.
6. **Hosted staging:** real auth, Neon, private R2, Cloudflare orchestration, Cloud Run Jobs.
7. **Bounded live Serverless:** exact endpoint/model/volume/GPU, owned inputs, measured spend,
   durable outputs, and zero-worker proof.
8. **Real Chrome/E2E:** user journey through production-like services and playable final MP4.
9. **Human quality/economics:** Ranga-style review, concurrency, production-length cost/speed.

`CI=1 TURBO_FORCE=true pnpm verify` is canonical provider-free integration evidence. It cannot prove
hosted bindings, provider identity, GPU/model/volume state, real cost, or production readiness.

## Mandatory provider-free gate

Every implementation checkpoint runs its focused tests plus the canonical aggregate before commit.
Context or contract changes also run:

```text
pnpm context:validate
project-context/scripts/validate-context.sh
project-context/scripts/validate-schemas.sh
```

The aggregate must remain `$0`, avoid credentials/external providers, own and release its test ports,
and leave no process it did not create. Installed-Chrome journeys use the stable application URL and
check console/network failures as well as appearance.

## `GATE_TENANCY_001` — account/workspace privacy

Pass requires:

- additive migrations from every supported starting schema, rollback/restore strategy, and PGlite
  constraint tests;
- one authenticated account mapped to one default workspace;
- composite database ownership on projects/revisions/assets/presets/queue/tasks/attempts/costs;
- owner-scoped repository and API reads/writes with no client authority over tenant IDs;
- built-in system presets readable by all accounts but immutable to ordinary users;
- two-account negative matrix covering ID swap, foreign FK, list/filter/search, archived objects,
  stale revisions, callbacks, downloads, and timing/enumeration responses;
- no private cross-account metadata in logs, events, queue estimates, errors, or browser state.

Any cross-tenant read, write, reference, signed URL, cache/scratch reuse, or existence leak is P0 and
blocks every provider checkpoint.

## `GATE_STORAGE_001` — private R2 and scratch

Provider-free pass requires exact tenant key construction; signed upload/download reservations bound
to tenant, method, key/prefix, type, maximum bytes, checksum, and expiry; completion revalidation;
redaction; and cleanup. Negative tests cover prefix traversal, arbitrary key, expired/replayed URL,
wrong method/type/hash/size, foreign asset, multipart interruption, and duplicate completion.

Hosted pass requires private buckets, least-privilege bindings, no public listing/CDN path for user
media, lifecycle policy evidence, and two-account upload/download isolation.

GPU/CPU worker scratch must be unique per attempt, outside `/runpod-volume`, unshared across tenants,
and scrubbed after success/failure/cancel. Recovery never depends on scratch.

## `GATE_QUEUE_001` — fair durable admission

Pass the following with real PostgreSQL semantics:

- no account can have more than one active video;
- no more than two videos are active globally under high-concurrency races;
- videos and explicit preset previews share one active-workload/account and two-global capacity
  leases; previews never outrank an eligible video or alter the video fairness cursor;
- FIFO holds within an account unless that account reorders its own waiting rows;
- durable round-robin/last-served selection prevents starvation across eligible account heads;
- a user can see/reorder/cancel only their own rows and cannot bypass another account's fair turn;
- waiting work creates zero CPU/GPU/provider outbox;
- transaction crash, dispatcher crash, stale lease, process restart, duplicate Generate, and cancel/
  promote races recover without over-admission;
- 1, 2, 5, and 10 simultaneous-account simulations report wait distribution and prove no
  starvation under the defined workload.

RunPod queue order is never used as fairness evidence.

## `GATE_SERVERLESS_CONTRACT_001` — provider-free transport

Pass before endpoint publication:

- `generation-admission/v3`, `serverless-worker-job-envelope/v3`,
  `serverless-provenance-receipt/v1`, and `production-manifest/v3` schemas, positive/negative
  fixtures, TypeScript/Python parity, and contract-index selection;
- runtime firewall rejects every old Pod/global-session envelope in the V2 dispatch path;
- predispatch authority/outbox commits before fake `/run`;
- post-assignment authority binds exactly one provider job ID before status/output acceptance;
- lost response becomes `DISPATCH_ACK_UNKNOWN` and does not blindly resubmit;
- at most one output can be accepted while duplicate/late results are quarantined and possible
  duplicate compute/cost remains visible;
- exact status polling, 30-minute provider-result-expiry recovery, webhook loss/duplicate/order
  faults, callback forgery, and restart reconciliation;
- TTL includes fake queue plus execution; execution/init timeouts are explicit and bounded;
- queue purge is absent from ordinary code and rejected by firewall tests;
- cancellation/retry targets only the exact authorized assignment.

Do not claim provider exactly-once execution or billing.

## `GATE_HOSTING_001` — hosted control/CPU plane

Pass in isolated staging:

- invite-bound Better Auth email/password and Google flows, verified-email equality, redemption
  races/replay/expiry/revocation;
- Neon migrations, repository behavior, transaction/isolation, backup/restore exercise;
- private R2 storage gate and production-like lifecycle;
- Cloudflare Worker/Workflow durable orchestration, restart/resume, secret binding, and alarm/error
  handling;
- pinned Cloud Run whisper.cpp and FFmpeg jobs using tenant R2 receipts, no RunPod credential or
  model-volume access;
- same-origin application/API, secure cookies, CSRF/origin controls, rate limits, redaction, and
  installed-Chrome user journey;
- measured CPU/R2/Workflow timing and cost.

The user's Mac is not a production dependency.

## Preserved model evidence

Historical evidence remains truthful:

- CP-06/VF-9-24Q proved the exact Mage INT8 ConvRot artifact on its isolated 50 GB volume, offline
  fresh-Pod reuse, eight valid 1280x720 outputs, guarded cleanup, and zero Pods.
- VF-9-24S/U proved the exact SoulX-FlashHead Pro artifact on its isolated 50 GB volume, offline
  fresh-Pod warm-up, owned native 10-second-class outputs, timing/cost records, and zero Pods.
- EchoMimic qualifications are immutable history but Echo is non-dispatchable and its operational
  volume was removed.

These do not close either Serverless lane gate. The existing two volumes are reused, not recreated,
unless a future explicitly authorized destructive decision changes that fact.

## `GATE_IMAGE_001` — Mage production quality

Pass the full qualification through the exact accepted Mage Serverless runtime with a frozen
40-prompt manifest and exactly 300 generated candidates. The manifest covers people/skin, hands and
physical demonstrations, food/produce/material texture, tools/rural work, interiors/public settings,
macro evidence, historical/period scenes, wide environmental context, split-safe framing, and the
five production styles. Record every first generation, bounded same-scene retry, rejection, and
accepted checksum; never curate failures out of the denominator.

Pass requires:

- exact 1280x720, 4-step, guidance-1 runtime/settings and immutable prompt/style/seed lineage;
- at least 90% of first generations clearly relevant to the literal scene request;
- no more than 5% obvious severe anatomy, generated-text/logo/watermark, pseudo-infographic,
  material object, or AI-look failures after the single allowed same-scene retry;
- every required prompt category yields accepted evidence, important subjects survive full/split
  crop-safe checks, and final 1080p zoom frames remain acceptably detailed;
- no OOM/crash, measured operational VRAM headroom, itemized timing/cost, and zero endpoint jobs plus
  zero total workers (`Active + Flex`) after drain;
- explicit human blind acceptance before the production image-quality gate closes.

## `GATE_STYLE_002` — five-style adherence

Using identical neutral person/action/environment content and locked seeds where supported, compare
the built-in default plus four substantially different published Image Style versions. Preserve exact
compiled positive/negative prompts, style/version hashes, optional-keyword on/off cases, generated
checksums, and blind-review order.

Pass requires the human reviewer to distinguish and accept every intended style as materially
different and faithful without copying reference subjects, identities, logos, readable text, or exact
reference compositions. Every style must retain literal narration relevance, useful full/split crop
safety, technical validity, and deterministic keyword behavior. Failure of any style keeps the gate
open; do not add LoRA/reference conditioning or change the selected generator without a new decision.

## `GATE_SERVERLESS_MAGE_001` — Mage endpoint

Pass requires the exact immutable Mage Serverless image/template/endpoint and existing Mage-only
50 GB `EU-RO-1` volume:

- `workersMin=0`, `workersMax=2`, one RTX 4090 GPU, no unqualified fallback;
- `/runpod-volume` exact sealed manifest, ordinary boot fully offline for model bytes;
- application-read-only volume behavior, scratch/cache redirection, pre/post hashes unchanged;
- real warm-up and authoritative `MODEL_READY`;
- owned deterministic image batches covering default plus required styles, 1280x720, exact 4-step/
  guidance-1 profile, negative cases, accepted hashes and probes;
- cold, warm, and two-concurrent-worker trials against the same read-only volume;
- request/status/cancel/reconciliation, timeout, output receipt, R2 durability, and settled cost;
- zero endpoint jobs and zero total workers (`Active + Flex`) after drain while both 50 GB volumes
  remain.

RTX 5090 is a separate later lane-specific qualification; it is not automatic fallback.

## `GATE_SERVERLESS_SOULX_001` — SoulX endpoint

Pass requires the exact immutable SoulX-FlashHead Pro Serverless image/template/endpoint and existing
SoulX-only 50 GB `EU-RO-1` volume:

- `workersMin=0`, `workersMax=2`, one RTX 4090 GPU, no repair/fallback;
- exact source/weights/audio/runtime manifest and best approved Pro settings;
- `/runpod-volume` offline/read-only contract, unique job scratch, unchanged pre/post hashes;
- deliberate `RUNPOD_INIT_TIMEOUT` and cold start below the documented seven-minute unhealthy
  threshold, addressing the historical 672-second Pod start-to-ready risk;
- real warm-up and authoritative `MODEL_READY`;
- representative owned avatars, phonemes, head motion, facial hair/hats, backgrounds, ordinary 2-6
  second scheduler spans plus the bounded seven-second opener, padding/trim, exact A/V duration, and
  no full-voiceover job;
- one native generation reused for approved full/split renderer compositions;
- cold, warm, and two-concurrent-worker trials against the same volume;
- request/status/cancel/reconciliation, invalid output, timeout, receipt/R2 durability, settled cost,
  and zero endpoint jobs plus zero total workers (`Active + Flex`) after drain.

Human review checks identity, lips/teeth/tongue, eye behavior, hair/beard/hat, head/shoulder motion,
background stability, blur, jitter, crop, and temporal continuity. Technical validity alone does not
activate production.

## `GATE_SOULX_LICENSE_001` — deployability record

Before production activation, preserve exact SoulX code/weight revisions and governing license/terms
artifacts, document intended hosted/commercial use, unresolved ambiguity, and the user's risk decision
where applicable. Passing this gate means the evidence and decision are explicit; it must not claim
commercial permission is clearer than the source artifacts establish.

## Scheduler and Ranga style gate

The existing CP-04 scheduler baseline is preserved. Regression/property tests enforce:

- only three compositions;
- frame 0 full avatar;
- approximately 21-22% avatar coverage;
- strict full/split avatar alternation;
- ordinary avatar spans 2-6 seconds, with only the bounded opening exception;
- the same native avatar source for full and split;
- clean split seam at `x=960`, no border/label;
- hard cuts and the approved image zoom; no forbidden graphics.

Statistical acceptance on representative 20-30 minute timelines targets:

- mean avatar span 3.5-4.0 seconds;
- 3.3-3.7 avatar appearances/minute;
- median non-avatar gap 10-13 seconds;
- first literal evidence at 3-6 seconds and first split by 18 seconds;
- mean visual-change interval 4.0-4.8 seconds and median 3.6-4.7 seconds.

These bands are measured reference behavior, not random duration selection. Word/sentence/pause
boundaries and deterministic bounded variation remain the scheduling mechanism.

## `GATE_RANGA_001` — human editorial quality

Pass a real owned 3-5 minute pilot, then a representative 20-30 minute output:

- composition/cadence metrics above;
- image-to-voiceover relevance scored `2=direct`, `1=contextual`, `0=generic/incorrect`, with mean
  >=1.8 and no `0` in the opening minute or critical claims;
- literal evidence/objects/locations/actions match narration rather than generic mood images;
- zero visible generated text/logo/watermark, major anatomy/object defects, pseudo-infographic,
  motion graphics, decorative transition, or style break in accepted scenes;
- avatar crops feel natural in full and split, with no abrupt talking cut attributable to renderer;
- human reviewer accepts opening rhythm, shot-role diversity, pacing, realism, lips, identity, audio,
  and the final playable MP4.

Ranga uses real moving UGC/stock in places. VideoForge's AI stills plus slow zoom can match the
composition, cadence, and evidence-led edit grammar, but must not claim identical natural footage
motion.

## `GATE_E2E_001` — real integrated project

Using an owned short project through the actual app:

1. authenticate and create/select tenant-private presets;
2. upload voiceover to private R2 and freeze revision;
3. admit through the fair DB queue;
4. run hosted ASR, deterministic schedule/prompts/span materialization;
5. dispatch exact Mage/SoulX whole-video jobs through their Serverless endpoints;
6. accept only verified signed receipts and durable tenant artifacts;
7. render/probe in Cloud Run;
8. review/play/download the final MP4 in installed Chrome;
9. restart the control plane during at least one non-destructive stage and recover;
10. prove zero endpoint jobs, zero total workers (`Active + Flex`), and both retained volumes after
    drain.

Record commit, deployment revisions, account-safe IDs/hashes, endpoint/runtime/volume manifests,
GPU/rate, every stage timing, artifact hashes/probes, cost, callbacks/status evidence, and cleanup.

## `GATE_CONCURRENCY_001` — 5-10-user behavior

Pass staged tests with 1, 2, 5, and 10 distinct accounts:

- no tenant leakage and no account with two active videos;
- exactly two or fewer videos active globally under races/restarts;
- fair promotion/no starvation and per-account queue order;
- each endpoint remains at two or fewer workers and the shared lane volume remains unchanged;
- cancellation/failure of one tenant does not mutate or expose another;
- status/event fan-out, database connections, Workflow instances, Cloud Run jobs, R2, and browser UI
  remain bounded and truthful;
- all jobs settle and endpoints drain to zero endpoint jobs and zero total workers (`Active + Flex`).

## `GATE_ECONOMICS_001` — production-length speed/cost

Use at least 10 representative accepted runs spanning cold/warm starts and concurrent load. Report
queue wait separately from active service time; per-lane initialization/inference/upload; CPU/render;
provider idle/retry/possible duplicate cost; final settled variable cost; and fixed volume rate.

Pass objectives:

- representative 30-minute active-service p50 <=30 minutes and p90 <=45 minutes;
- variable cost target <=`$1.00` and hard MVP ceiling <=`$2.00` per accepted 30-minute video;
- no hidden always-on GPU workers;
- zero total workers (`Active + Flex`) and zero endpoint jobs after drain, plus the explicit
  continuing two-volume `$7/month` planning rate;
- estimates remain conservative enough to block before cap risk.

If the exact quality/runtime cannot pass both hard cost and quality gates, stop and present measured
tradeoffs. Do not silently weaken quality, switch model/GPU, or leave workers warm.

## `GATE_SECURITY_001` — production security

Pass automated and independent review for:

- invite/auth/session/CSRF/origin/rate-limit controls;
- tenant database, API, event, queue, R2, signed-URL, callback, scratch/cache, and log isolation;
- least-privilege secrets/service identities and staging/production separation;
- upload/media parsing limits, malware/content policy as selected, decompression/zip-bomb protection;
- webhook forgery/replay, dispatch-token replay, stale assignment, SSRF/path traversal/object-key
  injection, ID enumeration, and cost-amplification attacks;
- dependency/container/image/secret scans, SBOM/provenance, key rotation and incident runbooks;
- queue purge and old Pod transport unreachable from ordinary production paths.

Any unresolved critical/high issue blocks release.

## UI and Chrome acceptance

Preserve the accepted shell and visible features. Replace manual GPU/Pod lifecycle controls with
one-click Generate, private queue/capacity state, clear current-video progress, cancellation, retry,
and result playback. The UI never exposes another tenant or claims an unverified state.

Installed Chrome acceptance covers desktop and compact/mobile layouts, keyboard/focus, reduced
motion, refresh/reconnect, multi-tab stale mutations, signed-download expiry, failure/blocked states,
and browser console/network cleanliness. Screenshots prove appearance only; interactions and state
evidence prove behavior.

## Release condition

Production release requires all active V2 gates green:

`GATE_TENANCY_001`, `GATE_STORAGE_001`, `GATE_QUEUE_001`,
`GATE_SERVERLESS_CONTRACT_001`, `GATE_HOSTING_001`, `GATE_SERVERLESS_MAGE_001`,
`GATE_SERVERLESS_SOULX_001`, `GATE_SOULX_LICENSE_001`, `GATE_E2E_001`,
`GATE_RANGA_001`, `GATE_IMAGE_001`, `GATE_STYLE_002`, `GATE_CONCURRENCY_001`,
`GATE_ECONOMICS_001`, and `GATE_SECURITY_001`.

The release handoff also requires clean Git state, exact deployed commit/digests, migration/backup
evidence, runbooks/alerts, no unexplained Chrome errors, settled paid evidence, zero endpoint jobs,
zero total GPU workers (`Active + Flex`), and the two expected retained volumes only.

# Cost, speed, and capacity budget

Per-image regeneration decision (2026-09-27): new replacements use Fal Z-Image Turbo, publicly
listed at $0.005 per megapixel. One 1280x720 image per request; no automatic paid retry after an
uncertain POST. Refresh rates and obtain exact finite-action authority before live acceptance.
This is a published-rate estimate, not observed account debit. Existing video generation prices
and historical attempt cost records remain separate.


Fresh API generation decision (2026-09-24): Kie z-image lists 0.8 credits, approximately
$0.004 per image. On 2026-09-25 the public Fal FlashHead model page listed $0.005 per output
second. The earlier authenticated audio-route quote was $0.00125 per billable compute second;
the audio route's actual debit remains unverified because its billing endpoint returned 403.
Use the higher public rate for a conservative finite-action cap and check actual provider usage
when accessible. The RunPod rates and formulas below apply to existing attempts and retained volumes.

Status: V2 planning envelope; live Serverless unit economics remain an acceptance gate
Read when: estimating a video, configuring endpoint capacity/timeouts, changing a model or stage,
or presenting paid authority.

Prices and availability change. Refresh official pricing and exact compatible `EU-RO-1` inventory
read-only at each paid checkpoint. A document snapshot is never dispatch authority.

## Ongoing ordinary Cloud billing — 2026-10-01

The user explicitly removes ordinary Cloud spend caps, account allowance expiry, rental-count quotas and repeated finite-budget approvals. Selecting Cloud and starting a video authorizes its normal paid processing. DEC_CLOUD_BILLING_001 supersedes prior temporary finite-account requirements for ordinary videos. Preserve account scope, durable estimated-versus-settled cost attribution, no-replay, fair admission, cancellation and finite machine shutdown deadlines. Historical finite authorities and the prior UNKNOWN/STOPPING launch remain immutable; ongoing access cannot clear an uncertain launch or its capacity fence. Migration0236 is live with ongoing access and no account spend ceiling, expiry or rental quota. Migration0237 permits fresh Cloud VIDEO admission past fully fenced terminal early-media cleanup; the old UNKNOWN/STOPPING record and debit remain unchanged and still count against the two-resource global ceiling. A fresh rental retains the singleton-locked one-live-rental/account check. Cloud runs hosted ASR, audio preparation and rendering on temporary RunPod Pods, commits results to R2, and terminates compute after upload; existing hosted Kie/Fal generation stays remote. No personal computer is required.

## Current planning references

RunPod Serverless pricing pages list Flex billing by the second for startup, execution, and idle time,
rounded to whole seconds. Current planning examples checked for this V2 reset:

- RTX 4090 PRO Flex: approximately `$0.00031/second` = `$1.116/hour`.
- RTX 5090 PRO Flex: approximately `$0.00044/second` = `$1.584/hour`.
- Network volume storage below 1 TB: `$0.07/GB-month`.

Only RTX 4090 is in the initial Mage and SoulX endpoint allowlists. The RTX 5090 row is comparison
data, not a fallback or dispatch option; each lane must qualify it independently before activation.

`workersMin=0` means no always-on Active worker charge, but each autoscaled Flex worker bills from
startup through execution and any retained idle period. `workersMax=2` is a capacity ceiling per
endpoint, not a reservation and not a promise of availability.

Other planning references:

- Runware DeepSeek V4 Flash: `$0.076/M` input, `$0.153/M` output, `$0.014/M` cached input.
- Runware Gemini 3.5 Flash style analyzer: `$1.50/M` input and `$9.00/M` output/thinking below
  200k, used only when explicitly analyzing a new draft style.
- Cloudflare R2 Standard: first 10 GB-month free, then `$0.015/GB-month`; direct egress free under
  the recorded pricing page. Operations still count.
- Cloudflare, Neon, R2, Runware, and RunPod pricing/allowances remain deployment-time measurements, not a
  permanent `$0` promise.
- Local personal-worker ASR/span/render has `$0` provider compute cost, but consumes the user's electricity,
  device time, storage, and network. Those are disclosed separately and are never used to claim the
  complete video costs `$0`.

## Fixed retained infrastructure

VideoForge already retains two isolated 50 GB `EU-RO-1` model volumes:

| Volume | Size | Recorded monthly rate | Purpose |
|---|---:|---:|---|
| Mage-only | 50 GB | `$3.50/month` | Exact Mage INT8 ConvRot sealed runtime |
| SoulX-only | 50 GB | `$3.50/month` | Exact SoulX-FlashHead Pro sealed runtime |
| **Total** | **100 GB** | **`$7.00/month`** | Fixed, outside per-video variable cost |

Zero endpoint workers does not stop this `$7.00/month` storage billing. Normal generation may not
resize, repair, prepare, merge, cross-mount, or delete either volume. Any change is separately
authorized and reports its new recurring rate before mutation.

## Representative 30-minute workload

Pinned Ranga-style planning basis:

```text
final duration                         1,800 seconds
avatar share                           approximately 21-22%
visible avatar output at 22%           396 seconds
exact accepted fixture appearances     103
exact accepted fixture padded audio    481.32 seconds
likely generated images                approximately 220-320
```

The scheduler, not an LLM or worker, determines these counts. Full and split compositions reuse one
native SoulX clip; rendering two crops must not trigger two avatar generations.

## Variable GPU cost formula

For each endpoint attempt:

```text
billed_seconds = startup + execution + provider_idle_billed_seconds
attempt_cost = billed_seconds * current_flex_rate_per_second
video_gpu_cost = accepted_attempts + failed_attempts + possible_duplicate_compute
```

Track Mage and SoulX separately. Include cold initialization, model load/warm-up, every batch item,
upload, retry, cancellation tail, and ambiguous/duplicate exposure. Do not calculate from inference
time alone. Do not divide an unaccepted output into a misleading low cost-per-video claim.

The application reserves against a conservative bound before dispatch and reconciles provider facts
afterward. The retained-volume fee is disclosed separately and is never hidden inside or amortized
into one project's variable cost.

## Accepted artifact-runtime measurements

These are valuable engineering baselines, not Serverless results:

- Mage qualification proved the exact 13,379,919,280-byte INT8 ConvRot artifact, offline load, two fresh RTX
  4090 Pods, eight 1280×720 outputs, and zero compute after cleanup. Recorded readiness observations
  included 31.755 and 42.144 seconds; the qualification's conservative total accounting was
  `$1.110002`, not a representative per-video bill.
- SoulX qualification proved the exact 6,916,084,703-byte Pro runtime, sealed volume, offline RTX 4090
  load, owned 10.12/10-second native outputs, and zero compute after cleanup. A measured worker run
  recorded 20.268 seconds inference plus 0.894 seconds encode/mux for 10 seconds of audio. The fresh
  Pod observation recorded 672.035 seconds from provider start to `model_ready`, while worker-internal
  manifest/load/compile/warm-up readiness totaled 173.672 seconds. A prior extrapolation put the
  avatar lane near `$0.402` at the then-Pod `$0.74/hour` rate, but it is not Serverless economics.

Do not transfer Pod rates, boot behavior, image cache assumptions, or settlement to Serverless.
Serverless handler import, volume attachment, concurrency, startup billing, endpoint idle time, and
Flex rate must be measured again.

## Prompt, style, and preset cost

Production prompt writing remains small relative to GPU work. Existing DeepSeek qualification kept a
40-scene accepted run at `$0.00085053` and all development attempts for that task at `$0.00243598`.
Retain a conservative `$0.005-$0.015` 30-minute prompt allowance until production usage replaces it.

A ready published Image Style adds no Gemini call to ordinary generation. Creating/analyzing a new
style is a separate user-triggered action with its own estimate, idempotency, and cost owner. Existing
qualification observed roughly `$0.032-$0.0375` for first analysis and below `$0.076` with one
bounded retry.

A ready Avatar Profile adds no onboarding inference to ordinary lookup. Each video's selected speech
still requires SoulX generation. Optional per-profile compatibility tests are separately estimated
and never charged to a video project.

No repair or fallback model reserve is active. Any retry beyond the documented same-model bounded
policy, substitute, quality pass, upscaler, or AI-video stage requires a new decision and estimate.

## CPU, storage, and orchestration cost

Pinned whisper.cpp transcription, selected-span preparation and deterministic FFmpeg render/probe
use the explicitly selected backend over private R2. Local uses the authenticated account's paired
Windows/macOS worker with `$0` provider compute; device time, electricity and transfer remain
measured. Optional Cloud uses a separate qualified RUNPOD_POD reservation with finite approved
GPU-plus-temporary-disk cost and deadline, and independent cleanup. See the Cloud media release
runbook for current authority and observed rates. Historical Cloud Run jobs remain superseded.

R2 stores tenant-private inputs, intermediates, results, and receipts. A 30-minute H.264 final at
8-12 Mbps is roughly 1.8-2.7 GB before intermediates. The 10 GB free allowance holds only a few
complete videos; apply the approved intermediate/final lifecycle and show storage state rather than
silently deleting results.

Cloudflare Workflows/Workers and Neon may initially fit published free allowances, but production
acceptance measures actual 5-10-user operations, database/storage usage, and alert thresholds.

## Per-video budget

| Component | V2 state |
|---|---|
| DeepSeek prompts | Planning `$0.005-$0.015`; qualified small runs exist |
| Mage Serverless | Unmeasured on live queue endpoint |
| SoulX Serverless | Unmeasured on live queue endpoint |
| Personal-worker ASR/render | `$0` provider compute; device time/electricity and real 30-minute runtime unmeasured |
| R2/Cloudflare/Neon variable share | Unmeasured; expected small |
| Repair/fallback | None active |
| **Total variable 30-minute generation** | **Target <=`$1.00`; measured economics gate, not a project cap** |

The target excludes the continuing `$7.00/month` volumes. A production profile cannot claim this
economics target until representative cold/warm, concurrent, failed, and recovered runs settle.
Hosted projects have no user-configured maximum-spend field: new revisions persist a `NULL` project
limit and predispatch does not reject solely because an estimate exceeds a per-project ceiling.
Exact cost estimates, reservations, attribution, settlement, and cancellation remain mandatory.
This unlimited-project decision is separate from paid release authority: every mutation checkpoint
still requires its own finite source-bound action cap and stop conditions.

## Speed and readiness budget

Measure queue wait separately from active service time. Initial acceptance objectives:

| Stage | Objective |
|---|---:|
| Admission transaction/outbox commit | p95 <=1 second under 10-user test |
| Dispatch-to-provider assignment | measured and bounded; no silent retry |
| Cold worker start to `MODEL_READY` | each lane below RunPod's documented 7-minute unhealthy threshold |
| Warm worker job start | p95 <=15 seconds before item work |
| Transcript/timeline/prompt preparation | overlap GPU cold start where dependencies permit |
| Final personal-worker render/probe | measured per supported OS/device class; no GPU retention |
| Active-service 30-minute video p50 | <=30 minutes after admission |
| Active-service 30-minute video p90 | <=45 minutes after admission |

Historical SoulX's 672-second Pod start-to-ready misses the seven-minute cold target and is a
specific Serverless risk. Qualify container startup and `RUNPOD_INIT_TIMEOUT`; do not hide the gap by
starting an always-on worker.

The initial invited-production gate requires one representative automatic run with final duration
between 29 and 31 minutes, plus the settled lane, short-E2E, pilot, and concurrency observations. A
shorter run cannot close the quality or economics gate. Do not label this p50/p90. Accumulate at
least 10 organic accepted beta jobs before reporting p50/p90 confidence. Report:

- application wait, RunPod queue wait, initialization, inference, upload, render, and end-to-end;
- actual worker/GPU/rate and billed seconds;
- cost per accepted output and per final video;
- failures, retries, possible duplicate compute, and cancelled tail;
- zero-worker proof after drain and continuing volume billing.

## Capacity and fairness economics

Application admission allows one active provider workload per account and two from different
accounts globally. Ordinary videos remain capped at one/account and two globally. Explicit preset
previews consume the same slots at lower priority than every eligible video. Each endpoint has
`workersMax=2`, permitting two admitted workloads to use separate workers when both need that lane.
RunPod's endpoint queue is not the fairness mechanism; only DB-admitted jobs are sent.

Benchmark 1, 2, 5, and 10 simultaneous accounts. Report per-account wait, starvation checks, worker
count, cold-start amplification, throughput, and cost. Scale limits may be lowered when economics or
volume read safety fail; they may not be raised beyond two without a new capacity/security decision.

## Budget-change rule

Any mandatory model, enhancement pass, multimodal QA call, upscaler, AI-video stage, extra endpoint,
always-on worker, larger volume, or higher concurrency must update this file with current recurring,
per-attempt, and representative-video cost before activation. A paid checkpoint proposal states exact
operations, current GPU/rate, fixed storage effect, finite spend cap, stop conditions, and cleanup.

## Cloud media cost qualification — 2026-09-28

Explicit Cloud adds compute cost and requires its own finite spend authority. Frontier's USD1.12/h,
USD5 and120-minute settings are references, not VideoForge approval. Read-only catalogue observed
rank1 RTX PRO4500 Blackwell Server32GB at USD0.72/h GPU/LOW availability, plus estimated100GB
temporary disk USD0.013889/h (USD0.733889/h all-in). Actual returned CPU/RAM/resources and charge
must pass approved bounds before execution. VideoForge speed,45-minute scratch peaks and settled
billing remain unmeasured; no reliability/capacity guarantee follows from the listing.

## Seedance7% integration (2026-10-03)

Seedance1.0ProFast bytedance:2@2,720p16:9: published Runware rate verified2026-10-02 is USD0.01336/generated second. Seven percent of30minutes is126motion seconds, nominalUSD1.68336; API minimum1.2seconds and0.1second rounding can generate a small unused tail. Planning uses generated duration for projected cost; exact task cost is recorded before media acceptance, including charged invalid outputs. Implementation qualification cap isUSD4 provider/compute, with no30minute paid benchmark. Four inference jobs may be outstanding; result acceptance is serial to fit Worker memory. Parallel stage durations are not added to wall-clock elapsed time.

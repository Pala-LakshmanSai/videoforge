# Cost, speed, and capacity budget

Status: V2 planning envelope; live Serverless unit economics remain an acceptance gate
Read when: estimating a video, configuring endpoint capacity/timeouts, changing a model or stage,
or presenting paid authority.

Prices and availability change. Refresh official pricing and exact compatible `EU-RO-1` inventory
read-only at each paid checkpoint. A document snapshot is never dispatch authority.

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
- Personal-worker ASR/render has `$0` provider compute cost, but consumes the user's electricity,
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

Pinned whisper.cpp transcription and deterministic FFmpeg render/probe run in scale-to-zero Cloud
Run Jobs over private R2. Measure CPU, memory, execution, operation, and transfer cost per accepted
project. Local Mac runs are development parity and cannot establish hosted cost.

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
| **Total variable 30-minute generation** | **Target <=`$1.00`; hard MVP ceiling <=`$2.00`; open gate** |

The target and ceiling exclude the continuing `$7.00/month` volumes. A production profile cannot
claim this budget until representative cold/warm, concurrent, failed, and recovered runs settle.
If the conservative predispatch estimate exceeds the active project cap or the `$2.00` product
ceiling, reject before provider mutation unless a later explicit decision changes the ceiling.

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

Do not declare p50/p90 from one sample. Record at least 10 representative accepted runs spanning cold
and warm starts, both endpoints, and the approved compositions. Report:

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

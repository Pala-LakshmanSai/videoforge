# Cost, speed, and capacity budget

Status: planning envelope; replace blocked rows with CP-11 measurements
Read when: showing estimates, choosing GPU profiles, changing avatar share, adding a stage, or approving fallback.

Architecture decision updated: 2026-08-13. Rate examples were last checked 2026-08-10. Prices and
inventory change; production refreshes inventory when opening a global generation session and
revalidates the session's exact lane offering before every Pod create.

## Current reference rates

Runware DeepSeek V4 Flash:

- $0.076/M input.
- $0.153/M output.
- $0.014/M cached input.

Runware Gemini 3.5 Flash style analyzer:

- $1.50/M text/image/video input below 200k.
- $9.00/M output/thinking below 200k.
- Runs only when a user explicitly analyzes a new draft Image Style version.

RunPod on-demand Pods are the approved GPU lifecycle. Recorded planning examples, not current quotes:

- RTX 4090 24 GB: $0.69/hour.
- RTX 5090 32 GB: $0.99/hour.
- L40S 48 GB: $0.99/hour.
- RTX 6000 Ada 48 GB: $0.84/hour.
- A100 PCIe 80 GB: $1.39/hour.

When the app is truly idle, fetch live compatible inventory and exact rates independently for Mage
and Echo. The first accepted Generate selects and locks one exact pair for the singleton global
session. Waiting projects inherit it; there is no per-project selection or mid-session switch. Pin
the receipts/rate ceilings and actual GPUs. A lane Pod may stay warm only if it is already running
and waiting projects exist. A deleted lane is not recreated merely because a project enters the
queue; recreate it only when the next project becomes active, using the same session GPU after fresh
availability/rate revalidation.

RunPod network storage standard under 1 TB: $0.07/GB-month.

VideoForge intentionally retains two different `EU-RO-1` model volumes: Mage INT8 ConvRot and Echo
FP8. No capacity is approved yet. Each allocation must be derived from that lane's verified manifest
plus explicit operational headroom before provisioning. At the recorded rate, fixed monthly cost is
`(mage_allocated_gb + echo_allocated_gb) × $0.07`; actual allocation and billing must be read from
RunPod. This fixed cost is explicitly accepted and is not a target for removal, sharing, or
per-project optimization.

Cloudflare R2 Standard:

- 10 GB-month free.
- Then $0.015/GB-month.
- Direct egress free.

## 30-minute workload

Ranga-style target:

```text
final duration = 1,800 seconds
avatar share = 22%
avatar output = 396 seconds
avatar frames at 25 fps = 9,900
```

Likely images: approximately 220–320 including split companions, often near 300.

## Runware prompt cost

Conservative example:

```text
10,000 input × $0.076 / 1,000,000 = $0.00076
30,000 output × $0.153 / 1,000,000 = $0.00459
total = $0.00535
```

Planning range: $0.005–$0.015. The cost is too small to justify weaker prompts or complicated provider routing.

Measured qualification on 2026-08-11 (`VF-3-01`):

- Final accepted strict-schema run: 40 scenes across five style blocks for `$0.00085053`.
- Total task spend including two earlier recorded five-batch attempts: `$0.00243598`.
- The final run and cumulative task spend remained below the `$0.02` run target and the
  non-transferable `$1` DeepSeek qualification cap, respectively.
- These are qualification measurements, not a production invoice; keep runtime cost collection
  and the broader project planning range.

## One-time Image Style cost

A ready published style adds no Gemini call to a project. Its compact guidance slightly increases the DeepSeek batch prefix but remains inside the existing $0.005–$0.015 project prompt range.

Original planning estimate for creating one style from 3–8 references with Runware Gemini 3.5 Flash:

```text
first analysis = approximately $0.03–$0.07 once per style
one reconciled retry may approximately double the analysis portion
optional three-image Mage test = explicit separate estimate; cold boot may dominate
```

Measured qualification on 2026-08-11 (`VF-3-02`):

- Qualified `mediaResolution: medium` and `thinkingLevel: low`.
- Accepted first-analysis range: `$0.031974–$0.037442`; every first analysis stayed below `$0.08`.
- Accepted retry totals: `$0.066977` and `$0.075869`, both below `$0.15`.
- Cumulative task spend including development probes/failures: `$0.407604`, below the
  non-transferable `$3` qualification cap.

This is a reusable global-catalog asset cost, not part of a 30-minute video's generation cap. Runtime must keep
provider-reported usage/cost and ordinary ready-style video generation at zero Gemini calls.

## Avatar Hub cost

Creating a named Avatar Profile, uploading/validating its source, and selecting a ready version uses no LLM and no mandatory GPU call. Its private image/thumbnail storage is small. Reusing it avoids repeated upload/setup but does not remove EchoMimicV3-Flash compute for each video's unique scheduled speech.

An optional user-triggered three-clip compatibility test is a separate one-time Avatar Profile version cost, never part of a video's generation cap. Initial planning target is at or below $0.20 because a cold worker boot may dominate a few seconds of output; show the exact execution-profile estimate first and replace this target with `GATE_AVATAR_001` measurements. Merely saving or selecting a profile must never start a worker.

## Mage image cost

User expectation to reproduce: about 300 images in five generation minutes after load. The user's
current ImageForge experience reaches model-ready in roughly 3–4 minutes; that is a user-reported
baseline, not a measured VideoForge result. VideoForge's ideal target is at or below 2 minutes from
Pod start request to `model_ready` after the one-time volume preparation.

Illustrative only, using the recorded $0.69/hour RTX 4090 Pod example:

```text
4 min start/load + 5 min generation = 9 min
9/60 × $0.69 = $0.1035

2 min target start/load + 5 min generation = 7 min
7/60 × $0.69 = $0.0805
```

These are arithmetic illustrations, not a VideoForge cost claim. The exact Mage INT8 ConvRot,
4-step, guidance-1.0, 1280×720 volume/Pod profile remains gated until cold and warm Pod runs measure
create, volume attach, container ready, manifest verify, model load, generation, and deletion.

## EchoMimicV3-Flash cost qualification

No accepted Echo runtime/cost exists. Historical BF16 and FP8 attempts produced no accepted MP4 and
remain attempt evidence, not production unit economics or approval of a long-video path.

The approved production target is a dedicated Echo FP8 volume and disposable Pod processing only
scheduled short spans. One-time volume preparation is measured separately from ordinary projects.
For every qualification record session-selected/actual GPU and rate; Pod create, volume attach,
container-ready, manifest verification, model-ready, generation, encode, upload, and Pod deletion
times; peak VRAM/disk; and exact settled cost. Cleanup means zero Pods while the two approved model
volumes remain intact. Only later representative cold/warm evidence may establish
production unit economics.

Every one percentage point of avatar share equals 18 output seconds or 450 frames at 25 fps. With a fast avatar engine this is affordable, but the scheduler still targets the measured 21–22% style rather than maximizing avatar.

## Fallback cost

No active repair/fallback reserve exists. Any retry, repair, or fallback requires new user authority
and separate cost evidence.

Measured qualification observations through VF-9-20 are not production unit economics: three Mage
technical runs cost `$0.0280524074`, `$0.0235054352`, and `$0.0308072963`, but all outputs failed
strict visual review; the 40-prompt matrix produced no PNG and cost `$0`. SkyReels bounded attempts
cost `$0.0502363111`, `$1.2642676444`, `$0.6784048000`, and `$0.5263056722`, with no output. These
failed/partial charges must not replace the planning ranges or close `GATE_COST_001`.

## Render and ASR

- Production whisper.cpp transcription and FFmpeg render/probe run as scale-to-zero Cloud Run Jobs
  over private R2 artifacts. Their variable CPU, memory, execution, transfer, and operation cost is
  measured separately; Mac execution is development parity only.
- Start transcription while the active project's GPU Pods boot. Final render never occupies or
  retains a Mage/Echo Pod. Cloud Run region and sizing remain benchmark-gated.
- If waiting work exists when a lane finishes, its already-running Pod may stay warm but cannot
  process that work until the next project becomes active. With no waiting work, delete immediately
  even if the other lane or CPU render continues. After queue drain, both Pods must be absent.

## Expected marginal total

| Component | 30-minute target |
|---|---:|
| Reuse of ready Avatar Profile | $0 onboarding/test call; normal EchoMimicV3-Flash row still applies |
| Reuse of ready Image Style | $0 vision; negligible added DeepSeek tokens |
| Runware prompts | $0.005–$0.015 |
| Cloud Run word ASR | no paid API; variable CPU/R2 cost unmeasured |
| Mage images | unmeasured on the selected INT8 ConvRot disposable-Pod profile |
| EchoMimicV3-Flash | unmeasured; production estimate blocked |
| Avatar repair/fallback | none active |
| Cloud Run FFmpeg/render QA | variable CPU/R2 cost unmeasured |
| R2 operations/storage allocation | $0–$0.03 initially |
| **Total variable 30-minute generation** | **target ≤$1.00; unmeasured; blocked by `GATE_COST_001`** |

The two retained model-volume charges are fixed infrastructure cost and do not consume a project's
variable generation cap. The 30-minute target is at most `$1.00`; the hard MVP ceiling is `$2.00`.
Dispatch must reject projected variable spend above `$2.00` unless a later versioned user decision
changes it. Replace blocked rows only with measured session-GPU, Cloud Run, R2, model-manifest, and
lifecycle costs.

## Fixed monthly cost

Required control-plane subscription: $0 while the currently published Cloudflare/Neon allowances
suffice. Cloud Run Jobs add no intentionally always-on CPU worker, but executions are variable video
cost. Alert before exhaustion and re-estimate if pricing/allowances change; do not promise permanent
free service.

Avatar Profiles and Image Styles add no subscription or always-on compute. They reuse private R2; styles also reuse the Runware balance. A few normalized references or avatar source derivatives are usually only a few megabytes; show storage/retention but do not add a paid database tier.

RunPod volumes are the accepted fixed cost and remain when Pods are deleted:

- `EU-RO-1` Mage volume: separate manifest-sized allocation containing only the exact prepared
  Mage-Flow-Turbo INT8 ConvRot runtime and manifest.
- `EU-RO-1` Echo volume: a different manifest-sized allocation containing only the exact prepared
  EchoMimicV3-Flash FP8 runtime and manifest.
- Never merge, cross-mount, or delete either approved volume merely to reduce its fixed charge.
- One-time preparation/download/verification cost is tracked separately from normal project cost;
  ordinary Pod boot must perform no model download.

Do not copy whole model repositories with duplicate BF16/FP8/unused artifacts. Store only the pinned
source lineage and exact prepared runtime files required by each model. Provider account minimum
top-ups, if any, are account-policy cash flow rather than app fixed cost and must be checked before
setup.

## Storage capacity

A 30-minute H.264 final around 8–12 Mbps is roughly 1.8–2.7 GB before intermediate assets. R2's free 10 GB holds only a few complete projects. Use lifecycle deletion for temporary assets and show final-retention choice. Beyond free, 50 GB-month of Standard storage is about $0.60 after the free allowance, so storage remains small but not zero.

Style references and private Avatar Profile source/thumbnail assets share that allowance. Default to short disposable-derivative retention and explicit original retention; do not silently delete a published style, active avatar source, or lineage needed to explain an output.

## Speed budget

Cold, no-fallback target:

| Stage | Goal |
|---|---:|
| Upload + Cloud Run ASR + timeline | 2–5 min, network dependent; unproven |
| Mage Pod start → model-ready | ideal ≤2 min; unproven |
| 220–320 images | ≤5–8 min after load |
| Echo Pod start → model-ready | ideal ≤2 min; unproven |
| Avatar generation | ≤6–20 min, benchmark dependent |
| Cloud Run final render + technical QA | 3–8 min; unproven |
| **End-to-end p50** | **≤30 min isolated service time** |
| **End-to-end p90** | **≤45 min isolated service time** |

The user's reported ImageForge model-ready baseline is 3–4 minutes. It is comparison context only,
not VideoForge evidence and not a relaxation of the ideal ≤2-minute target. Measure request-to-Pod,
volume attach, container ready, manifest verified, model loaded, and `model_ready` separately for
both cold and warm trials.

Both lanes may start in parallel for the one active project while upload/Cloud Run ASR/timeline
preparation advances. Waiting projects remain inert; there is no cross-project pipelining.

Style analysis is not in this table because project creation requires an already published style. Creating a new style is a separate asynchronous action; once published it does not change video-production p50/p90.

Avatar Profile creation and optional compatibility testing are also outside this table. A ready profile adds only a metadata/object lookup to project preflight.

The SLO excludes time waiting behind already queued projects and is not valid from one demo. Report cold/warm service-time p50/p90 after at least 10 representative completed jobs, and report queue wait separately for 1/2/5/10 concurrent users.

## Queue economics

- One global session serves exactly one active project at a time with at most one Mage Pod and one
  Echo Pod. Waiting entries never run chunks or CPU work.
- Waiting work may keep an already-running lane Pod warm. It never recreates an absent lane; that
  happens only after the next queue entry becomes active and the exact session offering revalidates.
- No round-robin/fairness engine, per-user Pod pair, GPU switch, or parallel project execution enters
  MVP. Any admitted user may manually reorder/remove waiting entries.
- Attribute session boot, active-project inference, warm idle, retry, Cloud Run CPU, R2, and fixed
  volume cost separately. Zero waiting/active work requires both Pods to be deleted and absent.
- Record cost per accepted output, not just GPU hourly price; a cheaper slow GPU can cost more after retries and wall time.

## Budget-change rule

Any new mandatory model, enhancement pass, multimodal QA call, upscaler, AI-video stage, Style LoRA/reference-conditioning stage, or separate worker must update this file with measured marginal and fixed cost before it enters MVP.

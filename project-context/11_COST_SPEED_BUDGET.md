# Cost, speed, and capacity budget

Status: planning envelope; replace with measurements during Phase 0  
Read when: showing estimates, choosing GPU profiles, changing avatar share, adding a stage, or approving fallback.

Checked: 2026-08-10. Prices and inventory change; production reads live/provider-configured rates.

## Current reference rates

Runware DeepSeek V4 Flash:

- $0.076/M input.
- $0.153/M output.
- $0.014/M cached input.

Runware Gemini 3.5 Flash style analyzer:

- $1.50/M text/image/video input below 200k.
- $9.00/M output/thinking below 200k.
- Runs only when a user explicitly analyzes a new draft Image Style version.

RunPod Serverless Flex baseline for the approved MVP:

- RTX 4090 PRO: currently about $0.00031/second, equivalent to about $1.10/hour while a worker is billed.
- Fetch the exact endpoint/GPU rate before every estimate and pin the rate snapshot to the execution profile/task.

Hourly Pod examples are later optimization references, not the MVP cost formula:

- RTX 4090 24 GB: $0.69/hour.
- RTX 5090 32 GB: $0.99/hour.
- L40S 48 GB: $0.99/hour.
- RTX 6000 Ada 48 GB: $0.84/hour.
- A100 PCIe 80 GB: $1.39/hour.

RunPod network storage standard under 1 TB: $0.07/GB-month.

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

This is a workspace asset cost, not part of a 30-minute video's generation cap. Runtime must keep
provider-reported usage/cost and ordinary ready-style video generation at zero Gemini calls.

## Avatar Hub cost

Creating a named Avatar Profile, uploading/validating its source, and selecting a ready version uses no LLM and no mandatory GPU call. Its private image/thumbnail storage is small. Reusing it avoids repeated upload/setup but does not remove EchoMimicV3-Flash compute for each video's unique scheduled speech.

An optional user-triggered three-clip compatibility test is a separate one-time Avatar Profile version cost, never part of a video's generation cap. Initial planning target is at or below $0.20 because a cold worker boot may dominate a few seconds of output; show the exact execution-profile estimate first and replace this target with `GATE_AVATAR_001` measurements. Merely saving or selecting a profile must never start a worker.

## Mage image cost

User expectation to reproduce: about 300 images in five generation minutes after load.

At the current 4090 Serverless Flex baseline:

```text
5 min cold/load + 5 min generation = 10 min
600 seconds × $0.00031 = $0.186
```

Planning sensitivity including cold start/retries: roughly $0.12–$0.25; the desired accepted-image target remains at or below $0.20 after measured caching/batching. This remains a gate until measured on the new account, exact resolution, container, and batch mode.

## EchoMimicV3-Flash cost qualification

No accepted Echo runtime/cost exists. BF16 attempts through `VF-9-24H` produced no MP4 and consumed
a cumulative live balance delta of `$1.8200686945`; the exact A100 sample remained active for about
21m54.9s before its attempt cost stop. These failures are not production unit economics.

`VF-9-24I` permits `$0` FP8 worker/image work now. Its one RTX 4090 paid sample requires a fresh
cumulative cap because only `$0.1799313055` remains under the prior `$2` ceiling. Once authorized,
record live rate, queue/activation/bootstrap/quantization/load/generation/encode/upload time, peak
VRAM, disk, exact settled cost, and absolute-zero cleanup. Only later 12–20-clip representative
cold/warm evidence may establish production unit economics.

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

- Local ASR has $0 API cost and targets under $0.01 incremental compute when sharing the image/media lane boot.
- FFmpeg render/technical QA on the current GPU Serverless baseline is roughly $0.06–$0.15 for 3–8 billed minutes. A benchmarked scale-to-zero CPU/cheaper media lane may lower it later.
- Do not hold a loaded Mage GPU idle while waiting for avatar work; dispatch a render job when the asset barrier closes.

## Expected marginal total

| Component | 30-minute target |
|---|---:|
| Reuse of ready Avatar Profile | $0 onboarding/test call; normal EchoMimicV3-Flash row still applies |
| Reuse of ready Image Style | $0 vision; negligible added DeepSeek tokens |
| Runware prompts | $0.005–$0.015 |
| ASR | $0 API; <$0.01 incremental target |
| Mage images | $0.12–$0.25 sensitivity; target ≤$0.20 |
| EchoMimicV3-Flash | unmeasured; production estimate blocked |
| Avatar repair/fallback | none active |
| FFmpeg/render QA | $0.06–$0.15 on current GPU baseline |
| R2 operations/storage allocation | $0–$0.03 initially |
| **Expected fast/no-major-fallback** | **about $0.40–$0.98** |
| **Planning envelope with modest fallback** | **about $0.50–$1.30** |

Default operational cap: $1.50 before explicit approval. The MVP project contract rejects any cap above $2. User goal: normally below $1 when fast-path measurements hold, always below the user-selected $1–$2 ceiling. These totals are derived ranges, not the sum of every independent worst case; the runtime forecast sums the exact selected execution profiles and reserved fallback probability.

## Fixed monthly cost

Required control-plane subscription: $0 while the currently published Cloudflare/Neon free allowances suffice. Alert before exhaustion and re-estimate if provider pricing/allowances change; do not promise permanent free service.

Avatar Profiles and Image Styles add no subscription or always-on compute. They reuse private R2; styles also reuse the Runware balance. A few normalized references or avatar source derivatives are usually only a few megabytes; show storage/retention but do not add a paid database tier.

RunPod volumes are the accepted fixed cost. Do not pre-provision unused fallback weights. Planning envelope:

- The one Echo sample uses 100 GB ephemeral container disk and creates no persistent volume cost.
- Any later durable Echo volume is measured from the exact `23,922,317,735`-byte minimum runtime
  manifest plus cache overhead before provisioning.

Do not copy whole model repositories with duplicate BF16/FP8/unused artifacts. Store only pinned runtime files. Provider account minimum top-ups, if any, are account-policy cash flow rather than app fixed cost and must be checked before setup.

## Storage capacity

A 30-minute H.264 final around 8–12 Mbps is roughly 1.8–2.7 GB before intermediate assets. R2's free 10 GB holds only a few complete projects. Use lifecycle deletion for temporary assets and show final-retention choice. Beyond free, 50 GB-month of Standard storage is about $0.60 after the free allowance, so storage remains small but not zero.

Style references and private Avatar Profile source/thumbnail assets share that allowance. Default to short disposable-derivative retention and explicit original retention; do not silently delete a published style, active avatar source, or lineage needed to explain an output.

## Speed budget

Cold, no-fallback target:

| Stage | Goal |
|---|---:|
| Upload + ASR + timeline | 2–5 min, network dependent |
| Image cold/load | ≤5 min |
| 220–320 images | ≤5–8 min after load |
| Avatar cold/load | ≤5–8 min |
| Avatar generation | ≤6–20 min, benchmark dependent |
| Final render + technical QA | 3–8 min |
| **End-to-end p50** | **≤30 min isolated service time** |
| **End-to-end p90** | **≤45 min isolated service time** |

Lanes run in parallel. Expected end-to-end is dominated by the slower lane, not their sum.

Style analysis is not in this table because project creation requires an already published style. Creating a new style is a separate asynchronous action; once published it does not change video-production p50/p90.

Avatar Profile creation and optional compatibility testing are also outside this table. A ready profile adds only a metadata/object lookup to project preflight.

The SLO excludes time waiting behind already queued projects and is not valid from one demo. Report cold/warm service-time p50/p90 after at least 10 representative completed jobs, and report queue wait separately for 1/2/5/10 concurrent users.

## Queue economics

- Back-to-back projects amortize model boots.
- `workersMax=1` initially limits cost; Faster mode may raise it after load tests.
- Round-robin chunks protect five to ten users from starvation.
- Record cost per accepted output, not just GPU hourly price; a cheaper slow GPU can cost more after retries and wall time.

## Budget-change rule

Any new mandatory model, enhancement pass, multimodal QA call, upscaler, AI-video stage, Style LoRA/reference-conditioning stage, or separate worker must update this file with measured marginal and fixed cost before it enters MVP.

# Fresh sample observation — 2026-09-29

Checkpoint V2-09 / VF-10-09. A separately approved 44.6-second normal Cloud project
started once in signed-in regular Chrome after enabling the extension's file URL
permission through Computer Use. New provider generation is capped at USD0.25;
the existing USD1.60 Cloud authority remains limited to five rentals, USD0.80/hour,
temporary disk at least100GB, no retained volume, expiry2026-09-30T12:30Z.

## First concrete failure and repair

Cloud ASR succeeded on a verified NVIDIA L4 placement at USD0.503888889/hour including
100GB disk. Context extraction succeeded. Scene planning rejected the exact saved
Cloud template with `HOSTED_GENERATION_ASR_JOB_TEMPLATE_INVALID`: the planner admitted
only the personal-worker template. No Kie image or Fal avatar jobs had been created.

The repair validates Cloud template/runtime/tool hashes against the same tenant,
revision, attempt and verified reservation. Local template/model/version checks
remain intact. The immutable saved ASR result is reused; no retranscription or
provider regeneration is required. No migration or media runtime change is needed.

The actual saved input/output bytes reproduce the old failure. The repaired planner
produces11 segments,9 image tasks,3 avatar tasks,1338 frames with full and split avatar
compositions. This is correctness recovery, not a measured render-speed improvement.

## Focused validation and limits

Coordinator13 tests, web and Worker typechecks, changed-file lint, production builds
and production bundle/dispatch firewalls pass. The installed native CLIs were used;
the pnpm wrapper's dependency reinstall/no-TTY failure is a tooling limitation.
Existing broad-suite failures remain as recorded in CURRENT_STATE.yaml.

ASR phase telemetry: startup48.599s, input transfer8.294s, processing12.061s,
checking6.001s; exact acceptance/cleanup timings remain in private evidence.
RunPod system logs confirm the pinned image. Successful container command logs were
not emitted; phase telemetry is not claimed as detailed FFmpeg profiling. Independent
complete inventory verifies owned ASR Pod absence; unrelated compute was untouched.

The planning repair is published at source41f74259 / Cloudflareee91ee4c. The same
canonical continuation instance adopted the new definition and progressed without
a new project, ASR attempt or browser retry. Live settings contain50 total bindings:
25 secrets,19 plain variables and6 resource bindings; earlier41-count shorthand was
stale. All existing values/resources and23 client assets were preserved.

Nine prompts were accepted in55.901s with reported costUSD0.041855. All three Cloud
spans reused one RTXPRO4500BlackwellServer Pod atUSD0.733888889/hour including100GB.
All9 Kie images and3 Fal avatar clips were accepted once; the span Pod is independently
CLEAN while the APIs run. Final assembly is searching bounded qualifying capacity;
no render Pod had launched at14:38UTC.

## Production fixes and fresh final acceptance

The first render capacity search exhausted and failed cleanly with no Pod launch.
Local-only retry status hid the already supported Cloud recovery. Additive224 fixes
only that read projection and selects the backend's qualified source hash. Local
failed-lease checks, tenant boundaries, accepted-media/manifest proof, uncertain
cleanup rejection and five-attempt bound remain. It was installed once after exact
source ROLLBACK proof:207 ledger rows, all206 old rows preserved, omitted148 untouched.
The configured runtime independently read eligible status. No authority expansion.

Source2cea7e581c79107fc0cd43d14f3837849a76882e is published at100 percent as Cloudflare
63a210c4-37e1-4c1c-8160-22c4f97a00a2. Frozen single-module bundle5795505c is7,549,045B;
config6ace447d,23 assets/manifest3cc81450. All25 secrets/50 total bindings/three existing
Workflow resources remain, as do Local0.1.44/Kie/Fal/auth/private R2/query redaction and
historical disabled GPU lanes. The same canonical continuation adopted the new
version; no new continuation instance or runtime/image publication.

An explicit Computer Use Retry created a fresh render attempt from the same accepted
9 images,3 avatar clips,9 prompts and immutable manifest003d2fcc. No regeneration.
RTXPRO4500BlackwellServer placement verified atUSD0.733888889/hour including100GB disk.
Final44.6s/1338frames/1920x1080p30 H264/AAC passed mandatory full decode and technical
gates,0ms reported A/V drift,6,475,224B; whole SHA149157b872ffdbfc414f3d7994acdc71e6e892ad816ef93c2686e7854f1d6dc8.
Private R2 bytes independently match. The original narration is pinned; decoded
8kHz audio has356,800 samples on both sides and zero-lag correlation0.9785 after
accepted loudness normalization/AAC. This supports narration preservation, not
bit-exact PCM or a numerical lip-sync quality score. Output loudness-16.44LUFS,
true peak-1.96dBTP. Full/split avatar and final44.3s frame reviewed without a visible
composition seam or lost tail. Source shirt branding is retained source content;
no overlay/caption/title/graphics is added. Imagery is coherent but fairly generic;
no quantified editorial-quality improvement is claimed.

Regular signed-in Chrome played naturally0→44.6s with ended=true/error=null after
complete inventory confirmed compute off; saved approval succeeds and survives reload.
Native Download was tried once and Chrome returned Failed–Blocked. No policy bypass.
Exact private object download is verified separately; native download remains a gate.

## Measured speed, cost and limits

| Final phase | Seconds |
| --- | ---: |
| Claim to input download |18.422|
| Input download |10.482|
| Render/composition |42.853|
| Checking phase |4.009|
| Saving to durable acceptance |19.122|
| Acceptance to independent cleanup verification |30.134|
| Fresh attempt to accepted output |99.840|

Checking includes control/phase overhead; recorded technical verification is549ms.
The first failed placement search lasted132.274s and rented nothing. Sample wall
elapsed40m39s includes diagnosis/release/capacity recovery; it is not ordinary run
speed. Prompt55.901s, spans2m51s, images36s, avatars2m11s; provider phases overlap.
No GPU was retained during API wait. One Pod served all three ready spans.

Capability lookup now uses one pool rather than two. Eight post-warmup read-only
requests per side: median471.456→411.945ms,59.511ms/12.62 percent lower observed.
This measures exact inactive control-path latency across different observation times;
network/provider variance remains and no end-to-end render gain is inferred. Active
span progress now prefers the running job over queued siblings. These changes are
live. Model, encoding, immutable media, quality gates and resource/price floors stay.

Three launched Pods' creation-to-verified-cleanup lifetime estimateUSD0.083083,
including disk rates; invoice unobserved. Conservative approval debitUSD0.80 across
four reservations includes the failed capacity search and is not billed compute.
Authority remainsUSD1.60/max5 reservations/expires2026-09-30T12:30UTC. Prompt reported
USD0.041855, contextUSD0.000067; UI image/avatar published-rate estimateUSD0.08 is
separate and unverified against provider invoices. No claim of whole-cost savings.
Final sampled scratch peak53,280,768B on100GB is a filesystem lower bound for this
short input, not a long-video disk sizing guarantee. Complete paginated provider
inventory15:55-style local observation (14:55:25UTC) proves zero owned media Pods;
all sample reservations CLEAN and unrelated resources untouched.

Controller126/coordinator13 checks, selected UI3 checks, two PostgreSQL recovery
checks, web/Worker typechecks, changed lint, builds and bundle/dispatch firewalls pass.
The broad repository baseline remains as CURRENT_STATE records. No broad rerun added.
Successful container command logs were not available; RunPod system logs, durable
phase/disk telemetry and application heartbeat/upload/complete/cleanup responses were
observed. Do not claim detailed FFmpeg CPU profiling or exactly-once provider effects.

Prior retained45-minute technical/storage proof remains valid for its fixture only;
fresh45-minute provider/editorial acceptance and full45-minute Chrome playthrough are
not established by this44.6s sample. No matched full-render before/after exists: old
planning blocked and initial render had no capacity. Correctness and measured control
latency improved; quantified video-quality or total production speed gain is unproven.

Rollback: disable allocations, fence/drain exact owned attempts and independently
verify absence before restoring the verified source. Preserve accepted media and all
additive ledger entries. No rollback was required. Main unrelated edits stay excluded.
Public proof: SAMPLE_OBSERVATION_PROOF.json. Private scoped evidence:
`.videoforge/cloud-media/sample-observation-20260929/` including application logs,
phase history, system logs, runtime/migration readbacks, whole-object, audio and Chrome
proof. Source voiceover repeats its opening and ASR joins scrape knee into scrapenie;
neither was silently edited.

# Models and providers

Status: exact model choices locked; Serverless lane qualifications pending
Read when: building a worker, pinning dependencies, estimating cost, or proposing a model change.

Rates and provider behavior are time-sensitive. Refresh official sources and live account
configuration before any mutation or paid proposal. Do not hard-code planning rates as provider
truth. Existing Pod evidence proves specific artifacts and samples; it does not prove queue-based
Serverless startup, concurrency, timeout, scale-to-zero, or billing behavior.

## Active compute boundary

Production target:

- one Mage queue-based RunPod Serverless endpoint in `EU-RO-1`;
- one SoulX queue-based RunPod Serverless endpoint in `EU-RO-1`;
- `workersMin=0`, `workersMax=2`, `REQUEST_COUNT=1`, handler concurrency 1, one GPU per worker;
- RTX 4090 only until each lane separately qualifies RTX 5090;
- one existing sealed 50 GB volume per lane mounted only at `/runpod-volume`;
- model volumes immutable/read-only by application policy, with all job writes redirected to local
  scratch and accepted outputs uploaded to tenant-private R2;
- normal startup downloads no model, resolves no mutable repository, and performs no quantization.

RunPod's queue is not the product scheduler. Postgres admits one active provider workload/account and
two globally from different accounts; ordinary videos retain one/account and two/global caps. Each
video/lane starts with one bounded whole-video batch attempt. A classified replacement may use a new
token only after the prior attempt is terminal or uniquely reconciled and batches all unresolved
items; accepted items are not regenerated. Users never choose GPUs, start/stop Pods, or manage
workers.

RunPod `/run` does not document client idempotency, exactly-once execution, or zero duplicate billing.
Persist dispatch authority/outbox before POST, bind the returned job, reconcile `/status`, accept one
signed R2 result, and record duplicate-compute/cost exposure. Async provider results expire after 30
minutes; webhook delivery alone is never durable truth. TTL includes queue time and may remove a
running job. Execution/init timeouts must be measured and finite.

## Runware DeepSeek V4 Flash 0731

Approved purpose: batched project image-prompt writing only. It consumes a compact stored style
profile and never analyzes references.

- Provider: Runware.
- Canonical AIR: `deepseek:v4@flash`; public alias `deepseek-v4-flash` is not the immutable lock.
- Qualified name/version: `DeepSeek-V4-Flash-0731`, version 4, architecture `deepseek_v4`.
- Thinking off, JSON output with strict schema, temperature 0.2, top-p 0.9.
- No tools, search, code interpreter, vision, or long reasoning.
- Store request/profile hashes plus provider-reported usage and cost.

The accepted qualification passed exact model search and a 40-scene/five-style relevance/schema suite. Its
run cost `$0.00085053`; cumulative qualification was `$0.00243598`. A conservative 30-minute prompt
workload is cents or less, so prompt relevance must not be degraded to save fractions of a cent.

## Runware Gemini 3.5 Flash

Approved purpose: one explicit, version-scoped analysis when a user creates a new draft Image Style.
Ordinary video generation makes no call.

- API model `google-gemini-3-5-flash`; Runware AIR `google:gemini@3.5-flash`.
- 1–12 normalized authorized references; 3–8 recommended.
- `mediaResolution=medium`, `thinkingLevel=low`, temperature 0.1, top-p 0.9, at most 6000 tokens.
- Validate untrusted `image-style-analyzer-output/v1`, then assemble trusted
  `image-style-profile/v1` with deterministic range/cardinality checks.
- Bind account/workspace/style/version and exact input/output/request hashes.

`GATE_STYLE_001` passed seven synthetic sets. Measured first analysis was `$0.031974–$0.037442`;
accepted two-attempt totals were `$0.066977` and `$0.075869`. This is separate from a video's cap.

Runware standard processing is not described as confidential or zero-data-retention. Require plain
disclosure/rights consent, send only account-authorized normalized derivatives through exact
short-lived signed URLs, minimize content, and distinguish VideoForge deletion from provider
retention. Never send Ranga research frames.

## Mage-Flow-Turbo

Only active image runtime:

- Weights: `Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6`.
- ComfyUI: `Comfy-Org/ComfyUI@26d7f8556822d9d08c2d3e1878636ac3b4969af9`.
- Mode: Turbo, four denoising steps, guidance/CFG 1.0.
- Precision/profile: INT8 ConvRot; 1280x720 text-to-image.
- PyTorch attention; no FlashAttention, diffusers/Microsoft runtime, watermark/refusal patch,
  upscaler, reference conditioning, LoRA, or edit model.
- Graph: `CLIPLoader.type=mage` and latent from `TextEncodeMageFlowEdit`; EmptySD3 is invalid.

Exact sealed runtime files:

- `diffusion_models/mage_flow_turbo_int8_convrot.safetensors`;
- `text_encoders/qwen3vl_4b_bf16.safetensors`, SHA-256
  `36f3ff447ef59201722e8f9ce6020c9819fdcfba6aa2608c4e09b1c0ce114e34`,
  `8,875,719,384` bytes;
- `vae/mage_flow_vae_bf16.safetensors`, SHA-256
  `34e076dc1e8a15321e1e07be5111d59cf16dd10b804b7c7e20b4de29013427e0`,
  `345,053,056` bytes.

The superseded BF16 transformer is non-dispatchable. Never resolve `main` at runtime.

### Accepted Mage artifact foundation

- Immutable Pod image:
  `ghcr.io/pala-lakshmansai/videoforge-mage-cp06@sha256:0bd33cc8c41c7dc81964652b68e8f902e3521b931ade330c089f7999eb9c9f69`.
- Sealed manifest SHA-256:
  `cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b`.
- Exact selected model bytes: `13,379,919,280`.
- Existing retained volume: `videoforge-mage-cp06-model-volume-eu-ro-1-50gb`, isolated 50 GB in
  `EU-RO-1`; recorded retained rate `$3.50/month`.
- Two fresh RTX 4090 Pods loaded offline in 31.755s and 42.144s, produced eight valid 1280x720 PNGs,
  and failed closed on missing/wrong manifest. The user accepted visual quality.
- Settled finite qualification cost: `$0.34927155333571136`; final audit proved zero compute and the
  retained Mage volume.
- Exact acceptance and settlement evidence is indexed by `CURRENT_STATE.yaml.model_runtime_evidence.mage`.

This is strong artifact/Pod proof. It does not establish that the Pod image is a valid Serverless
worker image/template or that two Flex workers can safely read the volume concurrently. The Mage
Serverless checkpoint must adapt/publish an immutable handler image without changing model bytes,
then prove offline cold/warm jobs, signed R2 I/O, timeout/cancel/recovery, max-two concurrency,
manifest immutability, cost, and scale-to-zero.

Mage license metadata remains ambiguous: the indexed Comfy-Org page and pinned Microsoft repository
show MIT, while upstream Microsoft prose describes research-only/not intended for product or
service deployment. The user accepted this risk on 2026-08-11. Preserve the ambiguity and never
claim clearly established commercial permission.

## SoulX-FlashHead Pro avatar lane

Only active/proposed avatar runtime:

- Source: `Soul-AILab/SoulX-FlashHead@9bc03de06bb0de82cd6bc477804512ae06144bf2`.
- Weights: `Soul-AILab/SoulX-FlashHead-1_3B@59119b6c681230c3eeee157e224ae1941746711e#Model_Pro`;
  exact Pro safetensors and Wan VAE only.
- Audio encoder: `facebook/wav2vec2-base-960h@22aad52d435eb6dbaf354bdad9b0da84ce7d6156`;
  safetensors only.
- Runtime profile: `videoforge_soulx_flashhead_pro_bf16_v1`.
- BF16, 512x512, 25 fps, four distilled steps, shift 5, color correction 1.0, deterministic seed 42,
  streaming audio, Torch compile, no face crop.
- No repair, enhancement, fallback, alternate long-form mode, substitute model, alternate precision, or full
  voiceover dispatch.

### Accepted SoulX artifact foundation

- Immutable Pod image:
  `ghcr.io/pala-lakshmansai/videoforge-soulx-flashhead-pro-vf924s@sha256:0538d16199f04cac0a68ad4570b3fc260470b079200da025fe8f36640fb69a9b`.
- Exact selected payload: `6,916,084,703` bytes.
- Sealed manifest SHA-256:
  `995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626`.
- Existing isolated retained SoulX-only 50 GB volume in `EU-RO-1`; recorded retained rate
  `$3.50/month`; exactly the Mage and SoulX volumes remain.
- Fresh Secure RTX 4090 Pod proof at the then-current `$0.74/hour`: 24 GB advertised VRAM,
  `9,660,950,528` peak inference bytes, model ready 189.786s from service start, and 10.12-second
  inference 22.892s. Output was exact 253-frame 512x512 H.264/AAC with zero A/V delta.
- A later 1672x941-source run measured provider start-to-ready 672.035s and 10-second inference
  20.268s and produced source-aware full/split outputs. The user explicitly approved both exact
  hash-bound layouts on 2026-08-26; live SoulX qualification remains open. The difference between
  service-ready and provider-start timing is retained; neither is generalized as Serverless cold
  start.
- Final audits proved zero Pods/templates/endpoints/workers and exactly the retained Mage/SoulX
  volumes. The original qualification cost bound was `$0.275645`; immediate settlement rows were
  pending and must not be relabelled settled.
- Exact acceptance, timing, and composition evidence is indexed by
  `CURRENT_STATE.yaml.model_runtime_evidence.soulx`.

The exact model and volume are prepared; do not download or prepare them again. A Serverless handler
image/template is still unqualified. SoulX's measured 672.035-second provider-start-to-ready case
exceeds RunPod's documented seven-minute unhealthy-worker threshold. The Serverless checkpoint must
set and validate a finite `RUNPOD_INIT_TIMEOUT`, optimize only packaging/startup without changing
model/settings, and prove actual queue-to-worker/model-ready behavior. It must also prove two
concurrent read-only-by-app workers, exact short-span padding/trim, signed R2 I/O, cancellation,
recovery, cost, and scale-to-zero before production binding.

One native clip serves full and split. Crop profiles are versioned against the exact Avatar Profile
source geometry/checksum and require review; do not apply a crop from a different source image.

## Inactive model boundary

No alternate avatar runtime, repair/fallback ladder, enhancement model, or AI B-roll video model is
part of the active system. A future comparison requires a new explicit decision, exact license/access,
same-input A/B, timing/VRAM/cost/failure evidence, and no silent production substitution.

## Hosted word timing and rendering

Timing model is pinned `whisper.cpp ggml-base.en`:

- normalize an analysis derivative to 16 kHz mono PCM;
- English greedy decode, `--max-len 1 --split-on-word`, best-of 1, beam size 1;
- preserve deterministic long-file chunk overlap/reconciliation and exact executable hashes.

Production uses an authenticated account-owned Windows/macOS personal worker over fresh tenant-
private immutable R2 ports. A second mode runs pinned FFmpeg/FFprobe for final rendering. The worker
has no database, reusable R2, RunPod, Runware, Google, admin credential, or model-volume access.
Exact Windows/macOS tool hashes, signed installer identities, representative 30-minute runtime,
offline/recovery behavior, and protocol/update compatibility remain checkpoint-gated.

## Provider and model-change rule

No agent swaps a model, GPU class, precision, steps, scheduler, source revision, worker image, volume,
or provider because an alternative appears faster/cheaper. A change requires:

1. explicit user approval and a bounded task;
2. exact license/access/source check;
3. same owned-input A/B against current accepted outputs;
4. cold/warm timing, VRAM, throughput, output quality, failure/recovery, concurrent-reader, and cost
   evidence on the exact lane;
5. immutable publication/manifest evidence and updated decision/context/contracts/tests;
6. zero-worker/cleanup proof and a separately disclosed retained-storage effect.

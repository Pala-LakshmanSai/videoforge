# Models and providers

Status: user-approved ladder plus explicit benchmark gates  
Read when: building a worker, pinning dependencies, estimating cost, or proposing a model change.

Prices and provider capabilities below are time-sensitive. EchoMimicV3-Flash source/license/access state was refreshed on 2026-08-12; Runware/Mage and historical AvatarForcing facts retain their recorded check dates. Runtime code stores current rates/configuration rather than hard-coding this document.

## Global GPU session and CPU boundary

MVP has one global generation session and exactly one active video. When no session is open, the
first accepted Generate request presents fresh compatible inventory and binds one exact Mage GPU
and one exact Echo GPU. While the session is open, every admitted user's later project inherits
that immutable pair and enters the shared waiting queue; GPU selectors are unavailable. A waiting
project performs no transcription, scheduling, prompt/span preparation, Pod action, or inference
until the current video is terminal and the project becomes the sole active entry.

After a lane finishes the active video, an already-running Pod may remain `model_ready` but idle
only when a waiting entry already exists. With no waiter, delete that lane's Pod immediately and
independently, even while the other lane or final render continues. If a waiter arrives after the
Pod was deleted, do not recreate early: on next-video activation, revalidate and recreate only the
same session-locked GPU. Unavailable blocks the lane; no GPU/model/precision/volume substitution is
allowed. Persistent model volumes remain.

When the final video is terminal and the waiting queue is empty, reconcile both lanes to proven Pod
absence before closing the session and exposing fresh selectors. Failure or cancellation is not an
exception; no paid Pod survives a fully drained session.

Production word transcription and final FFmpeg render/probe run as authenticated scale-to-zero
Cloud Run Jobs against the canonical private R2 namespace. The Mac runs the same pinned media
contract only for development/provider-free parity and is never the shared production executor.

## Runware DeepSeek V4 Flash 0731

Approved purpose: batched project image-prompt writing only. This model is text-only on Runware; it consumes a compact saved style profile and never analyzes reference images.

- Provider: Runware.
- Public API alias: `deepseek-v4-flash`.
- Qualified canonical Runware AIR ID: `deepseek:v4@flash`.
- User-approved checkpoint name: DeepSeek V4 Flash 0731.
- Thinking: explicitly `off` even though Runware currently documents it as the default.
- Output: `outputFormat: JSON` with strict `jsonSchema`.
- Temperature: 0.2 initial.
- Top-p: 0.9 initial.
- Include provider-reported usage and cost.
- Do not enable tools, search, code interpreter, or long reasoning.

Current documented Runware prices:

- Input: $0.076 per million tokens.
- Output: $0.153 per million tokens.
- Cached input: $0.014 per million tokens.

A conservative 30-minute workload of 10k input and 30k output is approximately $0.00535. Even a less efficient workload remains around one cent. Do not downgrade prompt relevance to save a fraction of a cent.

`VF-3-01` closed `GATE_LLM_001` on 2026-08-11. Live authenticated Runware
`modelSearch` resolved the canonical AIR `deepseek:v4@flash` to exactly one curated public result
named `DeepSeek-V4-Flash-0731` (`version: 4`, architecture `deepseek_v4`), and all generation
requests pinned that AIR rather than the mutable public alias. Native generation responses did not
echo a model/version field, so the provider model-search record and its response hash remain part
of the lock evidence. The final 40-scene/five-style strict-schema run passed every ID, role,
literal-relevance, forbidden-output, identity, and cost criterion at `$0.00085053`; cumulative
qualification spend including earlier recorded attempts was `$0.00243598`.

Official sources: [Runware DeepSeek-V4-Flash API](https://runware.ai/docs/models/deepseek-v4-flash), [Runware model search](https://runware.ai/docs/platform/model-search), and [Runware platform model identifiers](https://runware.ai/docs/platform/introduction).

## Runware Gemini 3.5 Flash

Qualified purpose: one-time multi-reference Image Style analysis when a user explicitly analyzes a new draft style version. `GATE_STYLE_001` closed on 2026-08-11.

- Provider/API: Runware, same account/key/SDK selected for DeepSeek.
- Native API model ID: `google-gemini-3-5-flash`; Runware SDK/AIR alias: `google:gemini@3.5-flash`.
- Input: 1–12 normalized reference images in one request; 3–8 recommended.
- Output: untrusted `image-style-analyzer-output/v1` through `outputFormat: JSON` and strict `jsonSchema`; trusted code validates it and assembles the stored `image-style-profile/v1` payload/provenance.
- Qualified mode: `mediaResolution: medium`, `thinkingLevel: low`, temperature 0.1, top-p 0.9, maximum 6000 tokens.
- Include provider-reported usage/cost and store exact request/profile hashes.
- Normal project generation makes no call to this model.

Current documented Runware prices:

- Text/image/video input: $1.50 per million tokens below 200k.
- Output/thinking: $9.00 per million tokens below 200k.
- Measured accepted first-analysis cost: $0.031974–$0.037442 across the seven synthetic sets; accepted two-attempt totals were $0.066977 and $0.075869. This is once per analyzed style, not per video.

The accepted provider-facing schema keeps exact properties, types, required fields, enums, and
closed-object boundaries. Gemini rejected the larger fully constrained schema, so trusted local
canonical validation remains authoritative for range/cardinality constraints. The qualified request
also omits provider seed because the documented unsigned Runware range was not portable through
this Google generation path. Cumulative VF-3-02 qualification spend was `$0.407604` under its `$3`
cap; ordinary video creation still performs zero analyzer calls.

Why not use Gemini 3.1 Flash Lite by default: it is substantially cheaper, but extracting subtle shared treatment while excluding recurring reference content is a quality-sensitive one-time task. The additional few cents are amortized across every project that reuses the style. The VideoForge-specific seven-set qualification passed Gemini 3.5 Flash, so no fallback A/B is currently required.

Runware advertises no LLM training on prompts/outputs, but zero-data-retention is enterprise-only. Its standard terms/privacy posture may store inputs, treats uploads as non-confidential, and grants service-related rights broad enough that VideoForge must not describe standard processing as ZDR or confidential. Require disclosure consent, use only owned/synthetic qualification images, send browser-normalized derivatives over short-lived signed URLs, minimize content, record user rights, distinguish VideoForge deletion from provider retention/deletion, and never send the private Ranga frames.

If the analyzer repeatedly fails style/content separation, A/B only the analyzer against direct Gemini 3.6 Flash. Do not disturb DeepSeek, Mage, the scheduler, or avatar architecture.

Official sources: [Runware Gemini 3.5 Flash](https://runware.ai/docs/models/google-gemini-3-5-flash), [Runware LLM security](https://runware.ai/llm-api), [Runware terms](https://runware.ai/terms), and [Runware privacy](https://runware.ai/privacy).

## Mage-Flow-Turbo

Approved purpose: every original B-roll still.

- Runtime weights: `Comfy-Org/Mage-Flow` at
  `d8c99241f6fa80fbd453014234af2bf337ea21e6`, loaded through pinned headless ComfyUI.
- Model family: 4B.
- Mode: Turbo, 4 denoising steps, CFG 1.0.
- Runtime profile: INT8 ConvRot, matching the user's current ImageForge model path.
- Output: 1280×720.
- Native variable resolution: official card describes 512–2048 and up to 4:1.
- Official A100 card result: about 0.59 seconds at 1024² and about 18–20 GB peak memory.
- GPU: selected independently from freshly queried, model-compatible live inventory only by the
  request that opens an idle global session; all queued projects inherit it. Public inventory is
  not compatibility evidence; only qualified choices are exposed.

The 1280×720 lock replaces the earlier resolution/BF16 candidates. Final 1080p detail and split-safe
framing remain acceptance checks, but they do not authorize a silent resolution, precision, or model
change. Use packed batches only if the exact ImageForge runtime remains stable. Do not add an
upscaler until blind final-frame evaluation proves a material improvement.

The separate `microsoft/Mage-Flow-Edit-Turbo` model is not needed in the normal MVP. Add it only if the user later approves reference editing/outpainting.

Mage receives a text prompt compiled from the selected style profile; it does not receive the style's reference images in MVP. Prompt-derived styling is intentionally simple/cheap but must pass `GATE_STYLE_002`. Do not silently introduce reference conditioning or LoRA training if a distinctive style fails.

The exact current ImageForge runtime is stock `Comfy-Org/ComfyUI` at
`26d7f8556822d9d08c2d3e1878636ac3b4969af9`, using PyTorch attention. No FlashAttention, diffusers,
Microsoft package, watermark patch, or refusal patch is part of this path. The exact graph uses
`CLIPLoader.type=mage` and the latent emitted by `TextEncodeMageFlowEdit`; an EmptySD3 latent is invalid.

The exact normal-runtime file set at the immutable public revision is
`diffusion_models/mage_flow_turbo_int8_convrot.safetensors`,
`text_encoders/qwen3vl_4b_bf16.safetensors`, and `vae/mage_flow_vae_bf16.safetensors`.
Existing evidence records the Qwen encoder as
`sha256:36f3ff447ef59201722e8f9ce6020c9819fdcfba6aa2608c4e09b1c0ce114e34`
(`8,875,719,384` bytes), and VAE
`sha256:34e076dc1e8a15321e1e07be5111d59cf16dd10b804b7c7e20b4de29013427e0`
(`345,053,056` bytes). The earlier BF16 transformer was
`sha256:6df47df3d7efc9ebdad075b87b3e9e4f74d09dca672d592271788f0ee27ab97d`
(`8,231,536,760` bytes), but it is historical and is not part of the selected normal-runtime file
set. The one-time preparation gate must record the INT8 transformer's exact size and SHA-256 before
writing the complete marker. Never resolve mutable `main` at runtime.

Mage owns one dedicated, persistent `EU-RO-1` network volume and uses disposable Pods. CP-06
verified `13,379,919,280` exact model bytes, and the user approved a 50 GB STANDARD volume at
`$3.50/month`, leaving at least `36,620,080,720` decimal bytes (`34.11 GiB`) for download staging
and operational headroom. The volume is not shared with or mounted by Echo. An explicitly
authorized one-time preparation job
downloads the three exact pinned ComfyUI-format runtime files, records every path, size, SHA-256,
configuration and revisions, then writes a completion marker after verification. CP-06 prepared the
manifest once. Two RTX 4090 Pods booted offline from that volume, produced eight
1280x720 PNGs, and became ready in 31.755s/42.144s. Both negative boots failed closed. All compute
is absent; the 50 GB volume remains at `$3.50/month`.

A normal Mage Pod boot mounts that volume, verifies the complete manifest, and loads the model to the
global session's exact Mage GPU without downloading model bytes or resolving a network model
repository. Missing, mutated, cross-mounted, or incomplete content fails closed. Inputs and outputs
are separate mutable job artifacts; they never enter the model volume. After the active video's
Mage outputs become durable, keep the existing Pod warm-idle only when a waiter already exists;
otherwise delete it immediately. A missing Pod is recreated only when the next video activates,
after exact same-offering revalidation. The volume remains as accepted fixed-cost infrastructure.

Terms evidence remains ambiguous. The indexed official model page reports MIT. Microsoft's public
`microsoft/Mage` source repository at `76bec2bb3818863f470de7e867c2dc7f1d0bfd83` has an MIT
`LICENSE` and labels Mage-Flow MIT, while the same README describes the models as research-only/not
intended for product or service deployment. The user explicitly accepted this unresolved risk on
2026-08-11 and authorized continuing the locked Mage model. Evidence must retain the ambiguity and
cannot claim clear commercial permission.

Official runtime sources: [Comfy-Org Mage-Flow weights](https://huggingface.co/Comfy-Org/Mage-Flow)
and [ComfyUI](https://github.com/Comfy-Org/ComfyUI). Historical Microsoft sources remain terms
evidence only and are not the runtime implementation.

CP-06 is `READY_FOR_USER_REVIEW`; proof is
`evidence/acceptance/VF-9-24Q/cp06-phase-b/acceptance.json`. Production quality/style, two-lane, and
30-minute cost gates remain open. Fixture stays default; BF16 attempts remain historical.

## EchoMimicV3-Flash

Sole active avatar path under `DEC_AVATAR_007` and precision recovery `DEC_AVATAR_008`. Native
output only; new repair/fallback bindings are `null`. Fixture remains default and no production
profile is eligible.

- Source: `antgroup/echomimic_v3@7e89489ca51c0d008fc1963ec6c03fc5bd0b9397`, Apache-2.0.
- Flash weights: `BadToBest/EchoMimicV3@311e176905a8c4c24b240b530488fe636ce4d249`, Apache-2.0; exact Flash safetensors SHA-256 `5ebdbb2fc709108bf2a1728fd92eb2874804e4bc0324e92a2cd55425968c85a4`.
- Base: `alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP@fc913c34361f4ec879e2f9c78b4f11ae50a937d1`, Apache-2.0.
- Audio encoder: `TencentGameMate/chinese-wav2vec2-base@3991242c806928916fff4a8c0e4f76acf661b743`, MIT.
- Exact selected runtime bytes: `23,922,317,735` decimal bytes before small configs/source/dependencies.
- Runtime profile: a VideoForge-prepared FP8 artifact derived from the pinned first-party Flash
  safetensors with a pinned TorchAO toolchain; compatible transformer linear operations use
  `float8_e4m3fn` dynamic activation-and-weight quantization and remaining tensors stay BF16.
- Sampling remains 8 steps, `Flow_Unipc`, 25 fps, seed 43, TeaCache threshold 0.1, and empty negative
  prompt unless a later accepted model-profile decision supersedes it.
- No Long Video CFG. Echo receives only the scheduler's short selected speech spans, never the full
  voiceover or a replacement long-video workload.
- Input: canonical runtime image from exact Avatar Profile version, selected speech span, restrained prompt.
- One native clip serves both layouts after a measured renderer crop profile is approved.
- GPU: selected independently from freshly queried, Echo-compatible live inventory only by the
  request that opens an idle global session; queued projects inherit it. Selected and actual GPU
  identity must match the immutable session/attempt profile.

The upstream `GPU_memory_mode=sequential_cpu_offload` argument is parsed but never enables offload.
VideoForge makes no CPU-offload claim.

Echo owns a different persistent `EU-RO-1` network volume and a different disposable Pod. Its
capacity is likewise not yet approved and must be manifest-derived with explicit headroom. It never
shares or cross-mounts the Mage volume. An explicitly authorized one-time preparation
job downloads and verifies the pinned source/Flash/base/audio-encoder files, prepares the
VideoForge-owned FP8 runtime without an uncarded third-party pickle, records source and derived
hashes plus the exact TorchAO/runtime toolchain, and writes a completion marker only after
independent verification. The exact serialized FP8 artifact and manifest remain gate-controlled.

A normal Echo Pod boot mounts only the Echo volume, verifies its complete manifest, and loads the
model to the global session's exact Echo GPU without downloading model bytes or resolving a network
model repository. Missing, mutated, cross-mounted, or incomplete content fails closed. Private
avatar and audio inputs remain outside the model volume. After the active video's Echo clips become
durable, keep the existing Pod warm-idle only when a waiter already exists; otherwise delete it
immediately. A missing Pod is recreated only when the next video activates, after exact
same-offering revalidation. The Echo volume remains as accepted fixed-cost infrastructure.

`GATE_AVATAR_004` read-only preflight found all pinned source artifacts public, ungated, and
license-labeled. It remains open until the dedicated persistent volume contains the exact prepared
FP8 manifest and a normal offline Pod boot reproduces it without cross-mounting or downloading.
`GATE_AVATAR_001` remains open until native sample review and later full qualification.

No first-party FP8 checkpoint is published. A third-party `fp8wo` pickle exists without a model
card or declared license and is not used. VideoForge's one-time controlled preparation derives its
own FP8 runtime from the pinned Apache-2.0 Flash safetensors using pinned BSD-3-Clause TorchAO. The
prepared bytes, procedure, and manifest must pass the gate before use; this avoids executing an
uncarded pickle payload.

Official sources: [pinned source](https://github.com/antgroup/echomimic_v3/tree/7e89489ca51c0d008fc1963ec6c03fc5bd0b9397), [pinned Flash weights](https://huggingface.co/BadToBest/EchoMimicV3/tree/311e176905a8c4c24b240b530488fe636ce4d249), [pinned base](https://huggingface.co/alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP/tree/fc913c34361f4ec879e2f9c78b4f11ae50a937d1), and [pinned audio encoder](https://huggingface.co/TencentGameMate/chinese-wav2vec2-base/tree/3991242c806928916fff4a8c0e4f76acf661b743). Evidence: `evidence/gates/GATE_AVATAR_004/2026-08-12-echomimic-v3-flash-preflight/`.

## Historical avatar paths

AvatarForcing, MuseTalk, and SkyReels remain immutable history/replay evidence only. `VF-9-21`
preserves `$0.4496891390` spend, failures, artifacts, and commits. `GATE_AVATAR_003` remains an open
historical permission record and blocks clear permission claims, but it does not block Echo work.
No new dispatch, fallback, repair, or production binding may use these models without a new explicit
user decision.

## Hosted CPU word timing and rendering

Approved model: `whisper.cpp` `ggml-base.en`.

Proven QuickCut-style settings on the user's M4:

- Normalize to 16 kHz mono PCM WAV.
- `--max-len 1 --split-on-word` for word-like segments.
- English, greedy decoding, `--best-of 1`, `--beam-size 1`.
- 8 threads, Metal and FlashAttention locally.
- Do not enable VAD on the known local build; prior reference testing recorded a Metal crash.

Short-file measurements in the local QuickCut repo imply about a minute or less for 30 minutes on
the M4; this is a projection, not a direct 30-minute measurement. That Mac path is development
parity only.

Production invokes a pinned Cloud Run Job media worker through authenticated `jobs.run`. One job
mode executes whisper.cpp word timing and deterministic optional-script reconciliation; another
executes pinned FFmpeg render/probe. Both consume immutable R2 manifest pointers/checksums, publish
only to the expected private global prefix, and require output checksum/media-or-JSON validation
before acceptance. They have no RunPod credential, model-volume mount, or GPU-lane claim. Cloud Run
region, CPU, memory, timeout, concurrency, representative 30-minute runtime, and cost remain
benchmark-gated.

Groq Whisper, Deepgram, WhisperX, and browser-side WebGPU ASR are excluded from MVP unless the
pinned Cloud Run whisper.cpp contract fails a measured accuracy/timing gate.

## Models deliberately not in the normal path

| Model/tool | Reason |
|---|---|
| LongCat Avatar 1.5 | User-reaffirmed exclusion: diffusion runtime/cost breaks the target budget |
| Hallo3/Hallo2 | Far slower than the fast-avatar budget path; unattributed ranking screenshot is not authoritative |
| SoulX FlashHead | Not selected; EchoMimicV3-Flash is sole active avatar path |
| InfiniteTalk | Future research only under a new explicit user decision; no active ladder or fallback exists |
| Remotion | Does not improve image/avatar pixels or relevance; FFmpeg is enough |
| HyperFrames | Motion-graphics/text strengths conflict with hard rules; cloud minute cost is wasteful here |
| AI B-roll video models | Deferred from MVP by user decision |
| Style LoRA trainers/reference-conditioned image models | Not needed unless the prompt-only Image Style gate fails and the user approves the measured extension |

## Model-change rule

No agent swaps a locked model because a newer one looks impressive. A change requires:

1. User approval.
2. Exact license/access check.
3. Same-input A/B on VideoForge acceptance fixtures.
4. Cold and warm runtime, VRAM, accepted-output cost, and failure-rate evidence.
5. Updates to `MANIFEST.yaml`, this file, costs, tests, and the decision log.

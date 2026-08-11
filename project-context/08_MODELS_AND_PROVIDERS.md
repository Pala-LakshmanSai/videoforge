# Models and providers

Status: user-approved ladder plus explicit benchmark gates  
Read when: building a worker, pinning dependencies, estimating cost, or proposing a model change.

Prices and provider capabilities below were refreshed from official sources on 2026-08-10 and are time-sensitive. Runware DeepSeek identity and qualification facts were refreshed live on 2026-08-11. Runtime code must store current rates/configuration rather than hard-code this document.

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

Approved provisional purpose: one-time multi-reference Image Style analysis when a user explicitly analyzes a new draft style version.

- Provider/API: Runware, same account/key/SDK selected for DeepSeek.
- Native API model ID: `google-gemini-3-5-flash`; Runware SDK/AIR alias: `google:gemini@3.5-flash`.
- Input: 1–12 normalized reference images in one request; 3–8 recommended.
- Output: untrusted `image-style-analyzer-output/v1` through `outputFormat: JSON` and strict `jsonSchema`; trusted code validates it and assembles the stored `image-style-profile/v1` payload/provenance.
- Initial mode: `mediaResolution: high`, `thinkingLevel: medium`, temperature 0.1, top-p 0.9, maximum 6000 tokens.
- Include provider-reported usage/cost and store exact request/profile hashes.
- Normal project generation makes no call to this model.

Current documented Runware prices:

- Text/image/video input: $1.50 per million tokens below 200k.
- Output/thinking: $9.00 per million tokens below 200k.
- Planning cost for 3–8 high-resolution references: approximately $0.03–$0.07 once per style, not per video.

Why not use Gemini 3.1 Flash Lite by default: it is substantially cheaper, but extracting subtle shared treatment while excluding recurring reference content is a quality-sensitive one-time task. The additional few cents are amortized across every project that reuses the style. The exact choice remains gated by a VideoForge-specific A/B.

Runware advertises no LLM training on prompts/outputs, but zero-data-retention is enterprise-only. Its standard terms/privacy posture may store inputs, treats uploads as non-confidential, and grants service-related rights broad enough that VideoForge must not describe standard processing as ZDR or confidential. Require disclosure consent, use only owned/synthetic qualification images, send browser-normalized derivatives over short-lived signed URLs, minimize content, record user rights, distinguish VideoForge deletion from provider retention/deletion, and never send the private Ranga frames.

If the analyzer repeatedly fails style/content separation, A/B only the analyzer against direct Gemini 3.6 Flash. Do not disturb DeepSeek, Mage, the scheduler, or avatar architecture.

Official sources: [Runware Gemini 3.5 Flash](https://runware.ai/docs/models/google-gemini-3-5-flash), [Runware LLM security](https://runware.ai/llm-api), [Runware terms](https://runware.ai/terms), and [Runware privacy](https://runware.ai/privacy).

## Mage-Flow-Turbo

Approved purpose: every original B-roll still.

- Checkpoint: `microsoft/Mage-Flow-Turbo`.
- Model family: 4B.
- Mode: Turbo, 4 denoising steps, CFG 1.0.
- Dtype candidate: BF16.
- Native variable resolution: official card describes 512–2048 and up to 4:1.
- Official A100 card result: about 0.59 seconds at 1024² and about 18–20 GB peak memory.
- Initial GPU target: RTX 4090 24 GB.

Resolution bakeoff:

| Use | Candidates | Lock criterion |
|---|---|---|
| Full image | 1024×576, 1280×720, 1536×864 | Final 1080p detail vs total batch time/cost |
| Split-right | 768×864 or 1024×1152 | Clean 960×1080 crop, subject safety, speed |

Use packed batches if the official implementation stays stable. Do not add an upscaler until blind final-frame evaluation proves a material improvement.

The separate `microsoft/Mage-Flow-Edit-Turbo` model is not needed in the normal MVP. Add it only if the user later approves reference editing/outpainting.

Mage receives a text prompt compiled from the selected style profile; it does not receive the style's reference images in MVP. Prompt-derived styling is intentionally simple/cheap but must pass `GATE_STYLE_002`. Do not silently introduce reference conditioning or LoRA training if a distinctive style fails.

Access/launch gate: preserve the exact model card/license/checkpoint artifact used, verify commercial launch terms and gated download access, and pin a revision/hash. The public metadata reports MIT, but unauthenticated model/license artifact retrieval returned authorization-required on 2026-08-10. Launch must rely on the exact retrieved artifact, not metadata or memory.

Official source: [Mage-Flow-Turbo model card](https://huggingface.co/microsoft/Mage-Flow-Turbo).

## AvatarForcing

Approved role: provisional technical candidate for primary talking-avatar model; commercial qualification is blocked by `GATE_AVATAR_003`.

- The official repository README labels the project Apache-2.0, while its committed `LICENSE.txt` says academic-only/non-commercial and prohibits production use; that file also refers to a different project name, `RollingForcing`.
- The public Hugging Face weights repository currently declares no license. Its observed repository revision on 2026-08-10 was `e2448919a7b535c29f34e07892884ae1a43c6ace`; this is identity evidence, not permission to use it commercially.
- Input: the canonical runtime image from the exact pinned Avatar Profile version + selected speech audio + a simple restrained text prompt.
- Typical paper configuration: 832×480, 25 fps, one-step, 1.3B student; renderer deterministically duplicates/resamples frames to 30 fps without optical flow.
- Paper reports 34 ms/frame, but does not disclose the GPU.
- Produces lip movement plus face/head/subtle upper-body motion.
- Initial RunPod target: RTX 4090 24 GB; L40S/other compatible GPU only if the measured fit requires it.

Do not download weights, provision compute, or spend the AvatarForcing sub-cap until authoritative code-and-weights commercial-use terms reconcile the contradiction. Even after that, do not promise 4090 VRAM, cold-start, FPS, full-screen realism, or unit cost before the exact-avatar suite across representative Avatar Profile versions. The accepted clip is cropped deterministically for both layouts.

MVP fallback dispatch requires an explicit user/reviewer defect classification after deterministic technical checks. AvatarForcing/MuseTalk/SkyReels are not coupled to an unapproved automatic visual-QA model.

Official sources: [KlingAIResearch AvatarForcing](https://github.com/KlingAIResearch/AvatarForcing), [repository license artifact](https://github.com/KlingAIResearch/AvatarForcing/blob/main/LICENSE.txt), and [official Hugging Face weights](https://huggingface.co/lycui/AvatarForcing).

## MuseTalk 1.5

Approved role: conditional lip-only repair.

- Source video is the otherwise-good failed AvatarForcing clip.
- Driving audio is the same selected span.
- Never run on a passed clip.
- Never describe it as an enhancer/upscaler/whole-frame realism model.
- If it adds face softness, seams, identity change, or fails sync, discard the derivative.

Official repo reports 30fps+ on a Tesla V100 and edits a 256×256 face region. Reusable-avatar preparation may later support a performance-bank path, but that is deferred.

Official source: [MuseTalk](https://github.com/TMElyralab/MuseTalk).

## SkyReels V3 Talking Avatar

Approved role: cold whole-frame quality fallback.

- Model: Talking Avatar 19B 720P.
- Input: the same revision-pinned canonical Avatar Profile runtime source + selected audio, never a failed derivative, raw retained original, or mutable parent lookup.
- Native 1280×720/24 fps candidate path; supports single-GPU offload. An accepted fallback clip keeps this resolution for detail and uses the separate deterministic `skyreels-centered-1280x720p24-v1` render-source profile; it is never forced through AvatarForcing's 832×480 crop constants.
- Official repo exposes `--low_vram` using FP8 weight-only quantization and block offload, and lower-resolution fallbacks.
- Audio input supports up to 200 seconds, far longer than VideoForge's short spans.

It is heavier and potentially slower, so dispatch only for a whole-frame defect or failed MuseTalk repair, with budget reservation. Benchmark one 48 GB lane first; low-VRAM under-24 GB support may trade large wall time for fit.

Official source: [SkyReels V3](https://github.com/SkyworkAI/SkyReels-V3).

## Local word timing

Approved model: `whisper.cpp` `ggml-base.en`.

Proven QuickCut-style settings on the user's M4:

- Normalize to 16 kHz mono PCM WAV.
- `--max-len 1 --split-on-word` for word-like segments.
- English, greedy decoding, `--best-of 1`, `--beam-size 1`.
- 8 threads, Metal and FlashAttention locally.
- Do not enable VAD on the known local build; prior reference testing recorded a Metal crash.

Short-file measurements in the local QuickCut repo imply about a minute or less for 30 minutes on the M4; this is a projection, not a direct 30-minute measurement. Production uses the same free approach in the image/media worker and reconciles optional supplied text deterministically.

Groq Whisper, Deepgram, WhisperX, and browser-side WebGPU ASR are excluded from MVP unless the local method fails a measured accuracy/timing gate.

## Models deliberately not in the normal path

| Model/tool | Reason |
|---|---|
| LongCat Avatar 1.5 | Excellent quality evidence but slow per-video diffusion cost breaks target budget |
| Hallo3/Hallo2 | Far slower than the fast-avatar budget path; unattributed ranking screenshot is not authoritative |
| SoulX FlashHead | No longer needed if AvatarForcing passes; square/head-focused compromise |
| InfiniteTalk | Quality fallback research option only if approved ladder fails broadly |
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

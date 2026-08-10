# Source index

Status: evidence map; model/provider sources checked 2026-08-08; Phase 1 database sources checked 2026-08-10
Read when: verifying a claim, refreshing prices/licenses, or tracing a decision.

## Official model/provider sources

- Runware DeepSeek V4 Flash API, parameters, JSON schema, thinking, and pricing: [runware.ai/docs/models/deepseek-v4-flash](https://runware.ai/docs/models/deepseek-v4-flash)
- Runware Gemini 3.5 Flash multi-image inputs, media resolution, strict JSON, and pricing: [runware.ai/docs/models/google-gemini-3-5-flash](https://runware.ai/docs/models/google-gemini-3-5-flash)
- Runware Gemini 3.1 Flash Lite cheaper comparison: [runware.ai/docs/models/google-gemini-3-1-flash-lite](https://runware.ai/docs/models/google-gemini-3-1-flash-lite)
- Runware LLM data/security claims and enterprise-only ZDR option: [runware.ai/llm-api](https://runware.ai/llm-api)
- Runware terms governing uploaded contributions, provider/model rules, and output rights: [runware.ai/terms](https://runware.ai/terms)
- Google Gemini media-resolution/token guidance: [ai.google.dev/gemini-api/docs/media-resolution](https://ai.google.dev/gemini-api/docs/media-resolution)
- Google Gemini structured outputs: [ai.google.dev/gemini-api/docs/structured-output](https://ai.google.dev/gemini-api/docs/structured-output)
- Google Gemini 3.6 Flash quality-fallback candidate: [ai.google.dev/gemini-api/docs/models/gemini-3.6-flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash)
- Mage-Flow-Turbo model card: [huggingface.co/microsoft/Mage-Flow-Turbo](https://huggingface.co/microsoft/Mage-Flow-Turbo)
- Mage code: [github.com/microsoft/Mage](https://github.com/microsoft/Mage)
- AvatarForcing: [github.com/KlingAIResearch/AvatarForcing](https://github.com/KlingAIResearch/AvatarForcing)
- AvatarForcing paper: [arxiv.org/abs/2603.14331](https://arxiv.org/abs/2603.14331)
- MuseTalk: [github.com/TMElyralab/MuseTalk](https://github.com/TMElyralab/MuseTalk)
- SkyReels V3: [github.com/SkyworkAI/SkyReels-V3](https://github.com/SkyworkAI/SkyReels-V3)

## Official infrastructure sources

- RunPod GPU/storage pricing: [runpod.io/pricing](https://www.runpod.io/pricing)
- RunPod Serverless per-second rates and defaults: [endpoint settings](https://docs.runpod.io/serverless/endpoints/endpoint-configurations)
- RunPod Serverless overview: [docs.runpod.io/serverless/overview](https://docs.runpod.io/serverless/overview)
- RunPod endpoint configuration: [docs.runpod.io/serverless/endpoints/endpoint-configurations](https://docs.runpod.io/serverless/endpoints/endpoint-configurations)
- RunPod async request lifecycle, execution timeout, TTL, status, and result retention: [docs.runpod.io/serverless/endpoints/send-requests](https://docs.runpod.io/serverless/endpoints/send-requests)
- RunPod endpoint REST create/read/update contracts used for API-only reconciliation: [create](https://docs.runpod.io/api-reference/endpoints/POST/endpoints), [read](https://docs.runpod.io/api-reference/endpoints/GET/endpoints/endpointId), [update](https://docs.runpod.io/api-reference/endpoints/PATCH/endpoints/endpointId)
- RunPod network volumes: [docs.runpod.io/storage/network-volumes](https://docs.runpod.io/storage/network-volumes)
- Cloudflare React SPA + API in one Vite Worker: [developers.cloudflare.com/workers/vite-plugin/tutorial](https://developers.cloudflare.com/workers/vite-plugin/tutorial/)
- Cloudflare Vite plugin/HMR/runtime parity: [developers.cloudflare.com/workers/vite-plugin](https://developers.cloudflare.com/workers/vite-plugin/)
- Cloudflare Workers pricing: [developers.cloudflare.com/workers/platform/pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- Cloudflare Workflows pricing: [developers.cloudflare.com/workflows/reference/pricing](https://developers.cloudflare.com/workflows/reference/pricing/)
- Cloudflare Workflows Free limits and three-day completed-instance retention: [developers.cloudflare.com/workflows/reference/limits](https://developers.cloudflare.com/workflows/reference/limits/)
- Cloudflare R2 pricing: [developers.cloudflare.com/r2/pricing](https://developers.cloudflare.com/r2/pricing/)
- Neon pricing: [neon.com/pricing](https://neon.com/pricing)
- Neon serverless driver and Cloudflare/HTTP/WebSocket transaction guidance: [neon.com/docs/serverless/serverless-driver](https://neon.com/docs/serverless/serverless-driver)
- PGlite official description and unit/CI/local-development use: [pglite.dev/docs/about](https://pglite.dev/docs/about)
- Drizzle's official migration-strategy comparison, consulted but not selected for `VF-1-01`: [orm.drizzle.team/docs/migrations](https://orm.drizzle.team/docs/migrations)
- Vercel pricing and Hobby commercial limitation: [vercel.com/pricing](https://vercel.com/pricing)

## Reference videos

- Correct Watermelon: [youtube.com/watch?v=6jZ7ib2Edes](https://www.youtube.com/watch?v=6jZ7ib2Edes)
- Mosquito: [youtube.com/watch?v=cVotLLx5bNs](https://www.youtube.com/watch?v=cVotLLx5bNs)
- Wrong/excluded Watermelon link: `5JCQbwj0Kso`.

Measurements, selected frames, timestamps, and rights notes: `references/ranga/README.md`, `references/ranga/measurements.csv`, and `references/ranga/frames/frames.csv`.

The Ranga frames seed the manually authored built-in `documentary_stock_v1` profile only. They are not sent to Runware for style analysis. Machine-readable stored payload and provider trust boundary: `evidence/default_image_style_v1.json`, `evidence/image_style_profile.schema.json`, and `evidence/image_style_analyzer_output.schema.json`.

## User-provided references preserved locally

- Main UI image: `assets/ui/swipecut-ui-reference.jpg`.
- Historical complex architecture: `assets/research/historical-complex-architecture.png`.
- Historical avatar ranking: `assets/research/historical-avatar-ranking.png`.
- Original detailed visual brief: `evidence/source-briefs/visual-identity-original.txt`.
- Original product brief: `evidence/source-briefs/product-brief-original.txt`.

These are evidence/inspiration, not current decision authority. See their local READMEs and asset manifest.

## Local application baselines

Compact, pinned lesson brief: `evidence/source-briefs/LOCAL_BASELINES.md`. New chats should read that brief instead of loading these unrelated repos unless a task explicitly requires source verification.

- QuickCut/video-production baseline: `/Volumes/ESD-USB/video production software`.
  - Useful: local `whisper.cpp` provider, audio normalization, word offsets, queue/progress ideas.
  - Do not assume its entire architecture is production-ready.
- ImageForge: `/Volumes/ESD-USB/ImageForge`.
  - Useful: visual tokens/components, truthful RunPod lifecycle, owner-bound idempotency, immutable artifacts, queue UX.
  - Do not merge the image-generation desktop product wholesale.
- VoiceStamp: `/Users/lakshmansai/Desktop/VoiceStamp/app.py`.
  - Useful: free faster-whisper CPU INT8 word timestamps and JSON output.
  - QuickCut's M4 Metal `whisper.cpp` path was locally faster in recorded tests.

All three paths are optional local evidence and are not VideoForge build dependencies.

## Research conclusions retained

- HyperFrames is an HTML/CSS/Chrome/FFmpeg compositor whose motion-graphics/text strengths are irrelevant here; direct FFmpeg is leaner.
- Remotion similarly does not improve avatar/image realism or voiceover relevance for this grammar.
- LongCat quality research informed the avatar study, but per-video cost excluded it from default.
- AI-video model research remains deferred because the user chose image-only MVP.
- Runware Gemini 3.5 Flash is the provisional one-time Image Style analyzer because it supports several images and strict JSON through the same Runware account; Gemini 3.1 Flash Lite is cheaper but not preferred before a style-fidelity A/B.

## Citation/freshness rule

Use primary/official sources for technical claims. For a future model/price/license question, browse again rather than treating this 2026-08-08 snapshot as permanently current.

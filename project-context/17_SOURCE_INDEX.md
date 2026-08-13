# Source index

Status: evidence map; current Mage INT8/ImageForge implementation and Pod architecture refreshed 2026-08-13; EchoMimicV3-Flash sources refreshed 2026-08-12; older sources are historical
Read when: verifying a claim, refreshing prices/licenses, or tracing a decision.

## Official model/provider sources

- Runware DeepSeek V4 Flash API, parameters, JSON schema, thinking, and pricing: [runware.ai/docs/models/deepseek-v4-flash](https://runware.ai/docs/models/deepseek-v4-flash)
- Runware Gemini 3.5 Flash multi-image inputs, media resolution, strict JSON, and pricing: [runware.ai/docs/models/google-gemini-3-5-flash](https://runware.ai/docs/models/google-gemini-3-5-flash)
- Runware Gemini 3.1 Flash Lite cheaper comparison: [runware.ai/docs/models/google-gemini-3-1-flash-lite](https://runware.ai/docs/models/google-gemini-3-1-flash-lite)
- Runware LLM data/security claims and enterprise-only ZDR option: [runware.ai/llm-api](https://runware.ai/llm-api)
- Runware terms governing uploaded contributions, provider/model rules, and output rights: [runware.ai/terms](https://runware.ai/terms)
- Runware privacy and standard-service retention/deletion posture: [runware.ai/privacy](https://runware.ai/privacy)
- Google Gemini media-resolution/token guidance: [ai.google.dev/gemini-api/docs/media-resolution](https://ai.google.dev/gemini-api/docs/media-resolution)
- Google Gemini structured outputs: [ai.google.dev/gemini-api/docs/structured-output](https://ai.google.dev/gemini-api/docs/structured-output)
- Historical Gemini 3.6 Flash analyzer-comparison source: [ai.google.dev/gemini-api/docs/models/gemini-3.6-flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash)
- Active Mage model repository and pinned revision: [Comfy-Org/Mage-Flow at
  `d8c99241`](https://huggingface.co/Comfy-Org/Mage-Flow/tree/d8c99241f6fa80fbd453014234af2bf337ea21e6)
- Active Mage runtime evidence is the user's current local ImageForge source, not the earlier
  VideoForge BF16 worker: `/Volumes/ESD-USB/ImageForge/worker/src/imageforge_worker/constants.py`,
  `model_profiles.py`, `inference/mageflow.py`, `worker/Dockerfile`, and
  `worker/scripts/prepare_mageflow_volume.py`. These pin `int8-convrot`, the required ComfyUI model
  files, 4 steps, guidance `1.0`, `1280x720`, offline loading, warm-up, and volume preparation.
- ImageForge Pod/volume and live-inventory implementation references:
  `/Volumes/ESD-USB/ImageForge/docs/RUNPOD_OPERATIONS.md` and
  `/Volumes/ESD-USB/ImageForge/src-tauri/src/native/gpu_inventory.rs`. Reuse their verified
  mechanics; never reuse ImageForge resource IDs, credentials, or production volume.
- EchoMimicV3 pinned source: [antgroup/echomimic_v3 at `7e89489`](https://github.com/antgroup/echomimic_v3/tree/7e89489ca51c0d008fc1963ec6c03fc5bd0b9397)
- EchoMimicV3-Flash pinned weights: [BadToBest/EchoMimicV3 at `311e176`](https://huggingface.co/BadToBest/EchoMimicV3/tree/311e176905a8c4c24b240b530488fe636ce4d249)
- EchoMimic Wan base: [Wan2.1-Fun-V1.1-1.3B-InP at `fc913c3`](https://huggingface.co/alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP/tree/fc913c34361f4ec879e2f9c78b4f11ae50a937d1)
- EchoMimic audio encoder: [chinese-wav2vec2-base at `3991242`](https://huggingface.co/TencentGameMate/chinese-wav2vec2-base/tree/3991242c806928916fff4a8c0e4f76acf661b743)
- EchoMimic exact access/license/runtime manifest: `evidence/gates/GATE_AVATAR_004/2026-08-12-echomimic-v3-flash-preflight/`
### Historical avatar candidates — evidence only; no dispatch authority

- AvatarForcing pinned code revision: [KlingAIResearch/AvatarForcing at `63b73e6`](https://github.com/KlingAIResearch/AvatarForcing/tree/63b73e6c0f7bb42180ca6d7e1bf11c1de1a80b39)
- AvatarForcing pinned contradictory academic-only/non-commercial license artifact: [`LICENSE.txt` at `63b73e6`](https://github.com/KlingAIResearch/AvatarForcing/blob/63b73e6c0f7bb42180ca6d7e1bf11c1de1a80b39/LICENSE.txt)
- AvatarForcing pinned public weights repository with no declared license: [`lycui/AvatarForcing` at `e244891`](https://huggingface.co/lycui/AvatarForcing/tree/e2448919a7b535c29f34e07892884ae1a43c6ace)
- AvatarForcing access/license evidence and exact hashes: `evidence/gates/GATE_AVATAR_003/2026-08-11-avatarforcing-access-license/`
- VF-3-11 no-replacement/user-reaffirmation evidence: `evidence/decisions/VF-3-11/2026-08-11-user-reaffirmed-avatar-ladder/`
- AvatarForcing paper: [arxiv.org/abs/2603.14331](https://arxiv.org/abs/2603.14331)
- MuseTalk: [github.com/TMElyralab/MuseTalk](https://github.com/TMElyralab/MuseTalk)
- SkyReels V3: [github.com/SkyworkAI/SkyReels-V3](https://github.com/SkyworkAI/SkyReels-V3)

## Official infrastructure sources

- RunPod GPU/storage pricing: [runpod.io/pricing](https://www.runpod.io/pricing)
- RunPod network-volume Pod lifecycle: [Manage Pods](https://docs.runpod.io/pods/manage-pods)
- RunPod Pod API used for exact create/reconcile/delete:
  [create](https://docs.runpod.io/api-reference/pods/POST/pods),
  [read](https://docs.runpod.io/api-reference/pods/GET/pods/podId), and
  [delete](https://docs.runpod.io/api-reference/pods/DELETE/pods/podId)
- RunPod live GPU availability: [GraphQL manage Pods](https://docs.runpod.io/sdks/graphql/manage-pods)
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
  - Binding reuse target for Mage only: exact `Comfy-Org/Mage-Flow` revision,
    `int8-convrot` ComfyUI profile, model-file manifest, offline load/warm-up, live exact GPU
    inventory, and disposable-Pod/persistent-volume lifecycle.
  - Useful elsewhere: visual tokens/components, owner-bound idempotency, immutable artifacts, and
    queue UX.
  - Do not merge the desktop product wholesale or share/copy its volume, Pod, resource IDs, or
    secrets into VideoForge.
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
- Historical RunPod Serverless endpoint/worker-count sources supported an earlier architecture
  that is now superseded. They are not active VideoForge deployment authority.

## Citation/freshness rule

Use primary/official sources for technical claims. Treat live GPU availability and price as an
expiring observation that must be refreshed and revalidated before each Pod create. For a future
model/price/license/API question, browse again rather than treating this snapshot as permanently
current.

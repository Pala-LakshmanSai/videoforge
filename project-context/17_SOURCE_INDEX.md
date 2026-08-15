# Source index

Status: evidence map; RunPod Serverless V2 sources refreshed 2026-08-15; Mage/SoulX exact runtime evidence refreshed 2026-08-15; older Pod/Echo sources are historical
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
- CP-06 source precedence is fixed. VideoForge `DEC_IMAGE_001` and its normative model/RunPod
  documents own product behavior. Executable runtime mechanics may be adapted from the user's local
  ImageForge source exactly at commit `1a6204e7b9387a4d26b5fbbb176506d670949fba`, verified as the
  checkout head on 2026-08-14; a newer ImageForge commit is not silently adopted. Relevant files are
  `/Volumes/ESD-USB/ImageForge/worker/src/imageforge_worker/constants.py`, `model_profiles.py`,
  `inference/mageflow.py`, `health.py`, `worker/Dockerfile`, and
  `worker/scripts/prepare_mageflow_volume.py`. The executable snapshot selects `int8-convrot`,
  Mage revision `d8c99241f6fa80fbd453014234af2bf337ea21e6`, ComfyUI revision
  `26d7f8556822d9d08c2d3e1878636ac3b4969af9`, the exact three ComfyUI model files, four steps,
  guidance `1.0`, `1280x720`, offline loading, and warm-up.
- Known ImageForge drift must not be copied unchanged: `worker/README.md` says BF16 although the
  executable constants/profile select INT8 ConvRot, and `prepare_mageflow_volume.py` defaults
  `--revision` to `None`. VideoForge must require the pinned revision and a byte-exact three-file
  size/hash manifest. The approximate README total `13.4 GB` is not capacity evidence; CP-06 Phase A
  derives exact bytes plus explicit headroom before proposing a volume size.
- Historical ImageForge Pod/volume/live-inventory/queue implementation references:
  `/Volumes/ESD-USB/ImageForge/docs/RUNPOD_OPERATIONS.md`,
  `/Volumes/ESD-USB/ImageForge/src-tauri/src/native/gpu_inventory.rs`, `gpu_pod.rs`,
  `profile_control.rs`, and `queue.rs`; worker references live under
  `/Volumes/ESD-USB/ImageForge/worker/`, especially `scripts/prepare_mageflow_volume.py`,
  `src/imageforge_worker/model_profiles.py`, `health.py`, `coordination.py`, and
  `inference/mageflow.py`. Reuse only exact Mage runtime, manifest, offline-readiness, and read-only
  inventory mechanics where V2 contracts match. Do not copy its Pod lifecycle, device ownership,
  leases, queue policy, resource IDs, credentials, or production volume.

### Historical Echo sources — evidence only; no dispatch authority

- EchoMimicV3 pinned source: [antgroup/echomimic_v3 at `7e89489`](https://github.com/antgroup/echomimic_v3/tree/7e89489ca51c0d008fc1963ec6c03fc5bd0b9397)
- EchoMimicV3-Flash pinned weights: [BadToBest/EchoMimicV3 at `311e176`](https://huggingface.co/BadToBest/EchoMimicV3/tree/311e176905a8c4c24b240b530488fe636ce4d249)
- EchoMimic Wan base: [Wan2.1-Fun-V1.1-1.3B-InP at `fc913c3`](https://huggingface.co/alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP/tree/fc913c34361f4ec879e2f9c78b4f11ae50a937d1)
- EchoMimic audio encoder: [chinese-wav2vec2-base at `3991242`](https://huggingface.co/TencentGameMate/chinese-wav2vec2-base/tree/3991242c806928916fff4a8c0e4f76acf661b743)
- EchoMimic exact access/license/runtime manifest: `evidence/gates/GATE_AVATAR_004/2026-08-12-echomimic-v3-flash-preflight/`

### Active proposed SoulX source — production gates open

- Active proposed avatar source: [Soul-AILab/SoulX-FlashHead at
  `9bc03de0`](https://github.com/Soul-AILab/SoulX-FlashHead/tree/9bc03de06bb0de82cd6bc477804512ae06144bf2)
- Active proposed avatar weights: [Soul-AILab/SoulX-FlashHead-1_3B at
  `59119b6c`](https://huggingface.co/Soul-AILab/SoulX-FlashHead-1_3B/tree/59119b6c681230c3eeee157e224ae1941746711e)
- SoulX audio encoder: [facebook/wav2vec2-base-960h at
  `22aad52d`](https://huggingface.co/facebook/wav2vec2-base-960h/tree/22aad52d435eb6dbaf354bdad9b0da84ce7d6156)
- Exact SoulX Pod-era runtime/volume/sample evidence:
  `evidence/acceptance/VF-9-24S/soulx-flashhead-pro/acceptance.json` and
  `evidence/acceptance/VF-9-24U/acceptance.json`. These sources do not prove Serverless compatibility
  or close the SoulX license gate.

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

- RunPod Serverless pricing and per-second Flex/Active semantics:
  [docs.runpod.io/serverless/pricing](https://docs.runpod.io/serverless/pricing)
- RunPod endpoint configuration, including `workersMin`, `workersMax`, GPU count/types, idle timeout,
  execution timeout, request TTL, scaling, and FlashBoot:
  [Endpoint configurations](https://docs.runpod.io/serverless/endpoints/endpoint-configurations)
- RunPod endpoint creation API:
  [POST `/endpoints`](https://docs.runpod.io/api-reference/endpoints/POST/endpoints)
- RunPod asynchronous request/status/cancel behavior:
  [Send requests](https://docs.runpod.io/serverless/endpoints/send-requests)
- RunPod `/status`, `/cancel`, `/retry`, and endpoint-wide `/purge-queue` operation semantics:
  [Operation reference](https://docs.runpod.io/serverless/endpoints/operation-reference)
- RunPod normalized job states and timing fields:
  [Job states](https://docs.runpod.io/serverless/endpoints/job-states)
- RunPod handler contract:
  [Handler functions](https://docs.runpod.io/serverless/workers/handler-functions)
- RunPod worker lifecycle and Active/Flex terminology:
  [Worker overview](https://docs.runpod.io/serverless/workers/overview)
- RunPod endpoint-queue boundary:
  [Endpoint overview](https://docs.runpod.io/serverless/endpoints/overview)
- RunPod cold-start optimization and `RUNPOD_INIT_TIMEOUT` guidance:
  [Optimize Serverless workers](https://docs.runpod.io/serverless/development/optimization)
- RunPod network volumes, Serverless mount `/runpod-volume`, data-center constraint, price, and
  concurrent-write warning:
  [Network volumes](https://docs.runpod.io/storage/network-volumes)
- RunPod Serverless storage behavior:
  [Storage overview](https://docs.runpod.io/serverless/storage/overview)
- RunPod worker cleanup and temporary-file guidance:
  [Worker cleanup](https://docs.runpod.io/serverless/development/cleanup)
- RunPod retained endpoint-log behavior:
  [Serverless logs](https://docs.runpod.io/serverless/development/logs)
- RunPod Serverless template/endpoint CLI boundary:
  [runpodctl Serverless](https://docs.runpod.io/runpodctl/reference/runpodctl-serverless)
- RunPod public GPU/storage overview: [runpod.io/pricing](https://www.runpod.io/pricing)
- Historical disposable-Pod lifecycle: [Manage Pods](https://docs.runpod.io/pods/manage-pods)
- Historical Pod API used by CP-06/VF-9-24S/U create/reconcile/delete evidence:
  [create](https://docs.runpod.io/api-reference/pods/POST/pods),
  [read](https://docs.runpod.io/api-reference/pods/GET/pods/podId), and
  [delete](https://docs.runpod.io/api-reference/pods/DELETE/pods/podId)
- Historical Pod live-GPU availability: [GraphQL manage Pods](https://docs.runpod.io/sdks/graphql/manage-pods)
- Cloud Run Jobs creation/configuration for pinned CPU media workers: [Create jobs](https://cloud.google.com/run/docs/create-jobs)
- Cloud Run Job execution through console, CLI, client libraries, or REST `jobs.run`: [Execute jobs](https://cloud.google.com/run/docs/execute/jobs)
- Current Cloud Run usage pricing and region dependence: [Cloud Run pricing](https://cloud.google.com/run/pricing)
- Current Cloud Run job/resource/CPU/memory/execution limits and regional quotas: [Cloud Run quotas and limits](https://cloud.google.com/run/quotas)
- Better Auth email/password, social-provider, signup, and sign-in primitives: [Basic usage](https://better-auth.com/docs/basic-usage)
- Better Auth email verification configuration and social-email behavior: [Email](https://better-auth.com/docs/concepts/email)
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
- Cloud Run Jobs is the selected scale-to-zero production boundary for whisper.cpp transcription and
  FFmpeg render/probe. Official docs support authenticated REST execution; exact region, CPU,
  memory, timeout, throughput, and cost remain benchmark-gated against current pricing/quotas.
- Better Auth supplies email/password, verified-email, and Google identity primitives. VideoForge's
  unique single-use email-bound invite, secure verifier, and atomic redemption are app-owned
  contracts; the cited Better Auth pages do not define that policy.
- LongCat quality research informed the avatar study, but per-video cost excluded it from default.
- AI-video model research remains deferred because the user chose image-only MVP.
- Runware Gemini 3.5 Flash is the provisional one-time Image Style analyzer because it supports several images and strict JSON through the same Runware account; Gemini 3.1 Flash Lite is cheaper but not preferred before a style-fidelity A/B.
- RunPod Serverless is the active V2 compute target. Official docs establish provider API/config
  semantics, not VideoForge tenant fairness, exactly-once execution/billing, signed provenance, or
  production acceptance. VideoForge supplies those application contracts and qualifies both lanes.
- The provider documents asynchronous results as available for 30 minutes, request TTL as including
  queue plus execution, webhook delivery as bounded rather than a durable application ledger, and a
  seven-minute unhealthy-worker cold-start threshold unless initialization timeout is configured.
  These are why VideoForge polls/persists status, measures every timeout, and does not treat webhooks
  or defaults as sole truth.
- RunPod's network-volume documentation warns that concurrent writes can corrupt data and does not
  establish an application read-only mount guarantee. VideoForge therefore redirects scratch/cache,
  enforces no writes below `/runpod-volume`, records pre/post hashes, and requires two-reader
  qualification before endpoint concurrency two.

## Citation/freshness rule

Use primary/official sources for technical claims. Treat live GPU availability and price as an
expiring observation that must be refreshed before every paid Serverless qualification/configuration
proposal and bounded by its approved rate/cap. For a future
model/price/license/API question, browse again rather than treating this snapshot as permanently
current.

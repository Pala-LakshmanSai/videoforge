# Source index

Status: active V2 source map; RunPod Serverless and exact Mage/SoulX runtime sources refreshed 2026-08-15
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
- Active Mage model repository and pinned revision: [Comfy-Org/Mage-Flow at
  `d8c99241`](https://huggingface.co/Comfy-Org/Mage-Flow/tree/d8c99241f6fa80fbd453014234af2bf337ea21e6)
- Mage source precedence is fixed. VideoForge `DEC_IMAGE_001` and its normative model/RunPod
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
  size/hash manifest. The approximate README total `13.4 GB` is not capacity evidence; exact bytes
  derives exact bytes plus explicit headroom before proposing a volume size.
- Exact Mage preparation/offline-readiness implementation references live under
  `/Volumes/ESD-USB/ImageForge/worker/`, especially `scripts/prepare_mageflow_volume.py`,
  `src/imageforge_worker/model_profiles.py`, `health.py`, `coordination.py`, and
  `inference/mageflow.py`. Reuse only exact Mage runtime, manifest, offline-readiness, and read-only
  inventory mechanics where V2 contracts match. Do not copy superseded device ownership, leases,
  queue policy, resource IDs, credentials, or production volume.

### Active proposed SoulX source — production gates open

- Active proposed avatar source: [Soul-AILab/SoulX-FlashHead at
  `9bc03de0`](https://github.com/Soul-AILab/SoulX-FlashHead/tree/9bc03de06bb0de82cd6bc477804512ae06144bf2)
- Active proposed avatar weights: [Soul-AILab/SoulX-FlashHead-1_3B at
  `59119b6c`](https://huggingface.co/Soul-AILab/SoulX-FlashHead-1_3B/tree/59119b6c681230c3eeee157e224ae1941746711e)
- SoulX audio encoder: [facebook/wav2vec2-base-960h at
  `22aad52d`](https://huggingface.co/facebook/wav2vec2-base-960h/tree/22aad52d435eb6dbaf354bdad9b0da84ce7d6156)
- Exact SoulX runtime/volume/sample evidence is indexed by
  `CURRENT_STATE.yaml.model_runtime_evidence.soulx`. It does not prove Serverless compatibility or
  close the SoulX license gate.

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
- Historical Cloud Run sources remain only as audit/rollback references; Cloud Run is not an active
  V2-06 production dependency after `DEC_PERSONAL_WORKER_001`.
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
- Drizzle's official migration-strategy comparison: [orm.drizzle.team/docs/migrations](https://orm.drizzle.team/docs/migrations)
- Vercel pricing and Hobby commercial limitation: [vercel.com/pricing](https://vercel.com/pricing)

## Reference videos

- Correct Watermelon: [youtube.com/watch?v=6jZ7ib2Edes](https://www.youtube.com/watch?v=6jZ7ib2Edes)
- Mosquito: [youtube.com/watch?v=cVotLLx5bNs](https://www.youtube.com/watch?v=cVotLLx5bNs)
- Wrong/excluded Watermelon link: `5JCQbwj0Kso`.

Measurements, selected frames, timestamps, and rights notes: `references/ranga/README.md`, `references/ranga/measurements.csv`, and `references/ranga/frames/frames.csv`.

The Ranga frames seed the manually authored built-in `documentary_stock_v1` profile only. They are not sent to Runware for style analysis. Machine-readable stored payload and provider trust boundary: `evidence/default_image_style_v1.json`, `evidence/image_style_profile.schema.json`, and `evidence/image_style_analyzer_output.schema.json`.

## Active local reference input

- Main UI image: `assets/ui/swipecut-ui-reference.jpg`.

This is visual inspiration, not current decision authority. See its asset-manifest entry.

## Local application baselines

- QuickCut/video-production baseline: `/Volumes/ESD-USB/video production software`.
  - Useful: local `whisper.cpp` provider, audio normalization, word offsets, queue/progress ideas.
  - Do not assume its entire architecture is production-ready.
- ImageForge: `/Volumes/ESD-USB/ImageForge`.
  - Binding reuse target for Mage only: exact `Comfy-Org/Mage-Flow` revision,
    `int8-convrot` ComfyUI profile, model-file manifest, offline load/warm-up, live exact GPU
    inventory mechanics.
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
- Account-owned Windows/macOS workers are the selected production boundary for whisper.cpp
  transcription and FFmpeg render/probe. Their default distribution matches ImageForge: Windows
  unsigned beta and macOS ad-hoc sealed/non-notarized beta. Exact OS trust identities, bundled tool hashes, protocol
  version, installer behavior, device security, runtime, and recovery remain V2-06 gates.
- Better Auth supplies Google and optional email/password identity primitives. VideoForge currently
  enables Google only because the selected email provider is `NONE`; its unique single-use
  email-bound invite, secure verifier, and atomic redemption are app-owned contracts.
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

# SoulX-FlashHead Pro Pod worker

This is VideoForge's exact single-GPU SoulX-FlashHead Pro BF16 qualification runtime. It pins the
official source, Pro checkpoint, Wan VAE, Facebook wav2vec encoder, base image, dependencies, and
FlashAttention wheel. The model-only 50 GB EU-RO-1 volume is prepared once from exact SHA-256
records and sealed with a deterministic manifest.

Normal runtime boot is offline. It verifies every model byte, loads Pro, performs a real compiled
inference warm-up, and only then reports ready. Generation uses the official native 512x512/25 fps
Pro profile: four distilled steps, shift 5, color correction 1.0, seed 42, streaming audio, and no
face detector, repair, restoration, upscaler, substitute model, runtime download, or first-request
compile. Output is trimmed deterministically to the exact audio-frame contract and encoded H.264
yuv420p plus AAC.

Immutable publish target:
`ghcr.io/pala-lakshmansai/videoforge-soulx-flashhead-pro-vf924s@sha256:<digest>`.

# Image/media worker

Python 3.12 provider-free boundary for local ASR, exact selected-span audio materialization,
FFmpeg render, fixture image generation, and technical-probe job types. The local bridge accepts
strict content-addressed job documents, invokes only explicit local tool paths, and publishes
immutable results below one owned artifact root. It contains no provider SDK, credentials, model
downloads, network dispatch, or paid path.

The current health command reports process readiness independently from model readiness:

```sh
PYTHONPATH=src python3 -m videoforge_image_media
python3 -m unittest discover -s tests
```

`local_cli.py transcribe` requires an already-installed pinned whisper.cpp executable and model;
ordinary tests use fixtures and never download either. `local_cli.py materialize-span` invokes the
installed FFmpeg/FFprobe pair and extracts only the persisted padded interval for one selected
avatar span. It never sends the full voiceover to an avatar worker.

A future HTTP/RunPod adapter may expose the same `worker-health/v1` payload, but it must not change `model_state` to `ready` until the exact pinned model is actually loaded.

The CP-06 Mage Pod path is VideoForge-owned and exact: `Comfy-Org/Mage-Flow` revision
`d8c99241f6fa80fbd453014234af2bf337ea21e6`, INT8 ConvRot, stock ComfyUI revision
`26d7f8556822d9d08c2d3e1878636ac3b4969af9`, four steps, guidance 1.0, and 1280x720.
`prepare_mage_volume.py` is the only model-download entrypoint. Ordinary boot requires offline
environment flags, verifies the sealed three-file manifest and exact VideoForge volume identity,
checks the actual single NVIDIA GPU, performs a real warm-up, and reports `ready` only afterward.
The 20 GiB allocation is derived from 13,379,919,280 exact model bytes plus 8,094,917,200 bytes of
operational headroom. The Mage volume is never shared with Echo or ImageForge.

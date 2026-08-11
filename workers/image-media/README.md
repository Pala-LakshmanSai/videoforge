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

`mage_production.py` defines the locked Mage-Flow-Turbo job/result boundary without loading or
downloading weights. It admits only exact model revision
`395402ba3ef110c96e70d01abe4d178dbe4e01a5` and fails closed on any mismatch.
The pinned source patch removes its otherwise mandatory Gaussian-Shading watermark to preserve
VideoForge's no-watermark output rule. Refusal placeholders must never be accepted as generated
assets.

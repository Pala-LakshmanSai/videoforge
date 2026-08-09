# Image/media worker skeleton

Python 3.12 fixture-only boundary for the future local-ASR, Mage, FFmpeg render, and technical-probe job types. It contains no model runtime, provider SDK, credentials, downloads, or dispatch code.

The current health command reports process readiness independently from model readiness:

```sh
PYTHONPATH=src python3 -m videoforge_image_media
python3 -m unittest discover -s tests
```

A future HTTP/RunPod adapter may expose the same `worker-health/v1` payload, but it must not change `model_state` to `ready` until the exact pinned model is actually loaded.

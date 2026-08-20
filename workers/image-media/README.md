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
`mage_prepare_service.py` is the one-time Pod entrypoint and calls `prepare_mage_volume.py`, the only
model-download implementation. It exposes hashed preparation state and the sealed manifest hash so
the Pod can be deleted immediately after verified completion. Ordinary boot requires offline flags,
verifies the sealed three-file manifest and exact VideoForge volume identity, checks the actual
single NVIDIA GPU, performs a real warm-up, and reports `ready` only afterward.
The RunPod request is 50 GB (the provider API and billing unit), derived from 13,379,919,280 exact
model bytes plus at least 36,620,080,720 bytes (34.11 GiB) of headroom. It does not claim the mounted
filesystem exposes an exact binary capacity. The Mage volume is never shared with Echo or ImageForge.

## Deterministic Serverless source overlay

`build_mage_oci_overlay.py` derives a publishable Docker schema-2 manifest from
an already fetched immutable parent manifest/config and the repaired
`mage_serverless.py` bytes. It creates one reproducible gzip-tar replacement
layer at `/opt/videoforge/mage_serverless.py`, updates only the image config
lineage/history, and never invokes Docker, downloads base/model layers, or
contacts a registry. Pass an explicit UTC `--created` value; omitting a clock
input is intentional so the resulting config and manifest digests can be
reviewed before publication.

The output directory contains `layer.tar.gz`, `config.json`, `manifest.json`,
and a redacted `identity.json`. The final `manifest_digest` is the exact
immutable image identity; uploading these three blobs is a separate, approved
publication action. `publish_mage_oci_overlay.py` validates those bytes and is
dry-run by default; its explicit `--publish` mode uploads only missing config
and layer blobs, refuses to overwrite an existing tag, PUTs the exact manifest
bytes, and performs a digest readback. It requires the already configured
`GHCR_TOKEN`/`GITHUB_ACTOR` environment and never prints either value.

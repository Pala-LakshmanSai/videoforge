# VideoForge worker boundaries

The four workers are independent Python 3.12 packages. Phase 0A contains only fixture-mode process-health stubs; no package includes a model framework, provider client, credential, download hook, or inference implementation.

- `image-media`: local ASR, image-generation, FFmpeg render, and probe boundary.
- `avatar-primary`: AvatarForcing primary and explicit compatibility-test boundary.
- `avatar-repair`: cold MuseTalk lip-only repair boundary.
- `avatar-quality`: cold SkyReels whole-frame fallback boundary.

Run the provider-free health tests from the repository root:

```sh
for worker in workers/image-media workers/avatar-primary workers/avatar-repair workers/avatar-quality; do
  PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s "$worker/tests"
done
```

Each process-health payload conforms to `packages/config/schemas/worker-health.v1.schema.json` and reports model state separately.

# VideoForge worker boundaries

The four workers are independent Python 3.12 packages in one locked `uv` workspace. Provider and
model downloads remain explicit; ordinary verification never installs a model or calls a provider.

- `image-media`: local ASR, image-generation, FFmpeg render, and probe boundary.
- `avatar-primary`: AvatarForcing primary and explicit compatibility-test boundary.
- `avatar-repair`: cold MuseTalk lip-only repair boundary.
- `avatar-quality`: cold SkyReels whole-frame fallback boundary.

Install the exact locked Python graph once, then run the provider-free health tests from the
repository root:

```sh
pnpm python:sync
pnpm test:workers
```

Each process-health payload conforms to `packages/config/schemas/worker-health.v1.schema.json` and reports model state separately.

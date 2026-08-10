# VF-3-04 RunPod account/API preflight evidence

Checked 2026-08-10 against context HEAD
`3e810be6fb0b6bde2ca04e6e275ff04dfe403c7f`.

## Result

PASS at `$0`. No Pod, endpoint, volume, worker, model, or inference resource was created.

- Authenticated account identity resolved through the official GraphQL API.
- Starting and ending balance: `$10.00`; current account spend rate: `$0.00/hour`.
- Official REST inventory returned HTTP 200 for Pods, Serverless endpoints, network volumes, Pod
  billing, and endpoint billing.
- Inventory: 0 Pods, 0 Serverless endpoints, 0 network volumes, 0 active workers.
- Therefore no stop/scale mutation was required. Every Pod and worker is off.
- One lifecycle-capable credential named `VideoForge lifecycle preflight` exists only in macOS
  Keychain service `com.videoforge.runpod.lifecycle`, account `videoforge`. Its value is not in this
  evidence, the repository, logs, or context pack.

## Verification

- `pnpm context:validate`: PASS.
- `pnpm secret:scan`: PASS.
- `git diff --check`: PASS.
- Keychain item existence check: PASS without reading its value.

This is an account/drain preflight only. `GATE_RUNPOD_001`, GPU/model, dispatch, callback, output,
cost, and quality gates remain open.

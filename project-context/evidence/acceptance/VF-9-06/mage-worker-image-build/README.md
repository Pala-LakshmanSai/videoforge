# VF-9-06 Mage worker image evidence

Status: complete.

## Published candidate

- Implementation commit: `022914da1f6b8c3ddf6261f58ac34f3ed535d7df`.
- Hosted build: `31571090443`, passed 2026-08-12 at `$0`.
- Immutable linux/amd64 image:
  `ghcr.io/pala-lakshmansai/videoforge-mage@sha256:7c655a73fc444ba15fd52d7fa8d8f9352d6d40226ab5bbc90f300b3011bfbcbf`.
- Hosted import/source/model identity smoke, handler registration, and compileall passed.
- Canonical local verify and hosted verify `31571085540` passed.

## Proven correction baseline

On 2026-08-12 the user supplied an owned RunPod spike and exact local evidence that corrected the
unproven Microsoft/diffusers/FlashAttention design:

- ComfyUI revision: `1108f2ac5e412b27accb0e5d51c90ef2ba39784d`.
- Public weights revision: `Comfy-Org/Mage-Flow` at
  `d8c99241f6fa80fbd453014234af2bf337ea21e6`.
- Runtime: stock ComfyUI, PyTorch attention, BF16, 1280x720, four steps, CFG 1, Euler/simple.
- Required graph: `CLIPLoader.type=mage`; `TextEncodeMageFlowEdit` supplies positive, negative, and
  latent. No `EmptySD3LatentImage`.
- Base image digest:
  `pytorch/pytorch@sha256:7b324d212a4450795b49edba9949b7cdc72429148a64e974334bfe5774d51385`.

Exact required weight files are pinned in the worker contract with byte sizes and SHA-256 values.
No credential is required to download them.

## Preserved owned outputs

- `/Volumes/ESD-USB/mageflow-evidence/aldi-seed1234.png`, 1280x720, 1,270,978 bytes,
  `sha256:cafc3a7d67a28499197384156eb19e48a2fa8bf622fec29cfbdc57f2aaacc879`.
- `/Volumes/ESD-USB/mageflow-evidence/bf16-text.png`, 1280x720, 1,198,619 bytes,
  `sha256:ad052c8b0c22b8abdbad4ea6fa4df3055c06c383273e890165d3de1b6b313ff9`.

Both files and hashes were independently verified locally. They prove the route, not VideoForge's
candidate container or a clean cold qualification.

## Timing baseline (RTX 4090)

- Pod create to ComfyUI API ready: about 90 seconds; network-volume attach was not separately timed.
- One process-start-to-ready observation: 80 seconds.
- BF16 cold model load plus first generation: 76.02 seconds in one observation.
- BF16 warm generation: 3.74 and 3.47 seconds.

The next qualification must measure every phase independently, save its output/checksum, enforce the
task cost cap, and delete/drain all transient RunPod resources immediately.

# VF-8-12 SkyReels V3 worker build evidence

Status: complete; pinned provider-free image published

- Implementation commits: `4166ff2`, `48e4993`, `ccb1d0a`.
- GHCR workflow: `31535566101`, success in 8m02s.
- Immutable image:
  `ghcr.io/pala-lakshmansai/videoforge-avatar-quality@sha256:eed0778157bda9c28ebdb54bbab407d64205063b0467897ee9dcb9438b930497`.
- Container smokes passed: linux/amd64 imports including pinned FlashAttention, handler registration,
  full official source compilation, and explicit `model_state=not_loaded` without weight download.
- Worker enforces exact original runtime-source/audio shape and hashes, fixed command/seed/offload,
  timeout/cancel, safe diagnostic hashes, one output, 960x960/25 H.264/AAC probe, immutable
  source/model/profile lineage, bounded inline qualification, and secret redaction.
- Official source aspect-bucket code exposed a pre-existing mismatch: the square canonical Avatar
  runtime source selects native 960x960, not 1280x720. Contracts, renderer geometry, fixtures, and
  tests now use `skyreels-centered-960x960p25-v2` with exact full/split crops.
- Local canonical verification passed: Workerd 1/1, control-plane 209/209, web 203/203, installed
  Chrome 38/38, worker suites including 11 SkyReels tests, zero skips. Hosted verify `31535566087`
  passed at `ccb1d0a`.
- External provider spend: `$0`; no RunPod credential, model weights, endpoint, worker, or GPU used.

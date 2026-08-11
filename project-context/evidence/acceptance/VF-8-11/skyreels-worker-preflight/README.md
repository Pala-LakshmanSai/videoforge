# VF-8-11 SkyReels V3 worker preflight evidence

Status: complete; exact provider-free worker-build successor selected

- Official source: `SkyworkAI/SkyReels-V3` at commit
  `28c771e8456341be6a213e3d1133ed1fd19bf75d` (clean detached checkout).
- Public model: `Skywork/SkyReels-V3-A2V-19B` at revision
  `fdad4053f492aba389b5a8c3c6982118c6a1ecf3`: 27 files, 55,970,858,643 bytes.
- Source hashes: `requirements.txt`
  `sha256:a7f52221ca8179d3b4c7ced583b6ce429808965f16d5805b9d5ea507d2ca662e`;
  `generate_video.py`
  `sha256:2033473c94a6b085a7383d03654a26a5d7a306087c0e63403e7934299c3e1ac`.
- Exact task is `talking_avatar`; inputs are the original immutable Avatar Profile runtime image
  and selected span WAV/MP3, never AvatarForcing output. One actor/audio track, maximum 200 seconds.
- Launch surface: explicit local model path, `--task_type talking_avatar`, `--resolution 720P`,
  `--offload`, seed 42, static-shot prompt. `--low_vram` is reserved for a separately qualified
  low-memory lane and cannot combine with USP.
- Authoritative pinned code writes talking-avatar output at 25 fps. README prose also mentions
  24 fps, so VideoForge corrected the SkyReels source profile to
  `skyreels-centered-960x960p25-v2`; the square canonical runtime source selects the official
  960x960 bucket and FFmpeg v3 deterministically center-crops then converts 25 to 30 fps.
- First qualification envelope: one A100 80GB worker, `workersMin=0`, `workersMax=1`, no volume,
  at least 160 GB ephemeral disk, one five-second owned/synthetic clip, 30-minute job timeout,
  one dispatch, `$2.00` maximum new spend, mandatory cancel/drain/delete and independent zero audit.
- Worker must pin source/model revisions, verify input hashes, download only into its ephemeral
  cache, return checksum/probe/lineage/cost-safe metadata, never return raw logs, and fail closed.
- Container uses the official FlashAttention 2.8.3 Torch 2.8/CUDA 12 wheel, pinned by release asset
  SHA-256 `f1a9e6cb4dfbd1647e56235d81fd6b56e6cd01c7ea3249968ca4aa36c389371a`;
  this compatibility pin replaces the source repo's older 2.7.4.post1 requirement.
- No credential, provider mutation, model download, GPU, or external spend was used in VF-8-11.

Official source: <https://github.com/SkyworkAI/SkyReels-V3>

Official model: <https://huggingface.co/Skywork/SkyReels-V3-A2V-19B>

# VF-8-14 SkyReels dependency-path evidence

Status: complete; corrected pinned image published

- Static source audit found official SkyReels imports `av` although its requirements omit it.
- Added pinned `av==13.1.0`; no model/provider substitution.
- Expanded linux/amd64 smoke to execute the full official `generate_video.py --help` import/parser
  path with exact A100 compute capability simulation (`TORCH_CUDA_ARCH_LIST=8.0`).
- Intermediate workflows `31537297510` and `31537594078` correctly exposed, respectively, the
  headless GPU probe and missing CUDA architecture simulation; no image was published from either.
- Workflow `31537894443` passed all imports, full CLI parser, handler registration, source compile,
  and model-not-loaded smokes.
- Corrected immutable image:
  `ghcr.io/pala-lakshmansai/videoforge-avatar-quality@sha256:1e7f9100bef7759ffe527d083e1655c7bfda6c9192668c9a13d15e4c4e73e878`.
- RunPod remained absolute zero; external provider spend `$0`.

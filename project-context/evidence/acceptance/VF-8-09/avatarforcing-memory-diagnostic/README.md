# VF-8-09 AvatarForcing memory-diagnostic evidence

Status: complete; candidate not promoted

- Source commit: `3c222a9b4fe08a8d73de26a72721df97f46ca837`.
- GitHub Actions image build: `31531241301` (`success`).
- Immutable image: `sha256:e46c3a9d0d770905ca2d04aecf5623986425eca861f2e1ea9245a3fd5867f434`.
- Built-container smoke: torchaudio/dependency import, complete source compile, exact handler registration.
- Compact Python/CUDA OOM spellings now map to `AVATAR_INFERENCE_CUDA_OOM` without raw logs.
- Qualification allowlist is exactly `NVIDIA A100 80GB PCIe`; one scale-zero worker maximum.
- Focused tests/lint/typecheck/context/secret/diff checks passed. External spend `$0`; RunPod remained zero.

`GATE_AVATAR_003` remains open. Exact successor VF-8-10 permits one A100-80GB-only five-frame run.

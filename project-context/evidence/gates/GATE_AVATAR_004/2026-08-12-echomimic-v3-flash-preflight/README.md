# EchoMimicV3-Flash source, weights, and license preflight

Status: read-only preflight pass; runtime bootstrap remains unverified  
Checked: `2026-08-12T14:56:02Z`  
Task: `VF-9-22`

No credentials, model download, provider call, GPU, RunPod mutation, or spend occurred.

## Exact public artifacts

- Source: `antgroup/echomimic_v3@7e89489ca51c0d008fc1963ec6c03fc5bd0b9397`, public GitHub commit, Apache-2.0 root `LICENSE.txt`.
- Flash weights: `BadToBest/EchoMimicV3@311e176905a8c4c24b240b530488fe636ce4d249`, public and ungated, model-card license `apache-2.0`.
- Flash safetensors: `echomimicv3-flash-pro/diffusion_pytorch_model.safetensors`, `3,727,671,120` bytes, SHA-256 `5ebdbb2fc709108bf2a1728fd92eb2874804e4bc0324e92a2cd55425968c85a4`.
- Base: `alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP@fc913c34361f4ec879e2f9c78b4f11ae50a937d1`, public and ungated, Apache-2.0 model card and root license.
- Audio encoder: `TencentGameMate/chinese-wav2vec2-base@3991242c806928916fff4a8c0e4f76acf661b743`, public and ungated, MIT model card.
- Minimum selected runtime bytes: `23,922,317,735` decimal bytes (`22.279394544 GiB`), before small configs/source/dependencies.

## First-party URLs

- <https://github.com/antgroup/echomimic_v3/tree/7e89489ca51c0d008fc1963ec6c03fc5bd0b9397>
- <https://raw.githubusercontent.com/antgroup/echomimic_v3/7e89489ca51c0d008fc1963ec6c03fc5bd0b9397/LICENSE.txt>
- <https://huggingface.co/BadToBest/EchoMimicV3/tree/311e176905a8c4c24b240b530488fe636ce4d249>
- <https://huggingface.co/alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP/tree/fc913c34361f4ec879e2f9c78b4f11ae50a937d1>
- <https://huggingface.co/TencentGameMate/chinese-wav2vec2-base/tree/3991242c806928916fff4a8c0e4f76acf661b743>

`source-manifest.json` pins first-party revision metadata, relevant file identities, license-artifact hashes, access state, official Flash command/config hashes, and selected runtime bytes. Worker bootstrap must reproduce this manifest exactly. Any revision, path, size, checksum, access, or license mismatch blocks download completion and GPU use.

Official `run_flash.sh` uses 8 steps, `Flow_Unipc`, BF16, 25 fps, seed 43, TeaCache threshold 0.1, sample-size ceiling 768×768, and an empty negative prompt. The upstream `sequential_cpu_offload` argument is parsed but never enables offload; VideoForge makes no CPU-offload claim.

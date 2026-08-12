# VF-9-24D digest-corrected EchoMimic sample

The corrected tokenizer digest allowed model bootstrap and inference to start. The sole RTX 4090
job then completed with `AVATAR_INFERENCE_CUDA_OOM`; no MP4 was produced. Queue delay was `142210`
ms and execution time was `175973` ms. The provider balance was unchanged during this attempt; the
cumulative measured spend remains `$0.0260412778` from VF-9-24B.

The runner confirmed queue empty, deleted the endpoint and template, and observed absolute zero.
Three subsequent independent reads also proved zero Pods, running Pods, active workers, endpoints,
private templates, and network volumes with stable balance.

No retry, GPU substitution, memory tuning, or fallback is authorized. The next action requires an
explicit decision because the measured 24 GB RTX 4090 profile does not fit this exact 253-frame job.

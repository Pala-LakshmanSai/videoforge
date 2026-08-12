# VF-9-24H A100 sample attempt

Status: `COST_STOP_NO_OUTPUT`

- Input: 253 frames at 25 fps (10.12 seconds), EchoMimicV3-Flash official BF16 config, 768x768, 8 inference steps.
- GPU: one `NVIDIA A100-SXM4-80GB` in `US-MD-1`.
- Model cache warm queue/activation: 101,338 ms.
- Model bootstrap/download/verification: 98,520 ms (`cache_hit=false`, 23,922,317,735 selected bytes).
- Inference queue/activation: 73,985 ms.
- Inference observed active time before cost stop: approximately 1,314,935 ms (21m 54.9s).
- Output/encode completion: not reached; job remained `IN_PROGRESS` when stopped.
- Peak VRAM: unavailable because upstream process did not return before cancellation.
- This attempt spend: $1.0017626232.
- Cumulative authorized-lane spend from $16.3399985241 baseline: $1.8200686945.
- Authorized $2 cap remaining: $0.1799313055.
- Root observable defect: the primary worker emitted no inference progress after bootstrap. A safe start/60-second-heartbeat/output-validated progress path was added after this attempt.
- Paid-resource cleanup: volume `vhalf7wag0` deleted (HTTP 204). Three independent inventory reads at `2026-08-12T19:55:48.269Z`, `19:55:52.767Z`, and `19:55:58.666Z` each showed zero Pods, endpoints, private templates, network volumes, running Pods, and active Serverless workers.

Raw evidence:

- `bootstrap-usmd/bootstrap-qualification.json`
- `inference-usmd/qualification.json`
- `inference-usmd/qualification.journal.json`

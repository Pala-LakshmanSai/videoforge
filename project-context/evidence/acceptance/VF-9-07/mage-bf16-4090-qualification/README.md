# VF-9-07 Mage BF16 RTX 4090 qualification

Status: technical pass; semantic/text quality concern retained.

## Exact run

- Candidate image:
  `ghcr.io/pala-lakshmansai/videoforge-mage@sha256:9f3dc9d886b309e74adac3d7d101ee546d8d3a31d123dd1c203852d22709334b`.
- Model: `Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6`, BF16.
- ComfyUI: `1108f2ac5e412b27accb0e5d51c90ef2ba39784d`.
- GPU: NVIDIA GeForce RTX 4090, 25,386,352,640 bytes reported memory; CUDA 12.8;
  PyTorch 2.9.1+cu128.
- Prompt: `a wideshot of costco store at night.`
- Prompt SHA-256: `caff36322a31b0b8cfd49e17f5e15c275b3c28e3acb5d6d0fb0af49d6e61f40d`.
- Seed 1234; 1280x720; four steps; CFG 1; Euler/simple.

## Result

- Saved PNG: `costco-night-wideshot-seed1234.png`, 1,102,711 bytes, 1280x720 RGB.
- SHA-256: `4b4add40d0fc03561e78bf0e82dcf115ae2dbbf5d16af8df709b38e66852abec`.
- Technical output contract passed. Visual inspection found a photorealistic night storefront, but the
  requested Costco logo is malformed and a second ghosted mark appears above it. This is a real
  text/logo quality limitation; do not convert this run into style/semantic acceptance.

## Timings

- Template creation: 743 ms.
- Endpoint creation: 869 ms.
- Dispatch acknowledgement: 508 ms.
- RunPod queue/provision/image-pull delay: 367,607 ms.
- Exact-weight bootstrap/download/hash: 100,190 ms; cache miss.
- ComfyUI start to API ready: 8,517 ms.
- Handler receipt to completion: 37,053 ms.
- Comfy generation/output retrieval/validation: 23,728 ms.
- RunPod execution time: 37,314 ms.
- Dispatch to terminal result: 423,963 ms.
- Overall preflight through independent cleanup proof: 433,350 ms.
- Network volume: not attached; existing ImageForge resources were not used or mutated.

## Cost and cleanup

- Starting balance: `$7.507739038`; ending balance: `$7.4796866306`.
- Measured spend: `$0.0280524074`, below `$1.00` cap and `$0.90` stop.
- One scale-zero endpoint, one template, one job; no retry.
- Queue drained, endpoint deleted, template deleted.
- Independent final inventory at `2026-08-12T07:15:54.825Z`: zero pods, workers, endpoints,
  templates, and volumes.

Raw secret-free evidence is stored in `qualification.json`; resource identifiers are SHA-256 hashes
only and inline output bytes are removed.

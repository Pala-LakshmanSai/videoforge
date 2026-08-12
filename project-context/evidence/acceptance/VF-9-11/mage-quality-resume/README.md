# VF-9-11 hardened compliant Mage quality resume

Status: technical success; visual quality rejected.

- Exact pinned Mage BF16 image completed one 1280x720 RTX 4090 job through hardened same-job
  polling. No network volume was attached and no redispatch occurred.
- RunPod delay: 278,898 ms. Weight bootstrap/cache miss: 62,972 ms. Comfy start: 7,009 ms.
  Generation: 4,756 ms. RunPod execution: 14,583 ms. Total wall time through cleanup: 319,873 ms.
- Output: `warehouse-night-documentary-seed20260812.png`, 1,335,070 bytes, SHA-256
  `6a5517da671ca0730846f13876548a4eb2ac549cdeae0bbc88252be9e7ae5a52`.
- Runtime: NVIDIA GeForce RTX 4090, 25,250,627,584 total-memory bytes, PyTorch 2.9.1+cu128,
  CUDA 12.8. Measured spend: `$0.0235054352` under the `$0.15` cap.
- Visual inspection rejected the image: despite the explicit prohibition, the facade contains visible
  `AMERICAN` text; people are repeated/uncanny and grocery/person/car geometry is not reliable enough.
- Queue drained; endpoint and template deleted. Independent final inventory: zero pods, workers,
  endpoints, templates, and volumes.

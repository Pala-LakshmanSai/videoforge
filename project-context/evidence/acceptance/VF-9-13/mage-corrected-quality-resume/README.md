# VF-9-13 corrected Mage quality resume

Status: technical success; strict visual quality rejected.

- Exact negative-prompt image completed one 1280x720 RTX 4090 job. Positive and negative prompt
  SHA-256 values were returned and matched. No network volume or redispatch.
- RunPod delay: 138,293 ms. Weight bootstrap/cache miss: 50,888 ms. Comfy start: 8,017 ms.
  Generation: 11,373 ms. RunPod execution: 27,152 ms. Total wall time through cleanup: 181,255 ms.
- Output: `warehouse-night-documentary-seed20260812.png`, 1,197,795 bytes, SHA-256
  `726a8d5deffab3ea0bccc4fe90cd15c12a3b4da6ad6ffa1c5747605f35597c01`.
- Runtime: NVIDIA GeForce RTX 4090, 25,386,352,640 total-memory bytes, PyTorch 2.9.1+cu128,
  CUDA 12.8. Measured spend: `$0.0308072963`.
- Negative prompting materially improved the blank facade, crowd uniqueness, and composition. Strict
  inspection still rejected gibberish license-plate text and visible grocery/hand artifacts.
- Queue drained; endpoint and template deleted. Independent final inventory: zero pods, workers,
  endpoints, templates, and volumes.

# VF-8-13 SkyReels qualification evidence

Status: exact safe dependency failure; no redispatch; RunPod absolute zero

- Immutable worker image:
  `sha256:eed0778157bda9c28ebdb54bbab407d64205063b0467897ee9dcb9438b930497`.
- One A100-80GB-only five-second job used the original pinned 960x960 source and selected audio.
- Delay `160,468 ms`; execution `203,771 ms`; terminal RunPod status `COMPLETED` with worker result
  `SKYREELS_INFERENCE_DEPENDENCY_MISSING` and safe diagnostic hash
  `sha256:3bf89af3a94c9ed9a47a899fde879b68140fd84e7a7a575d4c72e0419206810a`.
- Measured new spend `$0.0502363111` under the `$2.00` cap.
- No second dispatch occurred. Endpoint/template deletion succeeded without cleanup errors; final and
  independent inventories show zero Pods, endpoints, templates, volumes, and active workers.
- Provider bytes expose no module name. Static pinned-source import audit shows `av` is imported but
  absent from the official requirements and worker image. Exact provider-free successor VF-8-14
  must prove the full CLI import path in-container before any later paid resume.

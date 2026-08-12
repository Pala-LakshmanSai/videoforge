# VF-9-08 Mage result integration

Status: complete.

- Implementation commit: `5c6886a`.
- Added one exact server-side acceptance boundary for the qualified Mage candidate image, model,
  ComfyUI source, RTX 4090, prompt/scene/attempt/seed, 1280x720 PNG, output bytes/hash, bootstrap,
  Comfy startup, handler timing, network-volume state, and reported cost.
- Accepted output bytes are separated from immutable redaction-safe evidence; inline base64 never
  enters evidence.
- Unknown fields, malformed/noncanonical base64, wrong PNG/hash/size/profile, lineage drift, GPU
  drift, timing inconsistency, cost overrun, and unrestricted failure strings fail closed.
- The qualification runner now strips inline bytes without weakening the boundary.
- Focused web suite passed 207/207. Canonical forced verification passed with Workerd 1/1 and
  installed-Chrome 38/38, zero skips. Secret scan and diff checks passed.
- Fixture remains default; no candidate production profile was promoted. No provider call, credential,
  GPU, download, or spend occurred. RunPod remained absolute zero.

# VF-9-12 Mage negative-prompt correction

Status: complete at `$0`.

- Each Mage item now requires exact bounded non-empty `negative_prompt` bytes and its SHA-256.
  Missing, blank, oversized, shape-drifted, and hash-drifted values fail closed.
- `TextEncodeMageFlowEdit.negative_prompt` receives those admitted bytes. Result evidence returns the
  exact negative-prompt hash and the server acceptance seam validates it against task authority.
- The qualification runner now keeps positive scene description separate from explicit negative
  exclusions for text, branding, duplicated people, anatomy, object, vehicle, and synthetic-artifact
  failures.
- Canonical forced verification passed with web 210/210, Workerd 1/1, installed Chrome 38/38, and
  zero skips. Secret/context/diff checks passed.
- GitHub `mage-image` run 31576966213 built, smoke-tested, and published linux/amd64 image
  `ghcr.io/pala-lakshmansai/videoforge-mage@sha256:ee844a242956a376466fa233f05e3bb6ffdcf71a645f5b27241331e5e295a89c`.
- Hosted verify run 31576934663 passed. No provider call, credential, GPU, model download, or spend
  occurred. RunPod stayed absolute zero.

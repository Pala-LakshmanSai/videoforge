# VF-9-02 Mage worker boundary evidence

Status: complete at `$0`; exact model revision remains fail-closed

- Strict Mage production and one-image qualification contracts bind exact source/model revision,
  prompt hash, scene, contiguous seeds, dimensions, output location, and result lineage.
- Bootstrap rejects all execution as `MAGE_MODEL_REVISION_INACCESSIBLE` until authenticated admission
  pins the exact official weight revision.
- Inference is shell-free, offline, bounded by cancellation/timeout, and returns redacted failures.
- PNG acceptance validates structure, CRC, profile, decompressed size, exact dimensions, and forbids
  text metadata. The pinned source patch removes mandatory Gaussian-Shading watermark injection and
  changes refusal placeholder output into a hard failure.
- Canonical verification passed: Workerd `1/1`, image-media `25/25`, installed Chrome `38/38`, zero
  skips. No credential, download, provider mutation, GPU, dispatch, or spend occurred.

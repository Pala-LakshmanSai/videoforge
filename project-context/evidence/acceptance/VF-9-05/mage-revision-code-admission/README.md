# VF-9-05 Mage revision code admission

Status: complete at `$0`; candidate is not promoted

- Worker admits only exact official revision
  `395402ba3ef110c96e70d01abe4d178dbe4e01a5`; mismatch fails before inference.
- Known transformer identity and an 18 GB repository ceiling are pinned for image-build validation.
- Watermark/refusal patch, offline execution, exact prompt/seed/lineage, cancellation, timeout,
  redaction, and strict PNG acceptance remain enforced.
- Canonical verification passed: image-media `26/26`, Workerd `1/1`, installed Chrome `38/38`, zero
  skips. No credential, model download, provider mutation, GPU, dispatch, or spend occurred.

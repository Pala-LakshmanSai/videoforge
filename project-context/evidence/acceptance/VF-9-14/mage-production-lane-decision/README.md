# VF-9-14 Mage production-lane decision

Status: complete at `$0`.

- Keep user-locked Mage-Flow-Turbo BF16, exact stock ComfyUI graph, 1280x720, four steps. Do not
  substitute non-Turbo or claim it would fix typography/anatomy/object defects.
- Text/logo/brand-critical scenes must use authentic source media. Generated Mage scenes must not
  require readable text or branding for their core meaning.
- Exact negative prompting is mandatory. Reject any candidate with visible generated text, logo,
  watermark, material anatomy/object/vehicle defects, wrong crop, or wrong artifact lineage.
- Permit at most one same-scene candidate retry after a recorded rejection; never generate multiple
  candidates unconditionally. Human visual review remains required before promotion.
- Real evidence: generation 3.47-11.373 seconds on RTX 4090 after load; cold bootstrap 50.888-100.190
  seconds; RunPod queue delay 138.293-367.607 seconds; three measured runs totaled `$0.0823651399`.
- The ~300-image throughput/cost gate and 40-prompt quality matrix remain open. Next implementation
  integrates exact corrected result lineage into durable acceptance without promoting the profile.

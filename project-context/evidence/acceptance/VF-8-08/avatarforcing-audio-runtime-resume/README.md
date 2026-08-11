# VF-8-08 AvatarForcing audio-runtime resume evidence

Status: bounded technical failure; candidate not promoted

- Source commit: `f371df20f477b50c960e52f11a469d3d23c71fb9`
- Image build `31530153005`: success, including exact torchaudio import.
- Immutable image: `sha256:b7bdf282f97cb84195a7ef163670a3a7a464e593984d678723567c8ccd931b1d`.
- One five-frame job reached `COMPLETED` after `71,566 ms` delay and `213,373 ms` execution.
- Safe result: `AVATAR_INFERENCE_PROCESS_FAILED`; diagnostic hash
  `sha256:f96cb45f8916909d0f6c7a35f72260a77f6d429ce6ebf6fbdcf940344722538d`.
- Spend: `$0.0102739352`; final and independent RunPod inventories: absolute zero.
- Full local verify passed: Workerd 1/1, control-plane 209/209, web 203/203, Chrome 38/38,
  zero skips. Hosted verify `31530144090` passed.

Torchaudio correction advanced execution by about 99 seconds but produced no MP4. Static review found
the OOM classifier missed Python's compact `OutOfMemoryError` spelling and the L40S allowlist leaves
under 4.5 GB above 43.5 GB of pinned model files before runtime allocations. VF-8-09 fixes both at
`$0`; `GATE_AVATAR_003` remains open.

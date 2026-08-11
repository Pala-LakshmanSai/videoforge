# VF-8-15 SkyReels corrected-image resume evidence

Status: bounded timeout; no redispatch; RunPod absolute zero

- Immutable corrected image:
  `sha256:1e7f9100bef7759ffe527d083e1655c7bfda6c9192668c9a13d15e4c4e73e878`.
- One A100-80GB-only five-second job used the pinned 960x960 source and selected audio.
- Job entered inference but remained `IN_PROGRESS` at the 30-minute task limit. Operator guard
  cancelled it; no MP4 or worker result was accepted.
- Measured spend was `$1.2642676444`, below the `$2.00` task cap and `$1.80` hard stop.
- No second dispatch occurred. Endpoint/template deletion had no cleanup errors. Final and
  independent inventories show zero Pods, endpoints, templates, volumes, and active workers.
- Pinned official single-GPU talking-avatar command uses `--offload`; this run does not justify an
  unproven command change. Provider-free successor VF-8-16 adds stage/heartbeat evidence and removes
  the client/worker timeout race before any separately capped resume.

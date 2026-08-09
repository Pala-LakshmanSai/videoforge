# Gate evidence

Create one folder per gate and one immutable subfolder per run:

```text
evidence/gates/{GATE_ID}/{run_id}/
  metadata.yaml
  metrics.json
  README.md
  artifacts-or-private-links.md
```

Use `../../templates/GATE_EVIDENCE.md` as the human record. Do not put secrets, private style references, copyrighted Ranga frames, model weights, or large generated media in Git. Store private/large evidence in the approved object store and record checksums plus access-controlled links.

# V2-06 staging deployment inputs

Provider-free state only. Nothing in this directory authorizes deployment or resource creation.

- `cloud-run-asr.job.yaml` and `cloud-run-render.job.yaml` are fail-closed templates. Activation
  replaces both placeholders with the approved job service account and immutable Artifact Registry
  image digest, records the rendered manifest hash, then uses `gcloud run jobs replace` in the
  approved project/region.
- `neon-runtime-grants.sql` grants the staged runtime login only the current hosted auth, active
  tenant, and CPU-orchestration surfaces. The migration identity remains separate. Raw database
  credentials never enter a manifest or Git.
- `secrets.allowlist.json` is the exact set of Worker secret names. Values are applied only through
  the approved secret-store operation and never placed in Wrangler config, logs, evidence, or Git.
- Cloud Run's job service account receives no Google data-plane role: each execution receives only
  short-lived exact R2 GET/PUT ports and an opaque one-attempt callback. The separate Worker invoker
  service account receives `roles/run.invoker` on only the two jobs.
- The CPU image uses the digest-pinned `workers/media-local/Dockerfile`; whisper.cpp 1.8.4 and
  FFmpeg/FFprobe 8.1.2 are inside the image. The exact `ggml-base.en` object is downloaded through a
  short-lived private R2 port into job scratch and must match its pinned SHA-256 before use.
- Rollback deploys the previously recorded Worker version and job manifests. Schema migrations
  0029-0031 are additive and retained. Staging objects are deleted only through tenant retention records after
  backup/restore evidence and explicit approval; auth/session tables rely on Neon native PITR rather
  than the portable metadata export because they contain secret-bearing values.
- `backup.sh` creates a new mode-0600 logical backup and prints only its SHA-256; `restore-drill.sh`
  restores only to an explicitly supplied disposable database. Both executions belong in the
  approved mutation plan because the drill creates hosted rows and may consume Neon compute.
- `observability.template.json` pins redaction and alert conditions. Alert destinations and any
  external notification delivery are selected and approved during activation.

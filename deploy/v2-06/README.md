# V2-06 staging deployment inputs

Provider-free state only. Nothing in this directory authorizes deployment or resource creation.

- `media-worker-release.template.json` is the fail-closed Windows/macOS release manifest. Activation
  replaces it only with immutable installer URLs, exact sizes/checksums, disclosed ImageForge-style
  beta trust modes, the execution-bundle checksum, and a measured compatible protocol version.
- `neon-runtime-grants.sql` grants the staged runtime login only the current hosted auth, active
  tenant, and CPU-orchestration surfaces. The migration identity remains separate. Raw database
  credentials never enter a manifest or Git.
- `secrets.allowlist.json` is the exact set of Worker secret names. Values are applied only through
  the approved secret-store operation and never placed in Wrangler config, logs, evidence, or Git.
- `r2-cors.template.json` is the origin-exact browser transfer policy. Activation replaces its one
  placeholder with the deployed HTTPS origin, applies it to the private staging bucket, and proves
  it with `wrangler r2 bucket cors list`; wildcard origins and headers are forbidden.
- Each account-owned personal worker receives only a device credential in the OS credential store,
  a short lease for one exact attempt, and short-lived tenant-bound R2 GET/PUT ports. It never
  receives Neon, R2, Cloudflare, Google, email, RunPod, or Runware credentials and opens no inbound
  listener.
- The immutable worker bundles pinned whisper.cpp 1.8.4, FFmpeg/FFprobe 8.1.2, and the exact
  `ggml-base.en` model. Every executable and model is checked against the release manifest before
  the worker connects; there is no first-run model download or user configuration. Scratch is
  removed after terminal completion.
- Rollback deploys the previously recorded Cloudflare Worker version and prior signed desktop release
  manifest. Schema migrations 0029-0034 are additive and retained. Successful final video objects are
  not time-deleted; the user-facing Delete operation owns durable R2 deletion. Only failed/cancelled
  transient attempt objects use bounded retention. Auth/session tables rely on Neon native PITR rather
  than the portable metadata export because they contain secret-bearing values.
- `backup.sh` creates a new mode-0600 logical backup and prints only its SHA-256; `restore-drill.sh`
  restores only to an explicitly supplied disposable database. Both executions belong in the
  approved mutation plan because the drill creates hosted rows and may consume Neon compute.
- `observability.template.json` pins redaction and alert conditions. Alert destinations and any
  external notification delivery are selected and approved during activation.

# V2-06 staging deployment inputs

Provider-free state only. Nothing in this directory authorizes deployment or resource creation.

Render an activation-specific Wrangler file outside Git only after the exact activation proposal is
approved. The renderer refuses unresolved placeholders and never overwrites the tracked template:

```sh
node deploy/v2-06/render-staging-config.mjs \
  --account-id <32-hex-cloudflare-account-id> \
  --origin https://<exact-worker-origin> \
  --commit <deployed-git-sha> \
  --release-manifest-file <immutable-release-manifest.json> \
  --output /tmp/videoforge-v2-06-staging.wrangler.json
```

Use that rendered file for deploy and retain its printed SHA-256 with the deployment evidence. Never
commit the rendered file when it contains a release manifest or provider-specific identity.

- `media-worker-release.template.json` is the fail-closed Windows/macOS release manifest. Activation
  replaces it only with immutable installer URLs, exact sizes/checksums, disclosed ImageForge-style
  beta trust modes, the execution-bundle checksum, and a measured compatible protocol version.
- `neon-runtime-grants.sql` grants the staged runtime login only the current hosted auth, active
  tenant, and CPU-orchestration surfaces. The migration identity remains separate. Raw database
  credentials never enter a manifest or Git.
- `secrets.allowlist.json` is the exact set of Worker secret names. Values are applied only through
  the approved secret-store operation and never placed in Wrangler config, logs, evidence, or Git.
- `r2-cors.template.json` is Wrangler's R2 API shape (`{ "rules": [{ "allowed": ... }] }`), not the
  AWS S3 `CORSRules` shape. Activation replaces its one origin placeholder with the deployed HTTPS
  origin, applies it to the private staging bucket, and proves the exact live policy with:
  `EXPECTED_ORIGIN=https://<exact-worker-origin> deploy/v2-06/verify-r2-cors.sh
videoforge-v2-06-staging-private`. Wildcard origins and headers are forbidden.
- Each account-owned personal worker receives only a device credential in the OS credential store,
  a short lease for one exact attempt, and short-lived tenant-bound R2 GET/PUT ports. It never
  receives Neon, R2, Cloudflare, Google, email, RunPod, or Runware credentials and opens no inbound
  listener.
- The immutable worker bundles pinned whisper.cpp 1.8.4, FFmpeg/FFprobe 8.1.2, and the exact
  `ggml-base.en` model. Every executable and model is checked against the release manifest before
  the worker connects; there is no first-run model download or user configuration. Scratch is
  removed after terminal completion.
- Rollback deploys the previously recorded Cloudflare Worker version and prior immutable desktop release
  manifest. Schema migrations 0029-0034 are additive and retained. Successful final video objects are
  not time-deleted; the user-facing Delete operation owns durable R2 deletion. Only failed/cancelled
  transient attempt objects use bounded retention. Auth/session tables rely on Neon native PITR rather
  than the portable metadata export because they contain secret-bearing values.
- `backup.sh` creates a new encrypted mode-0600 logical backup and prints only its SHA-256. It
  requires a mode-0600 passphrase file, refuses overwrite/symlink targets, and never prints the
  database URL. `restore-drill.sh` decrypts only to a private temporary file, restores only to an
  explicitly labelled disposable database, verifies the migration head, and never drops or cleans
  the target. Both executions belong in the approved mutation plan because the drill creates hosted
  rows and may consume Neon compute.
- `observability.template.json` pins redaction and alert conditions. Alert destinations and any
  external notification delivery are selected and approved during activation.

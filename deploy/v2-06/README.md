# V2-06 staging deployment inputs

Provider-free state only. Nothing in this directory authorizes deployment or resource creation.
The following sequence is the activation runbook after the exact V2-06 proposal, finite spend cap,
and provider mutation approval have been recorded. It deliberately keeps the rendered config and
all secret values outside Git.

## Build, render, deploy, and verify

Run from the repository root on the exact clean commit that is being activated. The renderer refuses
to proceed until the Vite-built Worker module and client asset directory exist and are non-empty at
their fixed staging output paths. It then replaces the source-relative paths with absolute paths and
sets `no_bundle: true`; this is required because the rendered file is stored in `/tmp`, while the
Worker's generated module imports live beside the built bundle in the repository.

```sh
set -eu

pnpm --filter @videoforge/web build:staging
DEPLOYED_COMMIT=$(git rev-parse HEAD)
CONFIG=/tmp/videoforge-v2-06-staging.wrangler.json

node deploy/v2-06/render-staging-config.mjs \
  --account-id <32-hex-cloudflare-account-id> \
  --origin https://<exact-worker-origin> \
  --commit "$DEPLOYED_COMMIT" \
  --release-manifest-file <immutable-release-manifest.json> \
  --output "$CONFIG"

node -e '
  const fs = require("node:fs");
  const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (c.no_bundle !== true || !c.main.startsWith(process.cwd() + "/apps/web/dist-staging/") ||
      c.assets?.directory !== process.cwd() + "/apps/web/dist-staging/client") process.exit(1);
  if (!fs.statSync(c.main).isFile() || !fs.statSync(c.assets.directory).isDirectory()) process.exit(1);
' "$CONFIG"

# Upload exactly the eight required secrets through Wrangler's secret store.
# Each FILE is mode 0600 and contains one value; never put values in this config,
# shell history, logs, or evidence.
for entry in \
  DATABASE_URL:/secure/videoforge/DATABASE_URL \
  BETTER_AUTH_SECRET:/secure/videoforge/BETTER_AUTH_SECRET \
  GOOGLE_CLIENT_ID:/secure/videoforge/GOOGLE_CLIENT_ID \
  GOOGLE_CLIENT_SECRET:/secure/videoforge/GOOGLE_CLIENT_SECRET \
  R2_ACCESS_KEY_ID:/secure/videoforge/R2_ACCESS_KEY_ID \
  R2_SECRET_ACCESS_KEY:/secure/videoforge/R2_SECRET_ACCESS_KEY \
  WORKFLOW_CALLBACK_SECRET:/secure/videoforge/WORKFLOW_CALLBACK_SECRET \
  MEDIA_WORKER_TOKEN_SECRET:/secure/videoforge/MEDIA_WORKER_TOKEN_SECRET; do
  name=${entry%%:*}; file=${entry#*:}
  pnpm --filter @videoforge/web exec wrangler secret put "$name" --config "$CONFIG" <"$file"
done

pnpm --filter @videoforge/web exec wrangler deploy --config "$CONFIG"
```

Record the renderer's config SHA-256, deployed Worker version ID, `DEPLOYED_COMMIT`, release
manifest SHA-256, and the exact `/tmp` config path. Keep the mode-0600 config only for the approved
rollback window, then delete that exact file. Do not upload `EMAIL_DELIVERY_*` because email auth
was not selected; the optional pair must be absent unless separately approved.

The R2 browser policy is verified against the same rendered config (the verifier accepts an absolute
`WRANGLER_CONFIG` path):

```sh
EXPECTED_ORIGIN=https://<exact-worker-origin> \
WRANGLER_CONFIG="$CONFIG" \
  deploy/v2-06/verify-r2-cors.sh videoforge-v2-06-staging-private
```

Retain the command exit code and exact live policy output with the deployment evidence. A successful
local `build:staging` or renderer run is not hosted proof; the Worker URL, real Chrome journey, and
provider inventory must be captured separately.

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

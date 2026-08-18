# V2-06 staging deployment inputs

Templates and procedures in this directory are not deployment authority. The following sequence is
the activation runbook after the exact V2-06 proposal, finite spend cap, and provider mutation
approval have been recorded separately. It deliberately keeps the rendered config and all secret
values outside Git.

## Build, render, deploy, and verify

Run from the repository root on the exact clean commit that is being activated. The renderer refuses
to proceed until the supplied commit is the existing full 40-hex current `HEAD`, both the index and
working tree are clean, and the Vite-built Worker module plus at least one non-empty regular client
asset exist at their fixed staging output paths. It then replaces the source-relative paths with
absolute paths and keeps Wrangler bundling enabled. This is required because the Vite entry is a
small module that imports generated chunks beside it; `no_bundle: true` would upload only the entry
stub. Absolute paths are required because the rendered file is stored in `/tmp`.

```sh
set -eu

# This file is an operator procedure, not an approval record.  The activation record is a
# separately reviewed, mode-0600 JSON file with authority.mode=APPROVED, the finite cap, exact
# Cloudflare/Neon identities, and the immutable release-manifest SHA-256.  Never use the tracked
# activation.template.json as that record.
ACTIVATION_RECORD=/secure/videoforge/v2-06/activation-approved.json
CLOUDFLARE_ACCOUNT_ID=<exact-approved-32-hex-account-id>
STAGING_ORIGIN=https://<exact-approved-worker-origin>
RELEASE_MANIFEST=/secure/videoforge/v2-06/media-worker-release.json
CONFIG=/tmp/videoforge-v2-06-staging.wrangler.json
export CLOUDFLARE_ACCOUNT_ID STAGING_ORIGIN
umask 077
test -f "$ACTIVATION_RECORD" && test ! -L "$ACTIVATION_RECORD"
test "$(stat -f '%Lp' "$ACTIVATION_RECORD" 2>/dev/null || stat -c '%a' "$ACTIVATION_RECORD")" = 600

# Apply the committed migration chain only through the approved Neon migration-owner service.
# PGSERVICEFILE contains host/dbname/user but no password; PGPASSFILE is mode 0600.  The helper
# verifies every migration byte/hash, the exact ledger prefix, the owner identity, runtime grants,
# and FORCE RLS.  It never accepts a DATABASE_URL argv.
export V2_06_PG_SERVICEFILE=/secure/videoforge/v2-06/owner.pg_service.conf
export V2_06_PG_SERVICE=videoforge_v2_06_owner
export V2_06_PGPASSFILE=/secure/videoforge/v2-06/owner.pgpass
# backup.sh and restore-drill.sh consume the conventional libpq names; keep these aliases
# alongside the helper-specific names so neither path falls back to ambient credentials.
export PGSERVICEFILE="$V2_06_PG_SERVICEFILE"
export PGSERVICE="$V2_06_PG_SERVICE"
export PGPASSFILE="$V2_06_PGPASSFILE"
export V2_06_APPROVED_NEON_HOST=<exact-approved-neon-endpoint-host>
export V2_06_EXPECTED_DATABASE=<exact-approved-staging-database>
export V2_06_EXPECTED_OWNER_ROLE=<exact-migration-owner-role>
export V2_06_RUNTIME_ROLE=<exact-non-superuser-runtime-role>
node deploy/v2-06/apply-migrations-and-grants.mjs --apply-grants

# Create and verify the encrypted backup and separately approved disposable restore drill before
# deployment. These commands use the same protected service/passphrase files and never put a DSN
# in argv; the drill target is disposable and is cleaned only by the recorded operation.
BACKUP_DIR=/secure/videoforge/v2-06/backups
BACKUP_OUTPUT="$BACKUP_DIR/videoforge-v2-06-live.dump.enc"
mkdir -p "$BACKUP_DIR"
BACKUP_PASSPHRASE_FILE=/secure/videoforge/v2-06/backup.passphrase \
  deploy/v2-06/backup.sh "$BACKUP_OUTPUT"
# For the restore drill, set the separately approved disposable service/host/passphrase values
# before running this exact command; it never reuses the production database service.
RESTORE_APPROVED_NEON_HOST=<exact-approved-disposable-neon-host> \
RESTORE_EXPECTED_OWNER_ROLE=<exact-disposable-owner-role> \
RESTORE_RUNTIME_ROLE="$V2_06_RUNTIME_ROLE" \
RESTORE_TARGET_DATABASE=videoforge_v2_06_disposable_drill \
RESTORE_PASSPHRASE_FILE=/secure/videoforge/v2-06/backup.passphrase \
RESTORE_DRILL_CONFIRM=YES RESTORE_TARGET_LABEL=videoforge-v2-06-disposable-drill \
  deploy/v2-06/restore-drill.sh "$BACKUP_OUTPUT"

pnpm --filter @videoforge/web build:staging
DEPLOYED_COMMIT=$(git rev-parse HEAD)

node deploy/v2-06/render-staging-config.mjs \
  --account-id "$CLOUDFLARE_ACCOUNT_ID" \
  --origin "$STAGING_ORIGIN" \
  --commit "$DEPLOYED_COMMIT" \
  --release-manifest-file "$RELEASE_MANIFEST" \
  --activation-record "$ACTIVATION_RECORD" \
  --output "$CONFIG"

node -e '
  const fs = require("node:fs");
  const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (c.no_bundle !== false || c.name !== "videoforge-v2-06-staging" ||
      c.account_id !== process.env.CLOUDFLARE_ACCOUNT_ID ||
      c.r2_buckets?.[0]?.bucket_name !== "videoforge-v2-06-staging-private" ||
      c.workflows?.[0]?.name !== "videoforge-v2-06-staging-video" ||
      c.vars?.VIDEOFORGE_PUBLIC_ORIGIN !== process.env.STAGING_ORIGIN ||
      c.vars?.VIDEOFORGE_R2_REGION !== "auto" ||
      !c.main.startsWith(process.cwd() + "/apps/web/dist-staging/") ||
      c.assets?.directory !== process.cwd() + "/apps/web/dist-staging/client") process.exit(1);
  if (!fs.statSync(c.main).isFile() || !fs.statSync(c.assets.directory).isDirectory()) process.exit(1);
' "$CONFIG"

# Upload exactly the eight required secrets through Wrangler's secret store.  The preflight rejects
# symlinks, empty values, wrong modes, and extra files before any provider mutation.
SECRET_DIR=/secure/videoforge/v2-06/secrets
mode_of() { stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"; }
for name in \
  DATABASE_URL BETTER_AUTH_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET \
  R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY WORKFLOW_CALLBACK_SECRET MEDIA_WORKER_TOKEN_SECRET; do
  file="$SECRET_DIR/$name"
  test -f "$file" && test ! -L "$file" && test -s "$file" && test "$(mode_of "$file")" = 600
done
for file in "$SECRET_DIR"/*; do
  test -e "$file" || continue
  case "/$(basename "$file")/" in
    /DATABASE_URL/|/BETTER_AUTH_SECRET/|/GOOGLE_CLIENT_ID/|/GOOGLE_CLIENT_SECRET/|/R2_ACCESS_KEY_ID/|/R2_SECRET_ACCESS_KEY/|/WORKFLOW_CALLBACK_SECRET/|/MEDIA_WORKER_TOKEN_SECRET/) ;;
    *) echo "unexpected secret file: $file" >&2; exit 2 ;;
  esac
done
# Refuse remote extras before any upload. This prevents a stale EMAIL_DELIVERY_* or unrelated
# secret from surviving a supposedly exact activation and avoids partial cleanup after upload.
pnpm --filter @videoforge/web exec wrangler secret list --format json --config "$CONFIG" \
  > /secure/videoforge/v2-06/secret-list-before.json
node deploy/v2-06/check-secret-allowlist.mjs \
  /secure/videoforge/v2-06/secret-list-before.json
node deploy/v2-06/validate-secret-inputs.mjs "$SECRET_DIR" "$ACTIVATION_RECORD"
for entry in \
  DATABASE_URL:"$SECRET_DIR/DATABASE_URL" \
  BETTER_AUTH_SECRET:"$SECRET_DIR/BETTER_AUTH_SECRET" \
  GOOGLE_CLIENT_ID:"$SECRET_DIR/GOOGLE_CLIENT_ID" \
  GOOGLE_CLIENT_SECRET:"$SECRET_DIR/GOOGLE_CLIENT_SECRET" \
  R2_ACCESS_KEY_ID:"$SECRET_DIR/R2_ACCESS_KEY_ID" \
  R2_SECRET_ACCESS_KEY:"$SECRET_DIR/R2_SECRET_ACCESS_KEY" \
  WORKFLOW_CALLBACK_SECRET:"$SECRET_DIR/WORKFLOW_CALLBACK_SECRET" \
  MEDIA_WORKER_TOKEN_SECRET:"$SECRET_DIR/MEDIA_WORKER_TOKEN_SECRET"; do
  name=${entry%%:*}; file=${entry#*:}
  pnpm --filter @videoforge/web exec wrangler secret put "$name" --config "$CONFIG" <"$file"
done
pnpm --filter @videoforge/web exec wrangler secret list --format json --config "$CONFIG" \
  > /secure/videoforge/v2-06/secret-list.json
node - "$SECRET_DIR" /secure/videoforge/v2-06/secret-list.json <<'NODE'
const fs = require("node:fs");
const expected = new Set([
  "DATABASE_URL", "BETTER_AUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
  "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "WORKFLOW_CALLBACK_SECRET", "MEDIA_WORKER_TOKEN_SECRET",
]);
const actual = new Set(JSON.parse(fs.readFileSync(process.argv[3], "utf8")).map((entry) => entry.name));
if (actual.size !== expected.size || [...expected].some((name) => !actual.has(name))) process.exit(2);
NODE

# Render and apply the exact origin-only R2 CORS policy, then verify the live list.  The --force
# flag is intentionally visible because this is a separately approved provider mutation.
CORS_CONFIG=/tmp/videoforge-v2-06-r2-cors.json
node deploy/v2-06/render-r2-cors.mjs --origin "$STAGING_ORIGIN" --output "$CORS_CONFIG"
pnpm --filter @videoforge/web exec wrangler r2 bucket cors set \
  videoforge-v2-06-staging-private --file "$CORS_CONFIG" --force --config "$CONFIG"
EXPECTED_ORIGIN="$STAGING_ORIGIN" WRANGLER_CONFIG="$CONFIG" \
  deploy/v2-06/verify-r2-cors.sh videoforge-v2-06-staging-private

# Read-only storage safety: prove the bucket is Standard/private, has no automatic final-output
# deletion rule, and retains only Cloudflare's incomplete-multipart abort rule.
deploy/v2-06/verify-r2-private-state.sh videoforge-v2-06-staging-private "$CONFIG"

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
  Current V2-06 auth is Google-only with `email_provider=NONE`: `optional_together` is empty and
  both `EMAIL_DELIVERY_*` names are forbidden. Enabling email delivery requires a new explicit
  auth decision and activation record; it is not an implicit optional pair in this runbook.
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
  manifest. Schema migrations 0029-0035 are additive and retained. Successful final video objects are
  not time-deleted; the user-facing Delete operation owns durable R2 deletion. Only failed/cancelled
  transient attempt objects use bounded retention. Auth/session tables rely on Neon native PITR rather
  than the portable metadata export because they contain secret-bearing values.
- `backup.sh` creates a new encrypted mode-0600 logical backup and prints only its SHA-256. It
  requires a mode-0600 `PGSERVICEFILE` (approved host/dbname/user, no password), mode-0600 `PGPASSFILE`,
  mode-0600 passphrase, and the approved migration-owner role. It rejects `DATABASE_URL`/`PGPASSWORD`,
  refuses an existing or symlink output (including a creation race), verifies the complete migration
  manifest before dumping, and never places a DSN in argv. `restore-drill.sh` requires the exact
  approved disposable service host, database `videoforge_v2_06_disposable_drill`, owner role, runtime
  role, mode-0600 backup/passphrase/service files, and the fixed disposable label. It proves the
  target has zero public relations before decrypting, restores only through the service profile,
  applies/verifies every migration hash, runtime grant, and FORCE-RLS fence, and never drops or cleans
  the target. Both executions belong in the approved mutation plan because the drill creates hosted
  rows and may consume Neon compute.
- `observability.template.json` pins redaction and alert conditions. Alert destinations and any
  external notification delivery are selected and approved during activation.

## Tenant-owned activation presets

### Repository-authored owned staging fixture

`provision-owned-fixture.mjs` is the only supported way to turn the tracked
`apps/web/public/fixtures/avatar/amish-farm-host.svg` into tenant-owned staging
bytes. It verifies the immutable `asset_manifest.csv` row, rasterizes fixed
1536px original, 832x480 25-frame runtime, and 512px thumbnail outputs, strips
PNG ancillary metadata, probes the runtime, and labels every row
`V2-06 owned staging fixture` with compatibility `UNTESTED`. It never calls a
provider or GPU and never overwrites or deletes an existing R2 object.

The command is dry-run/provider-free by default:

```sh
V2_06_OWNED_FIXTURE_EMAIL=lakshmansai121@gmail.com \
V2_06_OWNED_FIXTURE_SEED_AT=2026-08-17T00:00:00Z \
node deploy/v2-06/provision-owned-fixture.mjs --dry-run
```

Live use requires the three independent confirmations
`V2_06_OWNED_FIXTURE_CONFIRM=YES`,
`V2_06_OWNED_FIXTURE_R2_CONFIRM=YES`, and
`V2_06_OWNED_FIXTURE_DATABASE_CONFIRM=YES`, a migration-owner Neon URL, and a
bucket-scoped R2 key supplied only through the environment. The Neon connection
is made with the installed driver resolved from `apps/web`; `psql` is not used.
The transaction is exact-idempotent and writes tenant-scoped assets, READY /
PUBLISHED preset rows, and one append-only mutation receipt. The provisioner
is Avatar Hub-only and never accepts project or revision IDs,
creates project artifact reservations/receipts, overwrites objects, or deletes
objects. It commits the exact tenant asset and preset rows before R2 writes, so
a later R2 failure leaves a deterministic expected-key orphan inventory for
audit and an idempotent rerun. This fixture is staging-only, not provider or
compatibility proof, and does not authorize V2-07.

The hosted catalog intentionally returns only the authenticated account's own `READY` Avatar Profile
and `PUBLISHED` Image Style versions. After each invited Google identity has completed its first
session admission, seed its exact private activation presets with
`seed-tenant-presets.mjs`. The utility requires a separate migration-owner URL, an explicit
`V2_06_SEED_CONFIRM=YES`, an explicit avatar-rights confirmation, three existing tenant-owned
`VERIFIED` avatar assets (original, runtime, thumbnail), and one fixed `V2_06_SEED_AT` timestamp.
It refuses the hosted runtime role, missing/foreign/unverified assets, non-head-35 databases, and
conflicting immutable rows. Re-running the same command is safe only when every deterministic row
already matches; it never deletes rows or creates media bytes.

Use `--dry-run` first. The normal command is documented in the script's `--help` output. Keep the
database URL in the environment; it is never written to the generated catalog rows or evidence.
This seed is a V2-06 CPU acceptance fixture only. It does not create GPU presets, RunPod work, or
pre-composed render outputs, and it does not authorize V2-07.

## Owned render fixture plan

`provision-owned-render-fixture.mjs` is the bounded, default-dry-run planner for the hosted
owned-render acceptance fixture. It reads only the exact approved provider-free
`artifacts/local-media/runs/revision_local_owned_001/attempt_render_local_004` evidence path and
fails closed unless the approved pinned input, evidence, manifest, output, and migration-source hashes
match their pinned identities. It rewrites the manifest to deterministic actual
tenant/project/revision IDs, and creates a complete `render-job-input/v1` plus exact
`hosted_render_submission` plan. The plan uses tenant-scoped R2 object-key lineage and is limited
to `lakshmansai121@gmail.com` and `demo9gss@gmail.com`.

The live path carries the explicit V2-06 authority record (finite action cap `$3`, R2 recurring
ceiling `$2/month`, zero expected provider spend, and GPU transport disabled) and an exact six-object,
five-megabyte aggregate / four-megabyte per-object R2 budget. It writes a durable immutable R2
upload-intent receipt before any object mutation, uses conditional create (`If-None-Match: *`),
and verifies an exact HEAD/GET match after every create race. Neon is pinned to `neondb`, the
`neondb_owner` migration role, TLS/channel binding, `public,pg_catalog`, the Google auth provider,
and the complete hash-checked 1–35 migration ledger.

```sh
V2_06_TENANT_EMAIL=lakshmansai121@gmail.com \
V2_06_SEED_AT=2026-08-17T12:00:00Z \
node deploy/v2-06/provision-owned-render-fixture.mjs --dry-run
```

Live use requires the same three explicit confirmations
(`V2_06_RENDER_FIXTURE_CONFIRM=YES`, `V2_06_RENDER_FIXTURE_R2_CONFIRM=YES`, and
`V2_06_RENDER_FIXTURE_DB_CONFIRM=YES`), the migration-owner Neon URL, and one bucket-scoped R2 key
through the environment. The provisioner hard-pins the approved staging resources (Cloudflare
account `f9254d773a3426fcb469451b1f965d8c`, bucket `videoforge-v2-06-staging-private`, region
`auto`, and the approved Neon project host), resolves only one of the two admitted identities,
and uses the driver rooted at `apps/web`. It forwards the complete aws4fetch-signed request to
`fetch`, uploads only missing exact tenant objects, verifies HEAD metadata and GET bytes/hash/type,
then commits one Neon transaction at migration head 35. Existing objects and rows are accepted
only when every immutable fact matches; no object, row, output, GPU, or provider-generated media
is deleted or overwritten. If R2 fails partway through, an append-only failure receipt records the
exact expected-object cleanup scope with `automatic_delete=false`; if Neon fails after R2
verification, the exact orphan objects remain detectable for audit and the transaction is rolled
back. Cleanup is explicit/manual and never an automatic final-video deletion.

The transaction stores the base `revision_config_payload` and its hash on the locked revision;
the rewritten manifest pins that hash, while `hosted_render_plans` stores the exact RENDER
submission and its canonical payload SHA separately. The append-only mutation receipt also emits
the exact ASR submission to send after the tenant completes browser sign-in. Re-running the same
command reuses exact R2 bytes and the same deterministic rows. Local fixture evidence remains
local proof only; it cannot prove hosted deployment or a successful worker render.

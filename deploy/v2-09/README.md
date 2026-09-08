# V2-09 qualified-production preparation

`read-only-preflight.mjs` is the provider-read-only gate immediately before a separately approved
V2-09 deployment proposal. It has no deployment, endpoint, template, job, R2, database, or authority
write operation. The sole authenticated POST is the fixed RunPod GraphQL account-identity query;
all other provider operations are GET reads. The emitted canonical JSON contains hashes and bounded
facts, never the RunPod key or raw provider identities.

From a clean repository root, keep the RunPod key in a regular, owner-only mode-0600 file and invoke:

```sh
umask 077
node deploy/v2-09/read-only-preflight.mjs \
  --expected-source <EXACT_CLEAN_SOURCE_COMMIT> \
  --runpod-api-key-file /absolute/path/to/runpod-api-key \
  > /absolute/outside-repository/path/v2-09-read-only-preflight.json
```

The command fails closed unless HEAD equals the explicitly supplied 40-character source commit and
the tracked worktree is clean. It verifies the exact account hash, endpoint billing, zero pods,
endpoints, templates, and active workers, the two unchanged retained 50 GB EU-RO-1 volume hashes,
and exact RTX 4090 EU-RO-1 Serverless Flex availability at LOW or better and no more than
USD 1.116/GPU-hour. It also anonymously streams and hashes both frozen image manifests, configs,
and every ordered layer, and checks linux/amd64 plus the exact source labels. This can read several
gigabytes from GHCR; it does not publish or republish either image.

Provider-free focused validation:

```sh
node --test deploy/v2-09/read-only-preflight.test.mjs
```

## Authority-gated production operator

The production operator is deliberately separate from the read-only preflight. Its provider-free
plan is always safe to inspect:

```sh
node deploy/v2-09/execute-qualified-production.mjs --dry-run
```

Normal execution requires a fresh exact V2-09 authority plus an exact private configuration. Both
JSON files and their parent directories must satisfy the operator's owner/mode/link/hash checks:

```sh
node deploy/v2-09/execute-qualified-production.mjs \
  --execute \
  --authority /absolute/private/v2-09-authority.json \
  --configuration /absolute/private/v2-09-configuration.json
```

After an interrupted or failed approved execution, only the cleanup suffix may be resumed. It never
authorizes redispatch, publication, a later normal operation, or a broader checkpoint:

```sh
node deploy/v2-09/execute-qualified-production.mjs \
  --cleanup-only \
  --authority /absolute/private/v2-09-authority.json \
  --configuration /absolute/private/v2-09-configuration.json
```

Current authority is **read-only preflight only**. Do not run `--execute` or `--cleanup-only`, push
source, apply migrations or grants, publish/install media-worker 0.1.16, mutate RunPod/Cloudflare/R2,
open a paid Chrome journey, or spend until the exact live proposal is separately approved. V2-07
Stage 6 and V2-08 Stage 7 are frozen qualified predecessors and must not be modified or rerun.

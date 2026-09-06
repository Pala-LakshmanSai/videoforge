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

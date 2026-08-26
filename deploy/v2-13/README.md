# V2-13 production pair boundary

This directory contains provider-free deployment preparation only. The checked-in Wrangler config
and pair binding contract remain `DISABLED_UNQUALIFIED`; none of these commands reads credentials,
calls a provider, deploys, or spends money by default.

The paid pair has two database principals:

- `DATABASE_URL` is the ordinary runtime role. It can use the narrow 0041-0043 materialize,
  predispatch, prepare, begin, finish, and inspect functions. The 0043 prepare projection returns
  only the exact immutable 0041 envelope template needed for restart reconstruction; the role has
  no direct 0041 table access. It cannot call final settlement.
- `VIDEOFORGE_RECONCILER_DATABASE_URL` is a distinct reconciler role. It can inspect the exact pair
  and call the 0044 zero-worker evidence and v2 settlement functions; it has no table access and
  cannot dispatch.

The dispatch-token encryption key, envelope signing key, provider-proof key, RunPod API key, and
both raw endpoint IDs plus their exact SHA-256 bindings are separate Cloudflare secrets. They must
never appear in Wrangler `vars`, client code, logs, evidence, or deployment records. The two
endpoint IDs must be distinct and each raw value is rehashed before a client can be constructed.
The migration owner separately provisions the active provider-proof HMAC key into
`hosted_provider_proof_keys`; neither runtime nor reconciler receives table access.
The provider-proof acquisition implementation must sign an
exact tenant/request/lane/attempt/deployment/token/job/state/observation document; the reconciler
verifies that signature and scope before its privileged settlement call.

## Guarded activation executor

`pnpm activate:v2-13-guarded` is a zero-read, zero-mutation dry run by default. The guarded
executor is the only combined database/secret/deployment procedure. Its tracked authority template
is a proposal surface, never authority. A future execution record must pin the clean exact HEAD,
the migration-manifest bytes, production-config activation bytes, media-worker release bytes, both
fresh qualification and deployment hashes, the paid-authority hash, the approved SoulX full/split
layout decision, a fresh readback hash proving the exact Worker/R2/Workflow resources already
exist, two distinct hardened database roles, and the SHA-256 of every protected secret input.
Qualification, deployment, paid-authority, and preexisting-resource hashes are external evidence
inputs: this executor checks their exact closed-world shape and cross-bindings but does not prove
their live truth. A separate live verifier must produce and authenticate those records immediately
before an execution authority can be issued.

`--plan` performs only local read-only validation and prints names/operations, never secret values.
`--execute` additionally requires the literal confirmation
`EXECUTE_EXACT_GUARDED_V2_13_ACTIVATION`, an exact mode-0600 approved authority file, a private
mode-0700 PostgreSQL input directory, a separate exact mode-0700 secret directory containing only
the 21 allowlisted mode-0600 files, a separately fingerprinted mode-0600 Cloudflare API-token file,
and a new evidence path under a mode-0700 directory. Secret values are read only from those files
and are streamed to Wrangler stdin; they never enter argv, stdout, the plan, or evidence. Every
child process receives a closed environment allowlist, so ambient provider or database credentials
cannot enter the procedure.

Execution requires both exact target role names to be absent cluster-wide; it never rotates a
password onto a reused role whose privileges in other databases cannot be proven from this
connection. It also keeps explicit membership, ownership, ACL, default-ACL, and dangerous effective
privilege predicates as defense in depth. Only then does it create `pgcrypto`, provision the two
exact `LOGIN NOINHERIT` roles, apply the exact
manifest through migration 0044, applies runtime/reconciler grants, and then rechecks the full
ledger, role flags/memberships/ownership, exact runtime function allowlist, reconciler function
allowlist, and absence of reconciler table grants. It refuses migration unless the database already
has the exact 36-row manifest prefix, so this activation can apply only migrations 0037-0044.

Before database mutation, the executor rechecks the authority-pinned Cloudflare deployment-status
and active-version bytes and proves one exact disabled version with an empty secret set. It repeats
that read immediately before Cloudflare mutation, deploys and reads back the exact new
`DISABLED_UNQUALIFIED` quarantine with automatic resource creation disabled, and only then uploads
the closed-world secret names. Every secret-created version and the final version are read back as
the exact disabled commit. A partial failure deletes only names introduced by that run, redeploys
the disabled quarantine, and verifies the rollback; inability to verify rollback is a hard manual
reconciliation stop. Database changes are staged and are never described as cross-provider atomic
rollback; a failure after database role/grant mutation is a hard manual reconciliation stop rather
than an automatic replay. The tool never creates a bucket, Workflow, endpoint, volume, or another
retained resource.

Run `pnpm validate:v2-13-production-pair` for the provider-free source/ACL/config validation. Before
any future activation, independently verify the exact 0037-0044 migration ledger, both fresh live
lane qualifications, the exact paid approval/cap, both exact published deployment snapshots, the
two distinct database-role bindings, and all three separate key bindings. Activation still requires
a fresh authorized deployment procedure; this source slice does not supply that authority.

`HostedPairWorkflow` is a second durable Workflow binding. It resumes the 0043 Mage-then-SoulX
send boundary once, polls exact assigned job IDs, starts exact-ID cancellation only after 20
minutes, and stops after 30 minutes as `MANUAL_RECONCILIATION_REQUIRED`. It never blindly resends.
Successful settlement requires both exact callback/output barriers and zero workers on both
endpoints. Migration 0044 persists both signed zero-worker proofs before delegating to the 0043
settlement that advances the CPU-render stage to `RENDERING`.

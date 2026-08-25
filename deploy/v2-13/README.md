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

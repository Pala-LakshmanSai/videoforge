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
  and call `videoforge_settle_hosted_pair_cleanup`; it has no table access and cannot dispatch.

The dispatch-token encryption key, envelope signing key, and provider-proof verification key are
three separate Cloudflare secret bindings. They must never appear in Wrangler `vars`, client code,
logs, evidence, or deployment records. The provider-proof acquisition implementation must sign an
exact tenant/request/lane/attempt/deployment/token/job/state/observation document; the reconciler
verifies that signature and scope before its privileged settlement call.

Run `pnpm validate:v2-13-production-pair` for the provider-free source/ACL/config validation. Before
any future activation, independently verify the exact 0037-0043 migration ledger, both fresh live
lane qualifications, the exact paid approval/cap, both exact published deployment snapshots, the
two distinct database-role bindings, and all three separate key bindings. Activation still requires
a fresh authorized deployment procedure; this source slice does not supply that authority.

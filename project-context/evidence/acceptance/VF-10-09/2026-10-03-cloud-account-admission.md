# Cloud access follows VideoForge admission

Checkpoint V2-09; policy and migration source `88ab0bed9d74db831b82477f5002de26631fb654`, branch `codex/seedance-video`. Migration0249 is applied in production. Application source `8ae9e4e37b230b0019c95399489715e48582e687` / Worker `8c5981cf-1aed-4ab6-a906-c32236c1d2f5` is unchanged; no application or native runtime deployment was needed.

## Decision and implementation

On 2026-10-03 the user requires ordinary Cloud access to accompany VideoForge access for every current and future admitted account. No separate Cloud account list or second grant applies. Earlier single-workspace Cloud access is superseded.

Migration0249 replaces three SQL readers in place. Ordinary readiness and project authorization derive eligibility from an active account, admitted hosted identity, verified email and absence of VideoForge revocation. Actual invitation redemption therefore inherits Cloud eligibility automatically. Finite historical approvals retain their exact account lists, budgets and expiry. Ongoing project scope additionally requires actual tenant ownership even for an authority-listed project; broadening account eligibility must never broaden project ownership.

New admission stops on revocation. Existing rental metadata remains readable for a trusted ongoing reservation through its original exact tenant/job/attempt/fence joins, including after admission disappears. This preserves cleanup, cancellation and accepted-artifact settlement without permitting new work. Readers retain their OIDs, owners and ACLs; rates, balances, runtime pins, authority rows, pending cleanup and global/account concurrency controls are not rewritten.

## Proof

- 35 focused SQL checks pass: old-list failure reproduction; current accounts; real future invite redemption; pending/revoked/disabled/unknown/system denials; restore; finite expiry and spend; tenant-negative project scope; authority disable; repeatable migration and rollback; existing rental cleanup under the restricted runtime role; original accounting, concurrency and Team access guards. Tests: `cloud-admitted-access.test.mjs`, `cloud-pay-per-use.test.mjs`, `hosted-cloud-reservation-authority.test.mjs`, `hosted-team-access.test.mjs` in `packages/control-plane/tests/`.
- Native PostgreSQL rollback rehearsal and guarded activation pass. Authority policy and current balances, pending cleanup and original migration ledger are conserved; only migration0249 is appended. Account eligibility passes for all five admitted user accounts across the three enabled ongoing authorities (15 read-only queries as the actual runtime role). Unknown-account admission fails.
- All three accounts with currently valid sessions return authenticated catalog200 and `cloud_media.available=true`. Accounts without a current session are proved by scoped SQL; no session was created or impersonation credential retained.
- Actual user Chrome reload, Cloud selection and visible “Cloud execution is enabled” pass. Local remains the reload default; incomplete inputs correctly leave Create disabled. No Create action was taken.
- Context validation, migration hash verification, tracked secret scan and `git diff --check` pass. Optional historical asset/profile warnings remain. No full-CI or newly generated-film acceptance is claimed.

Private receipts: primary checkout `.videoforge/cloud-access-all-20261003/`, including rollback/activation results, timestamped verification, provider inventory and `cloud-enabled-chrome.png`. Keep account-sensitive evidence outside Git and GPT Space.

## Spend, cleanup and rollback

This change starts zero provider requests, videos or paid compute (USD0 task spend). One existing VideoForge Pod is present during the final read-only inventory and remains under its user's normal video lifecycle. Do not stop another user's work or claim all compute is shut down. The historical unknown-launch claim is preserved; it is not settled by access rollout.

This proves admission and existing cleanup compatibility, not a fresh render, editorial acceptance or invoice. Rollback requires a separate explicit policy decision: restore the saved pre-migration reader definitions in place while retaining their original ACLs, additive ledger history, authority balances, accepted jobs and pending cleanup. Rolling back app code alone does not roll back database policy. Future releases must preserve admission-derived ordinary Cloud access and must never restore the obsolete separate account list.

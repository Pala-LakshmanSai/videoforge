# Cloud readiness repair — 2026-10-03

Checkpoint V2-09; branch codex/seedance-video. Published source `8ae9e4e37b230b0019c95399489715e48582e687`, Worker `8c5981cf-1aed-4ab6-a906-c32236c1d2f5`, 100% traffic. This follow-up preserves whole-scene coverage policy, migration0248, immutable legacy exports, Desktop0.1.47 and qualified Cloud runtime.

## Cause and correction

The user’s selected Cloud workspace was absent from the existing ongoing pay-per-use authority. Earlier acceptance used a different authorized account. Catalog used account-scoped eligibility, while preflight checked only the release flag; cached readiness could therefore show Ready while Create was disabled. Generic error handling hid actual blockers.

Catalog, preflight and fresh Create now invoke the same existing account-scoped SQL readiness reader. New Create refreshes both catalog and preflight. Availability changes invalidate stale proof; late responses cannot restore readiness for obsolete inputs. Blocker details remain visible. Typed definitive Cloud409 rejection unlocks a new form only before project acceptance. Unknown submissions, idempotency conflicts and accepted projects retain original request identity for reconciliation.

The guarded authority transaction appended only the affected workspace account. Prior membership, every other authority field, prices, shutdown deadlines and other authorities were preserved. No schema migration or broad account access grant occurred. Future promotion must derive scope from current live authority rather than a cached canary account list. Account-scoped eligibility remains mandatory.

## Verification

- 219 UI and154 API tests pass, including blocked/allowed account parity, cleanup priority, exact idempotent replay after access revocation, stale/late readiness, visible blockers and definitive versus uncertain409 handling. App/Worker types, owned lint/format, secret scan, production build and existing bundle ceilings pass. Independent diff review found no remaining issue.
- Production18-case authenticated HTTP check passes valid coverage presets/custom, invalid inputs and legacy default. Seven read-only runtime-role account scopes confirm exactly two authorized accounts ready and five nonmembers blocked; SQL readers and other authority fields unchanged.
- All23 public payloads match exact build hashes. Index307/root HTML and static fallback verified. All51 bindings,25 secrets and three Workflow identities preserved; no new Workflow or provider job.
- All39 packaged Cloud Python sources and50 Desktop release inputs match previous qualified releases. The four runtime/desktop pins remain byte-identical; no native release needed.
- Actual signed-in user Chrome: title30s, uploaded33-second narration, ready avatar/style. Off,7%,15%,25%,50%,75%,100% and custom23 each show Cloud enabled, Ready and Create enabled after fresh checks. Local offline produces explicit worker blockers and disables Create. Cloud and the user’s latest form choices restored; form retained open. No Create click.

Private receipts remain outside Git under `.videoforge/cloud-readiness-20261003`: `chrome-acceptance.json`, `cloud-ready-50.png`, `http-cloud-readiness-1791006264935-private.json`, `account-scopes-1791006262183-private.json`, `client-assets-1791006256651-private.json`, `native-desktop-identity-1791006293809-private.json` and `deployed-private.json`. They contain verification and account-sensitive evidence; do not publish private contents.

## Spend, limits and rollback

USD0 new provider generation or paid compute; no resource started/stopped. Current complete RunPod inventory contains zero Pods. Historical STOPPING/UNKNOWN cleanup claim remains preserved and unresolved; empty inventory does not retroactively settle it. Existing pay-per-use billing policy unchanged.

This establishes admission consistency and real-browser readiness, not a newly generated film, new-policy playback/editorial acceptance, billing invoice or long-video performance. Existing broad-CI baseline failures remain; full CI is not claimed green.

Rollback application version to the retained predecessor only after reviewing its known readiness inconsistency. Preserve additive schema, accepted assets, request identities and account-scoped access records. Access revocation is a separate explicit operation; do not blindly restore a stale authority snapshot or replay jobs.

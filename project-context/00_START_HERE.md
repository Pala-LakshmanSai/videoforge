# VideoForge: start here

## Active handoff — read this section first

### New-chat launch point — 2026-08-27

- The independently audited provider-free full-live source remains
  `3f7b588de4b96da7c1e56b6c1908df7381712710`. A provider-free successor repair is ready to commit
  and independently audit; all production entrypoints remain fail-closed/no-op.
- Credential bootstrap and the one corrective rotation/normalization are complete. Preserve the exact
  protected files and secret-free receipt `sha256:35caf042a18f6f4b42f264d96e52926856bcc387890c4925f512f2bf2c6c1eab`.
  Both credential authorities are consumed and non-reusable; no further credential or R2 mutation is
  part of the next task. Commit `e31e275a767bd9a098f4b94c078b50136d5b998b` makes the historical
  reuse-result validator distinguish its immutable old receipt hash from the exact completed rotation
  successor/current receipt, closing the temporal-path alias without changing either historical record.
- Production is still `DISABLED_UNQUALIFIED`. Migrations 0037–0045, the three production database
  roles, Cloudflare Worker/Workflows, immutable Mage/SoulX images, max-one RunPod lanes, and live
  acceptance have not been activated under a current full-live authority.
- Fresh read-only preflight proved zero temporary compute and bound the completed credential receipt,
  exact account-derived 404 HTML route, same two retained 50 GB EU-RO-1 volumes, and the official
  Serverless Flex rate of `$0.00031/second` (`$1.116/GPU-hour`) separately from the `$0.74/hour`
  Secure Pod catalog rate. Commit and independently audit this source repair, then reseal and audit
  the exact proposal before requesting user approval at the first mutation/spend boundary.
- After approval, execute the closed graph serially: Mage qualification, SoulX qualification, guarded
  database/Cloudflare activation, exact max-one lanes, V2-09 through V2-13 acceptance, immediate
  temporary-compute drain, settled billing, and independent zero-job/zero-worker proof. Never keep a Pod
  or worker active when it is not strictly required; ambiguity, expiry, cancellation, or failure enters
  cleanup-only with no redispatch.
- Planning estimate only: approximately 75% of the entire project is complete, including about 92% of
  product/source work and 100% of the credential setup. The remaining risk is concentrated in live
  qualification, deployment, long-form acceptance, billing reconciliation, and release proof; these
  percentages are not acceptance evidence.

Suggested new-chat request: `Continue VideoForge from the current clean HEAD. Read AGENTS.md and the
active handoff, orchestrate with multiple Luna workers plus an independent auditor, reseal and audit a
fresh V2-13 full-live proposal, perform only provider-free work and bounded read-only preflight until the
first mutation boundary, keep all Pods/workers at zero unless strictly required, then ask once for the
exact source-bound approval.`

`DEC_DELIVERY_002` now governs execution. V2-08 through V2-13 provider-free product implementation
may proceed in parallel behind fail-closed unqualified adapters. Live certification remains serial:
V2-07 Mage first, then V2-08 SoulX and successor live gates. Successful atomic live evidence is
reusable for at most 24 hours only with identical immutable image, complete source, endpoint-template/config,
sealed volume-manifest, GPU, and region hashes. Release remains blocked until both lanes pass, a
final two-lane smoke passes, and an independent zero-job/zero-worker drain is proven. No provider
call, mutation, deployment, GPU use, or spend is currently authorized.

The previous provider-free source is independently audited at `3f7b588de4b96da7c1e56b6c1908df7381712710`
(42/42 checks). The current provider-free repair is pending its new commit and independent audit;
default entrypoints remain no-op. It retains the zero-cap
`bootstrap_prequalification_database` operation after SoulX verification and before
`fresh-live-preflight`, exact 36-to-45 recovery, protected receipt/CAS and seed gates, strict
credential/origin boundaries, operator-only fresh preflight, and staged full runtime inputs. Current
repair component hashes are: executor `sha256:4a4e328630aa1e8e863b99ca4b56528b0068dacf1ae4f77df2974acc89f469f5`,
adapters `sha256:0a2b929507609d0709cb0262b757e537576c3b9af192681548fd78a357ac5437`, orchestration
`sha256:fde2b699086d6a6c104a4fdc43a8e917b1cf94b1c830adc2868b6a12207742d6`, approval validator
`sha256:40d251611456b3ddd9a1ff596f42d798539cf867b8bd5c6ed72aba095872a1b4`, and guarded activation
`sha256:1fc2d4b4b5246c6e0a6f407f7742f78acdca66723c60d2a0c1499e692a5162f7`. This is source/test
proof only. Production remains `DISABLED_UNQUALIFIED`; migrations/grants/config and database roles
are undeployed, and no full-live deployment bindings are activated.
The credential rotation/normalization boundary is now completed once and non-reusable. Proposal
`sha256:76f14ae25cff7840d0028be1ca0af87bbf325178d99a5ca2b80806aa3ddb2c73` at commit
`1845be6c852654c8396f2973981733ce64a3d2d0`
was approved and consumed under authority
`v2-13-credential-rotation-normalization-20260827-095717z-76f14ae2`; completion is recorded at
`58ad5cd5c5bf4dbe6fa7ad99b98288b3d4f1bd9a`, result
`sha256:815258fce0b32ecd8afa6ad1dae0399615c26533c7fd1b1d60ecf4657d567ac6`, and receipt
`sha256:35caf042a18f6f4b42f264d96e52926856bcc387890c4925f512f2bf2c6c1eab`. It rotated one
same-client Google secret with secure hash-bound readback before disabling only the exposed old
secret, and normalized only the two local R2 files. Cloudflare R2 provider mutation, RunPod calls,
GPU use, and spend were zero; no raw credential values are retained in evidence or the receipt.
Preserve the exact resources/files. No further credential/provider/R2/RunPod/GPU/spend mutation,
retry, or redispatch is authorized under the consumed boundary. Full-live release remains blocked
on its separate source-bound deployment/image/paid gates and fresh exact authority.

### Historical credential-bootstrap and prior full-live proposal records

The separate zero-cost Google OAuth/R2 credential-bootstrap proposal is sealed and independently
audited at commit `9106f9d` with SHA-256 `48bf5c7b…e96e0ab`. Its exact user-approved single-use
attempt stopped at the Google project-create preflight because the authenticated account reached
its project quota; the attempt is recorded as `BLOCKED_UNCONSUMED_NO_MUTATION`, with no executable
authority, project, OAuth client, R2 credential, protected credential-file write, GPU use, or spend.
One separately authorized request for one additional Google Free Services project was submitted on
2026-08-27; Google confirmation says review typically takes about 2 business days and follow-up goes
to the submitted email. No alternate project is authorized. Evidence:
`evidence/acceptance/VF-10-13/2026-08-27-credential-bootstrap-candidate/blocked-execution.json` and
`evidence/acceptance/VF-10-13/2026-08-27-credential-bootstrap-candidate/quota-increase-request.json`.
A separate read-only reuse audit of existing project `adroit-archive-329710` hit an unexpected Google
side effect: opening the Firestore inventory automatically enabled `firestore.googleapis.com` and
`firebaserules.googleapis.com`, increasing the enabled-service inventory from 13 to 15. The original
blocked credential attempt was not altered. No database, resource, billing association, OAuth client,
credential value, Cloudflare R2 action, RunPod action, GPU use, or spend occurred; no rollback/disable
or further provider action is authorized. The exact before/after service arrays and canonical hashes
are recorded in `evidence/acceptance/VF-10-13/2026-08-27-credential-bootstrap-reuse-adroit-archive-candidate/unexpected-firestore-api-enablement-incident.json`
(`sha256:936117ccc777b37d6e6ee595c8d8feccb4fbd026e11d7705084af03230db2229`). The first independent
reuse-proposal audit P1 was repaired and the existing-project candidate is now sealed at
`sha256:90d6b19d6935ded1bfebdb6df53c64ea33edeba4dce750fe3a81b93708228ed4`, committed at `68ea8a0`.
The candidate has no executable authority: proposal work
made no credential/provider mutation, RunPod call, GPU use, or spend. A fresh exact approval must
name the sealed proposal and successor commit before any consent configuration, OAuth client, R2
credential, or protected-file work. The quota-blocked approval remains non-reusable.
The blocked replacement proposal now closes a 25-operation graph by placing zero-cap
`record-workflow-start-authority` after promotion and before V2-09, and binds full receipt/ACL/public-
revoke readback, guarded receipt verification before secret reads, durable billing, and a separate
early no-database cleanup seam. The approval-validator component is externally bound to the exact
release-commit tree entry rather than embedding a self hash.
The worker receipt/envelope changes invalidate every earlier image-bound qualification. The user's
earlier full-live approval is recorded as superseded and unconsumed because its source hashes no
longer match. Proposal `sha256:9425de8e…899a` was approved and recorded at `67f6fb2`, but is now
superseded unconsumed before mutation: its 21-secret text conflicts with the exact 22-secret executor,
and the staged-preflight, isolated-source-worktree, authority-record publication, durable hash-chained
internal future-record materialization, true 30-minute end-to-end workflow deadline, and closed-env
credential-free CA-verified HTTPS trusted-time contracts require provider-free repair. The replacement
draft also forbids endpoint IDs in the initial seed: exact endpoint IDs, hashes, and actual max-one
deployment snapshots must be materialized only from the max-one result, with a separate cleanup-only
pre-endpoint descriptor for failures before endpoint creation. That endpoint-free cleanup path uses
only the operator database and RunPod credential after operator verification; before that verification,
the early no-database path uses only request and RunPod inputs and never claims database cleanup. Neither
path loads the normal production input, guarded roles, endpoint identities, or signing/key-registration inputs. Seed validation recursively rejects endpoint
identity case variants and future hashes; max-one materialization writes the four guarded endpoint
secret files and rebinds all 22 secret hashes. Repaired source `7444ed0` is the prior provider-free
audited baseline; source `3f7b588` passed its independent audit before the later Cloudflare boundary
finding. The replacement proposal
`sha256:45894ac0…01aaca` was resealed against the prior source; its fresh authority `59dfe8a` is
superseded unconsumed with no mutation after the Cloudflare boundary audit. The active successor draft
`2026-08-27-cloudflare-credential-origin-repair-candidate` is `PASS_BLOCKED_UNSEALED`
(`sha256:6b20b507…ed01d6`). Its protected Google OAuth and R2 credential identities and scope hashes
are receipt-bound and verified; the receipt is complete and non-reusable. The repaired source still
requires a fresh independent source audit, reseal, proposal-record audit, and exact approval.
It requires protected Wrangler OAuth only (no raw API-token file or `CLOUDFLARE_API_TOKEN` export),
authenticated account and workers.dev subdomain derivation, exact absent HTTP 404
`text/html; charset=UTF-8` body of 19,984 bytes with `sha256:2000e6b2…580976` before creation (not
503 JSON), then HTTP 200 `DISABLED_UNQUALIFIED` and `QUALIFIED_EXACT` reads. No fresh approval or
executable authority exists. Both lanes require fresh
immutable images, sealed deployment snapshots, dual live qualification, and that new single-use
approval.
Provider/deployment/credential/GPU/spend authority remains false with a `$0` executable cap, and no
provider call or spend is authorized.

Commit `417ab1c` activates only the exact approved provider-free SoulX full/split renderer profile,
including the source-background feathered overlay and split-only path. Commit `09c3cde` adds an
independently audited, default-no-op activation executor that requires a clean pinned release,
fresh database roles, ledger prefix 36, disabled Cloudflare quarantine, and a closed secret seam.
Neither commit supplies live qualification, credentials, deployment authority, or spend authority.

Attempt64 is closed `NOT_QUALIFIED`. Deadline-mode admission and the immediate pre-RunPod recheck
passed; the one-unit probe and three subsequent jobs produced 96 durable accepted units. Endpoint
rotation succeeded with distinct endpoint and signed Pod identities. Cancellation reached
`CANCELLED` with output cleanup confirmed, then the bounded runner stopped at
`RUNPOD_ZERO_NOT_CONFIRMED` before timeout and max-two proof. Exact cleanup deleted the replacement
endpoint/template. Three stable reads prove zero pods, endpoints, templates, workers, or running
compute; both exact 50 GB EU-RO-1 volumes remain under the approved `$7/month` retention. Billing
was stable at `2.095889555552276`, a `$0` observed increment within the `$4.50` cap. The signer is
absent, protected config is restored mode `0600`, and three route reads prove version-bound
`404 V207_ROUTE_DISABLED` on refreshed anchor `sha256:1e5d35b4…86e19` / record
`sha256:54cd4dcb…34c89`. Exact authority `sha256:503e07b9…492c2` is consumed and executable
authority/cap/refresh are null. Provider-free repair `1283a23` bounded-polls the first post-cancel
health zero and still requires a separate second exact zero before settling liability; an independent
audit found no P0/P1 and full web tests passed `713` with one skipped. Any new provider work requires
fresh admission truth and a fresh exact proposal/approval/cap. V2-08 live activation remains
forbidden; provider-free product implementation is active under `DEC_DELIVERY_002`.

Attempt63 is closed `NOT_QUALIFIED`. Exact proposal `sha256:83a54dbd…e532` ran once under
pre-execution authority `sha256:16378035…a798` and the `$4.50` cap. Two-phase anchor refresh and
signer activation succeeded, but fresh live admission stopped at
`V207_CATALOG_RTX4090_EU_RO_1_UNAVAILABLE` before any RunPod template, endpoint, endpoint rotation,
job, GPU use, or accepted unit. Cleanup deleted the signer, rolled back to refreshed disabled anchor
`sha256:f6aa5261…c643`, restored protected config mode `0600`, and proved three version-bound disabled
route reads. Three stable RunPod reads prove zero compute/disposables and both retained volumes.
Billing advanced `$0.04712827783077955`, recorded as unattributed late provider billing because
Attempt63 performed zero RunPod mutation/job. Closure `sha256:b2da7105…d13`, orchestration
`sha256:573119d1…017f`, and reconciliation `sha256:a71c1d4d…a5fe` are durable. Authority is
consumed/non-reusable; provider work stops, any future attempt needs refreshed capacity/anchor truth
and a fresh exact proposal/approval/cap, and V2-08 remains forbidden.

Before execution, Attempt63 was the provider-free endpoint-rotation candidate. Attempt62
failed correctly because terminal scale-zero proved inactivity but did not destroy the FlashBoot
seed endpoint process; the same endpoint reactivated the same signed Pod. Repair
`3f3bed48e69f149cf56ee6aa6c42cabb70528db4` now deletes only the drained seed endpoint after its
signed terminal boundary, proves two stable zero-resource reads, reserves the additional endpoint
initialization liability, creates and binds one fresh max-one FlashBoot endpoint, and issues exactly
one replacement request while preserving the strict distinct signed-Pod gate. Anchor rebind
`9c9ca3476c976592ae73414e6a1e53cc0fcbb643` pins the current clean Worker anchor. Combined
harness/live tests pass `142/142`, orchestrator tests `56/56`, activation tests `23/23`, and
TypeScript passes. Fresh read-only truth through `2026-08-25T09:17:57Z` proves zero RunPod compute
or disposables, both exact retained 50 GB volumes, LOW RTX4090 EU-RO-1 availability, unchanged
rates, cumulative billing `2.0487612777214963`, absent signer, protected config, and the exact
version-bound disabled route. Exact proposal
`sha256:83a54dbd5d4810a83fa100eaf5014af255097ae2eb7c6264deccf209d5a3e532` has a `$4.25`
finite-action estimate ceiling and requests a fresh `$4.50` maximum cumulative finite cap with
FlashBoot=true, LOW-or-better EU-RO-1, `two-phase-v1`, and continued `$7/month` volume retention.
No provider mutation, job, GPU use, or spend occurred during that repair phase. The later exact
authority was consumed by the clean capacity stop recorded above; do not retry or start V2-08.

Attempt62 is closed `NOT_QUALIFIED`. Proposal
`sha256:2fb475cca07fa9f76a0d6f724726d6d15a5214bea47931c1463dcfd14ef1f1d0` requests a fresh `$4`
finite cap, FlashBoot=true, LOW-or-better EU-RO-1, `two-phase-v1`, and continued `$7/month` volume
retention. Fresh read-only truth through `2026-08-25T07:15:13.105Z` proves zero RunPod compute or
disposables, both retained 50 GB volumes, LOW RTX 4090 availability, unchanged `$1.10/GPU-hour`
Flex and `$0.74/hour` Secure reference rates, cumulative billing `1.9971928337181453`, the exact
retained Cloudflare anchor, absent signer, protected config mode `0600`, three exact active-version-
bound POST `404 V207_ROUTE_DISABLED` reads, and sufficient local disk. Repair `3921f6b` records only
bounded redacted predicates when replacement identity is rejected; it does not relax distinct-Pod
acceptance or add redispatch. Anchor rebind `0b4b2d5` pins the refreshed clean Worker anchor.
Authority `sha256:73b81ef8e91c179d53046afabfe3801abdcfdfddea065860ccf084c71443d0cf`
ran once. The probe completed with one durable output/readback/receipt; the 31-unit replacement job
completed but its signed worker and Pod hashes both equalled the seed identity, so execution stopped
at `RUNPOD_PROCESS_REPLACEMENT_IDENTITY_NOT_DISTINCT` without redispatch or later batches. Cleanup
deleted the disposable endpoint/template and signer, restored the refreshed exact version-bound
disabled route and protected config, and independent three-read reconciliation proves zero compute/
disposables, both volumes retained, and `$0` observed increment subject to billing lag. Closure is
`failed-attempt-62.json`; authority is consumed/non-reusable, provider-free diagnosis only, and
V2-08 remains forbidden.

Attempt60 is closed `NOT_QUALIFIED`. Its exact single-use execution failed closed at
`V207_LOCAL_DISK_HEADROOM_INSUFFICIENT`: only `283267072` bytes were available against the exact
`2147483648`-byte minimum. The check occurred before orchestration-evidence initialization and
before any Cloudflare or RunPod mutation. The authority is consumed/non-reusable; executable
authority, cap, and anchor refresh are null. Three stable reconciliation reads prove zero compute
or disposable resources, both retained volumes unchanged, and `$0` observed incremental spend at
cumulative billing `1.9971928337181453`. Closure is `failed-attempt-60.json`; reconciliation is
`attempt60-reconciliation-observation.json`. Per the checkpoint timebox, stop on this unrelated
second problem: free local disk provider-free, then require a wholly fresh proposal/approval.
Do not retry Attempt60 and do not start V2-08.

Attempt59 is closed `NOT_QUALIFIED`; its exact single-use authority is consumed and non-reusable.
The first pre-mutation route read was exact version-bound `404 V207_ROUTE_DISABLED`, then a later
stability probe failed as `V207_ROLLBACK_ANCHOR_REFRESH_PRE_ROUTE_UNCONFIRMED`. No Worker or RunPod
mutation, job, GPU use, output, receipt, or observed incremental spend occurred. The protected
config marker reverted to the exact mode-0600 baseline, and three stable RunPod reads prove zero
compute/disposables plus both volumes. Repair `42a5a52` resets only bounded transport gaps and
requires a fresh full 16-match window inside 120 seconds; malformed/status/version mismatches still
fail immediately. Closure is `failed-attempt-59.json`; V2-08 remains forbidden.

Attempt58 is closed `NOT_QUALIFIED`. It completed the probe, 31-unit replacement resume, cold, and
warm batches with 96 durable outputs/receipts/readbacks, proved duplicate same-job delivery, and
confirmed cancellation. It then failed closed before timeout/readers at post-cancel scale-down with
`RUNPOD_QUIESCENT_NOT_CONFIRMED`: `/health` retained multiple stale FlashBoot counters while exact
inventory showed only terminal workers/Pods. Exact cleanup and three stable reconciliation reads
prove zero Pods/endpoints/templates/workers/running Pods, both 50 GB EU-RO-1 volumes unchanged,
`$0` observed incremental spend against the historical `$4` cap, signer absence, restored config,
and version-bound `404 V207_ROUTE_DISABLED`. Closure is `failed-attempt-58.json`; cleanup is
`attempt58-cleanup-observation.json`; reconciliation is `attempt58-reconciliation-observation.json`.
Authority is consumed/non-reusable and executable authority/cap/refresh are null.

Provider-free repair `8bb6583012569e595630deb3d7fe104a923dcc58` allows only the existing
queue-bracketed, two-identical-snapshot exact terminal-inventory fallback after post-cancel drain
when owned jobs are zero. It preserves cancellation liability fencing and no-redispatch behavior;
114 focused tests and TypeScript pass. Any future live attempt needs a fresh exact proposal,
approval, cap, anchor rebind, and provider truth. V2-08 remains forbidden.

Attempt57 is closed `NOT_QUALIFIED` and its exact single-use authority/cap are consumed and
non-reusable. The run accepted one durable probe unit, then failed during replacement output
readback with `MAGE_OUTPUT_NOT_SUCCEEDED`; no full V2-07 qualification claim is made. Closure is
`failed-attempt-57.json` (`sha256:6847f2c4f596705910c33d26581fab3b2c2c3ce5f9bb6d4e0a9c8103df052135`),
cleanup is `attempt57-cleanup-observation.json`
(`sha256:af01054a4b0c16fe43f4ace6a9036763e20966ac20842fb6d40210029421eae0`), and three-read
reconciliation is `attempt57-reconciliation-observation.json`
(`sha256:5895fe18b8143282e397d372b30fa56028f5003bc2ce258b5ef61cce2d1db8c6`).

The approved proposal was
`sha256:f28c0ceb4c39ce7c74c1a63d918c00acb078e8cb8c63d0728e00f9d4d2126cd4`; its authority record
was `sha256:7ab262a878e0447002f417ea3af49ffa376cea307296ea8d24681ff8492bc015`. Attempt57 used
FlashBoot=true, LOW-or-better EU-RO-1, `two-phase-v1`, and the fresh `$4` maximum cumulative
finite cap. Executable authority, cap, and anchor refresh are now null. Observed incremental
spend is `$0` within the historical cap, both exact 50 GB EU-RO-1 volumes remain retained at
`$7/month`, the signer/config/disabled route were restored, and final RunPod reconciliation proves
zero Pods, endpoints, templates, workers, and running Pods. V2-07 remains `NOT_QUALIFIED`; V2-08
is forbidden. Stop provider work; any future V2-07 attempt requires a provider-free diagnosis,
fresh exact proposal/approval/cap, and refreshed provider truth.

Attempt57 lineage is anchor rebind `2202c11f5587ddf1e61e03677401a67561f879f2`, queue-poll repair
`c2086e1a4d0f54adf50848fe5b0ddf9f75962b03`, orchestrator
`sha256:ed2b9f4edb3cac623055cbf14998c51aeba0b27d6d496c6a74e9cc302997bf62`, qualification
`sha256:afa9567e922f19256a47137336c6d573ec1be2e8765648812aa6d3fa96123fe1`, and harness
`sha256:3c5f6207eead02fc197bec3ec3b85d7dc31052d25c1ea694efba7326a92ac512`.

Provider-free repair `61919013c74f71995cf1631ce6ac56e633708dce` now classifies generated-output
port GET transport as `V207_OUTPUT_PORT_GET_TRANSPORT`, malformed/non-object responses as
`V207_OUTPUT_PORT_GET_RESPONSE_INVALID`, and signed artifact fetch/body-read transport as
`MAGE_OUTPUT_READBACK_TRANSPORT` while preserving `MAGE_OUTPUT_READBACK_FAILED` for non-2xx.
GET authority requests remain one-attempt and no response body, URL, header, nonce, or error cause
is retained. Diagnosis `sha256:87dcfe9b…2a2217`, 39/39 focused tests, TypeScript, and the separate
repair validator pass. This is provider-free evidence only: Attempt57 remains non-reusable,
authority/cap remain null, V2-07 is `NOT_QUALIFIED`, and V2-08 is forbidden.

Attempt56 is closed `NOT_QUALIFIED`. Its single-use authority is consumed and non-reusable after one
job remained `IN_QUEUE` for 34 status reads and was cancelled with no accepted batch, output, receipt,
execution time, or GPU use.
Repair commit `5c2fbe06ba559543c122876d32ef41cb26fd688b` binds the orchestrator constants, both staged
configs, proposal, and validator gate to the same fresh Cloudflare anchors. Proposal
`sha256:d3c10f7af00591dea0afe73d2960b316a788235bb2585decab6ca479b4ce9ab9`, acceptance
`sha256:3ddaf8f9fde45f93de0a9c4a770a09bc117168ff27dbd2ec312e7516cf9c094d`, preflight
`sha256:4a1f95ee496afabedc33ca148bee8543010600ea302966f4b66b8b23c2425373`, max1
`sha256:6bba5f707e19352b2935129429665f1a488f241065c9c84fe814a2f8677dae7a`, and max2
`sha256:19d4824c205b5c3c17edc351d7762578b249caee497d60ec4d8ff762fd41b37b` are provider-free evidence.

Terminal truth through `2026-08-24T16:43:56.268Z` is three stable reads with zero RunPod compute or
disposable resources and both retained volumes. Cumulative billing is `1.7478178361488972`, with `$0`
observed Attempt56 increment subject to provider lag. The signer is absent, protected config is
restored, and the refreshed exact route is POST `404 V207_ROUTE_DISABLED`.

Attempt56 closed authority is recorded at
`evidence/acceptance/VF-10-07/2026-08-24-attempt56-anchor-constant-rebind-candidate/approved-authority.json`
at `sha256:6a82d8ae…de5ac`; the approved pre-execution hash was `sha256:c708d07d…7bdf2`.
Executable authority/cap/anchor refresh are null. Closure `sha256:9465f6a1…731dd`, cleanup
`sha256:b7ded646…5bfc8`, and reconciliation `sha256:e1d71ed3…fd3d` prove the clean terminal state.
Both existing volumes remain retained at `$7/month`; V2-07 remains `NOT_QUALIFIED`; V2-08 is
forbidden. Provider-free diagnosis `sha256:247c8c6b…f922` proves Attempt56 stopped after 34 of 180
allowed reads, so the reconciliation timeout was not reached; the exact immediate exception and
provider-capacity root cause remain unproven. Repair `c2086e1` adds bounded billing-read retry and
explicit billing/checkpoint failure codes without redispatch or provider-policy changes; 129/129
focused tests and TypeScript passed. Attempt56 cannot be retried; Attempt57 is now also consumed
and closed as `NOT_QUALIFIED`; stop provider work and do not start V2-08.

Attempt55 remains closed and non-reusable at `V207_EXECUTABLE_ANCHOR_LINEAGE_MISMATCH`; preserve its
consumed authority and cap as immutable history and do not retry it.

Attempt52 is closed before mutation at `V207_ROLLBACK_ANCHOR_REFRESH_OLD_ANCHOR_MISMATCH`; its
authority is consumed and non-reusable. Closure `sha256:267918ea…8dec0` and reconciliation
`sha256:83dbb079…32876` prove zero disposable resources, both volumes retained, restored config,
unchanged billing, and no job, GPU use, output, or observed spend.

Attempt51 remains closed `NOT_QUALIFIED`. Its consumed/non-reusable authority produced one durable
1280×720 probe before the former exact-one-total-record gate failed. Closure `sha256:c2ac52ad…eab02a`
proves exact cleanup, restored route/config, zero compute/disposable resources across three stable
reads, both 50 GB volumes retained, and `$0` observed billing increment.

Terminal read-only truth at `2026-08-24T11:13:48.804Z` proves zero Pods/endpoints/private
templates/workers, both retained volumes, current cumulative endpoint billing `1.645446196460398`,
restored protected config, deleted signer, and exact POST `404 V207_ROUTE_DISABLED`.

Attempt50 is closed after one durable probe failed the former cross-namespace identity check. Its
proposal/authority are consumed and non-reusable. Cleanup and three stable reads prove restored
route/config, zero disposable resources/workers, both retained volumes, and `$0` observed increment.

V2-00 through V2-06 are complete and must not be rebuilt. The remaining fast sequence is V2-07
through V2-13 in `22_PROJECT_COMPLETION_CHECKPOINTS.md`; copy-ready implementation/audit prompts are
in `templates/CHECKPOINT_CHAT_PROMPTS.md`. Production is tenant-private and autoscaling-only: one
durable account/default-workspace-owned tenant state, one active provider workload/account, two different
accounts globally, two queue-based RunPod Serverless lanes, `workersMin=0`, and no manual Pod/GPU
lifecycle. Word-level transcript, voiceover splitting, the three-composition scheduler, and the
personal-worker renderer are completed foundations to integrate, not reimplement.

Use focused tests for changed surfaces and one narrow repair cycle. Canonical provider-free
verification runs at V2-09 and V2-13 unless a shared contract/runtime change needs it earlier.
Tenant isolation, authority/caps, artifact lineage, volume integrity, and zero-worker drain remain
mandatory. No current provider authority or cap exists. Do not retry Attempt56 or start V2-08.

## Historical V2-07 attempt ledger — do not preload

The records below remain for exact evidence/validator compatibility. Read only an exact referenced
attempt when a current failure or audit pointer requires it.

Attempt47 is closed fail-closed as `NOT_QUALIFIED`. Proposal
`sha256:e0e0e62014a770678485d780dbb2c852ae7e1786162fc58594f6d08afaa0ee53` and acceptance
`sha256:be3f2c5bca77f90a2470f4e2f165f47b2811501a6cc9febee911edeb24b758e6` bind repair `1d39b71`,
the unique exact terminal-Pod identity fallback, Attempt46 closure, the unchanged immutable image,
and unchanged max-one/max-two configs. Authority `sha256:aae6dfd8a282333a8a5caa3149e520e58a858c93b0730e4529d599f7d078a254`
and its `$4` cap were consumed when preflight stopped before mutation at
`V207_WORKER_ROLLBACK_ANCHOR_NOT_RETAINED`. Closure `failed-attempt-47.json` is
`sha256:6f3204b9eee5a10eaa64f4f80fa3bd7fa6cf16e3fc2dc0eda2e6d2a63de08472`; three stable reads prove
zero disposable resources, both volumes retained, and `$0` incremental spend. No authority/cap remains; V2-08 forbidden.

Attempt48 is closed fail-closed as `NOT_QUALIFIED`. Proposal
`sha256:6ac58b154cd6d91b72f591128f5f9ed94af8ae3ad969bfce278c05d31f1c11c8` and authority
`sha256:1c2166d74fdb0a35271b50709720bd80fbbef7442dc28d35c16c534dc43760fa` were consumed when
preflight stopped before mutation at `V207_WORKER_ROLLBACK_ANCHOR_NOT_RETAINED`. Closure
`sha256:c0fee47e5cc93adf06decaf8ca993f4040709069f1508fded890d57a76e86d92` proves zero disposable
resources, both volumes retained, restored protected config, and `$0` incremental spend. No authority/cap remains.

Attempt46 is closed fail-closed as `NOT_QUALIFIED`. Proposal
`sha256:653c44ceeb3aa3948dade2f7b2d0c68904152aeee66392f826b3b1ffd7b9c259` and authority
`sha256:86b5810de7fb360182c5ade95d2d0f4349cb76175cc41b4e10923e78262f5588` were consumed once with
FlashBoot=true, LOW-or-better EU-RO-1, and `$4`. One owned probe completed with one durable output,
replay-confirmed artifact receipt, signed v3 receipt, and 14,177,206,272-byte peak VRAM. Execution
stopped before the cold batch at `RUNPOD_PROCESS_REPLACEMENT_WORKER_IDENTITY_UNAVAILABLE`.

Closure `failed-attempt-46.json` is `sha256:e333bc34e7fbc72bf123e32ce65d28ee8a85da4e6b3542db929a4e63a520e8d2`.
Narrow cleanup deleted only the disposable endpoint/template after two stable terminal snapshots;
signer deletion, Worker rollback, `404 V207_ROUTE_DISABLED`, protected config, both retained volumes,
zero disposable resources, three stable reads, and unchanged billing `1.6217972798040137` passed.
No authority/cap remains. Provider-free harness diagnosis only; V2-08 is forbidden.

Attempt45 is closed fail-closed as `NOT_QUALIFIED`. Exact proposal
`sha256:a2f336fe5bb0291ef436699d60a0f6885948c4a5cf52d724a184caa917718770` and single-use authority
`sha256:e73bd7ecdf22db25bfebbb260364c580831ce949e7338bb133bf4def1b2b6b67` were used once with
FlashBoot=true, LOW-or-better EU-RO-1, and a fresh `$4` cap. The bounded run stopped before RunPod
calls, endpoint/template creation, job submission, GPU use, or output at
`V207_SIGNER_DISABLED_DEPLOY_FAILED`; redacted orchestrator evidence is
`sha256:e03a47850af3fc452fced31f45d5c62485e5a595e0b632e7dfce5fa12984c42a`. The signer secret was
never activated, the captured Worker version was rolled back, and the route returned to
`404 V207_ROUTE_DISABLED`.

Closure `failed-attempt-45.json` is `sha256:f287a7ec8ea064587e251f5ccb9b5321025d37976fdbf40b0b894a962c71167c`;
cleanup `attempt45-cleanup-observation.json` is `sha256:d23b169a2920e27b25e691e04758fbe123d3f41f3f1eb618940f998bc89d2f55`;
three stable reconciliation reads are `attempt45-reconciliation-observation.json`
`sha256:e786ee74546632ed38aeef5acf3860605693cd7255a4a19ba44d99ca91b82c2d`. They prove zero
disposable compute/resources, both exact retained 50 GB EU-RO-1 volumes, protected config mode 0600
and unchanged hash, and no model-volume mutation. Billing moved from `1.5903418626403436` to
`1.6217972798040137`; the `0.03145541716367006` delta is unattributed late provider billing, not
Attempt45 GPU spend; no Attempt45 jobs were submitted. The independent canonical-hash finding was
not the live deploy-failure cause; provider-free repairs `f945392` and `7066520` are recorded.
No authority or cap remains. V2-07 is still `NOT_QUALIFIED`, provider-free diagnosis only, and V2-08
is forbidden.

Attempt43 is closed fail-closed as `NOT_QUALIFIED`. Exact proposal
`sha256:05e8aa382b135101990edbe155e75ac89b51f75779d81de500bb75b693207458` and single-use authority
`sha256:e5c268b63583d28c18a3999ef9880f425d54e9bf50f759e376dbcd0f2b40a07b` were consumed once with
FlashBoot=true, LOW-or-better EU-RO-1, and a fresh `$4` cap. One owned job reached provider `COMPLETED`,
but output finalization failed with `V207_OUTPUT_PORT_400` before any accepted batch, durable readback, or
v3 receipt; generated output rollback was confirmed. Closure is
`failed-attempt-43.json` (`sha256:1699d5429b12a5573b10be5b325a780f5a1c7d484b960fdb0758e64381391494`).
Follow-up cleanup (`attempt43-cleanup-observation.json`, `sha256:59caf2f398a6146e177d2f6dd34f8fa82848a97261cdf752d1a8cd03729fe260`)
and three stable reconciliation reads (`attempt43-reconciliation-observation.json`,
`sha256:e9fe4d7547b2ddc38a3766d22044b414037d09dd5426ab4a9816aea18336da6a`; settled source
`sha256:805be262eddfe9597ff5aa1c0732cdc31d502fdb6312d815c4226ef413058c7c`) prove zero disposable
Pods/endpoints/templates/workers, both exact retained 50 GB EU-RO-1 volumes, stable POST `404
V207_ROUTE_DISABLED`, baseline config `sha256:085c49cad14e5e3b339f34065075f311a795c311d474c2355b6477f75c860175`
mode 0600, and `$0` incremental spend. No authority, cap, provider call, GPU use, or mutation remains;
provider-free diagnosis only. V2-08 is forbidden.

Attempt42 is closed `NOT_QUALIFIED` before provider mutation. Exact proposal
`sha256:1b3a75d67ff6ebff875e0ffb42e11d0bb0544c566670847f7748755c490681de` and authority
`sha256:ea0c638e8e68c48538954717aaa2eb49695ee702e2c98d000e9190e36aa54b53` were approved once with
FlashBoot=true, LOW-or-better EU-RO-1, and a fresh maximum cumulative finite spend of `$4`; both are now
consumed/non-reusable. The orchestrator stopped at `V207_WORKER_ROLLBACK_ANCHOR_NOT_RETAINED` before build,
deploy, signer, route probe, endpoint/template creation, RunPod job, GPU use, mutation, or spend. Its redacted
evidence is `sha256:25afc6caf005c54b98de89e1db026e869d0159d11b055a12d498c624c0cc63150e`. The bounded versions
read had ten entries (163–172, oldest-to-newest); active index 0 was outside the newest-seven safety window.
No model/image hash check is claimed for this attempt. Three stable read-only reconciliation reads at
`2026-08-23T07:23:34.925Z` prove zero disposable compute/resources, both exact retained volumes, and unchanged
cumulative billing `1.5709891965379938` (`$0` Attempt42 increment). Closure, cleanup, and reconciliation are
`failed-attempt-42.json` (`sha256:ca9d1ba45cdaf028acc92f07bfe278b7ae6c4bf2cf182dae0e4ed51696435dbc`),
`attempt42-cleanup-observation.json` (`sha256:4d30c80b9ba2d42916c358a0768ddca71b876d8b1225d5223114152065550f81`),
and `attempt42-reconciliation-observation.json` (`sha256:a73ffbf9fe0960d94027970f4036599f080d02e0b32359eeeabedd6bb266beac`).
Provider-free diagnosis only; no authority/cap remains, and V2-08 is forbidden.

Attempt41 is closed `NOT_QUALIFIED`. One exact RTX 4090 job reached provider `COMPLETED`/output `SUCCEEDED`,
then failed `MAGE_OUTPUT_READBACK_AUTHORITY_INVALID` before any output/readback/v3 receipt was accepted. Closure
`failed-attempt-41.json` is `sha256:ecfc252b04cc8daa9c4ee85fb5991d7e8874d6cf2fcfd5321d99abf343731187`;
cleanup is `sha256:caaf90bc41ad65ecb8407c280f125e3317e86e386299220a317b5028f5bcab54`;
reconciliation is `sha256:2d86e63bdaa5029cc6f13495d68a38d7603c49e4830a614e466e971dd706d61e`.
Exact endpoint/template deletion, zero final compute/resources, both retained 50 GB EU-RO-1 volumes, Cloudflare
rollback to `404 V207_ROUTE_DISABLED`, and a late-settled `$0.046342222136445343` increment within cap are proven.
Post-run sealed-manifest/hash comparison was not reached, so unchanged model bytes are not claimed; retained
volume identity and no observed writes/mutation are recorded. Authority `sha256:2aec5d48…291f9d` and its `$4` cap
are consumed. Provider-free commit `78062a729fd2e321fbe3b71dc9e7e57b5c8b3fe6` repairs the deterministic
hosted GET `artifact-transfer-port/v3` authority mismatch with 249/249 relevant tests passing. No fresh provider
authority or cap exists; live requalification remains pending and V2-08 is forbidden.

Attempt40 is closed fail-closed for V2-07. It repaired the exact Attempt39 output-lineage failure by adding `item_id = scene_id` at the Mage worker boundary, and its immutable image published exactly, but the bounded Cloudflare runner stopped at `V207_LIVE_RUNNER_FAILED` before any RunPod job dispatch. The source repair is `a7b7a937d08dc9032b8922cca71c602195f3094c`; the image-pinning/control commit is `b811cdfd677775558aa79452a4930b50a07b7b1a`.

Attempt40 proposal
`evidence/acceptance/VF-10-07/2026-08-23-attempt40-item-lineage-candidate/combined-live-proposal.json`
is `sha256:56cd650b61a56fb17a9abd602839992990d3a985a952eafc30afa60e82e02ae8`; approved candidate
acceptance is `sha256:def791c571e6266a85486982a95ad139e7baa52a2d646a178df1c7ad0939c645`; append-only
authority is `sha256:5691eb5bb3a9009fd1a010c74b7c04bc47d15c0ce580ff47f6183c105a563736`; max-one/max-two
are `sha256:391dd6b208b4b6c2e045058295f03e47937da7f9361b6bf27e7b225dbb51432e` /
`sha256:fee8426ec819aa4e742fd9e36e0e16113786fd773f66e9e46f29104b78ed044e`. It binds the exact
Mage model and manifest, existing sealed Mage-only 50 GB `EU-RO-1` volume at `/runpod-volume`, RTX
4090/Flex/FlashBoot, and new immutable image
`ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59`.
Fresh read-only preflight at `2026-08-23T02:42:00.951Z` observed HIGH availability, zero disposable
compute/resources, both retained volumes, `$1.10/GPU-hour` Serverless Flex, `$0.74/hour` secure-Pod
reference, and `$7/month` existing two-volume charge separately. The finite estimate is `$3.70`.
The user approved this exact proposal with FlashBoot=true, LOW-or-better EU-RO-1 availability, and a
fresh maximum cumulative finite spend of `$4`. Publication workflow `32615737298` read back the exact
manifest/config/layer digests. The append-only authority `approved-authority.json` is
`sha256:5691eb5bb3a9009fd1a010c74b7c04bc47d15c0ce580ff47f6183c105a563736`; it is consumed and
non-reusable. Closure `failed-attempt-40.json` is `sha256:a80a70ece72d4ff08eccfa210257e267b41a2f924f061ec8740d589edd22d32b`, cleanup is
`sha256:30daf998cf53eb2a476b44a907e2d6de6da9d73f4397a50840abae731cdd5398`, reconciliation is
`sha256:4bddde16156ba76d48449265583e417309fded6c2a6f99de35825c6813927fbb`, and publication is
`sha256:c4e0363b3b37cb0bc0bb0678ce174085669cfe77a504f2af9fdf5c338814cdb7`. Exact Worker rollback
restored `404 V207_ROUTE_DISABLED`; three stable RunPod reads prove zero disposable resources, both
retained volumes, and `$0` incremental spend. V2-07 remains `NOT_QUALIFIED`; provider-free diagnosis
only; V2-08 remains forbidden.

Attempt40 closure pointers: `failed-attempt-40.json`, `attempt40-image-publication.json`,
`attempt40-cleanup-observation.json`, and `attempt40-reconciliation-observation.json`; result
`NOT_QUALIFIED_LIVE_RUNNER_FAILED_CLEAN`, no provider authority/cap remains, and no RunPod job was
dispatched.

Attempt39 is now closed fail-closed as `NOT_QUALIFIED`. It used the exact approved, single-use candidate after Attempt38 closed `NOT_QUALIFIED`. It binds
the already-published immutable Mage image
`ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:d37242d8413b1a5e52c2434b0ff12a04093ec5fdfacaed72faeb86fa2cbc67f2`,
the existing sealed Mage-only 50 GB `EU-RO-1` volume at `/runpod-volume`, and control repair
`5aa2ccae639052fb61312a3b5a830402c275a2f8`. The repair treats the user cap as a fresh incremental
allowance over the cumulative billing baseline and fails closed on downward/invalid reads; it also
requires the exact pre-mutation Cloudflare Worker version record to remain in Wrangler's newest
seven of at most ten versions before any Worker or signer mutation, then verifies the exact record
hash and route fingerprint after rollback. The exact captured Worker version record and route were
restored to `404 V207_ROUTE_DISABLED`; provider mutation/GPU authority is now consumed and closed.

Attempt39 proposal
`evidence/acceptance/VF-10-07/2026-08-23-attempt39-fresh-cap-rollback-retention-candidate/combined-live-proposal.json`
is `sha256:11203e32aff804dd9f31c674cd3411c8a0efb2cdca7057e891543f30377f5e57`; the user approved it
with FlashBoot=true, LOW-or-better EU-RO-1 availability, and a fresh maximum cumulative finite
spend of `$4`. Append-only authority `approved-authority.json` is
`sha256:a9d68f4125f58429699fe52e90ae238b72f0835b4627f9246be86b10e759352b`; it is consumed and
non-reusable. One provider job reached `COMPLETED`/`SUCCEEDED` but failed `MAGE_OUTPUT_LINEAGE_INVALID`
at `output_lineage`; no output/readback/v3 receipt was accepted. Closure
`failed-attempt-39.json` is `sha256:66f067c2789c5f1a725e764ea23b07a741fee90565ac87a5e0d5f3e8522f4e12`,
cleanup is `sha256:4dde8efb506f6cbceaaf7e8b66193eda251200ff872373664ee1e14b3ba70a68`, and reconciliation
is `sha256:21cc221887ca44324948983e1ad4c001760cde7a9646b4faadfab7d15a2eb813`. Generated-output
rollback, exact Cloudflare rollback, zero final disposable RunPod resources, both retained volumes,
and `$0` incremental spend passed. V2-07 remains `NOT_QUALIFIED`; provider-free diagnosis only;
retained-volume mutation, fallback GPU/region, and V2-08 remain forbidden.

Current closure pointers: `failed-attempt-39.json`, `attempt39-cleanup-observation.json`, and
`attempt39-reconciliation-observation.json`; result `NOT_QUALIFIED` and no provider authority/cap
remain.

Attempt38 is closed `NOT_QUALIFIED` after bounded execution stopped at `initialized` on cap arithmetic
risk. Runtime/image repair `edb18154759a1c4da9f28789fe5f4c4ab74a92ed` binds the full immutable
32-unit plan to one `scene-01` seed, terminal scale-zero plus distinct worker/pod identity, and one
replacement that executes only `scene-02` through `scene-32`; accepted work cannot be regenerated.
The deterministic multi-file overlay includes the repaired handler and timing-provenance schema and
derives immutable image
`ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:d37242d8413b1a5e52c2434b0ff12a04093ec5fdfacaed72faeb86fa2cbc67f2`.
Exact proposal
`evidence/acceptance/VF-10-07/2026-08-23-attempt38-durable-replacement-candidate/combined-live-proposal.json`
is `sha256:8613f60fb65a3d7c254daeb42901b217d392566bef11dfaa864d7cbbe000378c`;
max-one/max-two are `sha256:a61c41148a80e9371934c1eaf7fdee76ab821cbbe6cff371a55dcfbd70493436`
and `sha256:13f17498808fd6062b0dbac187eaa82d836580b673d9e666cc3dae0a64480f01`.
The exact image was published/read back by workflow `32609238298`, but no GPU job was submitted.
Final read-only truth at `2026-08-23T01:13:26.598Z` proves zero disposable compute/resources across
three stable reads, both exact retained 50 GB EU-RO-1 volumes, and zero Attempt38 incremental spend.
Current rates are `$1.10/GPU-hour` Serverless Flex and `$0.74/hour` secure-Pod reference; the finite
estimate was `$3.70`, while the two existing volumes remain `$7/month` separately. Exact append-only
authority `approved-authority.json` is `sha256:1933bf186c235089c13edfee0e68a28b2fa0ab2ebc89a25f81bb59a7eedd92b6`
and is consumed/non-reusable. Closure
`failed-attempt-38.json` is `sha256:ab89f5f143c2f424c811a149e96ed0020b0095ce3399c5bbe33e64bb771a1a07`;
cleanup is `sha256:52d73dcbd15ca96e713306bf95877b1d2873025b934bab14306dae6011988ca4` and reconciliation is
`sha256:a9d6b96952892a33460e1aa592bbc97c8d6c3aad0d0580dda0f829d843788e10`. Cloudflare route rollback
remains uncertain (`503 HOSTED_ROUTE_NOT_COMPOSED` instead of captured `404 V207_ROUTE_DISABLED`).
Provider-free diagnosis only; retained-volume mutation, fallback GPU/region, and V2-08 remain forbidden.
Repository HEAD is now provider-free repair `5aa2ccae639052fb61312a3b5a830402c275a2f8`; the published image remains bound to the earlier Attempt38 source lineage.

Attempt37 is closed NOT_QUALIFIED. A prequalification safety audit exposed two P1 gaps in the
already-published immutable handler: no durable accepted-unit resume across process replacement, and
`allocation_ms` / `container_ready_ms` were hardcoded to zero. The live orchestration reached
preflight and began the runner before an outer-launcher interrupt; no accepted batch or terminal live
result was recorded. Closure
`evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-37.json` is
`sha256:0a3d9f62f656a7e069f88335cfe09ad5ce94010b7fb2a85b514fb79d38775318`; cleanup
`attempt37-cleanup-observation.json` is
`sha256:af1c8d3c1c1f8808c5cb94dda49c09c521b3f853c4560e28365af4a078617054`.
RunPod cleanup proves zero disposable resources, both exact 50 GB EU-RO-1 volumes retained, and
three stable billing reads from `$1.3100463044829667` to `$1.5246469744015485` (`$0.21460066991858184`
increment within the consumed `$4` cap). The signer is deleted and the captured Worker version hash
is active, but the route returns `503 HOSTED_ROUTE_NOT_COMPOSED` instead of the captured
`404 V207_ROUTE_DISABLED`, so cleanup remains uncertain. Provider-free handler repair and route
reconciliation only; any new publication or paid retry requires a separately hashed proposal and
fresh authority. V2-08 is forbidden.

Historical Attempt37 candidate repair `6632c4508a1f4127491a598d52157dece41a0560`
adds one bounded status-only recovery after the ordinary two-reader reconciliation timeout. It
accepts only the exact dispatch-order job tuple, never retries `/run`, returns both `COMPLETED`
results to the existing full output/readback/v3 receipt verifier, and cancels owned nonterminal work
before failing closed. Focused V2-07 tests pass 234/234.
The exact proposal is
`evidence/acceptance/VF-10-07/2026-08-23-attempt37-terminal-reader-result-recovery-candidate/combined-live-proposal.json`
at `sha256:6ff97af22dd025e9298a830a9bcd946f18fe376745f39ed6e5c15b791e3f390e`;
max-one/max-two are `sha256:e6f3d746959b3a5633fd9b7d6035a0dca44cee9f886b1c045e9d55b6dc1e86f0`
and `sha256:1a5ba973d3d97b76efa7ffb0a6f5cfa9427fb830e7fbfc8831659ea910f8e9d5`.
Consumed authority `sha256:812899db3d2225224ea231112d2eba150ffbbd254148e71f94c81a44de32cadf`
bound the exact proposal once with FlashBoot=true, LOW-or-better EU-RO-1 availability, and a fresh
`$4` cumulative finite cap. Historical read-only inventory at `2026-08-22T18:38:05.635Z` proved zero compute/disposable resources and both
exact retained 50 GB EU-RO-1 volumes. RTX 4090 EU-RO-1 availability remained LOW at
`2026-08-22T18:38:24.525Z` and the secure-Pod reference remained `$0.74/hour`; Serverless Flex stays
`$1.10/GPU-hour`. That authority/cap are closed and non-reusable; retained-volume mutation and V2-08 remain forbidden.

Attempt35 is closed fail-safe and V2-07 remains NOT_QUALIFIED. It consumed proposal
`sha256:1df762844058f78db8171adcad3943ecfc03157c225070fcbc6506088169c87c`, authority
`sha256:fc173408635e6af48f824188dad878cd6259526f407e655941848f092732ef37`, and its `$4` cap.
Owned probe, cold, and warm each accepted a complete 32-image batch: 96 durable readbacks and 96
replay-confirmed v3 receipts total, with exact duplicate delivery causing no second dispatch or compute.
Both reader jobs were dispatched and later observed provider-terminal `COMPLETED`, but neither reader
batch was accepted because status reconciliation failed closed. Cancel and timeout proof were not reached.
Closure `evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-35.json` is
`sha256:d0278822d001fe2639d47920f6923c565882bdbbf6ff11c174b30e72aba6d6fa`; cleanup
`attempt35-cleanup-observation.json` is
`sha256:ab3c5d668c7d2817bd0a9b3e40dbeab6bd3623ae92e9439292d1d32662ba57e1`.
Three stable final reads prove zero disposable compute, both sealed 50 GB EU-RO-1 volumes retained,
signer/Worker/route and generated-output rollback, and `$0` settled incremental spend at cumulative
`$1.3100463044829667`. No live authority/cap remains. Provider-free diagnosis/repair is next;
retained-volume mutation and V2-08 remain forbidden.

Historical pre-execution record: Attempt35 was approved once for bounded LOW-or-better V2-07 execution. Attempt34 stopped before any
provider mutation, GPU job, or spend because three fresh read-only checks proved LOW EU-RO-1
availability below its approved MEDIUM threshold. Its exact pre-execution closure is
`evidence/acceptance/VF-10-07/2026-08-21-live-qualification/blocked-attempt-34-capacity-drift.json`
at `sha256:cf207d45228bf2754803ce56187129dde229b0abdbeb1bd834e7e83dad34b980`; authority
`sha256:3157147f85ecea86b6d01ce489dbfff2dc0d7bc51a833749d96a9cecd99314ff` is closed and non-reusable.

Repair commit
`96f5e16cf03be7e31049478ce7f6b0c134a8108c` keeps retries exclusive to idempotent FINALIZE with
the same reservation/callback tuple, expands the bounded attempt count from three to six, and uses
1/2/3/4/5-second backoff; PUT and every non-FINALIZE POST remain single-shot. The exact combined
Attempt35 proposal is
`evidence/acceptance/VF-10-07/2026-08-22-attempt35-low-availability-candidate/combined-live-proposal.json`
at `sha256:1df762844058f78db8171adcad3943ecfc03157c225070fcbc6506088169c87c`;
max-one is `sha256:d31a518831b9a978295047310800a34eaf81ed56dde58eea46918dc581563ca2`,
max-two is `sha256:11665ee88f09c6cbe498026cacd8505b0fe02ee7f19ac8b4d3f68aa534f3435c`,
and approved acceptance is `sha256:fa701d3ef9f5619c585c6fc964007f660f19d5c92a3912d9af49e5d05bf7277d`.
Fresh read-only truth proved zero disposable compute, both intended volumes, and LOW RTX 4090
EU-RO-1 availability at the `$0.74/hour` secure-Pod reference; Serverless Flex remains `$1.10/GPU-hour`,
the finite estimate is `$2.20`, cumulative endpoint billing is `$1.1340842194622383`, and the two
existing volumes remain `$7/month` separately. Exact single-use authority
`sha256:fc173408635e6af48f824188dad878cd6259526f407e655941848f092732ef37` binds FlashBoot=true,
LOW-or-better EU-RO-1, and the fresh `$4` cumulative cap. Execute only this proposal, consume the
authority at closure, and stop before V2-08. Image republication and retained-volume mutation remain
forbidden; V2-07 is NOT_QUALIFIED pending live proof.

Status: V2-06 is complete and independently audited PASS. V2-07 remains NOT_QUALIFIED. Attempt33
closed fail-safe at `V207_OUTPUT_PORT_FINALIZE_RESPONSE_INVALID`: both simultaneous reader jobs
completed and the repaired terminal drain proof passed, but a reader's idempotent FINALIZE replay
received three bounded HTTP 503 `text/html` responses. Three owned/cold/warm 32-image batches remain
accepted with 96 durable readbacks and 96 replay-confirmed v3 receipts; reader acceptance, cancel,
timeout, and success retention were not reached. Exact closure
`evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-33.json` is
`sha256:44ce85620744650b48ad4cf7397b1cfa6e2173302c9b35311ff01e7d76aa42d8`; cleanup
`attempt33-cleanup-observation.json` is
`sha256:f2bff0bd293172ea851db26b2c14f8edc3d50074dfc89beccbb7d26e4e93c059`. It proves zero
disposable compute, both exact retained 50 GB EU-RO-1 volumes, signer/Worker/route rollback,
generated-output rollback, and three stable billing reads at cumulative `$1.1340842194622383`
(`$0` observed increment). Attempt33 proposal/authority/cap are consumed and non-reusable.
Provider-free repair may continue; any retry needs a separately hashed exact proposal, fresh exact
approval, and a fresh positive numeric cap. Retained-volume mutation and V2-08 remain forbidden.

Historical Attempt32 closed fail-closed. Its exact closure is
`evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-32.json` at
`sha256:5e2cf1f73e03673b9f350352fa2bfbb91566d9e9a695566fdc08f3b1d84c9f75`; cleanup is
`attempt32-cleanup-observation.json` at `sha256:01d91e1216a77ea4d6ac7130c2add5800f67043b3ba34d26ecbecf9422acc51d`.
The exact Attempt32 candidate that was executed is
`evidence/acceptance/VF-10-07/2026-08-22-attempt32-finalize-response-diagnostics-candidate/combined-live-proposal.json`
at `sha256:7c5370668ae06487729775f082cd981164d3e4a1634f20a77beb08bba2ea6b6a`; max-one is
`sha256:2663f06af19ceb11470e0ddac86ac74dae00d25a7b128970376dca2a3d1343d2`, max-two is
`sha256:969816bd9546a81d08f1b725480ad17839d6bd067451ed3074dac3a102cc9e7a`, and acceptance is
`sha256:7ed0bd6c9d064133e9409b79be099184a4b80444d4da66759fa47082d7a66080`. Control commit
`a1da27192c567823f9508ecd6f146f8667e1daac` preserves only bounded FINALIZE response metadata
(attempt, status, sanitized content type, body length, and category), never body/URL/IDs/secrets,
while retaining the 30-second/three-attempt FINALIZE-only retry fence. One bounded live execution under
authority `sha256:a2f2519e6cc5f00ec804adea07b431d155e9fc88a566d7f9ef05396beca99114`, FlashBoot=true,
LOW-or-better EU-RO-1, and a fresh `$4` cap accepted five complete 32-image batches: 160 durable
readbacks and 160 v3 receipts, including two simultaneous read-only readers and exact duplicate same-job
replay. It stopped at `RUNPOD_CONCURRENT_READER_DRAIN_UNCERTAIN` with
`V207_RECONCILIATION_INVENTORY_MISMATCH`; cancellation, timeout, and successful endpoint-retention
proofs were not reached. Exact cleanup and three stable final reads prove zero disposable resources,
both intended sealed 50 GB EU-RO-1 volumes retained, and cumulative endpoint spend unchanged at
`$0.9174736385466531` (`$0` settled Attempt32 increment). Provider calls, GPU use, mutation, and spend
are disabled; the authority/cap are consumed and non-reusable. V2-08 remains forbidden.

Historical closure: V2-07 remains NOT_QUALIFIED after the
Attempt31 output-finalization failure. Attempt31 authority
`sha256:02b91db639ddf6e612c7103d38f9c5c1bae3ff0072afaeebb124274db1e3eab5`, proposal
`sha256:ace01c82b5eaa9e45c177e7c41b908b1f384fe13ae6ff6bd3f8e04cf8ecb98ea`, and its fresh `$4`
cap are consumed and non-reusable. The owned probe, cold, and warm 32-image batches each completed
32 durable readbacks and replay-confirmed v3 receipts; duplicate delivery caused no second dispatch
or duplicate compute. The bounded max-two reader jobs reached provider terminal status, but no reader
batch was accepted. The run reported `MAGE_OUTPUT_NOT_SUCCEEDED` and stopped at
`V207_OUTPUT_PORT_FINALIZE_RESPONSE_INVALID` in
`output_finalization` and did not qualify V2-07. Closure
`evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-31.json` is
`sha256:76c9dec453b5670c0dff73c1857cbbb5e9b43a460599c81a24455404f634c490`; exact cleanup
`attempt31-cleanup-observation.json` is `sha256:61185a893499ab0634458fe472af21cb47385923e2fd05af60658ec97d1f54bc`. Three stable
reconciliation reads prove zero disposable Pods/endpoints/templates/workers/running Pods, both
intended sealed 50 GB EU-RO-1 volumes retained, and settled incremental spend `$0.05512650031596422`
within the consumed `$4` cap. Signer deletion, Worker rollback, route restoration, and generated-output
rollback passed. Provider calls, GPU use, mutation, and spend are now disabled; only provider-free
diagnosis/repair is allowed. V2-08 remains forbidden.

Historical Attempt31 pre-execution terminal-snapshot-stabilization candidate at
`evidence/acceptance/VF-10-07/2026-08-22-attempt31-terminal-snapshot-stabilization-candidate/combined-live-proposal.json`
with proposal `sha256:ace01c82b5eaa9e45c177e7c41b908b1f384fe13ae6ff6bd3f8e04cf8ecb98ea`, max-one
`sha256:29b3c4ed8d05b91cf5f7fda0b9055a95f3a553dfc65dec8a5b5540c9b7e0e006`, max-two
`sha256:4013c7b9887994b6de2dfd947f13ea74e622dfc0fe5b5e429c29fffedc69ef9b`, and acceptance
`sha256:0d316d9cce233a5dfe1b0f5fa7851cbdb64cee575f374e95c6aaadfbfe021269`. It pins the exact
published Mage image, sealed volume, FlashBoot=true, LOW-or-better EU-RO-1, RTX 4090, and repair
`f513ac807c6d5e2298092a936495e3c4fc0e6a28`; it is approved under fresh authority
`sha256:02b91db639ddf6e612c7103d38f9c5c1bae3ff0072afaeebb124274db1e3eab5` and the fresh `$4` cap.
V2-07 remains NOT_QUALIFIED pending execution gates, and V2-08 remains forbidden.

Historical Attempt28/Attempt29 pre-execution narrative follows for lineage.
Attempt28 completed one owned probe and one cold 32-image batch, each with 32 private durable
outputs/readbacks and 32 provenance receipts. Duplicate delivery was detected, and the repair stopped
fail-closed at `RUNPOD_QUIESCENT_NOT_CONFIRMED` in `cold-terminal`; no unplanned duplicate provider
compute occurred. Its exact proposal
`sha256:12bb46d0d6403c888bc5ba7c965174f681baa5f45f320a90a4b1d4f0cf7f56cf` and authority
`sha256:455d5102618a14595aabb9f38236a7fd4d8ddb59ba063c48b03b4c6dd0a85326` is consumed and
non-reusable. Closure
`evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-28.json` is at
`sha256:9d95a32f66a563db2c74dedd608067dbcc4b3ed989125ca4d2696b22943ef1bb`; exact cleanup
`attempt28-cleanup-observation.json` is at
`sha256:a8c7b12731fd8b6b72a4bdce38c2b03de51e50cdc255d9f0fb96639507174049`. Three stable reads prove
zero disposable resources, both intended 50 GB EU-RO-1 volumes retained, baseline and final endpoint
spend both `$0.3379560004686937`, and `$0` settled Attempt28 increment. The signer was deleted, the
Worker version restored, and the route returned to stable `404 V207_ROUTE_DISABLED`. Any retry requires
a fresh exact proposal and fresh positive numeric cap. No image republication, model/volume mutation,
fallback GPU/region, public sample publication, V2-08, or successor work is authorized.

Attempt29 candidate `evidence/acceptance/VF-10-07/2026-08-21-attempt29-terminal-replay-queue-proof-candidate/combined-live-proposal.json`
is `sha256:d29ab29956e00ebf15595943297564286a685fef0f796b5c8a6cb2a34183d8f6` with max-one
`sha256:115a413d11be895638d3742a512f1a1f2d21a6f613617559c5816aa70bd840aa` and max-two
`sha256:f375c3d4d4f67b7021b92d46b01c1e24b44c269280b697430191539a51155a0d`. It binds
terminal request-key replay to the original terminal job, forbids a second provider `/run` and
duplicate compute, and requires no owned jobs plus bounded exact queue-empty reads bracketing two
stable terminal inventory snapshots after `RUNPOD_WARM_IDLE_NOT_CONFIRMED`; queued, running,
malformed, active, nonterminal, mismatched, or unstable state fails closed. The control repair is
`7ba8e9181fe210858c23a3ba7c5c9aca768ac24b`; the proposal cap remains null by design and is bound by
fresh authority `sha256:46bf0ba614b4210f56fd745057e8ebc6f5be4c69c672fe885d6d36de185f1572` under a fresh
`$4` cap, FlashBoot=true, and LOW EU-RO-1 availability. Provider execution is pending exact
authority/context commit.

Attempt30 is now historical closed evidence. Its exact candidate
`evidence/acceptance/VF-10-07/2026-08-22-attempt30-finalize-replay-fast-path-candidate/combined-live-proposal.json`
was `sha256:2cb3d2a2ab73e968da1e964018fd2c100bf9e8cc7b277e9c5739b69355896c2a`, with max-one
`sha256:3ecd3f8f0d2ba49a7b1464bd3ff4a03f0866e371d9be0371db692fadc42a23f8` and max-two
`sha256:5c43f8c1499b8f8f3fbbed2cc7cf6b778e978bc61869cbdf79a680d26985e304`. It was approved under
append-only authority `sha256:6fd4560fcba507dbae51da056d09c309fe0c93ed65e713e3526ad3aa2f978131`,
FlashBoot=true, LOW-or-better EU-RO-1, and a fresh `$4` cumulative finite cap; that authority and
cap are consumed and cannot be reused. Its FINALIZE fast-path control was
`bf26c3a86ec6a48f619c39613d425da816eeae4d`. Its closure and cleanup are recorded above; V2-07 remains
NOT_QUALIFIED and V2-08 remains forbidden.

Attempt31 is now closed consumed evidence described above. Do not execute or reuse its proposal,
authority, or `$4` cap; any retry requires a new exact proposal, fresh approval, and fresh positive
numeric cap after provider-free diagnosis/repair.
Historically, Attempt25 consumed its exact proposal and authority. Its startup safety proof
passed and one owned job reached `COMPLETED` with output status `SUCCEEDED`, but the run stopped
fail-closed at `output_finalization` with a bounded `UNKNOWN` transport diagnostic before any
accepted batch, durable output, or accepted receipt. Exact cleanup deleted only the disposable
endpoint/template after two stable terminal snapshots; three settled reconciliation reads prove
zero Pods/endpoints/templates/workers, both intended 50 GB EU-RO-1 volumes retained, and `$0`
incremental endpoint spend. Closure evidence is
`evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-25.json` at
`sha256:4b1d8b14f24b3e38a672cbe15b772590646bf35fe4e92f7a1046f23f13e5daf2`. That closure required a
fresh exact proposal and cap; Attempt27 now supplies separately recorded authority, while V2-08 remains
forbidden.

Attempt26 consumed exact proposal `sha256:0112b0b72254ef286643fc63bee0176fce327edc401ce40de4a3a860a5e68632`
and authority `sha256:bad94e64eab6fcbc03edf6521f02159ddb2f1c49407a6ca30dfc027fecad2d05`.
One owned diagnostic job reached provider `COMPLETED` and output `SUCCEEDED` after 816602 ms queue
delay and 118362 ms execution, then stopped fail-closed at `output_finalization` with
`V207_OUTPUT_PORT_FINALIZE_RESPONSE_INVALID`; no batch/output/receipt was accepted. Closure
`evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-26.json` at
`sha256:f2839fefaafbe507ce447a4e374d502a971e75653b466f6703caa1a1f8e7c9ec` proves generated-output
rollback, exact endpoint/template deletion, zero Pods/endpoints/templates/workers, both intended
50 GB EU-RO-1 volumes retained, signer deletion/Worker rollback/stable disabled route, and `$0`
settled incremental endpoint spend. Attempt26 authority is consumed and non-reusable. Attempt27's exact
proposal, consumed cap, authority, and closure are recorded below.

Attempt27 candidate and closed execution:
`evidence/acceptance/VF-10-07/2026-08-21-attempt27-hosted-png-crc32-repair-candidate/combined-live-proposal.json`
at `sha256:5cb96aa79a4bb6f1fda3e6dadba7d6997421cc87cd2ed27f6a8ed92bee9fe7ae`. It binds the unchanged
published image, Mage model/manifest, sealed 50 GB EU-RO-1 volume at `/runpod-volume`, FlashBoot=true,
LOW EU-RO-1, RTX 4090 only, max-one `sha256:07749793fe28e158bad4314dbec128c30c6dcb3df52e7912837ec6dd10e27372`,
and max-two `sha256:1673a27538aef7796a364e125e812c26dc22c2c9a2b7c7671f615fa5af603a25`. It adds the
provider-free hosted PNG CRC32 table repair `1960ea9307bb7fcb591c842b84fc1c622aec49eb` while preserving
RunPod control `b8666dd8b8bc12578ffae8925f6ce73dbf53a841`. The proposal bytes retain a null cap by
design. The user approved this exact proposal with FlashBoot=true, LOW EU-RO-1 availability, and a
fresh maximum cumulative finite spend of `$4`. Append-only authority
`evidence/acceptance/VF-10-07/2026-08-21-attempt27-hosted-png-crc32-repair-candidate/approved-authority.json`
is recorded at `sha256:3bf923fb59df2ab0a0ff648ad8773ed549b2296aba66e82db9635c9fa7b66b10`.
The authority and reconciled context were committed and validated before execution; the authority is now
consumed and non-reusable. The accepted probe completed in 32,954 ms queue time and 115,855 ms execution,
with peak VRAM `14,177,206,272` bytes; its recorded timings are volume verification 18,911 ms,
model load 5,858 ms, warm-up 4,843 ms, first inference 763 ms, total 84,900 ms, and upload 18,572 ms.
Closure evidence is
`evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-27.json` at
`sha256:ffd622c4ee0a6a37311a51f191ce9c3ccbb0ae91620e51f64a03dfef932fb20d`.
Exact cleanup deleted only the disposable endpoint/template; three stable reconciliation reads prove
zero Pods/endpoints/private templates/active workers/running Pods, both intended 50 GB EU-RO-1 volumes
retained, baseline and final endpoint spend both `$0.29846311127766967`, and `$0` settled incremental
spend. The signer was deleted, the captured Worker version restored, and the route returned to a stable
`404 V207_ROUTE_DISABLED`. No image republication, model download/quantization, retained-volume mutation,
fallback GPU/region, public sample publication, V2-08, or successor work is authorized; a fresh exact
proposal and fresh positive numeric cap are required for any retry.

Historical Attempt24 exact template/endpoint identity work reached the pre-dispatch safety guard,
but `RUNPOD_QUIESCENT_NOT_CONFIRMED` stopped before `/run/job`; zero jobs and zero batches were
submitted. Historical Attempt24 control `63517e6` retains only structurally branded verification-stage diagnostics for
any future completed-job non-success, then stops without retry. Exact cleanup and three stable
reconciliation reads prove zero RunPod disposable resources, both intended 50 GB EU-RO-1 volumes
retained, billing from USD 0.18311072164215147 to USD 0.22078647126909345, and USD
0.03767574962694198 settled Attempt24 increment. Attempt24 proposal
`sha256:be17430ce61a48a823a1ac87a128e83e44cfb88b01163331c285280e95274137` and authority
`sha256:fccd60a68ee93f522d9e378012c5ccbefb182f6b03e26fde1b5940506ab9c412` are consumed and
closed. The user approved Attempt25 proposal
`sha256:c8baa8a45b8e3e108904cac5f04f472ad22da2936dad75daa2a59d23476a8946` with FlashBoot=true,
LOW EU-RO-1 availability, and a fresh `$4` cap. Authority
`sha256:2fc6072b88ca5069eef5510e6f0699faad977102565455495f89b56b02444b7c` is recorded and consumed;
no provider execution remains authorized. No image republication, model or retained-volume
mutation, fallback GPU/region, public sample publication, V2-08, or successor work is authorized.

Historical Attempt26 candidate: `evidence/acceptance/VF-10-07/2026-08-21-attempt26-finalize-transport-repair-candidate/combined-live-proposal.json`
at `sha256:0112b0b72254ef286643fc63bee0176fce327edc401ce40de4a3a860a5e68632`. It binds the exact
published image, Mage model/manifest, sealed 50 GB EU-RO-1 volume at `/runpod-volume`, FlashBoot=true,
LOW EU-RO-1, RTX 4090, Attempt25 closure `sha256:4b1d8b14f24b3e38a672cbe15b772590646bf35fe4e92f7a1046f23f13e5daf2`,
and local FINALIZE transport repair `b8666dd8b8bc12578ffae8925f6ce73dbf53a841`. Max-one is
`sha256:b64d008bac42fb13ec342028675a1bb498836981c553e884529ad846d6cdf964`; max-two is
`sha256:10f887ba47e8a7cac952374eb236fed08cb67962171769b65d96a4f0d3a7acf7`. The user approved the
exact proposal with FlashBoot=true, LOW EU-RO-1, and a fresh `$4` cap. Append-only authority
`evidence/acceptance/VF-10-07/2026-08-21-attempt26-finalize-transport-repair-candidate/approved-authority.json`
is `sha256:bad94e64eab6fcbc03edf6521f02159ddb2f1c49407a6ca30dfc027fecad2d05`. That authority is now
consumed by the failed-closed execution above; V2-08 remains forbidden.

Attempt 25 candidate path: `evidence/acceptance/VF-10-07/2026-08-21-attempt25-startup-terminal-inventory-candidate/combined-live-proposal.json`.
Attempt 25 startup-terminal-inventory candidate was approved and executed once under the exact
recorded authority and fresh `$4` cap; both are now consumed and non-reusable.
Attempt 25 proposal SHA-256: `sha256:c8baa8a45b8e3e108904cac5f04f472ad22da2936dad75daa2a59d23476a8946`.
It binds control `bb9abc03f286cae56bf874fe47dc1d7ebddb1fe9`, unchanged image/source/model/manifest,
the sealed Mage volume, FlashBoot=true, LOW EU-RO-1, and RTX 4090 only. The startup fallback is
allowed only before any owned job when health.jobs is present with inQueue=0 and inProgress=0 and
two matching terminal worker/Pod inventory snapshots are stable; post-dispatch, cancellation,
concurrent-reader, and drain checks remain health-first. Max-one is
`sha256:d7a5791c80fa96f997994c70486208af5faea93989a1cc3fe5033a0a911ddacd`; max-two is
`sha256:e1edf2d61b188428ce16e6f5597ceadc6ce7d58aa50dda4f8a7ea09e96bd0e38`. Authority record:
`evidence/acceptance/VF-10-07/2026-08-21-attempt25-startup-terminal-inventory-candidate/approved-authority.json`
at `sha256:2fc6072b88ca5069eef5510e6f0699faad977102565455495f89b56b02444b7c`. That provider authority
is consumed; V2-07 remains NOT_QUALIFIED and any retry requires fresh authority and cap.

Attempt 23 candidate path: `evidence/acceptance/VF-10-07/2026-08-21-attempt23-output-contract-diagnostic-candidate/combined-live-proposal.json`.
Attempt 23 proposal SHA-256: `sha256:386dd8330f8e626d9afe8c8de8bbd1385fd9664b9fefbc472c24722105f917f9`.
It pinned FlashBoot=true, LOW EU-RO-1, the unchanged Mage image/source, exact sealed volume, and
RTX 4090, with max-one then separately hashed max-two staged definitions. Max-one was
`sha256:45f8d447829d63517b78807ce710af7fbd81a9ff06d67cafe1a5a6bf37a15959`; max-two was
`sha256:6b02604fd7a58ee98c350429663c038bbc5c93ea2e0786e64ac3a6ef3f476e8b`. Attempt23 closure is
`failed-attempt-23.json` at
`sha256:0f48f3bc82b6d0b7fb48e723c4a3fc36a142129de578447acd30d77157e1ca1b`; the output status,
failure code, and shape remained unproven. Fresh exact approval and a fresh positive numeric cap
are required before any provider mutation or GPU use.

Attempt 23 closure: the authority is consumed, exact cleanup and final reconciliation are complete,
V2-07 remains NOT_QUALIFIED, and a fresh exact proposal and fresh positive numeric cap are required
for any retry. V2-08 remains forbidden.

Attempt 24 verification-stage diagnostic candidate: provider-free control
`63517e605d441fa23020bea8bff2987cc4bc99c5` retains only structurally branded
`output_failure_stage`, output status, failure-code, and shape facts from the first completed-job
non-success; unsafe or unbranded diagnostics fail closed, and no provider body or raw output is
retained. Candidate:
`evidence/acceptance/VF-10-07/2026-08-21-attempt24-verification-stage-diagnostic-candidate/combined-live-proposal.json`
at `sha256:be17430ce61a48a823a1ac87a128e83e44cfb88b01163331c285280e95274137`. It binds the
unchanged image/source, exact Mage manifest, sealed 50 GB EU-RO-1 volume at `/runpod-volume`,
FlashBoot=true, LOW EU-RO-1, RTX 4090, max-one
`sha256:345072150945c7dfa686c6b90b36565accd65ad5666f5c2917e160d5cf9f308a`, and max-two
`sha256:173e52dde1443d61f9a678e54ff859f2709797a3f4aa818f0402772887c2be8a`. The exact authority
is recorded below; provider mutation, publication, GPU use, or spend are authorized only after
the authority commit and within the fresh `$4` cap. Attempt23 closure is
`failed-attempt-23.json` at
`sha256:0f48f3bc82b6d0b7fb48e723c4a3fc36a142129de578447acd30d77157e1ca1b`.

Attempt 24 exact authority was recorded at
`evidence/acceptance/VF-10-07/2026-08-21-attempt24-verification-stage-diagnostic-candidate/approved-authority.json`
with SHA-256 `sha256:fccd60a68ee93f522d9e378012c5ccbefb182f6b03e26fde1b5940506ab9c412`. The user
approved proposal `sha256:be17430ce61a48a823a1ac87a128e83e44cfb88b01163331c285280e95274137`
with FlashBoot=true, LOW EU-RO-1 availability, and a fresh maximum cumulative finite spend of
`$4`. The authority bound the unchanged image/source/control, exact Mage volume and manifest,
RTX 4090, max-one then separately hashed max-two configurations, bounded output diagnostics,
cleanup/rollback, and V2-08 prohibition. It is consumed and closed: the pre-dispatch guard raised
`RUNPOD_QUIESCENT_NOT_CONFIRMED` before `/run/job`, and closure evidence
`evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-24.json` records exact
cleanup, zero disposable compute, retained volumes, and the settled USD 0.03767574962694198
increment. No provider authority remains; V2-07 remains NOT_QUALIFIED and any retry requires a
fresh exact proposal and fresh positive numeric cap.

Attempt 24 closure SHA-256: `sha256:12ca4be38d063f761537cc4184b387ae83feeaebc6e9bb102260feff6c347bcb`.

Attempt 22 candidate path: `evidence/acceptance/VF-10-07/2026-08-21-attempt22-template-environment-readback-candidate/combined-live-proposal.json`.
Attempt 22 proposal SHA-256: `sha256:96ead6591874229d93537af46a3159002e2fe86c93cc2905c42bbb1326ccece7`.
The user approved FlashBoot=true, LOW EU-RO-1, and a fresh USD 4 cap. That consumed authority is at
`evidence/acceptance/VF-10-07/2026-08-21-attempt22-template-environment-readback-candidate/approved-authority.json`
with SHA-256 `sha256:fecdfa6dee640d483a1787a726723bef08cdeaf455f5b7df0a2fbcdf3c3699f6`.
Attempt22 closure evidence: `evidence/acceptance/VF-10-07/2026-08-20-live-qualification/failed-attempt-22.json`.
Closure evidence SHA-256: `sha256:43f9db51e67a39e4a837614be5af14299d91c4fbdd446b9d78ecc51260da517a`.
Context schema: `2.0`
Last updated: `2026-08-21`

VideoForge is an invite-only voiceover-to-video product for 5–10 people. Each admitted account has
one default workspace. User-created projects, queues, Avatar Profiles, Image Styles, media, manifests,
usage, and results are private to that account/workspace. Only explicitly built-in presets, such as
`documentary_stock_v1`, are global. Authentication identity and workspace ownership are enforced by
the database and every server boundary; a client-supplied owner ID is never authority.

Input is a title, final English voiceover, exact ready Avatar Profile version, and immutable Image
Style version. Output is an automatically assembled 1920x1080 MP4. The product flow requires no
Premiere work, provider console, manual Pod start/stop, model knowledge, or prompt writing.

The output grammar is only `AVATAR_FULL`, `IMAGE_FULL`, and `AVATAR_SPLIT_IMAGE`. Hard cuts only.
Every image-containing scene has a slow, smooth centered zoom. Never add captions, titles, text
overlays, lower thirds, borders, watermarks, motion graphics, decorative graphics, title cards, or
decorative transitions.

## Active production architecture

The v2 target uses a scale-to-zero control plane plus two isolated RunPod queue-based Serverless
endpoints in `EU-RO-1`:

| Lane | Exact model/runtime | Existing retained storage | Serverless bound |
|---|---|---|---|
| Images | `Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6`, pinned ComfyUI, INT8 ConvRot, 4 steps, guidance 1.0, 1280x720 | Sealed Mage-only 50 GB volume | `workersMin=0`, `workersMax=2`, `REQUEST_COUNT=1`, handler concurrency 1, one GPU/worker |
| Avatar | `Soul-AILab/SoulX-FlashHead-1_3B@59119b6c681230c3eeee157e224ae1941746711e#Model_Pro`, BF16, four distilled steps | Sealed SoulX-only 50 GB volume | `workersMin=0`, `workersMax=2`, `REQUEST_COUNT=1`, handler concurrency 1, one GPU/worker |

Each endpoint mounts only its own existing volume at `/runpod-volume`. Model bytes and manifests are
immutable/read-only by application policy; RunPod does not supply a documented read-only
network-volume mount. Every worker verifies the full sealed manifest before load and after its job,
downloads nothing at runtime, resolves no mutable model reference, and writes all caches, temporary
files, inputs, and outputs to a project-isolated local scratch directory. Missing, modified,
cross-mounted, incomplete, or writable-model-path behavior fails closed.

RTX 4090 is the only active GPU class. RTX 5090 may be added to a lane only after that exact lane's
image, volume, runtime, cold/warm timing, VRAM, output, concurrency, and cost suite passes. Do not list
an unqualified fallback: RunPod may place work on any GPU type configured for an endpoint.

Private R2 is the durable artifact plane. Keys are account/workspace/project/attempt scoped, accepted
objects are checksum-bound, and signed URLs are short-lived. Model volumes never hold user media.
Pinned whisper.cpp transcription and FFmpeg render/probe run on an account-owned Windows or macOS
personal media worker. The worker installs like a normal desktop application, pairs once through the
already-authenticated browser, starts at login, uses outbound HTTPS only, and receives no database,
R2, RunPod, Runware, Google, or admin credential. If that account's worker is offline, its job waits
truthfully for the computer; it never borrows another tenant's device. V2-06 proved the hosted plane
and immutable beta releases: Windows is unsigned; macOS is ad-hoc sealed and non-notarized.

## Admission, queue, and authority

- One provider workload per account may be active; the global hard limit is two workloads from
  different accounts. Ordinary videos therefore remain capped at one/account and two globally.
- Explicit Mage/SoulX preset previews use the same locks/slots, become eligible only after every
  video queue head, and never change the video fairness cursor.
- A durable fair scheduler rotates eligible accounts. RunPod's endpoint queue is transport capacity,
  not product fairness or admission truth.
- A waiting account may have queued work, but no GPU/CPU generation begins before database admission.
- Users may inspect, cancel, or reorder only their own work. An account-local reorder cannot defeat
  cross-account fair rotation. No user can see or mutate another account's project or catalog.
- One active video's lane work may be sent as a bounded whole-video request so the loaded model is
  reused across its images or short avatar spans. Handler concurrency remains one.
- Provider dispatch uses two phases: durable predispatch authority/outbox before `/run`, then exact
  provider job/worker/GPU/output binding after assignment. Recovery accepts at most one result.

RunPod `/run` returns a job ID, but its public contract does not promise client idempotency,
exactly-once execution, or zero duplicate billing. VideoForge must never claim those guarantees.
Persist a unique dispatch token and cost reservation before the POST, reconcile the exact job via
`/status`, accept at most one checksum-bound output, and expose any duplicate-compute/cost risk.
Async results expire after 30 minutes, so a signed private R2 receipt is durable truth; webhooks are
an acceleration hint, not the sole completion channel. TTL includes queue time and can remove a
running job. Execution and initialization timeouts therefore come from measured lane evidence, not
provider defaults. Ordinary queue purge is forbidden.

Scale-to-zero means `workersMin=0`: no Active worker is retained. Autoscaled work uses Flex workers,
and `workersMax` counts both Active and Flex workers. The control plane must prove zero running/idle
workers after drain and continue billing only for the two explicitly retained volumes.

## Preserved green foundations

- Word timing: exact word-level whisper.cpp contract, deterministic chunk overlap/reconciliation, durable
  receipts/replay, and real Linux FFmpeg/whisper.cpp parity.
- Scheduling: deterministic `scheduler-v2`, exact 30 fps coverage, three-composition manifests, natural
  word/clause cuts, selected-span audio, and provider-free Chrome playback.
- Fixture orchestration: complete provider-free recovery/cancellation/fail-closed evidence,
  useful UI shell, and final MP4 playback/download. Its singleton global-session and manual-Pod
  semantics are superseded, not production truth.
- Mage foundation: exact INT8 runtime and sealed 50 GB volume, accepted visual quality, valid offline
  worker proof, and zero-compute settlement. Bounded worker qualification does not prove Serverless compatibility.
- SoulX foundation: exact Pro runtime and sealed 50 GB volume, valid offline worker samples,
  source-aware full/split review outputs, measured RTX 4090 behavior, and zero compute. Exact
  full/split visual approval is recorded and hash-bound. Pod proof does not prove Serverless handler,
  endpoint, scale-to-zero, concurrency, or recovery behavior.

No inactive avatar runtime, repair route, model substitute, or alternate volume is dispatchable.
Only the exact Mage and SoulX lanes named above belong to the active production plan.

## Locked editorial contract

The pinned Ranga studies remain the style target, while respecting VideoForge's still-image medium:

- exactly three compositions; frame 0 is full avatar;
- full and split avatar alternate; normal avatar spans are 2–6 seconds and opener may reach 7;
- total avatar coverage 21–22%, mean avatar span 3.5–4.0 seconds, and 3.3–3.7 appearances/minute;
- median non-avatar gap 10–13 seconds; first literal evidence 3–6 seconds; first split by 18 seconds;
- mean visual change 4.0–4.8 seconds and median 3.6–4.7 seconds;
- one native avatar clip serves full and split; split boundary is exactly x=960 at 1920x1080;
- narration relevance is literal, shot roles vary deterministically, and every cut follows a natural
  word/clause boundary rather than a randomized duration.

The scheduler's owned 30-minute fixture already reached 21.05% avatar, 3.433 appearances/minute, 3.679-second
mean avatar span, and 4.569-second mean scene duration. Preserve it. Remaining quality work is
literal image relevance, per-avatar crop/lip/background review, authentic-feeling imagery, and real
full-length acceptance. Ranga uses moving stock/UGC; stills plus zoom can match composition, cadence,
and evidence selection, not source-footage motion.

## Current handoff

V2-00 and its independent audit are green. V2-01 is complete and independently re-audited green: additive migration
`0018_tenant_private_scope.sql` gives projects, revisions, assets, Avatar Profiles/versions, Image
Styles/versions, queue entries, attempts, outputs, costs, approvals, and audits an `account_id`
joined to `workspaces (account_id, id)`, so a cross-tenant row cannot be represented. Ownership is
derived by the database from the already-authorized parent row, which means a client-supplied owner
is overwritten rather than honoured. Pre-V2 rows are adopted by a reserved LEGACY account that no
identity can authenticate into, and pre-V2 admissions receive fresh empty accounts instead. Every
repository call now snapshots its inputs, binds `videoforge.account_id`, and validates the account's
ownership of the workspace in the same transaction. The active shared-app fixture also projects
tenant-local queue metadata, audits, orchestration, costs, outputs, and downloads, with foreign
reads and mutations returning non-revealing not-found responses. Invite redemption atomically creates exactly one
account, one default workspace, and one membership. Built-in presets are the only globally readable
records and reject every update and delete. The approved UI geometry is unchanged.

V2-02 is complete and independently re-audited green. Append-only migrations
`0019_tenant_artifact_receipts.sql` and `0020_tenant_artifact_isolation_repair.sql` provide canonical
v3 artifact identity, transfer-port, and commit-receipt contracts plus exact database key and
retention enforcement. The fake-R2 adapter has no list/copy/move/global-hash surface and cannot
replace an accepted immutable key. Object keys derive only from trusted
account/workspace/project/revision/lane/job/artifact identity. Exact
method/path/type/length/checksum ports are short-lived and bounded-replay; durable receipts bind
hashes, probes, retention, and deletion ownership. The superseded raw-key route is fixture-only and
fails construction without its explicit legacy firewall. Both model lanes accept scoped ports,
pin `/runpod-volume` as application-read-only policy, and route every mutable cache/output to
job-local scratch with path, ancestor/internal symlink, cross-mount, crash, refresh, and every
terminal-path cleanup negative. This remains provider-free proof, not real R2, hosted RLS, or
published Serverless-worker proof.

V2-03 implementation at audited HEAD `9fe0cfa3d470247e0b91eae50b012bd69ec34696` failed its first
independent audit. The four bounded findings were repaired at `fa01480fe6b4356ce986a6bd105b72a04ebdca8a`
and independently re-audited green at `268e26cb6cc28880854d6ca5d4290da05ee502e8`. Additive migrations `0021_fair_generation_admission.sql`
and `0022_v2_03_admission_audit_repairs.sql` plus the fair-admission
repository persist tenant-owned video and Mage/SoulX preview requests, deterministic account
last-served rotation, one active provider workload/account, and exactly two distinct-account global
leases. Videos always outrank previews; previews use a separate cursor. Owned waiting reorder/cancel,
retry, terminal release, lease heartbeat/expiry, reclamation, restart reconstruction, stale-version
fencing, and append-only audits are atomic. Ten-account contention yields exactly two winners, no
third slot, and complete video-account rotations before previews; explicit 1-, 2-, and 5-account
reports cover boundary distributions. Duplicate Generate replays idempotently, concurrent
cancel/promote is serialized, preview requests pin an owned or immutable built-in exact preset
version, and every reconstruction capacity correction is audited, including stale nonzero to zero.
Waiting rows create no task, outbox, artifact, ASR, render, or provider work. The active Node
Generate and Queue routes now use the same PGlite-backed `FairAdmissionRepository` and committed
migration chain; installed Chrome proves two different accounts active at the same time. The
ordinary Queue/Create UI exposes only private factual queue state and no GPU or Pod lifecycle
controls. The previous global-session fixture remains only for downstream provider-free media
execution and recovery compatibility; it is no longer admission or queue truth. Durable terminal
release promotes the next fair request while that compatibility executor retains its serial media
lifecycle, so earlier fixture recovery evidence remains valid without becoming admission truth.

At the V2-01 handoff, row level security was declared on every tenant table but not behaviourally
proven because PGlite connects as a superuser and bypasses it; the local proof came from the tenant
write guard and the `videoforge_tenant_*` views. V2-06 final live closure subsequently proved the
runtime role is non-superuser/non-`BYPASSRLS`, every tenant table uses forced RLS, and real private-R2
tenant isolation/deletion holds. `GATE_TENANCY_001` and `GATE_STORAGE_001` are closed.

V2-04 is complete, repaired, and provider-free. Its first audit at
`698f96ffd527df0e05e570687b93d2eb594a5c08` failed five trust-boundary checks; repair commit
`9da626cae846a524f282a1fa36be52455a60b03e` closes them with additive migration
`0025_serverless_v2_04_audit_repairs.sql`, exact assignment-gated status, verified reconciliation
receipts, exact non-null output job binding, typed paid resources/rate membership, and enforced
provider-result-window polling. A later audit at `d5825158073a5e255133a20ccfce560d60ae3f3f`
found that the result window still began at local attempt creation and that a signed receipt could
revive a cancelled attempt. Repair commit `2f530885fc6aed61688427c324e26606d8d5eac3`
adds migration `0026_serverless_result_window_and_cancellation_fence.sql`, starts request TTL at
provider submission, persists terminal observation/result expiry, and serializes cancellation and
canonical output acceptance with an application lock plus database trigger. Its provider-free
same-chat re-audit passes; no separate-agent independence is claimed. A subsequent independent
audit at `8d14fda8a4510866590c95684b345143a1612182` found two remaining semantic gaps: incomplete or
caller-authored artifact rows could be accepted behind one detached commit-receipt hash, and an
assignment was called terminal without observing `/status` while terminal discovery stopped at TTL.
Repair `3c219dd6a006dc22e6cddae3314fc79c8c2b5ea8` adds migration
`0027_serverless_output_binding_and_result_discovery.sql`, derives every canonical artifact from one
live tenant-owned commit receipt per batch item, exact-matches those facts to the separate signed
provenance items, and polls assigned jobs through the worst-case TTL-plus-1800-second horizon until
terminal observation. Its provider-free same-chat re-audit passes; no independent repair audit is
claimed. Additive migrations
`0023_serverless_attempts_and_outbox.sql` and
`0024_serverless_cost_and_reconciliation.sql`, canonical TypeScript/Python v3 contracts, and the
fake transport bind exact tenant/revision/lane/endpoint/config/image/model/volume/input/deadline/spend
facts before dispatch. A stable token and outbox exist before fake `/run`; provider assignment is
durable before status or output acceptance. Separate signed VideoForge provenance and exact
tenant-artifact commit receipts,
bounded unknown-ack reconciliation, advisory webhooks, cancellation/restart/TTL recovery, accepted-unit
resume, cost conservation, and at-most-one canonical output with visible duplicate compute/cost all
pass. Superseded Pod schemas are read-only compatibility evidence and cannot authorize v3 dispatch.
Canonical verification passed 28/28 package tasks and 44/44 installed-Chrome tests. No credential,
provider call, endpoint/image/volume mutation, worker, GPU, or spend occurred.

V2-05 is complete and provider-free. Additive migration `0028_v2_05_runtime_cutover.sql` gives
every admitted video independent durable stage state, per-lane state, append-only accepted units,
append-only runtime events, and a superseded-contract registry whose write fence rejects ordinary
production writes to `generation_sessions`, the session GPU pair tables, `global_queue_entries`,
`compute_run_plans`, the Pod lifecycle and dispatch tables, and `durable_generation_outputs`, while
leaving those rows readable as compatibility evidence. A runtime leaves `QUEUED` only behind a
durable admission, a lane binds an attempt only with its own durable items manifest plus exactly one
predispatch authority and coverage of exactly the unaccepted planned units, accepted units are
append-only facts of the video joined to live tenant artifact commit receipts, and render is fenced
behind every lane succeeding. The application composition carries two tenants' videos concurrently
through preparation, both exact lane batches, the asset barrier, render, and completion with zero
live attempts and `$0` settled cost, and proves queued inertness, lane independence, unknown
acknowledgement, duplicate-execution visibility, restart reconstruction, cancellation fencing, and
non-revealing cross-tenant negatives. `pnpm ci:static` now also runs the V2-05 runtime firewall.

The application now serves that truth end to end: Generate registers the durable runtime, private
queue views report factual owned stages and lane facts, waiting work remains inert, and finalization
requires a live tenant-private render receipt whose SHA-256, bytes, H.264/AAC probe, project,
revision, and render manifest all agree. Installed Chrome proves two accounts, the three locked
compositions, real 1920x1080 MP4 download/playback, cross-tenant refusal, and zero fake jobs/workers
after drain. V2 routes cannot call the compatibility orchestrator. At the V2-05 handoff, the emitted
production worker was import-free and failed API traffic closed pending V2-06 hosted adapters; its client bundle
contains no v1 shared-app route, manual Pod/GPU selector, inactive Echo route, repair override, or
fallback vocabulary. Local compatibility fixtures remain explicitly gated and the production UI
visibly says fixtures are not live.

V2-06 final live closure deployed executable source `e673527b7ac3dbb4db64f66a19a766cf1cf1d422`
and proved migration `0036`; two-account auth/RLS/R2/device/lease isolation; ASR/render; Workflow
recovery/cancel/replay fences; durable delete and inventory restoration; backup/restore; two-step
rollback health; Chrome playback; and Windows/macOS worker `0.1.11`. New spend was USD 0 under the
separate USD 1 cap; no recurring resource was created. RunPod stayed read-only at zero compute, with
two existing 50 GB volumes untouched. The final evidence-only audit passed and closed
`GATE_HOSTING_001`. Immutable provider evidence is not current authority; live refresh requires a
new read-only grant. V2-07 Attempt 18 independently reconciled RunPod to zero compute/resources and
both retained volumes after a successful endpoint PATCH response failed the complete matcher before
GET or dispatch. Cloudflare rollback and its 30-second route-stability window passed; cumulative
billing remained USD 0.12480033212341368 for a settled USD 0 attempt increment. The consumed
proposal `sha256:2752b61dfe4481eaa15ef349f859d91650160971a828d7d19af2638f7c8715be`
and its USD 4 authority cannot be reused. Provider-free control now accepts only an exact-ID,
non-conflicting partial PATCH acknowledgement while preserving complete exact GET readback. Fresh
proposal `sha256:ce11e4efb3b97f47c9ca70f83451ce6535e8467ac506b682527466f9327dafde`
and its USD 4 authority were consumed after Attempt 19. Provider-free repair `b35f4a6` then allowed
only documented GET omissions. Attempt 20 under proposal
`sha256:9e9675dcf6943dce35b4bf6155fdfc39f8dade5e9775bcc3ee9a427980d39e02`
still failed GET identity binding before dispatch. Exact cleanup restored zero disposable resources,
both retained volumes, unchanged billing, signer absence, Worker version, and the disabled route.
Its USD 4 authority is consumed; no current cap or provider authority exists. Image republication,
volume mutation, fallback, public sample publication, and V2-08 remain forbidden. The ordered
checkpoints and copy-ready implementation/audit prompts supersede every removed planning file. Git
history records removed briefs; only evidence required by active foundations and gates remains in
the working tree.

Attempt 21 then consumed the exact diagnostic-readback proposal under its fresh USD 4 authority.
RunPod again stopped before `/run` with `RUNPOD_ENDPOINT_ID_BINDING_READBACK_UNCONFIRMED`; only
the bounded `environment` category was retained. Exact cleanup deleted the disposable endpoint and
template, both intended 50 GB EU-RO-1 volumes remain retained, cumulative billing stayed
`USD 0.12480033212341368`, and the Attempt 21 increment was USD 0. Closure evidence is
`evidence/acceptance/VF-10-07/2026-08-20-live-qualification/failed-attempt-21.json` at
`sha256:cd7200aca5f532a3e9062b37c296cf412bce974605f44278156c23674710bd68`. V2-07 remains
NOT_QUALIFIED. Attempt22 later consumed its exact authority; no retry is currently authorized.

Attempt 22 is now historical consumed evidence. Control `54af72f1e9a29eed7f53e47ecdda9f6a34abb7df`
POSTs the endpoint-hash environment update, GETs exact template identity/environment, then PATCHes
documented endpoint fields and requires strict endpoint configuration readback. Endpoint environment
omission is accepted only after the exact template proof; any present endpoint environment must match.
The exact candidate is
`evidence/acceptance/VF-10-07/2026-08-21-attempt22-template-environment-readback-candidate/combined-live-proposal.json`
at `sha256:96ead6591874229d93537af46a3159002e2fe86c93cc2905c42bbb1326ccece7`, with approved
authority `sha256:fecdfa6dee640d483a1787a726723bef08cdeaf455f5b7df0a2fbcdf3c3699f6`, FlashBoot=true,
LOW EU-RO-1, and the consumed USD 4 cap. One job reached `COMPLETED` but no batch/output receipt was
accepted. Cleanup and reconciliation are complete; provider-free diagnosis is next and V2-08 remains
forbidden.

Attempt 23 is the approved pre-execution output-contract diagnostic. Control `9f5a15c3382c03af675392dacc487b96811674ed` records only
the safe `output_contract` category plus output status, failure-code, shape-kind, and shape-key facts
for the first completed-job non-success; it retains no provider body or raw output and stops without
retry, warm batch, reader dispatch, or duplicate submission. The candidate proposal is
`evidence/acceptance/VF-10-07/2026-08-21-attempt23-output-contract-diagnostic-candidate/combined-live-proposal.json`
at `sha256:386dd8330f8e626d9afe8c8de8bbd1385fd9664b9fefbc472c24722105f917f9`. The user approved
FlashBoot=true/LOW EU-RO-1 and a fresh USD 4 cap. Authority
`sha256:c59bd74673263eeeafed828dade74fe36ae2f27ed7914d413e37bfd6722a3b35` is recorded; provider
execution was historically bounded to that proposal.

## Context navigation

Historical Attempt45 candidate (now consumed/closed):
`evidence/acceptance/VF-10-07/2026-08-23-attempt45-resume-get-lifetime-repair-candidate/combined-live-proposal.json`
`sha256:a2f336fe5bb0291ef436699d60a0f6885948c4a5cf52d724a184caa917718770`;
acceptance `sha256:106c12b6be55f870ec17c52135eb90d09aa09fb60ad119e79a0d8174318353a2`;
preflight `sha256:7a0e66ce4cf9cddaab6aa09692ed9f6cb385f43dedf8a288ffac57a41f6abffb`;
`sha256:fcd591f6ad384ad5ab20ae6ab24bbec6d1e3940f07ffbc3cb33bc3be6664973c`;
`sha256:8c1d60cc939c3e01f95533733259ce8de5a2a8345429327af2fd869b2dd32a2c`; V2-08.
Attempt45 authority `sha256:e73bd7ec…b6b67` recorded one use and `$4`; it is consumed and non-reusable.
Closure `failed-attempt-45.json` is `sha256:f287a7ec8ea064587e251f5ccb9b5321025d37976fdbf40b0b894a962c71167c`,
cleanup `attempt45-cleanup-observation.json` is `sha256:d23b169a2920e27b25e691e04758fbe123d3f41f3f1eb618940f998bc89d2f55`,
and reconciliation `attempt45-reconciliation-observation.json` is
`sha256:e786ee74546632ed38aeef5acf3860605693cd7255a4a19ba44d99ca91b82c2d`. The run failed before
RunPod/GPU with clean Worker/route rollback and zero disposable resources; no authority/cap remains.
Provider-free repairs are `f945392` (canonicalization) and `7066520` (deploy diagnostics). V2-08 forbidden.

Read `MANIFEST.yaml`, `CURRENT_STATE.yaml`, then only the selected profile and task. Normative
decisions: `15_DECISIONS_AND_OPEN_GATES.md`; architecture: `06_SYSTEM_ARCHITECTURE.md`; models:
`08_MODELS_AND_PROVIDERS.md`; pipeline: `07_PIPELINE_AND_SCHEDULER.md`; RunPod:
`09_RUNPOD_AND_QUEUE_OPERATIONS.md`; contracts: `10_DATA_AND_API_CONTRACTS.md`; cost:
`11_COST_SPEED_BUDGET.md`; acceptance: `14_TESTING_AND_ACCEPTANCE.md`; execution:
`21_IMPLEMENTATION_EXECUTION_PLAN.md`; completion checkpoints:
`22_PROJECT_COMPLETION_CHECKPOINTS.md`; copy-ready prompts:
`templates/CHECKPOINT_CHAT_PROMPTS.md`; maintenance: `16_CONTEXT_MAINTENANCE.md`.

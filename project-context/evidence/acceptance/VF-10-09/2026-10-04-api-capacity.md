# Shared provider capacity — V2-09 / VF-10-09

4 October 2026. Branch `codex/api-capacity`, base `c85ccc3ddd8bdc2b741f50adb79b3809b2961664`. Production baseline: source `beeaa22362aa75f1ad97b80c20c8d028be08e2a5`, Worker `8b61d38a-2ac0-420c-93dc-45e5163c7e29`, migration258. Release identity is recorded in CURRENT_STATE after publication; this record does not self-pin a future commit.

## Scope and behavior

Priority1 only: database-backed shared provider admission, fair account turns, confirmed-refusal cooldowns and existing observer integration. One video/account remains; no cross-account ordinary video ceiling. Kie and Fal rejection retries retain immutable inputs. J1 uses a versioned waiting intake with exact submission claims. Runware preserves task UUIDs and stops for review on a confirmed post-dispatch capacity refusal; automatic new-UUID recovery is not implemented. Progress shows a durable review hold. Models, quality, scene counts, paid uncertainty fences and accepted media are preserved.

Limits are operational configuration. Kie100 outstanding/550ms starts; Fal4 outstanding/250ms starts across avatars and regeneration; Runware video4/250ms; J1 one outstanding/60sec starts. Fal4 is a bounded application backlog, not verified purchased concurrency. The user confirms a USD35 unlimited-generation J1 subscription, but actual concurrency/RPM remains unverified. Text model gates share cooldowns without asserting an undocumented universal concurrency limit. No second provider account/key rotation was introduced.

## Verified evidence

- Independent agents reviewed exact claim fences, owner/RLS privilege boundary, lock ordering, unsafe replay and rollout coexistence. Review fixes include stale unsent waiter expiry, strict Runware error identity, HTTP200 native refusal cooldown, versioned J1 intake and truthful durable prompt holds.
- Native PostgreSQL17.11: actual migration chain through261; ten physically distinct runtime-role sessions respect a configured cap3 (3 admitted,7 waiting); same-job race yields one immutable claim; another connection cannot see an uncommitted claim; a real lock wait resolves after rollback. Optional reproducible test: `packages/control-plane/tests/provider-api-capacity-native.test.mjs`. Temporary server, runtime, downloaded bottle and two temporary symlinks were removed; port55491 no longer responds.
- PGlite functional tests cover ten tenants, fairness, cancellation, stale waiters, Fal avatar/regeneration sharing, cooldown/receipt identity, stale claim rejection, unknown occupancy, tenant denial, direct runtime privilege denial and legacy/new J1 coexistence. Serialized PGlite proof is distinct from native concurrency proof.
- Native production migration trial applied259–261 inside a transaction and explicitly rolled it back. Verified policies and runtime denied privileges; ledger remained258 and new tables absent afterward. No durable production change from this trial.
- Focused provider/media final suite61 tests passes. Final Voices/Progress/J1 route/Runware transport suite272 passes. Schema inventory and portable backup/restore5 tests pass. Web and Worker type checks, changed-file ESLint, production/staging builds and bundle firewalls pass. Production static closure increased exactly11 bytes for WAITING voiceover observation; staging retains its ceiling, provider code remains dynamic.
- Broad web suite:2894 pass,10 fail,1 skip. All10 failures independently reproduce at clean baselinec85ccc3d (old V207 image digest1, V209 lane image fixtures7, incomplete queue fixture schema1, source-substring visibility expectation1). No baseline source edits.
- Broad database suite initially714 pass,2 fail,12 skip. One new test fixture omitted the required Runware model; it was corrected and all4 affected SQL tests passed. The other expects migration239 to be the last migration and independently reproduces on clean baselinec85ccc3d with239–258; it is unrelated to provider capacity. The broad aggregate is not claimed green.
- Canonical `CI=1 TURBO_FORCE=true pnpm verify` remains nongreen: existing formatting debt (143 flagged files on first run) and unavailable repository-local uv0.8.13. Workerd parity passes. Separately invoked installed-Chrome suite:28 pass16 fail; failures concern old counts/text/selectors, but a baseline Chrome rerun was not performed and aggregate Chrome is not claimed green.
- Existing production Chrome Voices and Create forms were inspected without submission before release. Final post-release readback is recorded separately below.

## Release and rollback

Additive migrations259–262 require a superuser/BYPASSRLS migration owner and exact historical function preimages. Old media claims still require exact SUBMITTING claims. Old J1 start/record remains compatible; new app uses versioned queue intake. Never drop queued jobs or rejection receipts on rollback. Prior binary rollback requires zero WAITING narration; otherwise hold affected provider admissions via durable cooldown and deploy a queue-compatible fix while observing accepted jobs. Operational policies/fairness are native-backup/PITR state; portable restore preserves rejection receipts and requires operator quota/reconciliation before admission.

Private baseline/configuration, logs and release receipts are under the ignored task directory `.videoforge/api-capacity-20261004` in the primary checkout. Credentials and private configuration are not committed.

## Progress permission repair

Initial source `f6723003` was published as Worker `82d1a209-0be6-477c-aa5b-92019f1603ca` after additive migrations259–261. Real Chrome exposed a Progress regression: its new hold query directly selected protected `repository_mutation_receipts`. The actual runtime connection reproduced permission denied. With zero WAITING narration verified, traffic was restored to prior Worker `8b61d38a-2ac0-420c-93dc-45e5163c7e29`; existing completed Progress and private access recovered. Additive schema and existing media identities were retained.

Migration262 adds only a tenant-scoped SECURITY DEFINER boolean read helper; runtime receives EXECUTE without receipt-table SELECT or INSERT. The exact production Progress SELECT passes a regression under the named restricted runtime role and tenant security-barrier views, including foreign-tenant denial. A native owner rollback trial passed, then262 was applied while the prior app remained live. Before republishing, the exact current Progress SELECT returned the existing project through actual production runtime credentials; receipt-table SELECT remains denied and helper EXECUTE is granted. No provider request or existing job mutation was used for this proof.

## Final production publication

Source `b89632043e2256f364280ba74b2bbab269994b72`, Worker `0023e2a1-f6d4-4bee-97b1-902d673621b7`,100% traffic. Migrations259–262 are applied. Final production and staging builds/firewalls, web/Worker types, changed-file lint, context and the exact-query regression pass. All30 public assets match immutable build hashes; `.assetsignore` is excluded from public assets. Status returns the deployed source;53bindings,26secrets,3Workflow identities and runtime pins are preserved. Unauthenticated private project access returns401. Runtime still has no direct receipt SELECT/INSERT. Readback finds zero WAITING or UNKNOWN narration and zero new provider rejection receipts.

Real Chrome after final publication shows the retained completed project Approved100%, all11 stages complete,380 images,113 avatar clips,28 scene clips, saved narration and GPU released. Upload-voiceover and script Create forms load; the script voice selector resolves A.J. Voiceover Hub shows1,117 catalog voices and the saved A.J. preset. Final Review loads the retained Approved output, contact sheet and Download MP4 link; no fresh playback/decode benchmark is claimed. No Create, paid generation, regeneration or workflow-start action was invoked for acceptance.

GPT Space project context was updated successfully at sequence38, including current release, decisions, failure/rollback and proof limits. The subsequent Project Index patch returned an internal error with unknown save outcome; same-stream readback and the Coverage update failed because the Pages session closed (`RPC UNAVAILABLE`). Their final save state remains unverified. Reconcile current blocks before any later retry; never replay the ambiguous patch blindly. Repository evidence is complete; no Obsidian fallback or credential content was written.

## Spend and remaining proof

New paid provider generations:0. New Pods, endpoints, GPUs, retained volumes or production Workflow instances:0. No existing paid cleanup lifecycle was changed. Model unit prices and requested generation counts remain unchanged; extra database/Workflow activity is not a guarantee of identical total infrastructure cost.

Actual provider-account quotas, a fresh real-provider canary, and ten-user live video throughput/latency/cost remain unverified. Existing historical full-film, invoice, local-runtime, editorial and cleanup gates are separate. Publication does not imply those gates passed.

# Optional Cloud media release preparation

Status: safe local implementation/preparation in progress, Cloud disabled; no production release,
image publication, new provider generation or paid media execution. Checkpoint VF-10-09/V2-09.

## Source and preservation

Public production status verified2026-09-28 at source
`366d16c27369b4430a843ae4e6929b7d7156eb89`. Historical readback records Cloudflare version
`62524e69-7fea-4796-9d4a-a87124b16009`,25 secrets, worker0.1.44 and query redaction; current
Cloudflare settings GET returned401, so bindings/version must be freshly verified before publication.
Implementation checkout is `f9b9283ca662e73c0ba276741db22521c3b65357`. It includes unpublished UI
changes; release preparation uses a registered isolated worktree from production366d and applies
only task changes with three-way merging, preserving the published timing/details UI. Exclude the
unrelated `apps/web/src/server/runtime/node-fair-admission.ts` edit. No commit/push/deploy performed.

Local evidence: `.videoforge/cloud-media/baseline.json`, `implementation-from-f9.patch` and
`release-transplant.json`. These sanitized operator files retain identities/rates/test boundaries,
not secrets. Worktree location is recorded there; refresh task changes only after owners finish.

## Operator rate snapshot

RunPod Pod REST v2 Secure Cloud catalog GET2026-09-28 returned48 models. Complete paginated Pod
inventory contained zero Pods. No creation, termination, endpoint or volume mutation occurred.

| Preference / offering | Observed GPU rate | Capacity / fallback reason | GPU memory | Speed |
|---|---:|---|---:|---|
| 1. NVIDIA RTX PRO 4500 Blackwell Server Edition | USD0.72/h | LOW; verify actual CPU/RAM/rate | 32GB | Unmeasured |
| 2. NVIDIA RTX PRO 4000 Blackwell | USD0.57/h | NONE; no observed capacity | 24GB | Unmeasured |
| 3. NVIDIA RTX PRO 4500 Blackwell | USD0.72/h | NONE; no observed capacity | 32GB | Unmeasured |
| 4. NVIDIA GeForce RTX 4090 | USD0.74/h | NONE; no observed capacity | 24GB | Unmeasured |
| 5. NVIDIA L40S | USD1.09/h | NONE; no observed capacity | 48GB | Unmeasured |
| 6. NVIDIA RTX A6000 | USD0.53/h | NONE; no observed capacity | 48GB | Unmeasured |
| 7. NVIDIA A40 | USD0.49/h | NONE; no observed capacity | 48GB | Unmeasured |
| 8. NVIDIA L4 | USD0.49/h | NONE; no observed capacity | 24GB | Unmeasured |
| 9. NVIDIA GeForce RTX 3090 | USD0.50/h | NONE; no observed capacity | 24GB | Unmeasured |
| 10. NVIDIA L40 | USD0.82/h | NONE; no observed capacity | 48GB | Unmeasured |
| 11. NVIDIA RTX 6000 Ada Generation | USD0.84/h | NONE; no observed capacity | 48GB | Unmeasured |
| 12. NVIDIA RTX PRO 5000 Blackwell | USD0.96/h | NONE; no observed capacity | 48GB | Unmeasured |
| 13. NVIDIA GeForce RTX 5090 | USD0.99/h | NONE; no observed capacity | 32GB | Unmeasured |
| 14. NVIDIA RTX A5000 | USD0.27/h | NONE; no observed capacity | 24GB | Unmeasured |
| 15. NVIDIA RTX 4000 Ada Generation | USD0.28/h | NONE; no observed capacity | 20GB | Unmeasured |
| 16. NVIDIA RTX A4500 | USD0.25/h | NONE; no observed capacity | 20GB | Unmeasured |
| 17. NVIDIA RTX A4000 | USD0.25/h | NONE; no observed capacity | 16GB | Unmeasured |
| 18. NVIDIA RTX 2000 Ada Generation | USD0.24/h | LOW; verify actual CPU/RAM/rate | 16GB | Unmeasured |

At100GB temporary disk, reference disk cost is USD0.013889/h, giving rank1 estimated
USD0.733889/h. This is an estimate from current listing, not actual billing/spend approval or a
qualified placement. Persist chosen disk across fallback; verify actual returned price/resources
against approved limits before work. No warm pool or retained network volume.

## Upload size boundary

R2 single PUT is nominally5GiB, with up to5MiB included headers per official footnote4. Use the
conservative exact object-body ceiling **5,363,466,240 bytes** (5GiB minus5MiB), rather than a
5,000,000,000-byte decimal estimate. [Cloudflare R2 limits](https://developers.cloudflare.com/r2/platform/limits/).
The application's existing10GiB artifact cap is a validation ceiling, not an R2 single-PUT or
storage guarantee. Compatible Local uploads below the conservative limit keep their existing
behavior, including files larger than decimal5GB. Larger Cloud outputs use tenant/attempt-scoped
multipart with bounded buffers, exact part authority, whole-object hash/size verification,
failed-part-only retries and uncertain-completion reconciliation before terminal acceptance.

## Required release gates

1. Finish source review/focused tests, changed-file lint, context/contracts/typecheck/worker/firewall
   and web builds. Reproduce broad baseline failures separately; do not claim whole-repository green.
2. Build the dedicated Linux runtime on the repository's standard runner under approved publication
   authority; verify offline Python3.12, FFmpeg/FFprobe8.1.2, whisper.cpp1.8.4, exact base.en model,
   hashes, NumPy/OpenCV, real ASR/span/Fal square-to-wide/final render and technical gates. Pin image
   digest/source SHA256. No paid-startup install/model download or mutable code.
3. Present one combined finite authority proposal with exact operations/current qualified offering,
   all-in rate, derived disk, numeric cap/deadline and cleanup stop conditions. Frontier budgets and
   consumed historical VideoForge approvals do not authorize this lane.
4. Run retained-input short Cloud ASR/span/render, cancellation/independent cleanup and current
   Local execution. Measure each phase. Run representative45-minute VideoForge storage/render;
   Frontier's repeated-source fixture is not VideoForge qualification.
5. Real Chrome: explicit Local/Cloud, create/queue/real phases, close/reload recovery, private preview/
   download/full playback, saved media after verified compute shutdown, Cloud with computer offline.
   Fixture selectors/retained media are narrower than fresh full-provider/editorial acceptance.

## Exact production operations after authority

### Approved combined authority (2026-09-28)

The previous unapproved USD20 proposal is withdrawn. The revised finite action cap is
**USD5 total**: up toUSD3 for at most six Cloud reservations, and up toUSD2 for immutable image
publication, CI and related storage actions. Verify billing/quota before any chargeable build or
publication; use existing free quota when available, without assuming it exists.
Require all-in GPU plus temporary disk rate at mostUSD0.80/h. Derive temporary
disk from validated exact-job inputs/intermediates using the release formula, bounded100–200GB;
fail rather than rent above200GB. No retained network volume or recurring retained-volume charge.

| Exact retained-input proof | Rental deadline | Maximum reservation |
|---|---:|---:|
| Short ASR | 15 minutes | USD0.20 |
| Selected-span batch | 15 minutes | USD0.20 |
| Short final render and technical checks | 15 minutes | USD0.20 |
| Cancellation and independently verified cleanup | 5 minutes | USD0.07 |
| Representative45-minute render and storage proof | 2 hours | USD1.60 |
| One recovery, only if needed | 15 minutes | USD0.20 |

These six reservations sum toUSD2.47; the remaining USD0.53 compute allowance is contingency,
not permission for more rentals. Before each ready proof, set the corresponding approved rental
deadline/reservation limit in control-plane configuration; persist those limits on its reservation.
The existing operator budget authority enforces the USD3 aggregate and scoped project identities.
Short-proof measurements determine whether the45-minute proof is feasible within its limit.
If it cannot finish safely, stop and retain that acceptance gate; preserve encoding, mandatory
decode/frame-count verification, resource floors and accepted media. Do not claim an unrun gate.

Operations: qualify/publish the Linux runtime; retained-input short ASR, selected-span batch and
render; one cancellation with independent cleanup; representative45-minute retained-input render;
and one bounded recovery if needed. No new Kie/Fal generation. Production migration/deployment
is conditional on the offline/runtime/live/browser/storage gates passing and a fresh verified
baseline. Stop on missing authority, unknown/incomplete inventory, ambiguous launch, resource or
actual-rate mismatch, exhausted capacity window, failed qualification, budget/deadline risk or
unverified cleanup. Keep uncertain reservations counted; terminate only exact owned Pods.

Fresh read-only inventory at2026-09-28T13:05:45Z used the configured Frontier reference credential
account and was complete with zero Pods; no credential was copied. The configured VideoForge
account must receive its own preflight before paid allocation. No billable POST has been issued
for this new lane, so owned Pods are zero; live independent shutdown remains unexercised. Rank1 GPU listing
wasUSD0.72/h andLOW, while an adjacent query reportedNONE; availability is volatile. A fresh catalog
read at2026-09-28T13:27:09Z still listedUSD0.72/h butNONE. At100–200GB disk, the estimated all-in
preferred rate isUSD0.733889–0.747778/h; it is not an actual placement or invoice. Actual
placement CPU/RAM and VideoForge speed remain unverified. Refresh catalog before allocation.
The cap is an application action guard, not an invoice guarantee. User approved this replacement proposal with “Ok approved, go ahead and finish everything”. No paid action occurred before approval.

Re-read production source/version/configuration/bindings and exact local-worker release. Stop on
baseline drift. Inventory runtime migration ledger through213 and compare retained checksums,
including archived/omitted entries (the verified production ledger has196 rows and deliberately lacks retained148); prepare one owner transaction for only
`0214_optional_runpod_media.sql`, exact checksum/ledger insert and required minimum runtime grants.
Do not run a directory-wide migration replay. Add the compatible schema with Cloud still disabled.

`deploy/cloud-media/prepare-release.mjs` prepares local files only. Supply a fresh complete ledger
JSON array (`version,name,filename,sha256`, ordered by version), the freshly read production Wrangler
configuration and reviewed release commit:

```sh
node deploy/cloud-media/prepare-release.mjs --ledger /private/ledger.json --baseline-config /private/wrangler.json --output-prefix /private/cloud-media-release --commit <reviewed-40-character-commit>
```

It validates every applied retained migration hash through213, permits only the exact historically omitted148 identity, and preserves all observed archived entries and148 absence in the exact complete
ledger guard, emits one advisory-locked transaction for214 and its exact ledger insert, and preserves
baseline configuration/bindings while forcing Cloud off. Output files are private, exclusive writes.
The tool makes no network call and cannot execute SQL, publish an image or deploy. Restore current
Cloudflare read access and obtain a fresh production baseline before using its output for release.
The production validator accepts only complete qualified Cloud release variables (or the sole
disabled flag); provider secrets remain existing secret bindings outside plain configuration.

Publish the qualified immutable runtime/source, then deploy isolated reviewed source. Preserve all
existing secrets, Kie/Fal settings, private R2, query redaction, authentication, worker0.1.44 and
historical GPU-disabled settings. Enable only the separately qualified Cloud media lane with finite
approved limits, pinned image and source identity. Verify deployed identities, binding/config parity,
ledger checksum, read-only APIs and authorized Chrome acceptance. Save sanitized durable evidence.

## Rollback

Disable new Cloud allocations first. Fence/drain exact owned active attempts, revoke stale ports,
continue result reconciliation and terminate only owned reservation-matched Pods. Independently read
complete inventory until their absence is verified; uncertain cleanup keeps capacity reserved.
Preserve accepted media, previous valid outputs, receipts/manifests and additive migration ledger.
Restore the verified production control-plane source/config with Cloud disabled after active compute
is settled. Never terminate unrelated Pods or touch historical Mage/SoulX volumes/endpoints.

## Current acceptance boundary

Production-based final UI/product tests:234 pass, one existing product source-text guard failure.
Implementation code is locally committed as2cdda790adcf16c1c33f7d2286a3b64972bab9c3.
Focused backend79, migration8, Cloud Python runtime80 and Ruff pass. Existing Local media89pass/
1skip (90 total), ASR33, span14 and render31 pass. Contracts123, vNext dispatch firewall, changed-file lint
and context validation pass; context retains profile-budget/optional-asset warnings. Broad worker
suite172pass/1fail (173 total) has an unchanged historical Mage byte/hash failure at366d/f9.
Broad web2250pass/22fail/1skip is not green; all22 failures have not individually been reproduced
on baseline. The unrelated edit hash is unchanged. Linux image identity isUNBUILT_UNQUALIFIED.
Public production readback at2026-09-28T13:17:47Z still reports source366d16c2 and GPU transport DISABLED_UNQUALIFIED. Current Cloudflare settings read401; fresh production binding/config parity remains a release gate.
Production full web, final Cloudflare and staging builds pass; their measured static closures are
2,778,357 and2,776,188 bytes. The Cloud controller remains in an isolated dynamic server chunk
of56,679 and56,050 bytes. Config/quarantine/release-preparation tests19/19 pass, including a
provider-free canonical Wrangler dry-run and a guard that rejects Cloud GPU vocabulary in client,
static Worker closure or any other server chunk. Linux/Python execution code remains outside
Cloudflare bundles. The source runtime firewall has two existing unlisted continuation imports;
the same imports/guard are present at bothf9 and the published366d baseline.
Scoped tests prove Local default, explicit Cloud offline readiness, compatible retry payload,
and Saving/Stopping compute until verified cleanup. Cloud CPU progress has no numerical percent
or x/100 counter; accessible exact phase text is shown, Local/pipeline accepted-item counts preserved;
real Chrome provider-free hosted fixtures on the production-based worktree prove Local/Cloud
selection and restoration, exact mocked Cloud render-retry payload, and STOPPING phase/full-navigation
reload with no CPU counter or premature Production complete. These are mocked UI proofs, not
controller/cleanup or production submission evidence. Current production Settings/Library mounted with
an offline Windows0.1.44 device; saved MP4 loaded1920x1080/159.2s without media error, advanced
through the first10.077s using native controls, and its private download was requested. Full
play-through/audio-sync/downloaded-byte verification was not completed after the tab handle became unavailable; its cause was not established.
No live Cloud,45-minute VideoForge, runtime image/digest or release proof exists yet.

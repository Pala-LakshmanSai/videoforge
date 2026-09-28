# Optional Cloud media release preparation

Status: implementation and offline Linux runtime qualified; immutable private image published.
Cloud remains disabled; no production application release, new provider generation or paid Pod.
Checkpoint VF-10-09/V2-09. Current evidence: SAFE_PREPARATION_EVIDENCE.json and QUALIFIED_RUNTIME.json.

## Source and preservation

Public production status verified2026-09-28 at source
`366d16c27369b4430a843ae4e6929b7d7156eb89`. Historical readback records Cloudflare version
`62524e69-7fea-4796-9d4a-a87124b16009`,25 secrets, worker0.1.44 and query redaction; fresh settings/deployments reads returned200 after existing OAuth refresh. Preserve the verified
baseline and recheck bindings/version immediately before publication.
Implementation checkout is `f9b9283ca662e73c0ba276741db22521c3b65357`. It includes unpublished UI
changes; release preparation uses a registered isolated worktree from production366d and applies
only task changes with three-way merging, preserving the published timing/details UI. Exclude the
unrelated `apps/web/src/server/runtime/node-fair-admission.ts` edit. Isolated task source/evidence are committed and pushed on codex/cloud-media-release; no application deployment.

Local evidence: `.videoforge/cloud-media/baseline.json`, `implementation-from-f9.patch` and
`release-transplant.json`. These sanitized operator files retain identities/rates/test boundaries,
not secrets. Worktree location is recorded there; refresh task changes only after owners finish.

## Qualified Linux image and publication boundary

Real offline retained-source ASR, span cutting, current Fal full/split composition and final technical
checks passed in CI36437915344 at sourcefe61f686. Qualified execution source SHA25608f7344553c2b493eccd236b61698cae330edbee77eb7ee909e180d13f66b768 and runtime SHA256194d1a4cee7acca64661774faa9ad205b31c66470af2011b5dc420ebe447db81 are recorded with exact tool/model hashes in QUALIFIED_RUNTIME.json.
The immutable image is ghcr.io/pala-lakshmansai/videoforge-cloud-media-runtime-private@sha256:d054d17bef2178593d96b8d579c41446f272330044e79ef1bbde976a859f2c62.
Independent GitHub API visibility is private, with no repository link. Controller-local scoped
registry mounts preserved every qualified layer and digest without rebuilding or transferring media.
The first public-repository GITHUB_TOKEN push inherited public package visibility; it contained only
source/upstream tools/model, no private input or credential. Future publication must reject that path.
Exact private root/Linux manifests, config and all layer sizes were authenticated-pull verified; anonymous pull returned401. A dedicated read:packages-only capability registered one exact owned RunPod media registry and independent inventory verified it. Actual Pod startup/resources/rate and independent cleanup remain live gates. The mistaken newly public package was removed via exact regular-Chrome owner confirmation and independently returned404; the private qualified digest stayed unchanged.
Linux executable hashes are qualified separately from desktop binaries.

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

Fresh configured VideoForge inventory/catalog at approximately2026-09-28T15:20Z was complete with
zero Pods/one inventory page/48 GPU models. No Frontier credential was copied. Prior Secure listing
observed RTX4000 Ada atUSD0.28/h, with100GB disk estimatedUSD0.013889/h; refreshed placement facts
remain required. No paid Pod POST or DELETE has occurred. Rates/resources and VideoForge speed
remain unmeasured on real rented hosts; listed estimates are not invoices.
The cap is an application action guard, not an invoice guarantee. User approved this replacement proposal with “Ok approved, go ahead and finish everything”. No paid action occurred before approval.

Re-read production source/version/configuration/bindings and exact local-worker release. Stop on
baseline drift. The exact214 append was executed and independently verified: ledger197/exact checksum, no prior-row or omitted148 change. The preparation below records the applied guard procedure. Before any future schema release, inventory the current migration ledger and compare retained checksums,
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
The tool makes no network call and cannot execute SQL, publish an image or deploy. Obtain a fresh production baseline before using its output for release; Cloudflare read access has been restored.
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

Production-based UI/product tests234pass/one unchanged source-text assertion. Focused controller50,
continuation17, exact R2 inventory/checksum29 and migration9 pass. Python Cloud80, Local99pass/1skip,
ASR33/span14/render31 and derived-audio helper25 pass; contracts123, typecheck, changed lint and
context pass. Broad worker172pass/one unchanged historical Mage byte/hash failure; broad web
2250pass/22fail/1skip, with not all22 individually baseline-reproduced. Source firewall retains two
unchanged continuation import allowlist failures; emitted bundle quarantine passes. The unrelated
node-fair-admission edit SHA remains unchanged.

Production/staging builds pass at static closures2,778,234/2,775,622 bytes under unchanged limits;
Cloud/multipart helpers remain dynamic, Linux execution stays outside Cloudflare bundles.
Production source366d16c2/version62524e69 remains unchanged; fresh settings/deployments reads200,
25 secret bindings, worker0.1.44 and query redaction verified. Publication parity is still required.

Real regular Chrome saved159.2s output reached ended=true, reload restored readyState4 without
error, and private download25,080,526 bytes matches accepted SHA256; independent FFprobe verifies
4776frames/1080p30/H264/AAC. Fixture selector/offline/Stopping/reload checks remain mocked.
Current native Local execution remains below its unchanged2GiB scratch guard after clearing only
verified disposable package/update caches (about1.1GiB remains); external613MiB and stale Windows heartbeat provide no ready alternative. Saved playback is not fresh execution or human AV review.

Real offline qualified Linux image/private pull proof is recorded in QUALIFIED_RUNTIME.json.
Synthetic45-minute retained audio was derived with that exact runtime in free CI36441214616,
195,749,679 bytes; independent whole R2 SHA and119,070,000-sample/2700s/44.1kHz/stereo FLAC probe
passed and the exact new asset became VERIFIED. This is fixture preparation, not a45-minute render.
Additive214 is independently installed, ledger197 and omitted148 preserved. The scoped authority
and dormant owned proof jobs are prepared; no paid Pod or new Kie/Fal/prompt request has occurred.
Short Cloud/cancellation/independent cleanup,45-minute render/storage, actual Cloud Chrome flow,
current Local, ordinary final-promotion and qualified production rollout remain gates.

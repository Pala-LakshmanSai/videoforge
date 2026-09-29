# Optional Cloud media release — 2026-09-29

Historical initial release snapshot. Current production source2cea7e58 / Cloudflare63a210c4, additive224/ledger207, fresh44.6s provider sample, measured control latency and updated budget/cleanup evidence are in [SAMPLE_OBSERVATION.md](SAMPLE_OBSERVATION.md) and CURRENT_STATE.yaml.

Checkpoint **VF-10-09 / V2-09**, profile `v2_09_short_live_e2e`.
The original production release at https://videoforge.buzz used source **30b0485513f188263e229e7bc787774a8bae94b8**, Cloudflare version **601d8ff3-6d37-43ab-b4bf-073ad6c6c121**, 100% traffic. This release extends verified production366d16c2, excludes Main's unrelated edits, and preserves25 secrets,50 total bindings (earlier41 shorthand was stale), three existing Workflow resources, Local0.1.44, Kie/Fal, historical disabled GPU generation, private R2 and query redaction.

## Identities

| Artifact | Immutable identity |
| --- | --- |
| Web/Worker bundle | `sha256:7d6a4c5d43a302a44e1e32142349c3d5e0c9447d5da9920d78fcdc650d825038` |
| Production configuration | `sha256:48f450dd287776b5142ce060176acf12d8d0227d49b2a462d5ba7cdefe5cdcc5` |
| 23 client assets manifest | `sha256:9046680381d6f4cef6a72a7d663cf095e4d1ac293db8092821f3f1531bd741ea` |
| Private Linux image | `ghcr.io/pala-lakshmansai/videoforge-cloud-media-runtime-private@sha256:a2ff1f16e4d8990e611f0eb9380c96bcd936ddffdc49be3332ef140888566811` |
| Execution bundle | `sha256:2d5f4f16be8c7f0be96b0608dce905cc22f38426d9e242c0ebc4aa91c8cdcc41` |
| Qualified Linux runtime | `sha256:d313eee20b0874f9729c259417e78d02a6c56b11e58ed21350c4c6e503ef73f4` |

The runtime is Python3.12, FFmpeg/FFprobe8.1.2, whisper.cpp1.8.4/exact base.en and locked NumPy/OpenCV. Network-disabled CI36458994531 verified real ASR, selected spans, current Fal full/split composition and final technical checks. Linux executable identities are distinct from desktop.

## Integration and preservation

New Project alone exposes accessible Local/Cloud selection; Local is default. Server-side revision/attempt backend participates in idempotency and conflict checks. Existing attempts keep their backend. A separate `RUNPOD_POD` executes ASR, selected SPAN_AUDIO and RENDER using exact committed inputs. It shares existing CPU attempts, fair VIDEO admission, outbox/Workflows, private R2 receipts and terminal promotion.

The controller reserves before billable POST, fences leases, bounds placement/GPU fallback, counts ambiguous launches and uncertain cleanup against capacity, and reconciles complete provider inventory without creation replay. One/account and two/global video and Pod caps remain. Workflows progress without the browser or desktop polling; Pod watchdog and external controller both enforce cleanup. Inputs and accepted media remain after shutdown.

Scoped artifact ports stream output and support multipart initiation/parts/completion/abort with durable attempt authority, whole-object checksum verification and uncertain completion reconciliation. Disk is autosized, at least100GB temporary, no retained volume. Browsing, Settings, previews and downloads allocate nothing. Existing image/avatar generation, immutable manifests, full decode/frame checks, encoding, narration and visual grammar remain.

Primary integration points: hosted `app.ts`, `configuration.ts`, `submission.ts`, `product.ts`, `runpod-media.ts`, `hosted-render-retry-route.ts`, `hosted-v209-render-terminal.ts`, cancellation/continuation/Workflows; shared Python cloud execution and streaming uploads; New Project draft/selector. Additive214–223 use compatibility-safe ledger guards. Ledger206/max223 preserves archived/omitted versions.222 SHA `c1c74764842fbc51adc98262aa5abd2494ca94f8f390266b63cd9dd4cffbcd7c`;223 SHA `c5fcbb1b2c69277b898933369f9173aad44030b584a0e861d2855a5e849419f7`.

222 creates fresh successful-source render-only request/admission/attempt/receipt/review lineage.223 defers provider runtime initialization at the real outer admission boundary even when accepted source prompts and canonical bridge are complete. Original native runtime/backend/final/approval remain unchanged. Final Cloud promotion used existing terminal logic with zero new provider jobs/runtime. Staging's missing restricted terminal credential was added; one same-instance restart reconciled accepted artifacts without rerendering.

## Real acceptance

- Real Cloud ASR, selected-span preparation, short retained final, active cancellation and45-minute retained render/storage passed. Local was stopped for Cloud proof; no native lease executed the Cloud attempt.
- Final accepted-source159.2s output:1920×1080/30fps/4776frames/H264/AAC,25,079,721B, SHA `d9efdf52861665fd2d7cd162fb6c9c09ab55c605ffb7fd5d771c5ee0f9ef9e46`. Full decode and frame count pass; A/V drift0. New approval is separate; old source approval/final unchanged. Delegated approval was executed under user authorization.
- Regular Chrome tab closed during input download and reopened on the same attempt. Final saved video naturally played to end after compute stopped. Production New Project Local/Cloud readiness, approved saved output and a second natural159.2s playthrough are verified. Existing Local0.1.44 execution, saved playthrough and native private download are preserved; service restored with fresh heartbeat. No new Windows execution qualification claimed.
- Staging Cloud private download endpoint returns200/video MP4/exact size; the production link is present and Chrome displays **Blocked by your organization** for the new download. No browser security setting was bypassed. Earlier real Chrome download of the same Cloud bytes matches the accepted SHA; this does not establish a new-route native download.
- Retained45-minute fixture:2700s/81000frames/426,380,093B, full decode/voiceover/technical gates pass. Chrome close/reload and saved playback5:50/45:00 pass. Full45-minute playthrough/download and fresh full-provider/editorial production quality are **not claimed**.

## Measurements and pricing

| Final159.2s accepted-source phase | Observed seconds |
| --- | ---: |
| Reservation to verified placement | 2.776 |
| Verified placement to input phase, combined startup | 18.154 |
| Downloading inputs | 25.342 |
| Rendering phase before Checking | 148.768 |
| Checking phase | 9.218 |
| Saving to accepted CPU result | 26.291 |
| Accepted result to independent CLEAN | 15.600 |
| Reservation to independent CLEAN | 246.150 |

Mandatory technical verification inside checking took1.762s. Separate image-pull duration is unmeasured; phase intervals include polling/transport overhead. Ordinary terminal promotion waited for the missing staging credential, separate from compute/upload.

LONG rendering2121.010s, combined startup16.135s, inputs23.757s, technical25.392s, save/accept51.413s, cleanup11.173s, total2257.654s. Sampled filesystem peak1,186,160,640B/minfree106,188,021,760B over2218 samples on100GB is a fixture lower bound, not a general disk guarantee. Final SHORT sampled peak131,358,720B over197 samples.

| Offering | Observed or catalogue all-in USD/hour,100GB | Fallback reason | Speed evidence |
| --- | ---: | --- | --- |
| RTX PRO4500 Blackwell Server | **0.733889 observed returned rate** | First qualifying Frontier preference; current resources/price rechecked | Retained SHORT/LONG measured above |
| A40 | 0.503889 catalogue estimate | Known preference fallback only after confirmed rejection and complete reconciliation | Unmeasured |
| L40S | 1.103889 catalogue estimate | Excluded above approved0.80 ceiling | Unmeasured |

Catalogue snapshot is time-specific (`OPERATOR_RATE_SNAPSHOT.json`); allocation refreshes availability/price. No comparative GPU speed benchmark or preference reordering. Rates/debits are not provider invoices.

## Validation and known failures

Focused controller/policy135, render-only route/terminal24, full-schema actual PostgreSQL admission/lifecycle9, NewProject-only UI6 plus elapsed-time regression1, web/Worker typechecks, changed-file lint, web/Cloudflare builds, bundle firewall, contracts123 and context pass. Historical SQL compatibility/full scoped suites are detailed in retained evidence. Native installed build passed; pnpm's dependency verification wrapper attempted installation without TTY and failed, separate from compilation.

Broad suite remains non-green: worker175pass/1 unchanged historical Mage byte/hash failure; web2250pass/22fail/1skip, not all22 individually baseline-reproduced; two existing V2-05 continuation allowlist failures; five0093 compatibility fixtures fail A/B before body at migration195 missing deployment-owned helper42883. No whole-repository green claim.

## Continuation driver

The existing `hosted-continuation-driver` was restarted exactly once after deployment and is RUNNING on definition **0cccd078-27e5-4a54-a42d-bb32857e0480**. Complete continuation inventory remains29 instances; no new instance was created. Exact five historical inactive API rows are preserved; active-work guards passed. This enables browser-independent progression on the deployed code. Verification **2026-09-29T12:53:23.032Z**.

## Spend, shutdown and rollback

All10 qualification reservations independently CLEAN; complete paginated provider inventory confirms zero owned VideoForge media Pods. One unrelated Pod was untouched. Conservative qualification compute debit **USD2.87**, invoice unobserved. New account authority starts at debit0 with **USD1.60/max five rentals/expiry2026-09-30T12:30UTC**; combined approved ceilingUSD6.60 includes originalUSD5. Maximum rateUSD0.80/hour, autosized temporary disk, no retained volume, no warm pool/new Kie/Fal/prompt generation during proof. This is finite account scope, not unrestricted ongoing spend.

Rollback anchor: source366d16c27369b4430a843ae4e6929b7d7156eb89 / Cloudflare62524e69-7fea-4796-9d4a-a87124b16009. First disable new Cloud allocations/authority; fence and drain exact owned active attempts, terminate only owned Pods, independently verify absence, then restore baseline traffic and existing Workflow definitions. Preserve additive migrations, accepted receipts/media and Local worker. Never roll traffic back while abandoning paid compute.

Publication initially failed definite Cloudflare validation10027 because broad module discovery swept private helper directories. No version/deployment resulted. Corrected artifact contains exactly one7,541,153-byte JS module, discovery disabled, and23 hashed client assets; native dry run passed before the single successful publication.

Durable source and review: draft PR https://github.com/Pala-LakshmanSai/videoforge/pull/1. Current state: `CURRENT_STATE.yaml`; bounded rollout/drain instructions: `RELEASE_RUNBOOK.md`. Sanitized runtime/live SHORT/LONG/CANCEL/span evidence remains in this directory; restricted approval, receipt, complete inventory, exact ledger/binding preimages and publication/browser readbacks remain outside Git in `.videoforge/cloud-media/`.

# ASR timing recovery — 2026-10-04

Checkpoint V2-09 / VF-10-09, profile `v2_09_j1tts_voiceover`. Isolated branch
`codex/asr-timing-recovery`, base `2da0f945`; resolve implementation commit from Git.
Status: fix published; approved live ASR/context/planning recovery complete. Historical accepted ASR, context,
revision and audio are preserved. Production source `65d28fab257353d54f25bfdf1c9d344dd5484e97`.

## Exact failure

Project `a397d24a-6910-4049-a43e-58e09aa9865e`, revision
`473004da-2983-4e4f-a915-665c1a1fb75c`, accepted ASR
`768feb48-019b-4e31-9996-218a285c5746`.
The accepted result was schema-valid but contained word2755 at875595–899815ms (24220ms)
and word2756 at899815–927115ms (27300ms). The original18:56.509 audio contains speech
through this range; FFmpeg silence detection found no silence exceeding3s at−40dB.
Whisper's long second chunk lost speech and stretched tiny tokens across it.

The scheduler allows at most7s per image scene and6s per avatar span, and never cuts
inside a word. The exact accepted transcript failed all8 planning seeds with
`TIMELINE_INVALID`:16 coverage failures,0 internal/tail partition failures,
maximum reached avatar frames5652, last reached start872835ms. Runtime was about45s.
The generic hosted error offered planning-only Retry, which reused the same bad result.
No timeline, prompts, images or avatar generation had started.

## Shared repair

Transcription detects oversized word timing before publishing a chunk receipt. It performs
one same-model recovery pass over only the affected original chunk using balanced overlapping
windows capped at90s (15s for an original chunk at most90s). It preserves healthy chunks,
original audio/checksum/duration, model/options, cancellation and immutable receipts.
Invalid recovery fails closed. A60s full-chunk trial produced out-of-range word timing;
that approach was discarded rather than weakening parser guards.

The scheduler and hosted coordinator reject historical oversized words before expensive
planning. Hosted Progress names transcription timing as the defect, shows Needs attention,
and removes the planning-only Retry for this error. Historical accepted receipts remain
immutable; deployment alone does not rewrite the failed project's ASR result.

## Verification

-37 transcription tests: normal paths, recovery once, cancellation, exhausted recovery,
  receipt replay without process work, and preservation of legacy accepted bytes.
-215 pipeline tests, including17 scheduler tests, including the exact24.220s/27.300s durations and30-minute golden schedule.
-249 focused web tests including hosted lineage, no timeline persistence for bad timings,
  truthful stopped status and absence of futile retry/provider submission.
- Full original source through patched local worker:3636 words,588 phrases,
  maximum word1330ms; source still1136509ms. Healthy first chunk reused; second recovered.
- Provider-free plan:250 scenes,34095 frames,65 avatar spans,21.00894559% avatar coverage.
  This is local semantic planning proof, not a production accepted timeline or full-video proof.
- Build, Web/Worker types, changed-file lint, Ruff and secret scan passed.
- Real user Chrome, visibly synthetic fixture, revised stopped state and no planning Retry;
  production tab restored without clicking retry. Screenshot `/tmp/vf-asr-timing-fixture.png`.

Private source/transcripts and tool output remain outside Git. No model was downloaded;
local qualification used the installed worker's pinned Whisper/model/FFmpeg tools.

## Pre-approval release and recovery requirements

Cloud Linux runtime/image and native Desktop package qualification/publication are required:
this shared Python code runs in both. The web application must also be published with current
bindings, secrets, workflow identities and native/runtime pins preserved. Local build proof
does not establish those published identities. Docker daemon is unavailable on this host;
no remote builder or CI mutation had started at that local handoff. These publication gates
are now resolved by the approved release below.

For the existing project, first re-read exact revision/attempt/result checksum, account/project
admission, sibling CPU states and complete provider inventory. Guard a same-project immutable
successor revision retaining original voiceover asset/checksum and all preset choices; preserve
old accepted ASR/context evidence. Retire only demonstrably unstarted siblings/admission, retain
an auditable exact source-receipt alias, then create one fresh normal ASR attempt using the qualified
runtime. Do not overwrite an accepted transcript or simply retry planning. Existing migration0215
covers failed ASR only and must not be forced onto this SUCCEEDED-but-unschedulable result.
The successor transaction needs native rollback/tenant/lineage qualification before live execution.
Keep downstream paid prompt/image/avatar generation paused until repaired transcription and
canonical planning are accepted. Stop on conflicting identity, executing work, ambiguous provider
state, changed rate or cap risk.

Proposed combined external boundary: publish qualified app/Cloud/native artifacts; perform the
single guarded same-project transcription recovery and context/planning acceptance; finiteUSD1
cap for recovery actions, one Cloud rental at most900s. Read-only current SecureRTXPRO4500
BlackwellServerEdition32GB rateUSD0.72/hour,100GiB ephemeral disk gives observed all-in
USD0.7338888889/hour;900s aboutUSD0.1834722 before rounding. No retained volume/recurring
volume charge. No new TTS or unrelated test video. Any downstream full-video generation remains
separate from this bounded timing-repair scope. The user subsequently approved this exact bounded proposal.

## Spend and cleanup

At the local handoff, new provider spend wasUSD0 and no external publication/paid compute had started.
The approved live recovery now has oneUSD0.20 Cloud reservation; final reported spend and cleanup
are recorded below. No retained volume or new model download.
Read-only complete RunPod inventory:0 total Pods and0 owned Pods. The original Cloud ASR
reservation is CLEAN with cleanup verified2026-10-04T08:09:05.801Z. Invoice is unverified.

## Approved publication and bounded recovery

User approved: “approved,go ahead, fix and push to production.” Scope and limits above are accepted.
Desktop0.1.49 builds Windows and Mac successfully in Actions37190052431 from82dfb695;
Linux initial run37190054279 passed real media/transport and failed only because the added test mount
was too shallow for its repository-relative import. Corrected mount is included in the next qualification.
Additive0257 provides owner-only accepted-output-checksum-bound successor recovery, preserves old
ASR/context/revision/source bytes, retires only pre-plan admission and records an audit. A durable
preparation-only alias makes paid prompt loading return WAITING, so accepted planning cannot
start images/avatars under the timing-repair authority. Runtime cannot invoke the operator recovery.
Existing unrelated cleanup-only reservations use migration0235's full fencing predicate and remain
untouched; the inspected historical STOPPING row is not released by this repair.
PGlite exercises rejected cross-tenant/checksum/runtime calls, unstarted render rejection, immutable
successor/replay/source alias/private negatives and paid-stage hold. Native transaction rollback on
the actual failed project passed before migration257 was applied; original project evidence was
deep-equal before/after rollback and application. Runtime has no operator execution grant.

## Published qualification and parity

Desktop0.1.49 from82dfb695 is published at `media-worker-v0.1.49`; Windows/Mac native Actions
37190052431 pass. Complete installers match both release manifest and GitHub asset hashes:
Windows279626340 bytes, `9338d7c812fe5131c70681ebbd1a3fb41dd7e577adc136778e835d13e1520f60`;
Mac414292035 bytes, `276ddd579f6275344bea672de5c525781ab859f18bf8d75d4b357ac22345821e`.
Execution bundle `a2d03010519d4586785ba6f04528b5bf5c1c8eb4b63b803d8162133ae02f52e9`.

Cloud Actions37190484208 from65d28fab passes real offline ASR/span/render, whole/split Fal and
legacy rendering,77 transport checks and37 transcription checks inside the exact Linux image.
Qualified image digest `8ffb9239eafe74147031f5aa15e88f7a009524ed29e7f680873b13f8a94550c9`;
source `2e3a6f9440f6faacda439520134ba9876058f4bebbcbc1f88002ed5c188da9a0`;
runtime `24b8ba9357ada3d8417e2b8c2482df88e25202035833a40f78e219d95900f6d7`.
Registry manifest/small runtime-layer hashes, all39 reviewed source files and pinned Whisper1.8.4/
base.en/FFmpeg8.1.2 match. Temporary package-publish secret deleted and absence verified.

App source65d28fab, Worker `fe1af150-d8c3-4210-8866-fc6d941f5a88`,100% traffic. Status commit,
29 public assets,53 bindings,26 secret names and three Workflow identities verified; only intended
new worker/Cloud runtime/authority pins changed. Final284 affected web checks, two SQL recovery
suites, types, lint, production build, context and tracked-secret scan pass. Same-account ongoing
Cloud policy is cloned with new qualified pins; old authorities/reservations stay immutable.
Native257 ledger/rollback/operator-only privilege/hold/idempotence checks pass. Owner200,
foreign404 and anonymous401 verify current private project access. Real signed-in Chrome shows
Needs attention, the exact lost-timing explanation and no planning-only Retry on the original result.

Live successor `3b8159bf-1b9d-4622-bf8d-3074f2f9bf64`; fresh normal ASR
`090ad4e3-81cd-4406-903b-7d0d5537b6bb`. Exact accepted old ASR/revision/context/reservations were
compared after successor creation and remain unchanged; old unstarted admission is audited and
retired. One100GB rental,900s/USD0.20 cap, approved RTXPRO4500ServerEdition, all-inUSD0.7338888889/hour,
no retained volume; paid prompts hold is true and there are no prompt/image/avatar jobs. No second
rental or provider replay is authorized. Final acceptance and zero-compute readback are complete below.

## Final live acceptance and additional replay defect

New Cloud ASR accepted447359 bytes with checksum
`05c8a0dfe48c62eb379995d6415cbfc61408d26be7ce60666452c75283d49d6c`:
3636 words, maximum1330ms, original1136509ms duration. Whole R2 result/timeline readback matches
accepted length/hash. Canonical timeline120628 bytes, hash
`4283a924b706734ab522aeab4f841554a5e2e5c5ffc0b7b6f4a78b6ca1d01790`:
248 segments,34095 frames,65 avatar spans,21.13506379% avatar coverage. Source audio and every preset
pin match the prior revision; the new immutable revision legitimately has a new derived schedule.
Historical accepted ASR/revision/context remain deep-equal to the pre-recovery snapshot.

Live verification exposed a second independent failure: concurrent browser/continuation planning
accepted the same canonical plan but later callers received500. Private Worker trace showed
`hosted canonical timing idempotency conflict`; the two per-request display clock fields differed
while semantic plan identity stayed exact. Migration0258 from `5c09c192` excludes only
`timeline.asset.metadata.planning_started_at` and `planning_completed_at` from the exact append-payload
replay comparison. First accepted timestamps/payload remain unchanged; all source/timeline/task/
semantic metadata/tenant checks remain exact. Native rollback reproduces the original clock-only
conflict, accepts repaired replay and rejects changed words/semantic metadata without altering any
accepted row. Two PGlite bridge/privacy/backup-restore checks pass with the clock regression; lint
and control-plane build pass. Native258 applied with ledger/hash readback and no data rewrite.
No worker, image, model, provider request or ASR retry was created for this database repair.

Production API now returns202 with idempotent_replay=true for the exact accepted plan. Signed-in
Chrome reload shows stages1/2/3 COMPLETE and Saved248 segments/65 avatar spans; screenshot
`/tmp/vf-asr-timing-live-complete.png`. Prompt endpoint202 WAITING explicitly states transcription
recovery is complete and generation is paused. Durable preparation_only remains true, zero prompt
runs, image/avatar provider jobs or render jobs; only the approved fresh ASR was submitted.
Both project rentals are CLEAN with cleanup verified; complete provider inventory0 Pods. The
unrelated historical STOPPING row still satisfies tenant-scoped cleanup-only fencing and is untouched.
Cloud conservative created-to-clean rounded estimate:2 minutes ×USD0.7338888889/hour =USD0.024462963;
new context provider reportsUSD0.00053, conservative recovery totalUSD0.024992963, below approvedUSD1.
USD0.20 is the reservation, not an invoice. Cloud settled invoice remains unverified.

No gate remains for the requested repair/publication. Downstream full-video generation is deliberately
held at the approved repair boundary; installed Local, whole-film editorial/playback/performance and
invoice acceptance remain distinct. App deployed source65d28fab/Workerfe1af150 remains the qualified
release; native258 source5c09c192 and the later documentation handoff are separate commits.
Private operator receipts: `.videoforge/asr-timing-20261004/` in the primary checkout; no audio,
transcript or credentials were added to Git. Primary unrelated dirty work remains untouched.

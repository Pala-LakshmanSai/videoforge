# ASR timing recovery — 2026-10-04

Checkpoint V2-09 / VF-10-09, profile `v2_09_j1tts_voiceover`. Isolated branch
`codex/asr-timing-recovery`, base `2da0f945`; resolve implementation commit from Git.
Status: local verified, not published. Original project remains unchanged.

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

## Remaining release and recovery gates

Cloud Linux runtime/image and native Desktop package qualification/publication are required:
this shared Python code runs in both. The web application must also be published with current
bindings, secrets, workflow identities and native/runtime pins preserved. Local build proof
does not establish those published identities. Docker daemon is unavailable on this host;
no remote builder or CI mutation was started.

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
separate from this bounded timing-repair scope. No approval for this proposal has been recorded.

## Spend and cleanup

New provider spendUSD0; no external mutation, publication, model download or paid compute.
Read-only complete RunPod inventory:0 total Pods and0 owned Pods. The original Cloud ASR
reservation is CLEAN with cleanup verified2026-10-04T08:09:05.801Z. Invoice is unverified.

# Cloud audio spanning: measured bottleneck and recommended plan

Checkpoint V2-09 / VF-10-09. Investigation only; proposed changes are not implemented or deployed. Production source remains `661b6ddf7a17666568d5758479da37fc8e50c68f`; context baseline `e72179444c7b02bac9644cf884120daccd2236da`.

## Measured evidence

The completed normal 30m07s project used 105 Cloud spans and 30 consecutive span rentals. Attempts span 08:47:46.276722–09:47:56.180980 UTC, approximately 60 minutes including the earlier handoff repair. This is not a clean matched performance baseline.

After 09:12 UTC, 88 spans completed on 22 four-clip rentals. Submitted-to-terminal median was 17.210343s, mean 18.290365s. Rental creation-to-independent-CLEAN averaged 94.725239s. Continuing that four-clip cadence projects about 43 minutes for 105 clips, not a newly measured run. Raising the clip ceiling alone leaves roughly 32 minutes of submitted-to-terminal work at that mean; this projection cannot isolate individual network/control components.

Provider-free local benchmark used the exact owned 43,366,609-byte MP3 and all 105 saved materializer input selections loaded through scoped read-only database queries. These include the actual outward 40ms snapping, rather than the unsnapped canonical selection. Padded audio totals 490.96s. The unchanged production `_ffmpeg_arguments`, source checksum verification, FFprobe validation, exact WAV sample checks, output checksum and deletion ran for every clip.

| Local concurrency | First run | Second run | Mean |
| --- | ---: | ---: | ---: |
| 1 | 13.035810s | 13.226048s | 13.130929s |
| 2 | 6.977618s | 7.021227s | 6.999423s |

All 420 exports passed 48kHz/mono/PCM16/exact-sample-duration checks. All 105 local byte checksums matched across all four runs. Outputs total 47,136,780 bytes per run; temporary WAVs were removed immediately, with at most two present. Input Downloads media and accepted Cloud assets were untouched. A preliminary benchmark used canonical rather than saved snapped bounds; it is superseded and excluded from the reported numbers.

This measures local export/hash/probe work, not the full child CLI, Cloud hardware, network, control requests or production output equivalence. Local FFmpeg is 8.1.1; none of these local WAV checksums matched the saved Cloud checksum. The reason was not investigated; the local benchmark does not qualify replacement Cloud outputs. No audio-algorithm change is proposed.

## Causes supported by source

1. `workers/media-local/src/videoforge_media_local/runpod_job.py::_download_inputs` calls `_download` for each attempt. `run` deletes its entire scratch tree before the next span. Reusing a Pod currently does not reuse narration. The same verified source is transferred 105 times: 4,553,493,945 bytes (4.24GiB), versus 43.37MB once. This is code-derived transfer volume, not measured network traffic.
2. `execute_batch` and migration 0214 both enforce four spans per rental. Merely changing application configuration cannot remove that immutable runtime/database ceiling.
3. Every clip synchronously sends four phase callbacks, obtains two upload authorities, completes, then requests cleanup/next-spec. Authorization, completion, handoff and `buildSpec` perform multiple tenant transactions. `tenant` creates and closes a database pool per invocation. These repeated round trips are a strong overhead mechanism; no request-level profiler was available to assign exact seconds to them.
4. The export seeks before opening the input and has no GPU operation. It already avoids decoding the entire narration for every cut. A faster GPU or a new decode-once algorithm does not address the observed difference between approximately 13s of local export work and the Cloud stage.
5. The continuation sweep starts dispatch only after the prompt set is accepted; ordinary API dispatch prepares all spans before materializing API jobs. The span materializer itself requires exact admitted revision/timing/source/task lineage, not prompt acceptance. In this project selections existed at 04:55:39 UTC, but span attempts started at 08:47:46. Prompt recovery delays contributed to that gap; it is not a normal prompt-speed benchmark.

## Recommended order

### 1. Reuse the source and one bounded worker

Reuse the existing `_download_span_source` verified-source cache, scoped to one rental/project/revision and discarded at process exit. Preserve URI/SHA/byte equality, corruption rejection, private paths, renewal and cancellation. Reuse only immediately ready spans while the existing rental deadline, remaining budget and authority permit; never extend the deadline or wait for prompts/Kie/Fal on a rented machine. A finite clip ceiling must remain.

This needs a newly qualified immutable runtime and additive database migration. Keep historical four-span attempts compatible. It reduces downloads and rentals but cannot by itself remove the observed per-clip control overhead.

### 2. Batch control work without combining acceptance

Claim small groups of 8–16 exact existing attempts; obtain their upload authorities together after output facts exist; verify/complete the group through fewer requests and database connections. Reuse a request-local pool with separate transaction-local tenant settings and fresh fencing checks. Keep network reads outside database locks. Each WAV retains its own object, checksum, result, receipt, cancellation outcome and recoverable state. Lost replies must reconcile exact accepted members before claiming anything new.

Use at most two cuts/uploads at once and a bounded worker heartbeat rather than blocking the next clip on four phase requests. Do not introduce a permanent pool or widen the one-account/two-account admission policy. Avoid 105 independently polling observers for one physical worker where existing orchestration can consolidate observation; durable per-attempt recovery must remain.

This is the main change needed for a substantial reduction. A first Cloud target is **5–10 minutes for this 105-clip workload**, explicitly a design target, not a measured prediction or promise. CPU work is already seconds; unknowns include provider placement, transfer latency, receipt checks and database behavior under real load.

### 3. Overlap with prompt writing

Once the admitted immutable timeline and verified source are ready, schedule audio preparation alongside prompts. Shut its worker down when spans finish. Keep provider submission behind accepted prompts and each required verified audio dependency; early audio completion must not attempt paid API dispatch before prompts are ready. Cancellation and lease renewal must cover both branches. This shortens total video wall time even when the span timer itself is unchanged.

Streaming Kie/Fal dispatch per accepted dependency could remove another global barrier, but changes more admission/budget/materialization behavior. Defer it until the span changes are measured; no provider/backend switch is needed.

## Verification before publishing

Use the current qualified Linux tool/runtime pins. Check exact output facts, source corruption, tenant/revision mismatch, cancellation, expired rental/authority, crash after a partially completed group, lost completion/next-group replies, accepted-prefix reuse, no duplicate claims, and automatic independent shutdown. Measure one short genuine Cloud run before one matched 105-clip run. Stop optimization once the measured target and reliability gates pass.

Investigation made zero provider mutations and zero paid POSTs. Complete native inventory at **2026-09-30T12:45:45.276Z** independently confirmed zero Pods, including zero owned media Pods. No retained resource was created. Current scoped Cloud authority expired at 12:30 UTC; a new paid qualification would need a finite scoped authority. Whole-app download/restore/historical activation/editorial gates remain as recorded in CURRENT_STATE; this investigation does not close them. Context validation and whitespace checks pass; existing optional reference-file and profile-budget warnings remain. No application source changed or additional application test gate was claimed.

Detailed private evidence: `.videoforge/long-cloud-20260930/span-performance-source-private.json`, `span-performance-materializations-private.json`, `benchmark-span-cpu.py`, `span-cpu-benchmark-1790772659852422000-private.json`, completed monitor snapshots, and `.videoforge/cloud-media/final-owned-complete-inventory-1790772345277-private.json` in the primary checkout. No private documents or credentials are included here.

# Span preparation stall and performance repair

Checkpoint: V2-09. User requested exact Chrome diagnosis, focused speed repairs, tests, commit, push, and production deployment. Existing project continuation only; no fresh paid generation or GPU configuration changes authorized by this repair.

## Observed before repair

- Real Chrome project `fc4ada08-9e54-43e8-a548-30ccf51622d4`: 11/65 clips ready, one cutting, 53 queued; images waiting for audio.
- Read-only production DB: first 11 SPAN_AUDIO attempts SUCCEEDED. Their execution intervals were about 11-21 seconds, followed by roughly 28-31 seconds before the next claim (except initial preparation overlap).
- Attempt `72cf1b4c-652f-5d19-8d3a-4ec257f208ea` repeatedly claimed at 16:55:24, 17:00:28, 17:05:30 UTC. Each lease heartbeat equals claim time; prior leases expired. No FFmpeg child or per-job scratch exists; process sampling shows idle/network operations.
- Exact active job-spec R2 GET returns 404. Control GET of a succeeded span spec returns HTTP 200, matching declared bytes/checksum. No credential, signed URL, or source media content retained here.
- Claim commits RUNNING before fetching the job template; missing template throws, leaving a five-minute lease without execution. Thus UI cutting is a claim reservation, not observed media work.
- Hosted scheduling catch deletes the deterministic template even when concurrent scheduling already committed the same attempt. Completion reconciliation schedules all still-unaccepted spans, allowing overlap with initial preparation.
- Worker additionally sleeps five seconds after successful jobs and downloads full voiceover for every clip. FFmpeg already uses input-side seeking; no speculative decoder changes needed.

## Acceptance boundary

Repair the missing-template race/recovery and avoid redundant per-clip work. Reuse the current project's completed stages and artifacts. Focused regression tests, production deployment and original Chrome continuation determine acceptance. Record actual subsequent gates and provider/compute state; do not infer full-video completion from local tests.


## Local worker benchmark and focused validation

- Used the current project's latest successfully completed span template and exact source voiceover, retrieved read-only. Source size: 26,197,263 bytes; SHA-256 matched the pinned source identity.
- One source GET took 3.229 seconds. Reusing the new cache, including full checksum verification and copying into a new attempt directory, took 0.0973 seconds. These are single local measurements, not production end-to-end timings.
- The exact span input executed with real FFmpeg/FFprobe in a fresh canonical temporary artifact directory: `SUCCEEDED`, 0.449 seconds including CLI startup. No provider job, claim, or production replay was created by this benchmark.
- Initial local harness runs used the wrong artifact-root layout and then an already populated directory; both were rejected. Using the worker's `_local_path` and a fresh canonical temporary directory corrected the harness. These were benchmark setup errors, not additional production failures.
- Worker now immediately polls after a completed claim. Idle/error polling retains its delay. A single private temporary voiceover cache is bounded at 256 MiB, keyed by source URI/checksum/size, verifies bytes before reuse, replaces changed/corrupt sources, and is removed at process exit.
- `.venv/bin/python -m unittest discover -s workers/media-local/tests -p test_personal_worker.py`: 40 tests passed, including immediate next-claim polling and cache reuse/corruption/source separation.
- Focused Ruff check on `personal_execution.py`, `personal_worker.py`, and `test_personal_worker.py`: passed.
- The worker's generic claim/parse exception path backs off; the observed failure occurred on the hosted claim response before parsing or execution. No speculative parser change was needed. The cache/polling improvements require the rebuilt worker to be installed.

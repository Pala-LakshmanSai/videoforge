# VideoForge media-local worker

CP-03 promotes the existing provider-free whisper.cpp path through this CPU-only entrypoint. Mac
development and the future Cloud Run Job call the same `videoforge_media_local.cli transcribe`
command and receive the same `asr-job-result/v1`, immutable chunk receipts, and
`videoforge.transcription-work-receipt/v1`.

Original voiceover bytes remain immutable final-render truth. The worker normalizes a separate
16 kHz mono PCM analysis WAV, chunks long inputs with deterministic 5-second overlaps, assigns each
overlap midpoint to exactly one chunk, and deletes transient normalized/chunk audio after publishing
the durable result.

`Dockerfile` builds the same CPU-only job entrypoint from digest-pinned multi-architecture Python
3.12.13 and static FFmpeg 8.1.1 bases. It checksum-verifies and compiles whisper.cpp 1.8.4 with
GPU and native-host tuning disabled. It never downloads or embeds a model. The existing pinned
`ggml-base.en` model is mounted read-only at runtime; missing or hash-mismatched bytes fail closed.
The durable receipt binds the exact whisper, FFmpeg, and FFprobe executable hashes used by the run.

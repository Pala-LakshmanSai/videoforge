# VideoForge media-local worker

CP-03 promotes the existing provider-free whisper.cpp path through this CPU-only entrypoint. Mac
development and the future Cloud Run Job call the same `videoforge_media_local.cli transcribe`
command and receive the same `asr-job-result/v1`, immutable chunk receipts, and
`videoforge.transcription-work-receipt/v1`.

Original voiceover bytes remain immutable final-render truth. The worker normalizes a separate
16 kHz mono PCM analysis WAV, chunks long inputs with deterministic 5-second overlaps, assigns each
overlap midpoint to exactly one chunk, and deletes transient normalized/chunk audio after publishing
the durable result.

`Dockerfile` intentionally has no default base and never downloads a model. CP-08 must supply one
qualified digest-pinned base containing exact Linux builds of Python 3.12.13, whisper.cpp 1.8.4,
FFmpeg 8.1.1, and FFprobe 8.1.1. The existing `ggml-base.en` model is mounted privately at runtime;
missing or hash-mismatched bytes fail closed.

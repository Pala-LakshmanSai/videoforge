# VideoForge media-local worker

CP-03 promotes the existing provider-free whisper.cpp path through this CPU-only entrypoint. Local
development and the signed Windows/macOS personal worker call the same
`videoforge_media_local.cli transcribe` command and receive the same `asr-job-result/v1`, immutable chunk receipts, and
`videoforge.transcription-work-receipt/v1`.

Original voiceover bytes remain immutable final-render truth. The worker normalizes a separate
16 kHz mono PCM analysis WAV, chunks long inputs with deterministic 5-second overlaps, assigns each
overlap midpoint to exactly one chunk, and deletes transient normalized/chunk audio after publishing
the durable result.

`personal_worker.py` is the zero-configuration background client. It pairs once through the hosted
browser, keeps its account credential in macOS Keychain or Windows Credential Manager, starts at
login, and claims only account-owned leases over outbound HTTPS. It streams final video uploads so
large renders are not loaded into RAM, holds the OS sleep assertion only while working, kills the
exact process group on cancellation, and removes per-attempt scratch in `finally`.

The native wrapper accepts only Windows x64 or macOS universal2 runtime identities. It rejects
non-HTTPS control/pairing URLs, validates the exact PKCE enrollment/token responses, and exits
cleanly on `UPDATE_REQUIRED` so an installer can replace the old executable. Network loss preserves
the paired OS credential and retries the same device with bounded backoff. `--uninstall` removes
the local installation record, OS credential, and macOS LaunchAgent without contacting the control
plane; remote device revocation remains an authenticated Settings action.

Cancellation, process-group termination, and the active-job sleep assertion remain owned by
`personal_execution.py`; this wrapper slice does not alter that execution owner. Local contract
tests cover the native boundary, but real Windows/macOS cancellation, sleep/wake, offline/reconnect,
clean-install, and update/remove observations remain native acceptance work.

The historical `Dockerfile` remains rollback/source evidence and is not an active production target.
The desktop release bundles checksum-pinned whisper.cpp 1.8.4 and FFmpeg/FFprobe 8.1.2 executables.
It never discovers tools or providers at runtime. The pinned `ggml-base.en` model arrives only as an
exact private job input; missing or hash-mismatched bytes fail closed. Durable results bind the exact
tool identities used by the run.

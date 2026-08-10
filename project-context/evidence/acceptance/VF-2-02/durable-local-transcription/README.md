# VF-2-02 durable local transcription and span audio

Status: technically verified; VF-2-02 complete

Implementation commit `9e79b856d0e267a8755432bcc330986923bcf3e0` adds provider-free local
transcription persistence and exact selected padded-span audio materialization. The final uncached
verification and local-slice acceptance ran on the exact candidate bytes committed there.

## Durable transcription proof

- Canonical `asr-job-input/v1`, `asr-job-result/v1`, and `transcript-timing/v1` documents are
  validated and JCS-hashed before persistence. Source voiceover bytes, pinned local whisper.cpp
  engine/model facts, options, tool version, transcript bytes, and input fingerprint are bound to
  deterministic artifact and lineage identities.
- The canonical transcript artifact, accepted `TRANSCRIBE` attempt, word/sentence/phrase records,
  and timing head advance commit in one database transaction. Cancellation or stale timing state
  rolls all accepted database state back; only harmless unreferenced content-addressed bytes may
  pre-exist a failed transaction.
- Exact retries replay without duplicate artifacts or timing rows. A changed model appends an
  invalidation, preserves the first immutable transcript, and accepts a second transcript with an
  explicit ordered supersession link.

## Selected span-audio proof

- One strict job contains only the selected padded avatar interval and its trim facts; it never
  carries the complete voiceover as an avatar input.
- The local Python bridge invokes explicit absolute FFmpeg and FFprobe paths with argument arrays,
  no shell, network, provider, or download. It emits deterministic mono 16 kHz PCM WAV, verifies
  duration/profile/checksum, and publishes immutable content-addressed bytes.
- Control-plane acceptance binds the exact current transcript, timeline, segment, selected span,
  task key, source asset/checksum, padded boundaries, accepted `PREPARE` attempt, output asset, and
  output checksum. Optimistic timing-head and span versions fence invalidation races.
- Two independent real FFmpeg executions of a synthetic 12-second owned WAV produced identical
  five-second output hashes and byte sizes. Hostile unknown fields, duplicate result properties,
  control characters, fractional boundaries, bad checksums, wrong duration, and cancellation fail
  closed.

## Audit findings closed

The corrective audit closed every finding before acceptance:

1. Transcript persistence now verifies that a sourced canonical artifact is the exact output of
   the accepted local transcription attempt and that its input hash matches.
2. Model invalidation and replacement-lineage coverage proves immutable prior history and exact
   ordered supersession.
3. Span materialization is transactionally fenced against cancellation/invalidation and cannot
   leave an accepted orphan artifact or attempt.
4. Span ownership now binds artifact metadata and the generation task to the persisted task key,
   source identity, timeline lineage, boundaries, and attempt input hash.
5. Both job boundaries reject non-finite/duplicate/unknown/unsafe input facts, including hostile
   existing result files and control-character task keys.

No high or medium audit finding remains. Source inspection found no provider dispatch, cloud or
account mutation, credential operation, ambient secret access, model download, or spend path.

## Verification

The final `TURBO_FORCE=true pnpm verify` exited 0 with zero Turbo cache hits on the committed
candidate. It passed formatting, JavaScript/Python lint, TypeScript checks, generated parity,
context/schema validation, tracked-file secret scan, stable generated routes, local Workerd parity,
and installed Chrome.

- Control plane: 127 passed, 0 failed, 0 skipped.
- Pipeline: 37 passed, 0 failed, 0 skipped.
- Web unit/integration: 148 passed, 0 failed, 0 skipped.
- Canonical contracts: TypeScript 53 passed; Python 42 passed.
- Python workers: 56 passed across six explicit suites, including 10 span-audio cases.
- Local Workerd: 1 passed.
- Installed Chrome: 36 passed, zero skips.
- Synchronized canonical files: 50.

The refreshed `pnpm test:local-slice` completed at `$0`, with provider calls disabled, using the
already-installed whisper.cpp `1.8.4`, pinned local model hash
`sha256:a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002`, and FFmpeg/FFprobe
`8.1.1`. The 37.167-second owned MP4 and its API re-download both hashed to
`sha256:7acc789f9626e23bc12540a452d52822671ba85caf37bf4148e0a6def665e276`.

The required read-only dependency registry audit reported no known vulnerabilities. Secret scan,
diff check, and clean-worktree checks passed. No remote/cloud/account mutation, credentials,
provider call, model download, publication, or spend occurred.

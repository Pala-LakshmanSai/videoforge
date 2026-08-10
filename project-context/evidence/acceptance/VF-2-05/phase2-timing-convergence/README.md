# VF-2-05 Phase 2 timing convergence

Status: technically verified; VF-2-05 and Phase 2 complete

Implementation commit `907e0e4908bddc1ec7b90232f043a10d9c7d5b2a` converges the committed
transcription, deterministic timeline, selected-span audio, local render, and inspection interfaces
into one provider-free flow that can restart and restore without rerunning accepted work.

## Durable convergence proof

- The local media runner extracts every selected Avatar span from the exact owned source audio with
  the scheduler's 500 ms padding, exact trim bounds, and deterministic 16 kHz mono PCM WAV output.
  Each content-addressed span records its segment/task identity, selected and padded times, hash,
  bytes, and probed duration.
- A canonical `phase2-runtime-state.json` binds source/output documents, accepted result, evidence,
  and every selected-span hash. Bootstrap restores only the latest complete attempt and revalidates
  all content-addressed bytes, canonical documents, revision/output lineage, acceptance/provider
  facts, and the current owned voiceover hash.
- A missing or corrupt selected span, document, output, evidence record, render result, or latest
  attempt fails closed. Restore never falls back to an older attempt and never invents readiness.
- Server and client both require all planned selected spans to be materialized with exact
  task/time/padding lineage and valid WAV bytes before timeline readiness. The preserved disclosure
  shows `N/N spans materialized` and the short audio hash.
- The control-plane acceptance composes selected-span jobs and acceptance with the durable timing
  flow, exports metadata, restores into a fresh database, and proves byte-identical canonical
  timeline output plus identical materialized-span metadata.

## Real owned-audio proof

The isolated local acceptance used a fresh artifact root, completed owned fixture
`local_short_slice_owned_001`, started a fresh runtime process, restored the accepted revision
without rerunning ASR/render, and downloaded bytes identical to the accepted output.

- Source SHA-256:
  `sha256:83aecc10d7fd716bf114b8f9b191764ab9a0801e2c15f9775907297479518599`.
- Transcript SHA-256:
  `sha256:66be9ffa12740282a250bfa7431f6806ace747a03325676ef069d07b6ddca124`.
- Timeline SHA-256:
  `sha256:7a114d2e33b02f21ab683d20a073f133415f160e544ef379ee9db35aabb66e6a`.
- Approved and downloaded MP4: 1,957,674 bytes, 37,167 ms, 1,115 frames, SHA-256
  `sha256:7acc789f9626e23bc12540a452d52822671ba85caf37bf4148e0a6def665e276`.
- Run evidence SHA-256:
  `sha256:c511a2da4df204503f064e3347cfb4bf969eba1dc55f42d6c442ebc9695cab5b`.
- Span `seg_0a6c48eb`: selected 0–4,700 ms, padded 0–5,200 ms, 166,444 bytes,
  `sha256:3828fa64b0e1007b80b0c1fe67910a8160c24bd92f2df141dccfe9121e2d2dc3`.
- Span `seg_4c480a05`: selected 15,360–18,580 ms, padded 14,860–19,080 ms,
  135,084 bytes,
  `sha256:ec73f05b9f972f5237d7630d398279d2d4f855dcd8ae1f9c40010ad352ddc2f0`.

Two independent runs produced identical transcript, timeline, output, and selected-span hashes and
bytes. Runtime-bearing ASR diagnostics may differ; accepted canonical documents and media do not.

## Installed-Chrome proof

`pnpm --filter @videoforge/web test:local-chrome` used installed Chrome against an isolated local
artifact root. It created a real project, waited for real ASR/render, inspected materialized spans,
opened the disclosure by keyboard, verified focus and overflow, played the MP4, approved it, and
downloaded matching bytes. The journey had zero external requests, failed responses, console/page
errors, unnamed controls, or horizontal overflow. It passed 1/1. The canonical fixture matrix also
passed 38/38 with zero skips, preserving the accepted shell and output grammar.

## Verification and audit closure

The exact source tree later committed as `907e0e4908bddc1ec7b90232f043a10d9c7d5b2a` passed
`TURBO_FORCE=true pnpm verify` with zero Turbo cache hits: formatting, JavaScript/Python lint,
typecheck, database/migrations, generated parity, context/schema checks, tracked-file secret scan,
build/route stability, local Workerd parity, and installed Chrome all exited 0.

- Control plane: 131 passed.
- Pipeline: 39 passed.
- Web unit/integration: 163 passed.
- Provider sandbox: 39 passed.
- Canonical contracts: TypeScript 53 passed; Python 42 passed.
- Python workers: 56 passed.
- Root scripts: 6 passed.
- Local Workerd: 1 passed.
- Installed Chrome: fixture 38 passed plus local convergence 1 passed; zero skips.

The read-only dependency registry audit reported no known vulnerabilities. All VF-2-05 audit
findings are closed; no high or medium finding remains. No remote/cloud/account mutation,
credential operation, provider call, model download, deployment, publication, or external spend
occurred.

## Stop boundary

This handoff consumes the standing provider-free implementation authority through VF-2-05. There is
no exact Phase 3 implementation brief in the repository. The next chat must perform the
consolidated gate/authorization and exact-brief planning checkpoint, not begin Phase 3 from the
high-level roadmap. Provider qualification, credentials, remote publication, cloud/account work,
deployment, and spend all require new explicit authority.

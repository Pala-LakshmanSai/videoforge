# VF-2-04 real-audio timeline inspection UI

Status: technically verified; VF-2-04 complete

Implementation commit `f5e33ac2a8aede6c4d888707d309095ba2ca5b98` adds a project-scoped,
fail-closed inspection of canonical transcript timing and deterministic timeline coverage while
preserving the accepted shell, density, dock, Hubs, disclosure hierarchy, and provider-free local
runtime.

## Persisted coverage proof

- The local media runner stores the exact RFC 8785/JCS `transcript-timing/v1` and
  `timeline-plan/v1` bytes in the local content-addressed store and rejects any persisted-object
  hash mismatch.
- The local inspection adapter rereads those stored objects, verifies binary identity, fatal UTF-8,
  strict JSON, canonical contract schema/hash, selected revision, exact contiguous frame,
  source-audio, and transcript-word coverage, and exactly one segment owner for every canonical
  phrase.
- Waiting data is not inferred from project progress. Missing artifacts report `WAITING`; invalid
  bytes, hashes, JSON, schema, or revision lineage report `MISMATCHED`; and coverage gaps report
  `UNCOVERED`. Every non-current state is not ready and exposes an exact recompute/blocker state.
- The client repeats the readiness invariant and refuses a server response that claims `ready` while
  reporting stale, incomplete, mismatched, uncovered, blocked, or structurally incomplete coverage.
- The project UI exposes phrase timing, exact source duration, segment/frame coverage, selected
  avatar spans/share, layout assignments, and transcript/timeline hashes behind the established
  disclosure hierarchy. It adds no timeline editor, debug/provider noise, or project-local upload.

## Real local audio proof

`pnpm local:doctor` passed with the already-installed local toolchain and model; no model download
occurred. `pnpm test:local-slice` then completed owned source fixture
`local_short_slice_owned_001` through transcription, deterministic scheduling, local render,
approval, queryless download, and the new persisted timeline inspection assertion.

- Attempt: `attempt_render_local_018`.
- Source voiceover: 37,154 ms, SHA-256
  `sha256:83aecc10d7fd716bf114b8f9b191764ab9a0801e2c15f9775907297479518599`.
- Persisted transcript: `sha256:66be9ffa12740282a250bfa7431f6806ace747a03325676ef069d07b6ddca124`.
- Persisted timeline: `sha256:7a114d2e33b02f21ab683d20a073f133415f160e544ef379ee9db35aabb66e6a`.
- Approved/downloaded MP4: 1,957,674 bytes, 37,167 ms, 1,115 frames, SHA-256
  `sha256:7acc789f9626e23bc12540a452d52822671ba85caf37bf4148e0a6def665e276`.
- Local run evidence SHA-256:
  `sha256:948b6297269a01f44708ea984f0f6109f053533ee124d0faade13a7033445a17`.
- Output remained 1920x1080 H.264/AAC, 30 fps, decode-valid, with hard cuts only, the required
  slow smooth image zoom, and every prohibited decorative/text output false.

## Installed-Chrome proof

The exact new installed-Chrome journey passed in both desktop and compact Chrome. It verifies the
ready metrics, fixture-versus-local source truth, keyboard-opened phrase disclosure, Escape focus
return, transcript/timeline identity, no horizontal overflow, and a malicious `ready: true` plus
`UNCOVERED` response that the client still renders as not ready.

The full installed-Chrome matrix passed 38/38 with zero skips. It includes desktop/compact coverage,
the existing interaction and recovery journeys, and 1920, 1440, 1280, 1024, 820, 680, 430, and
390 px overflow/focus checks.

## Corrective findings closed

1. The first full build exposed a Node-only local artifact/schema adapter imported into the
   Cloudflare fixture bundle. Fixture document construction now uses only the runtime-neutral
   canonical JSON module, while persisted-object inspection remains isolated in the Node local
   adapter. Cloudflare local-origin parity passes.
2. The first full installed-Chrome run exposed a dock race where CSS transform easing could resume
   after the JavaScript spring settled but before pointer leave. Spring ownership now remains active
   for the full pointer-tracking interval. The exact compact test passed five consecutive targeted
   repetitions and the full desktop/compact run.
3. Canonical transcript and timeline hashes previously existed in the local result without the
   corresponding exact documents being stored. The runner now persists and verifies both canonical
   objects before the accepted result can continue.
4. Corrupt persisted timing, incomplete coverage, stale/mismatched response states, transport
   failures, and malicious false-ready client payloads all fail closed in automated coverage.

No high or medium audit finding remains. Source inspection found no remote/cloud/account mutation,
credential access, provider call, model download, deployment, or spend path.

## Verification

The final `TURBO_FORCE=true pnpm verify` exited 0 for the exact implementation tree committed as
`f5e33ac2a8aede6c4d888707d309095ba2ca5b98`, with zero Turbo cache hits. It passed formatting,
JavaScript/Python lint, TypeScript checks, database and migration suites, generated parity,
context/schema validation, tracked-file secret scan, stable generated routes, local Workerd parity,
and installed Chrome.

- Control plane: 131 passed, 0 failed, 0 skipped.
- Pipeline: 39 passed, 0 failed, 0 skipped.
- Web unit/integration: 161 passed, 0 failed, 0 skipped.
- Canonical contracts: TypeScript 53 passed; Python 42 passed.
- Python workers: 56 passed across six explicit suites.
- Local Workerd: 1 passed.
- Installed Chrome: 38 passed, zero skips.
- Synchronized canonical files: 50.

The required read-only dependency registry audit reported no known vulnerabilities. Context
validation, tracked-file secret scan, and diff check passed. No remote/cloud/account mutation,
credential operation, provider call, model download, publication, or external spend occurred.

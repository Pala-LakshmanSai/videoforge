# VF-9-17 real-provider render composition

Status: complete at `$0`.

## Durable composition

- `09c937a` extended accepted-asset resolution with immutable per-task acceptance proofs while
  leaving `resolved-render-manifest/v1` and fixture defaults unchanged.
- `c997cb9` added one server-side PGlite composition adapter. Callers receive exact durable Mage and
  Avatar candidate bindings; they cannot invent acceptance fingerprint, attempt, model, prompt,
  runtime, QA, review, checksum, provider operation, or cost lineage.
- Missing/rejected QA, task/attempt mismatch, cancellation, checksum/asset drift, invalid acceptance
  fingerprints, provider-operation drift, and cost non-conservation fail before render resolution.
  Rejected `VF-9-13` Mage and `VF-8-10` Avatar bytes are not accepted inputs.

## Fake-provider-shaped FFmpeg v3 proof

- One owned local `37.167` second candidate rendered as 1,115 frames with no provider capability or
  spend. Output: 1,957,674 bytes,
  `sha256:7acc789f9626e23bc12540a452d52822671ba85caf37bf4148e0a6def665e276`.
- Health/preflight, idempotent create replay, byte-range preview, exact-candidate approval, and exact
  download passed. Restart restored the persisted provider proofs and returned byte-identical media
  without duplicate execution or cost.
- Evidence document checksum:
  `sha256:860f906c522e92e247afb17bccb5fcd02a8b55d2af67538111bf979d39498303`.

## Installed Chrome and verification

- `162cf6d` completed installed-Chrome preview play, seek, approval, download, SHA-256 match, and
  downloaded-file playback. The local Chrome command exited `0`.
- Two full-gate attempts reproduced a two-worker Playwright close race after all 38 journeys had
  passed. The suite alone closed normally. `958d7bd` keeps two workers locally but serializes the CI
  installed-Chrome gate; focused Chrome passed 38/38 and exited `0`.
- `CI=1 TURBO_FORCE=true pnpm verify` passed at `958d7bd` and exited `0`: control-plane 213,
  web 212, pipeline 116, provider-sandbox 43, Workerd 1/1, installed Chrome 38/38, zero skips, plus
  build/typecheck/lint/format/context/schema/secret/generated-file checks.
- Hosted baseline run `31581717410` for `5b92bc4` completed successfully across every required lane
  before implementation resumed.

No provider call, credential, GPU, model download, RunPod/Runware/cloud mutation, profile promotion,
or spend occurred. Owned servers are stopped and fixture remains default.

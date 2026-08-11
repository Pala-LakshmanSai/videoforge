# VF-7-02 Image Style reference-binding evidence

Checked 2026-08-11 against implementation commit
`802a42b4171463cc22a504149047623c3b574a91`.

## Result

PASS at `$0` in provider mode `fixture`. No credential, provider, browser-reference, model, cloud,
network, or external-object-store activity occurred. The new path queries only durable Image Style
and artifact metadata; it does not read, upload, transform, inspect, or transmit reference bytes.

- Migration `0008_image_style_reference_contract.sql` has SHA-256
  `4ee3fb90a3818a93f754267ece96044dd837af13010978e37df0838b5f7eb8d1` and refuses to
  infer rights/source facts when legacy reference rows exist.
- Draft bindings preserve distinct original/normalized artifacts, exact workspace ownership,
  current-actor rights attestation, retention intent, order, and immutable verified media facts.
- Attach/detach is receipt-replay safe and allowed only before the first analysis attempt.
- Analysis resolution requires contiguous `ref_01..ref_N` bindings for 3–8 unique normalized
  hashes and returns exact checksum, MIME, dimensions, and byte count.
- `beginAnalysis` rejects an invalid reference set before task, attempt, cost, outbox, specialized
  attempt, or lifecycle mutation.
- Focused tests cover fresh and seven-migration upgrades, legacy-row refusal, workspace isolation,
  rights/retention/media validation, count/order/hash rules, replay/conflicts, `FAILED`-state
  immutability, reopen, and metadata restore.

## Verification

- Focused reference-binding tests: PASS, 4/4.
- Focused migration tests: PASS, 4/4.
- Targeted metadata export/restore tests: PASS, 4/4.
- Full `@videoforge/control-plane` tests: PASS, 142/142.
- `TURBO_FORCE=true pnpm verify`: PASS, including 142 control-plane tests, 163 web tests,
  115 pipeline tests, 43 provider-sandbox tests, 50-file contract sync, six Python 3.12 worker
  suites, local Workerd parity, context/schema validation, secret scan, stable builds, and 38/38
  installed-Chrome journeys.
- Targeted lint, typecheck, build, migration checksum, and `git diff --check`: PASS.

This task adds no upload/normalization implementation, byte inspection, EXIF handling, route, UI,
Gemini transport composition, provider call, Mage preview, cloud mutation, or original deletion.
Artifact metadata is consumed only at the pre-existing trusted private-artifact boundary and is not
claimed to prove actual byte safety. `GATE_STYLE_002` remains open.

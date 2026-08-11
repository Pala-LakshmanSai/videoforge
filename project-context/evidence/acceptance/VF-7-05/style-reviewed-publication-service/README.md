# VF-7-05 reviewed Image Style publication evidence

Checked 2026-08-11 against implementation commit
`f0e3e66a545634b3f145932156e56b7da6efe4da`.

## Result

PASS at `$0` in provider mode `fixture`. No credential, analyzer, provider, model download, GPU,
RunPod, cloud, external object-store, reference-byte, or real-network activity occurred.

- An authenticated workspace actor can resolve one bounded, frozen review snapshot containing the
  exact accepted canonical profile, profile hash, version/analyzer/disclosure facts, and only
  non-sensitive lineage identifiers and hashes.
- Publication re-resolves the active parent, `NEEDS_REVIEW` version, accepted general and
  specialized analysis attempts, canonical artifact, exact reference set, canonical request and
  model identity, and conserved cost before mutation.
- The reviewed profile is schema-, hash-, semantic-, prompt-guardrail-, and byte-validated against
  the exact accepted artifact. Manual edits are rejected.
- The existing repository transaction publishes the immutable version and moves only the same
  parent's active pointer. A forced pointer failure rolls back both mutations.
- Exact replay is stable after PGlite reopen. Stale, changed, malformed, archived, cross-workspace,
  actor-spoofed, incomplete-lineage, artifact-drift, and hostile stored-profile cases fail closed.
- The service has no analyzer, credential, ambient-environment, network, provider, signed-URL,
  reference-byte, or manual-edit capability. Schema head remains migration `0008`.

## Verification

- Focused reviewed-publication tests: PASS, 5/5.
- Combined VF-7-04 + VF-7-05 focused tests: PASS, 10/10.
- Full `@videoforge/control-plane` tests: PASS, 164/164.
- `TURBO_FORCE=true pnpm verify`: PASS, including 164 control-plane tests, 163 web tests,
  115 pipeline tests, 43 provider-sandbox tests, 50-file contract sync, Python worker suites,
  local Workerd parity, context/schema validation, secret scan, stable builds, and 38/38
  installed-Chrome journeys.
- Targeted control-plane and pipeline lint, typecheck, build, tests, formatting, secret scan, and
  diff checks: PASS.

## Source hashes

- `reviewed-publication.ts`: `fbcbc3cbf1ecb349e2108212292e0510feb49c4e5286e88e19383f990d0b5f6f`
- `pglite-repositories.ts`: `c73b33323f65bfc15f1163165eca6ab2e3138c07eb7b32fa091d282b6c5ac180`
- `semantic.ts`: `a10e8c2ce72e418b3e86eecb12974f3d7d8d36926f9d987f5b5336ef9b62f508`
- reviewed-publication tests: `81c804ec719781f4162abc33c37cb4ff7a31ed5e2c78f96d7b5f7828f48a7678`

This task adds no route, UI, upload, preview, manual profile edit, provider call, credential access,
spend, staging, or deployment. `GATE_STYLE_002` remains open because production qualification
evidence has not been executed. Manual-edit provenance semantics remain unresolved and must be
reconciled before an edit implementation is selected.

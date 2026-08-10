# VF-3-03 deterministic prompt compiler evidence

Checked 2026-08-10 against implementation HEAD
`3fcbcc310cf42be766b6fe90163d50e1c4620bb1`.

## Result

PASS at `$0` with provider mode `fixture` and no network/provider activity.

- Deterministic 25/40/50-scene batching sanitizes batch context once and preserves stable IDs.
- The fixture writer echoes all six code-assigned shot roles and never selects composition.
- Strict output validation rejects missing, duplicate, unknown, changed-role, extra-field, accessor,
  cyclic, control-character, blank, and oversized data.
- The compiler locks full 16:9 center-safe and split 8:9 centered-right-panel guidance, permanent
  output guardrails, five style inputs, optional normalized extras, normative component order, exact
  UTF-8 bytes, and SHA-256 hashes.
- Hard output/layout conflicts fail closed while `no logo`, `no text`, and `no AI look` remain valid
  negative refinements.
- Hash, component, byte-count, and final-string tampering fail closed.

## Verification

- Targeted `@videoforge/pipeline` lint, typecheck, and test: PASS, 47/47 tests.
- `TURBO_FORCE=true pnpm verify`: PASS, including 131 control-plane tests, 163 web tests,
  47 pipeline tests, 40 provider-sandbox tests, local Workerd parity, context/schema validation,
  secret scan, stable builds, and 38/38 installed-Chrome journeys.
- `git diff --check`: PASS before implementation commit.

No accepted UI, renderer, output grammar, schema, migration, route, provider, or cloud behavior was
changed.

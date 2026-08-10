# VF-3-06 style semantic foundation evidence

Checked 2026-08-10 against implementation HEAD
`68577e18916ab70b3390cc93d804a82bc77dab43`.

## Result

PASS at `$0` with provider mode `fixture` and no network/provider activity.

- Exact checksum-bound 3-8 reference requests accept only canonical aliases and bounded media facts.
- Deterministic fixture analysis covers all 14 exact style traits with aliases, support, conflicts,
  outliers, and content-separation controls.
- Semantic validation rejects reference identity, subject, object, location, brand, logo, readable
  text, layout replication, prompt injection, artist-copying, blank creative fields, invalid trait
  coverage, and inconsistent evidence.
- Trusted `image-style-profile/v1` assembly reuses the permanent prompt/output and crop rules,
  canonicalizes through the TypeScript RFC 8785 authority, hashes exact bytes, and freezes output.
- Optional negative suffixes remain valid when absent; full and split crop guidance remains locked.

## Verification

- Targeted `@videoforge/pipeline` lint, typecheck, and test: PASS, 55/55 tests.
- `TURBO_FORCE=true pnpm verify`: PASS, including 131 control-plane tests, 163 web tests,
  55 pipeline tests, 40 provider-sandbox tests, local Workerd parity, context/schema validation,
  secret scan, stable builds, and 38/38 installed-Chrome journeys.
- `git diff --check`: PASS before implementation commit.

`GATE_STYLE_001` and `GATE_STYLE_002` remain open: no real Gemini/reference analysis, publication,
provider qualification, reference upload, database, route, UI, cloud, or production behavior was
performed.

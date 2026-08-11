# VF-3-07 Runware DeepSeek prompt-adapter evidence

Checked 2026-08-11 against implementation commit
`062841411318103bae487a77205cf7eb4d9e7a3b`.

## Result

PASS at `$0` with provider mode `fixture`, injected fake transport, and no credential, network,
provider, filesystem, route, database, or cloud activity.

- Pins canonical AIR `deepseek:v4@flash`, `scene-prompt-writer-v1`, strict exact response shape,
  deterministic canonical request bytes/hash, settings, and 25-50-scene input identity.
- Validates strict JSON without duplicate-property loss, exact batch/scene IDs, unchanged shot roles,
  literal narration anchors, continuity fields, forbidden output, finish state, model, latency,
  usage, and caller-owned cumulative cost authority.
- Retains independently valid first-attempt rows, retries only unresolved expected IDs once, merges
  in original order, and never retries ambiguous, timeout, unknown-ID, duplicate-ID, changed-role,
  malformed-top-level, or invalid-evidence outcomes.
- Emits redacted attempt evidence containing hashes, IDs, retry lineage, latency, usage, cost,
  finish reason, and disposition without prompt text, response text, credentials, or signed data.

## Verification

- Targeted `@videoforge/pipeline` lint/typecheck/test: PASS, 84/84 tests.
- `TURBO_FORCE=true pnpm verify`: PASS, including 131 control-plane tests, 163 web tests,
  84 pipeline tests, 43 provider-sandbox tests, local Workerd parity, context/schema validation,
  secret scan, stable builds, and 38/38 installed-Chrome journeys.
- `git diff --check`: PASS before implementation commit.

This implements no live Runware transport or application composition. The deterministic fixture
writer remains the default, provider mode remains `fixture`, and external spend remains `$0`.

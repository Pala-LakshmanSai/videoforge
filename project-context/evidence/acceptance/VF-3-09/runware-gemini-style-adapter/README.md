# VF-3-09 Runware Gemini style-adapter evidence

Checked 2026-08-11 against implementation commit
`0445a0ce98c10800471ead8280ff0b201b03bfcd`.

## Result

PASS at `$0` with provider mode `fixture`, injected fake transport/reference resolver, and no
credential, network, provider, filesystem, route, database, or cloud activity.

- Pins canonical AIR `google:gemini@3.5-flash`, analyzer `style-analyzer-v1`, strict JSON output,
  low thinking, temperature `0.1`, top-p `0.9`, max tokens `6000`, and medium image resolution.
- Locks provider schema hash
  `sha256:78ccf3137849250901ff017a461a33bf22daad757c86ec320fb87942231ebad3` and system-prompt hash
  `sha256:3a0f2d2e27852c0b6c3d657b3a1e851e0ea48764101b38d7b9863dc99d3ea2fa`.
- Preserves exact ordered alias/hash identity through bounded HTTPS reference resolution and one
  canonical one-task request byte sequence.
- Validates task/model/finish/latency/usage/cost metadata, strict duplicate-safe JSON, and the full
  VF-3-06 schema, semantic, content-leakage, crop, and trusted-profile boundary.
- Retries the same whole set at most once only after deterministic output validation failure and
  only while reserving the exact `$0.08` second-call allowance inside the `$0.15` total cap. Each
  response is independently bounded by `$0.08`.
- Emits immutable redacted evidence containing IDs, hashes, latency, usage, cost, retry lineage,
  validation category, and disposition only; no signed URLs, pixels, provider text, or secrets.

## Verification

- Targeted `@videoforge/pipeline` lint/typecheck/test: PASS, 115/115 tests.
- `TURBO_FORCE=true pnpm verify`: PASS, including 131 control-plane tests, 163 web tests,
  115 pipeline tests, 43 provider-sandbox tests, 50-file contract sync, six Python 3.12 worker
  suites, local Workerd parity, context/schema validation, secret scan, stable builds, and 38/38
  installed-Chrome journeys.
- `git diff --check`: PASS before implementation commit.

This adds no runtime application composition or live provider transport. The deterministic fixture
analyzer remains the default, ordinary video creation does not invoke style analysis, provider mode
remains `fixture`, and external spend remains `$0`.

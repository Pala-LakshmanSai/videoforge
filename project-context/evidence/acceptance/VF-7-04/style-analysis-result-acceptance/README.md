# VF-7-04 durable Image Style result-acceptance evidence

Checked 2026-08-11 against implementation commit
`789ea98e28baea7a7d6b9b40be06c3f5f8d4f8c2`.

## Result

PASS at `$0` in provider mode `fixture`. No credential, provider, model download, GPU, cloud,
external object-store, or real-network activity occurred.

- One trusted VF-7-03 completion candidate is validated as an exact plain-data snapshot, including
  canonical `image-style-profile/v1` bytes, RFC 8785 hash, bounded one-or-two-call usage, and pinned
  workspace/version/task/attempt/reference provenance.
- The service re-resolves durable version, specialized attempt, ordered reference set, general task,
  general attempt, and artifact state before storing bytes or entering the unit of work.
- One replay-safe transaction registers and binds the canonical profile artifact, succeeds the
  general attempt, appends exact caller-owned cost mutations, finalizes cost summaries, accepts the
  general task result, succeeds the specialized attempt, and moves the version from `ANALYZING` to
  `NEEDS_REVIEW`.
- Exact replay returns the accepted result after PGlite reopen. Changed candidate, provenance,
  artifact, object bytes, cost, lifecycle, claim, or workspace fails closed without partial durable
  mutation.
- The acceptance service has no analyzer, credential, ambient-environment, network, or provider-call
  capability. Schema head remains migration `0008`.

## Verification

- Focused result-acceptance tests: PASS, 5/5.
- Full `@videoforge/control-plane` tests: PASS, 159/159.
- `TURBO_FORCE=true pnpm verify`: PASS, including 159 control-plane tests, 163 web tests,
  115 pipeline tests, 43 provider-sandbox tests, 50-file contract sync, Python worker suites,
  local Workerd parity, context/schema validation, secret scan, stable builds, and 38/38
  installed-Chrome journeys.
- Targeted lint, typecheck, build, formatting, staged-file secret scan, and diff checks: PASS.

## Source hashes

- `durable-analysis-result.ts`: `a319901305fd336c02b795eb85447d31db6908ca4f7f9d653e21447ff3a41e0d`
- `pglite-repositories.ts`: `5ef6343af1661203f1c057d3f305db054a33cd70ad6725a42ee7683bbf26154d`
- result-acceptance tests: `f1f53be061e35ebeaf32e96fb7dd2a5a26e372016b6dad952e737964ab8ca742`

This task adds no review/publication service, route, UI, provider call, credential access, spend,
staging, or deployment. `GATE_STYLE_002` remains open because production qualification evidence has
not been executed.

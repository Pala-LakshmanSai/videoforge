# VF-7-03 claimed Image Style analysis-composition evidence

Checked 2026-08-11 against implementation commit
`72d5cff2ba1ecf9049115801a159365097eb1324`.

## Result

PASS at `$0` in provider mode `fixture`. No credential, provider, model download, GPU, cloud,
external object-store, or real-network activity occurred.

- Preparation deterministically maps the exact ordered VF-7-02 durable reference facts into
  `style-analyzer-v1` while retaining authoritative reference and normalized-asset IDs only in the
  application fingerprint.
- One RFC 8785 fingerprint binds workspace, style/version, specialized/general task and attempt
  IDs, pinned provider/model/revision, analyzer version, and the complete ordered reference set.
- Execution re-resolves the version, specialized attempt, reference set, version-owned task, and
  general attempt. It rejects lifecycle, owner, specialized hash, general input hash, reference,
  workspace, or claim drift before analyzer invocation.
- Only an injected `StyleAnalyzerPort` can run. The returned output is validated again and reduced
  to a frozen canonical `image-style-profile/v1` completion candidate with exact hashes and lineage;
  no durable result acceptance, terminal mutation, or cost settlement occurs.
- The qualified Gemini adapter composes only through fake reference resolver, transport, clock,
  task-ID, and evidence seams. Evidence contains no signed URL or provider output.
- Fresh and reopened PGlite tests prove deterministic preparation, exact post-claim invocation,
  workspace isolation, fail-closed drift handling, malformed-output rejection, and opaque adapter
  failure.

## Verification

- Focused composition tests: PASS, 12/12.
- Full `@videoforge/control-plane` tests: PASS, 154/154.
- Full `@videoforge/pipeline` tests: PASS, 115/115.
- `TURBO_FORCE=true pnpm verify`: PASS, including 154 control-plane tests, 163 web tests,
  115 pipeline tests, 43 provider-sandbox tests, 50-file contract sync, six Python 3.12 worker
  suites, local Workerd parity, context/schema validation, secret scan, stable builds, and 38/38
  installed-Chrome journeys.
- Targeted lint, typecheck, build, formatting, and `git diff --check`: PASS.

This task adds no result persistence/acceptance, route, UI, signed-URL implementation, byte read,
provider transport selection, live call, credential access, spend, staging, or deployment.
`GATE_STYLE_002` remains open.

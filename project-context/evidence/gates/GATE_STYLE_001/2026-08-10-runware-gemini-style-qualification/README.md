# GATE_STYLE_001 — Runware Gemini style qualification

Result: **PASS**

Checked 2026-08-11 with canonical Runware AIR `google:gemini@3.5-flash`. Authenticated
`modelSearch` resolved exactly one public `Gemini 3.5 Flash` result, version `3.5`, architecture
`gemini_3_5_flash`. Normal application provider mode remained `fixture`.

Acceptance:

- Seven owned/synthetic metadata-free reference sets passed strict output-schema and canonical local
  semantic validation: coherent, outlier, conflicting, different-subject/same-style,
  same-subject/different-style, content-injection, and normalized-derivative cases.
- Every result preserved the 14 exact evidence traits and request-scoped aliases. Content traps did
  not become positive style requirements; uncertainty and outliers were surfaced.
- Qualified settings: `thinkingLevel: low`, `mediaResolution: medium`, temperature `0.1`, top-p
  `0.9`, maximum `6000` tokens, JSON output, and no tools.
- First accepted analysis cost `$0.032537`. The two accepted retry paths cost `$0.075869` and
  `$0.066977`, both below the `$0.15` retry ceiling.
- Cumulative VF-3-02 spend, including preserved development probes and failed attempts, was
  `$0.407604`, below the non-transferable `$3` cap.
- The full canonical schema exceeded Gemini's accepted structured-output complexity. The final
  provider-facing schema keeps exact properties, types, required fields, enums, and closed-object
  boundaries while local canonical validation enforces all range/cardinality constraints.
- Runware's documented unsigned seed range was not portable to this Google path; the qualified
  request omits provider seed. Deterministic fixture/input hashes remain recorded.

`acceptance.json` contains request/response hashes, provider identity, settings, latency, usage,
cost, retries, redacted outputs, and every criterion. `attempt-1-open.json` through
`attempt-5-open.json` preserve the bounded failed-development evidence. No image bytes, Data URIs,
signed URLs, credential values, or secrets are recorded.

Runware's standard service is not treated as confidential or zero-data-retention. Only synthetic
qualification images were used. Official facts checked 2026-08-11:

- https://runware.ai/docs/models/google-gemini-3-5-flash
- https://runware.ai/llm-api
- https://runware.ai/terms
- https://runware.ai/privacy
- https://ai.google.dev/gemini-api/docs/structured-output

Verification: provider-sandbox tests passed 43/43, then forced uncached `pnpm verify` passed,
including context/schema validation, secret scan, local Workerd parity, and 38 installed-Chrome
journeys. The temporary qualification API key was deleted after the accepted run; the pre-existing
VideoForge qualification key remained untouched.

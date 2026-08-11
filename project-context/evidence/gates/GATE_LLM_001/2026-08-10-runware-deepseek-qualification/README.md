# GATE_LLM_001 — Runware DeepSeek qualification

Result: **PASS**

Checked 2026-08-11. The signed-in Runware wallet showed `$20.05` available and `$0.00` month spend
before qualification. No credential value entered logs, evidence, Git, or process arguments.

The accepted runner used canonical Runware AIR `deepseek:v4@flash`. A live authenticated
`modelSearch` returned exactly one public result named `DeepSeek-V4-Flash-0731`, version `4`,
architecture `deepseek_v4`; the redacted response hash is in `acceptance.json`. Native generation
responses did not echo model/version fields, so the live provider model-search record establishes
the identity while every generation request pins its canonical AIR.

Acceptance:

- 40 exact-once scenes across `documentary_stock_v1` plus four owned/synthetic style blocks.
- Strict JSON schema, unchanged shot roles, all literal anchors present, and no forbidden visual
  requests.
- Final accepted run cost: `$0.00085053`.
- Earlier provider-visible five-batch attempt whose local evidence write failed: `$0.00083600`.
- Preserved open attempt in `attempt-2-open.json`: `$0.00074945`.
- Cumulative task spend: `$0.00243598`, below the non-transferable `$1` task cap.
- One later identity-preflight connection timeout occurred before generation and added no billed
  request.

Verification: provider-sandbox tests passed 40/40, then forced uncached `pnpm verify` passed,
including context/schema validation, secret scan, local Workerd parity, and 38 installed-Chrome
journeys. Provider mode remains `fixture` outside this explicit runner.

Official facts checked 2026-08-11:

- https://runware.ai/docs/models/deepseek-v4-flash
- https://runware.ai/docs/platform/model-search
- https://runware.ai/docs/platform/introduction

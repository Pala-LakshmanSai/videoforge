# Prompt transport Cloudflare receiver failure

Checkpoint V2-09 / VF-10-09. The user requests a careful repeated-failure audit,
parallel agents, production repair and complete-stage verification under USD2.

## Proven cause

The fresh gardening project passed Stage4 input binding and committed its first
batch claim. The run failed 36ms after that claim with
`HOSTED_PROMPT_EXECUTION_UNKNOWN`. Original request hash:
`sha256:614a1a8422647a97f3d17d5123bd8c111aed1c4b4893fc3a4e95fe07260cde80`.
The claim uses current Luna v39/profile9, with34 scenes in4 planned batches.

The new transport retained global `fetch` as a class property and invoked it as
`this.fetcher(...)`. Cloudflare's native function rejects that receiver before
any outbound request. Its catch correctly fenced a possible network failure but
therefore surfaced the local programming error as an uncertain provider outcome.

Two independent reproductions bundled actual source in local workerd with the
original sealed request and a fully intercepted outbound service. Unchanged
source produced `post_outcome_unknown` with0 outbound calls. The fixed source
reached the local service exactly once. A success response passed accounting;
an independent HTTP400 response became the expected typed provider rejection.
No production inference was used for this causal proof.

## Repair and prevention

Invoke the captured function through a local variable, matching the already
qualified sibling Runware/RunPod transports. Preserve request bytes, model,
budgets, response validation, unknown-outcome fencing and stored identities.

The unit regression uses a receiver-sensitive global function. The permanent
`scripts/tests/runware-luna-worker-transport.test.mjs` bundles real production
source in Cloudflare workerd with its native default fetch and intercepts all
outbound traffic. It verifies successful dispatch, strict request settings,
settled accounting, invalid-usage fencing and no automatic repeated POST. It
runs in existing script CI and before the Cloudflare browser suite, with no new
dependency. Prior Node mocks did not enforce this platform calling convention.

The other agents audited native claims, runtime permissions, receipt recovery,
Workflow lifetime and active sibling transports. No evidence supports a four-
second provider timeout, batch-plan mismatch or malformed sealed request here.
Historical log retrieval is unavailable to the configured telemetry credential;
the original persisted claim plus deterministic runtime reproduction supplies
the causal evidence. Do not claim an original network trace was retrieved.

## Qualification so far

-105 focused prompt/route/transport tests pass;2 actual workerd transport tests
 pass. Web and Worker typechecks, focused lint/format, both production builds,
 bundle firewall, context validation and tracked-secret scan pass.
-Canonical aggregate remains non-green on116 inherited formatting files and
 Python lint. This is not a full repository-green claim.
-No new paid work yet. Exact original UNKNOWN recovery uses a private one-shot
 intent and saved response, preserving its existing claim/reservation. No general
 UNKNOWN retry or new schema is introduced.
-A concurrent pricing release became production24b89c50 during qualification;
 merge and requalify it before publishing to preserve that release.

Real provider/native full-stage acceptance, Chrome verification, release
identities and final spending/cleanup evidence remain pending.

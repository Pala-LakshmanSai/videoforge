# Implementation task briefs

These files turn one entry from `21_IMPLEMENTATION_EXECUTION_PLAN.md` into a bounded executable
handoff. `CURRENT_STATE.yaml.recommended_next_task` selects exactly one brief; a fresh chat must not
pick another file merely because it looks parallelizable.

Each brief owns scope, dependencies, files, safe agent lanes, acceptance, budget, evidence, rollback,
and the required next-state update. Product behavior remains authoritative in the decision ledger
and primary domain files. Completed briefs may remain for traceability, but `CURRENT_STATE.yaml` is
the only mutable snapshot and Git/evidence remain the progress log.

Most recently completed brief: `VF-7-04.md`, with implementation commit `789ea98` and evidence
commit `49acea4`. It atomically accepts one trusted Image Style analysis candidate as canonical
artifact/cost/task/attempt/version truth and moves the version to `NEEDS_REVIEW` at `$0`.

`VF-3-00` through `VF-3-09` completed the authorized checkpoint, DeepSeek/Gemini qualification,
provider-free prompt/style adapters, RunPod account preflight, public Git/hosted CI, and the still-open
Mage checkpoint/license audit. `VF-7-01` through `VF-7-04` completed the provider-free custom-style
lifecycle, reference, claimed-analysis, and durable result-acceptance foundation.
`CURRENT_STATE.yaml` selects only `VF-7-05.md`: byte-identical reviewed publication through a
provider-free application service. Manual edit semantics, routes/UI, uploads, previews, live
providers, staging, and production are not authorized by that brief.

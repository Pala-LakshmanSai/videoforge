# Implementation task briefs

These files turn one entry from `21_IMPLEMENTATION_EXECUTION_PLAN.md` into a bounded executable
handoff. `CURRENT_STATE.yaml.recommended_next_task` selects exactly one brief; a fresh chat must not
pick another file merely because it looks parallelizable.

Each brief owns scope, dependencies, files, safe agent lanes, acceptance, budget, evidence, rollback,
and the required next-state update. Product behavior remains authoritative in the decision ledger
and primary domain files. Completed briefs may remain for traceability, but `CURRENT_STATE.yaml` is
the only mutable snapshot and Git/evidence remain the progress log.

Current clean checkpoint: `3168602`. Most recently completed implementation brief is `VF-5-01.md`
at `fcb8f31`; `VF-4-01` and `VF-7-07` have committed domain foundations but remain partial.

`VF-3-00` through `VF-3-09` completed the authorized checkpoint, DeepSeek/Gemini qualification,
provider-free prompt/style adapters, RunPod account preflight, public Git/hosted CI, and the still-open
Mage checkpoint/license audit. `VF-7-01` through `VF-7-06` completed the provider-free custom-style
lifecycle through byte-identical reviewed publication and its exact manual-edit provenance contract.
`CURRENT_STATE.yaml` selects only the durable-store continuation in `VF-4-01.md`. Complete tasks
author exactly one successor brief; do not select or expand later roadmap work before that handoff.

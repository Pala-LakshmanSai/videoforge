# Implementation task briefs

These files turn one entry from `21_IMPLEMENTATION_EXECUTION_PLAN.md` into a bounded executable
handoff. `CURRENT_STATE.yaml.recommended_next_task` selects exactly one brief; a fresh chat must not
pick another file merely because it looks parallelizable.

Each brief owns scope, dependencies, files, safe agent lanes, acceptance, budget, evidence, rollback,
and the required next-state update. Product behavior remains authoritative in the decision ledger
and primary domain files. Completed briefs may remain for traceability, but `CURRENT_STATE.yaml` is
the only mutable snapshot and Git/evidence remain the progress log.

Current implementation checkpoint: `d9adee9`. `VF-4-01/02`, `VF-5-01/02`, and `VF-7-01` through
`VF-7-09` are complete and preserved. VF-7-09 implementation is `6fb3312` plus Workerd correction
`d9adee9`.

`VF-3-00` through `VF-3-09` completed the authorized checkpoint, DeepSeek/Gemini qualification,
provider-free prompt/style adapters, RunPod account preflight, public Git/hosted CI, and the still-open
Mage checkpoint/license audit. `VF-7-01` through `VF-7-09` complete the provider-free custom-style
lifecycle and fixture Hub. `CURRENT_STATE.yaml` selects only read-only AvatarForcing license/access
preflight in `VF-3-10.md`. Complete tasks author exactly one successor brief; do not select or
expand later roadmap work before that handoff.

# Implementation task briefs

These files turn one entry from `21_IMPLEMENTATION_EXECUTION_PLAN.md` into a bounded executable
handoff. `CURRENT_STATE.yaml.recommended_next_task` selects exactly one brief; a fresh chat must not
pick another file merely because it looks parallelizable.

Each brief owns scope, dependencies, files, safe agent lanes, acceptance, budget, evidence, rollback,
and the required next-state update. Product behavior remains authoritative in the decision ledger
and primary domain files. Completed briefs may remain for traceability, but `CURRENT_STATE.yaml` is
the only mutable snapshot and Git/evidence remain the progress log.

Current active brief: `VF-1-01A.md`, the user-authorized provider-free hardening task created from
the VF-1-01 adversarial audit. `VF-1-02` remains next afterward but its exact brief has not been
authored. Do not infer its scope or ownership from the summary plan.

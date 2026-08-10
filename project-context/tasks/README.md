# Implementation task briefs

These files turn one entry from `21_IMPLEMENTATION_EXECUTION_PLAN.md` into a bounded executable
handoff. `CURRENT_STATE.yaml.recommended_next_task` selects exactly one brief; a fresh chat must not
pick another file merely because it looks parallelizable.

Each brief owns scope, dependencies, files, safe agent lanes, acceptance, budget, evidence, rollback,
and the required next-state update. Product behavior remains authoritative in the decision ledger
and primary domain files. Completed briefs may remain for traceability, but `CURRENT_STATE.yaml` is
the only mutable snapshot and Git/evidence remain the progress log.

Most recently completed brief: `VF-1-01A.md`. The user approved the accelerated completion plan on
2026-08-10 and granted standing provider-free implementation authority through Phase 2. Exact
briefs now cover `VF-1-02` through `VF-1-08`, provider-free `VF-0D-01`, and `VF-2-01` through
`VF-2-05`.

`CURRENT_STATE.yaml` still selects exactly one active task/wave and owns the current paths. A brief
being present does not make its dependencies ready, permit concurrent edits, authorize credentials,
activate the planned `$25` envelope, or allow a remote/cloud/provider mutation. Phase 3 onward must
be briefed from measured gate evidence at the Phase 2 handoff rather than guessed now.

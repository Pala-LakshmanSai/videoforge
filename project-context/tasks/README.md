# Implementation task briefs

These files turn one entry from `21_IMPLEMENTATION_EXECUTION_PLAN.md` into a bounded executable
handoff. `CURRENT_STATE.yaml.recommended_next_task` selects exactly one brief; a fresh chat must not
pick another file merely because it looks parallelizable.

Each brief owns scope, dependencies, files, safe agent lanes, acceptance, budget, evidence, rollback,
and the required next-state update. Product behavior remains authoritative in the decision ledger
and primary domain files. Completed briefs may remain for traceability, but `CURRENT_STATE.yaml` is
the only mutable snapshot and Git/evidence remain the progress log.

Most recently completed brief: `VF-2-05.md`, with implementation commit `907e0e4` and evidence
commit `d16c2a9`. The 2026-08-10 standing provider-free implementation authority through Phase 2 is
complete and exhausted.

`CURRENT_STATE.yaml` now selects `VF-3-00.md`, an exact planning-only gate/authorization checkpoint.
It authorizes no application implementation or context mutation. A brief being present does not
permit concurrent edits, credentials, the planned `$25` envelope, or remote/cloud/provider
mutation. Phase 3 onward must be briefed from fresh facts and measured gate evidence rather than
guessed from the high-level roadmap.

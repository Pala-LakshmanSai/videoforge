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

`VF-3-00.md` is complete. `VF-3-01.md` created a safe bounded runner and Runware account, but live
inference is blocked before spend because Runware requires a paid invoice or at least `$5` balance.
`CURRENT_STATE.yaml` selects provider-free `VF-3-03.md`, allowing deterministic prompt work without
funding, provider calls, or weakening `GATE_LLM_001`. `VF-3-02.md` remains unselected and blocked by
the same account prerequisite.

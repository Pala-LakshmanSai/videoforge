# Implementation task briefs

These files turn one entry from `21_IMPLEMENTATION_EXECUTION_PLAN.md` into a bounded executable
handoff. `CURRENT_STATE.yaml.recommended_next_task` selects exactly one brief; a fresh chat must not
pick another file merely because it looks parallelizable.

Each brief owns scope, dependencies, files, safe agent lanes, acceptance, budget, evidence, rollback,
and the required next-state update. Product behavior remains authoritative in the decision ledger
and primary domain files. Completed briefs may remain for traceability, but `CURRENT_STATE.yaml` is
the only mutable snapshot and Git/evidence remain the progress log.

Current implementation checkpoint: `8ceecb4`. `VF-4-01/02`, `VF-5-01/02`, and `VF-7-01` through
`VF-7-09` are complete and preserved. VF-7-09 implementation is `6fb3312` plus Workerd correction
`d9adee9`.

`VF-3-00` through `VF-3-10` completed the authorized checkpoint, DeepSeek/Gemini qualification,
provider-free prompt/style adapters, RunPod account preflight, public Git/hosted CI, and the still-open
Mage and AvatarForcing checkpoint/license audits. `VF-7-01` through `VF-7-09` complete the
provider-free custom-style lifecycle and fixture Hub. `VF-3-11` ended without a replacement after
the user reaffirmed AvatarForcing and the LongCat exclusion. `VF-8-01/02/03` are complete.
`VF-8-04` through `VF-9-21` preserve the full historical AvatarForcing/SkyReels attempt lineage,
including `$0.4496891390` in `VF-9-21` and independent final zero inventory. `VF-9-22` supersedes
that active route with EchoMimicV3-Flash. `VF-9-23` published the pinned worker after full local and
hosted green. `VF-9-24` dispatched one job, then stopped when RunPod created three `EXITED` worker
records; no MP4 or paid retry authority exists. `VF-9-24A` completed the provider-free correction
and published the corrected GHCR image. `VF-9-24B` failed before model-ready on a truncated tokenizer
digest, spent `$0.0260412778`, and ended at absolute zero. `VF-9-24C` is the sole selected
provider-free digest correction and image build; it cannot dispatch a second sample.

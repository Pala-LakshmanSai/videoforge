# Implementation task briefs

These files turn one entry from `21_IMPLEMENTATION_EXECUTION_PLAN.md` into a bounded executable
handoff. `CURRENT_STATE.yaml.recommended_next_task` selects exactly one brief; a fresh chat must not
pick another merely because it looks parallelizable.

Each brief owns scope, dependencies, files, safe agent lanes, acceptance, budget, evidence,
rollback, and required next-state update. Product behavior remains authoritative in the decision
ledger and primary domain files. Completed briefs remain historical traceability; they do not grant
new provider authority.

`CP-00` through `CP-05` are complete provider-free. `VF-9-24Q` is the exact selected next brief for
`CP-06`, but it is not started and selection grants no authority. At rest, provider calls,
credentials, cloud mutation, model downloads, publication, GPU use, retained-volume billing, and
spend remain false/`$0`. The prior `VF-9-24I` paid FP8 sample path is superseded and its former `$8`
ceiling is historical and non-transferable.

The approved future lifecycle uses two different persistent `EU-RO-1` model volumes and two
disposable Pods: exact ImageForge Mage INT8 ConvRot and EchoMimicV3-Flash Turbo FP8. Live compatible GPU
selection is independent per lane. Ordinary boot downloads no model files. Delete Pods after
durable outputs and retain only explicitly approved volumes. The exact CP-06 prompt activates only
`VF-9-24Q` Phase A local/read-only preflight at `$0`; a later complete numeric authorization is
required for Phase B mutation. See that brief for the exact finite-cap, GPU, volume, ongoing
retention, and scope fields. No default cap is inferred.

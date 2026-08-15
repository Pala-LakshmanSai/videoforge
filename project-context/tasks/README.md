# Implementation task briefs

`CURRENT_STATE.yaml.recommended_next_task` selects exactly one brief. A fresh chat must not choose a
different checkpoint because it appears parallelizable.

Active production work uses `VF-10-00A` and `VF-10-01` through `VF-10-13`, matching V2-00 through
V2-13 in `22_PROJECT_COMPLETION_CHECKPOINTS.md`. The former CP/VF-9 briefs remain immutable history
for migrations, evidence, model artifacts, approvals, and cost lineage; they are not active prompts,
provider authority, resource permission, or spend caps.

Each active brief defines one checkpoint's outcome, predecessor, scope, exclusions, authority
boundary, proof, and stop point. Normative behavior still comes from the decision ledger and primary
domain files. The paired copy-ready implementation and independent-audit prompts live in
`templates/CHECKPOINT_CHAT_PROMPTS.md`.

All checkpoints start provider-free at `$0`. External checkpoints complete local work and their
allowlisted read-only preflight first, then stop once for one exact combined proposal. The user must
supply a numeric maximum cumulative finite spend; no historical cap is inferred or reused. Every
live handoff reports pending provider work, active workers, retained resources, recurring charges,
and cleanup truth.

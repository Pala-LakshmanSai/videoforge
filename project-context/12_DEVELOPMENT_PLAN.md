# Development plan

Status: compact roadmap index; implementation and provider activation remain checkpoint-gated
Read when: opening a coding chat, sequencing work, assigning ownership, or accepting a milestone.

## Canonical sequence

`22_PROJECT_COMPLETION_CHECKPOINTS.md` is the authoritative balanced roadmap from `CP-00` through
`CP-12`. This file intentionally does not maintain a competing phase list. `CURRENT_STATE.yaml`
selects the exact current task and read profile; its task brief controls scope, authority, evidence,
and stop conditions.

Implement checkpoints in order:

```text
CP-00 context/reference lock
CP-01 vNext contracts + legacy dispatch firewall
CP-02 shared admission + global queue + idle GPU UX
CP-03 hosted word transcript contract
CP-04 deterministic three-composition work plan
CP-05 provider-free complete MVP orchestration
CP-06 exact Mage INT8 persistent-volume lane
CP-07 exact Echo FP8 persistent-volume lane + crop lock
CP-08 durable hosted staging + Cloud Run CPU jobs
CP-09 one real automatic video
CP-10 real shared-session queue
CP-11 5–10-user quality/cost/recovery qualification
CP-12 production release
```

No later checkpoint may implement around an incomplete dependency. Fixture/local evidence never
proves a production provider path. Every provider, credential, cloud mutation, model download,
image publication, or spend task needs explicit bounded authority.

## Locked MVP shape

- One global shared app for 5–10 admitted users with equal rights, one catalog/results surface, one
  manually ordered queue, and exactly one active project.
- The first accepted Generate while truly idle selects and atomically locks one exact live Mage/Echo
  GPU pair for the global generation session. Waiting projects inherit it and cannot select or
  switch GPUs.
- Mage INT8 ConvRot and EchoMimicV3-Flash Turbo FP8 use different persistent `EU-RO-1` model volumes,
  different worker images, and at most one disposable Pod per lane. Volumes never share or become
  routine-cleanup targets.
- Mage and Echo may run concurrently only for the active project. Waiting entries are inert: no GPU
  inference, CPU work, prompt generation, or artifact mutation begins before activation.
- Waiting work may keep an already-running lane Pod warm. If a lane Pod was deleted, enqueueing does
  not recreate it; the next project activation recreates it on the same session GPU after fresh
  availability/rate revalidation. No substitution.
- With no waiting project when a lane finishes, delete that Pod immediately without waiting for the
  other lane or final render. Session close and GPU unlock require no active/waiting entry and both
  Pods independently proven absent. Both model volumes remain.
- Production word transcription and final FFmpeg render/probe run as scale-to-zero Cloud Run Jobs
  over private R2 artifacts. Mac execution is development parity only.
- Thirty-minute variable generation targets `≤$1.00` and has a hard MVP ceiling of `$2.00`.
  Retained-volume fixed billing is reported separately.

## Implementation discipline

Work contract-first and provider-free by default. Preserve historical migrations, v1 fixtures,
attempt evidence, and accepted UI/render work. Add vNext replacements, prove the cutover, then
quarantine Serverless endpoints, `Auto`/priority GPU routing, BF16 Mage, repair/fallback roles, and
historical avatar runtimes. Never reinterpret old bytes as new production authority.

Each checkpoint ends with focused failure tests, canonical verification, real Chrome acceptance for
visible behavior, honest gate status, a small green commit, refreshed `CURRENT_STATE.yaml`, and a
copy-ready handoff. Paid RunPod work additionally records exact GPU/rate, Pod/volume/model identity,
boot/model-ready/inference/upload/delete timings, cost, output hashes/probes, and independent Pod
absence. Use `templates/CHECKPOINT_CHAT_PROMPTS.md` to start and audit each checkpoint.

## Safe implementation parallelism

Agent work may parallelize only across disjoint files after shared contracts lock—for example Mage
worker versus Echo worker. Runtime project execution does not parallelize across queue entries.
Serialize shared schemas, migrations, session/queue state, root UI, provider mutations, context,
integration commits, and release decisions through one owner.

AI B-roll video, advanced fairness, per-user Pod pairs, role systems, multi-tenancy, GPU switching,
parallel projects, and repair/fallback models are post-MVP decisions, not hidden work in this plan.

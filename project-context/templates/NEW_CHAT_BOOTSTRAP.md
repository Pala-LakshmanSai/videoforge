# New-chat bootstrap prompt

```text
Continue VideoForge in /Users/lakshmansai/Documents/videoforge.

Use caveman updates: brief, factual, development-focused.

1. Read AGENTS.md.
2. Read project-context/00_START_HERE.md, MANIFEST.yaml, and CURRENT_STATE.yaml.
3. Preserve current HEAD/newer commits, historical evidence, and private inputs; never reset them.
4. Load only CURRENT_STATE's exact selected read profile and task brief.
5. Read the matching checkpoint in project-context/22_PROJECT_COMPLETION_CHECKPOINTS.md.

Current architecture: one global shared equal-rights app for 5–10 admitted users, one singleton
generation session, one active video, and one manually ordered queue. New signup uses email/password
or Google plus one unique single-use code bound to the same verified email. Waiting projects inherit
the session GPU pair and are orchestration-inert until promotion. A waiter may keep an existing lane
Pod warm but never create/recreate one.

Mage INT8 ConvRot and EchoMimicV3-Flash Turbo FP8 have separate persistent EU-RO-1 volumes, worker images,
and at most one disposable Pod per lane. Idle-session first Generate locks two exact live GPU
offerings and starts both Pods concurrently. Missing lanes recreate only after next-project
activation on the same GPU after revalidation. Full drain means zero Pods and two retained volumes.
Production whisper.cpp and FFmpeg use Cloud Run Jobs over private R2; Mac is development parity.

Do not trust checkpoint names copied into this reusable template. CURRENT_STATE owns the exact
completed checkpoint, selected profile/brief, and next task. Selection alone grants no authority.
For CP-06 through CP-12, pasting the matching implementation prompt activates only its bounded
local/read-only Phase A at $0. Phase A may repair local code and query its allowlisted inventory/
rates, but may not mutate resources, download model bytes, publish, allocate paid compute, retain a
new resource, or spend. Phase B requires the later complete checkpoint-specific authorization.
Historical caps and superseded architectures authorize nothing.
```

If this template disagrees with `CURRENT_STATE.yaml`, stop and reconcile; current state wins.

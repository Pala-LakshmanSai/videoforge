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

Mage INT8 ConvRot and EchoMimicV3-Flash FP8 have separate persistent EU-RO-1 volumes, worker images,
and at most one disposable Pod per lane. Idle-session first Generate locks two exact live GPU
offerings and starts both Pods concurrently. Missing lanes recreate only after next-project
activation on the same GPU after revalidation. Full drain means zero Pods and two retained volumes.
Production whisper.cpp and FFmpeg use Cloud Run Jobs over private R2; Mac is development parity.

VF-9-24L/CP-00 is complete context only. VF-9-24K/CP-01 is proposed and paused. Do not change
application code unless the user explicitly authorizes CP-01. Even then it is provider-free, no
credentials/cloud/model downloads, and $0. Historical VF-9-24I produced no MP4; its old cap and
Serverless/ephemeral design authorize nothing.
```

If this template disagrees with `CURRENT_STATE.yaml`, stop and reconcile; current state wins.

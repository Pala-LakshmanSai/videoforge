# New-chat bootstrap prompt

```text
Continue VideoForge in /Users/lakshmansai/Documents/videoforge.

Keep responses concise and spend-conscious. Focus on the selected task and evidence.

1. Read AGENTS.md.
2. Read project-context/00_START_HERE.md.
3. Read project-context/MANIFEST.yaml.
4. Read project-context/CURRENT_STATE.yaml.
5. Run git status --short --branch. Require clean HEAD descending from 95ff125 (which descends from
   all preserved provider/runtime checkpoints and verified implementation checkpoint d9adee9).
6. Preserve every commit. Never reset, rewrite, or redo completed work.
7. Load only CURRENT_STATE.recommended_next_task, its one MANIFEST read profile, and exact brief.
   Do not run a broad research pass or preload later profiles/briefs.

Selected task: VF-9-17 real-provider render composition boundary.
Profile: phase9_real_provider_render_composition.
Brief: project-context/tasks/VF-9-17.md.

This task permits local application/control-plane/renderer/tests/docs, Git push, hosted CI, and
installed-Chrome verification at `$0`. Do not access credentials, download models, call providers,
mutate RunPod/Runware/GPU/cloud resources, deploy, promote profiles, redesign UI, or spend.

Preserve every completed task and accepted UI/output. Checkpoint `95ff125` already implements the
pure provider-acceptance render-input barrier and passes focused pipeline build/typecheck/lint plus
116/116 tests. Do not redo it. Compose durable Mage/Avatar acceptance records into the barrier,
preserve exact lineage, and build one fake-real 30–120-second local FFmpeg v3 path. Prove missing or
rejected QA, checksum drift, cancellation, and restart/replay fail closed. Rejected real evidence
from VF-9-13 and VF-8-10 must never become accepted render input.

Finish with FFmpeg v3, installed-Chrome play/seek/approve/download/hash proof, forced full verify,
context/schema validation, secret scan, Prettier, dependency audit, git diff check, server stopped,
clean commit, and refreshed CURRENT_STATE. Close VF-9-17 only when every acceptance item exists;
otherwise leave a truthful resumable checkpoint.

Stop on dirty unexplained state, missing brief, context contradiction, rejected real evidence
entering render, credential/provider/GPU activity, external mutation, charge, or failed validation.
```

If this template disagrees with `CURRENT_STATE.yaml`, stop and reconcile it; current state wins.

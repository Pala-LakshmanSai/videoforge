# New-chat bootstrap prompt

```text
Continue VideoForge in /Users/lakshmansai/Documents/videoforge.

Keep responses concise and spend-conscious. Focus on the selected task and evidence.

1. Read AGENTS.md.
2. Read project-context/00_START_HERE.md.
3. Read project-context/MANIFEST.yaml.
4. Read project-context/CURRENT_STATE.yaml.
5. Run git status --short --branch. Require clean HEAD descending from d9adee9.
6. Preserve every commit. Never reset, rewrite, or redo completed work.
7. Load only CURRENT_STATE.recommended_next_task, its one MANIFEST read profile, and exact brief.
   Do not run a broad research pass or preload later profiles/briefs.

Selected task: VF-3-10 AvatarForcing access and commercial-license preflight.
Profile: phase3_avatar_access_license_preflight.
Brief: project-context/tasks/VF-3-10.md.

This task is read-only and $0. Reconcile authoritative first-party AvatarForcing code, weights,
revision, and commercial-license evidence for GATE_AVATAR_003. Do not download weights, accept
terms, expose/use credentials, contact third parties, install/run models, call a provider, mutate
RunPod/GPU/cloud/account resources, deploy, push, or spend.

Preserve Phase 0A-2, accepted shell/output, VF-DX-01/02, VF-REL-01, VF-4-01/02, VF-5-01/02, and
VF-7-01 through VF-7-09. Latest provider-free checkpoint is 6fb3312 plus Workerd correction
d9adee9: forced full verification passed 786 tests/journeys, control-plane 209/209, Workerd 1/1,
Chrome 38/38, zero skips, fixture mode, $0; server stopped. Mage VF-3-08 already left
GATE_IMAGE_002 open. Do not repeat it or download around the blocker.

At handoff, update exact gate/evidence/context truth, run context/schema validation, secret scan,
Prettier, dependency audit, and git diff --check, commit one small context/evidence change, and
author exactly one successor brief. If licensing remains ambiguous, the successor must be a
replacement-model decision; if clearly permitted, it may be a capped qualification brief.

Stop on dirty unexplained state, missing brief, context contradiction, credential/legal boundary,
large-file transfer, external mutation, charge, ambiguous authority, or failed validation.
```

If this template disagrees with `CURRENT_STATE.yaml`, stop and reconcile it; current state wins.

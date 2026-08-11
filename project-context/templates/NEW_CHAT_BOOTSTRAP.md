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

Selected task: VF-3-11 primary-avatar replacement-model decision.
Profile: phase3_avatar_replacement_decision.
Brief: project-context/tasks/VF-3-11.md.

This task is read-only and $0. Inspect a bounded first-party candidate set and recommend at most one
primary-avatar replacement only when code-and-weights commercial permission and existing contract
fit are clear. Do not download weights, accept terms, expose/use credentials, contact third parties,
install/run models, call a provider, mutate RunPod/GPU/cloud/account resources, deploy, push, or spend.

Preserve Phase 0A-2, accepted shell/output, VF-DX-01/02, VF-REL-01, VF-4-01/02, VF-5-01/02, and
VF-7-01 through VF-7-09. Latest provider-free checkpoint is 6fb3312 plus Workerd correction
d9adee9: forced full verification passed 786 tests/journeys, control-plane 209/209, Workerd 1/1,
Chrome 38/38, zero skips, fixture mode, $0; server stopped. Mage VF-3-08 left GATE_IMAGE_002 open.
AvatarForcing VF-3-10 pinned code revision 63b73e6 and weights revision e244891 but kept
GATE_AVATAR_003 open because official code-license artifacts conflict and the weights card declares
no license. Do not repeat either preflight or download around either blocker.

At handoff, update exact decision/evidence/context truth, run context/schema validation, contracts
check, secret scan, Prettier, dependency audit, and git diff --check, commit one small
context/evidence change, and author exactly one successor brief. If one candidate qualifies on
paper, the successor may be a capped qualification brief; otherwise it must preserve the blocker
and request the exact next user decision.

Stop on dirty unexplained state, missing brief, context contradiction, credential/legal boundary,
large-file transfer, external mutation, charge, ambiguous authority, or failed validation.
```

If this template disagrees with `CURRENT_STATE.yaml`, stop and reconcile it; current state wins.

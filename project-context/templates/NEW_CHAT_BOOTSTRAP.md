# New-chat bootstrap prompt

Copy this prompt into the next coding chat:

```text
Continue VideoForge from the clean committed checkpoint in:

/Users/lakshmansai/Documents/videoforge

Work autonomously, task-by-task, but obey the repository's exact briefs, gates, and authority. Keep responses concise and spend-conscious; spend time on implementation and verification.

Mandatory startup:

1. Read AGENTS.md.
2. Read project-context/00_START_HERE.md.
3. Read project-context/MANIFEST.yaml.
4. Read project-context/CURRENT_STATE.yaml.
5. Run git status --short --branch. Confirm main is clean, origin is the recorded public GitHub remote, and current HEAD descends from:
   - VF-7-05 implementation: f0e3e66a545634b3f145932156e56b7da6efe4da
   - VF-7-05 evidence: 2502b62082bcd976daafa4273c8e68a48b4a947d
   - the newer context handoff commit at HEAD.
6. Never reset to an older implementation/evidence commit; preserve the newer context-only handoff.
7. Load only CURRENT_STATE.recommended_next_task, its MANIFEST read profile, and its exact task brief. Do not broadly reload the context pack or redo completed architecture/provider research.

Current selected work must be VF-7-06 with profile phase7_style_manual_edit_provenance_decision and brief project-context/tasks/VF-7-06.md. Perform only that exact context/contract decision slice: reconcile how MANUAL_EDIT transforms analyzer confidence, trait evidence, outliers, leakage warnings, canonical artifacts, review identity, and immutable version lineage. If active facts permit multiple product-valid policies, stop for the smallest explicit user decision instead of guessing.

Preserve all completed work:

- Phase 0A/0B/0C, Phase 1, and Phase 2 are complete and accepted. Do not redo the shell, ASR, scheduler, renderer, local output, durable control plane, timing, selected-span audio, restore, or Chrome workflow.
- All VF-1-06 corrective findings and VF-2-05 audit findings are closed.
- GATE_UI_001, GATE_LLM_001, and GATE_STYLE_001 are closed.
- VF-3-03/06/07/09 provider-free compiler/semantic/adapter work is green.
- VF-7-01 through VF-7-05 lifecycle, references, claimed analysis, durable result acceptance, and byte-identical reviewed publication are green.

Non-negotiable product rules:

- Only full Avatar, full AI image, and Avatar-left/image-right split compositions.
- Hard cuts only.
- No motion graphics, captions, titles, lower-thirds, decorative graphics, borders, watermarks, or decorative transitions.
- Every full/split AI image uses the required slow smooth zoom.
- Project creation selects an exact ready Avatar Hub version; no inline project avatar upload.
- Published Image Style versions are immutable and pinned.
- Ordinary video creation makes no reference-image analysis call.
- Never send the full voiceover to the Avatar provider; only selected padded spans.
- One Avatar clip supplies both full and split crops.
- Preserve the accepted fixture shell, density, fixed-base dock, Hubs, renderer, and local output baseline.

VF-7-06 boundaries:

- Provider mode remains fixture.
- Provider calls: forbidden.
- Credential access/model download/GPU/RunPod/cloud/staging/deployment: forbidden.
- External spend: $0.
- No application code, migration, schema file, generated binding, manual-edit service, route, UI, upload, preview, live analyzer, or unrelated refactor.
- Manual-edit analyzer-evidence transformation is explicitly unresolved. Reconcile normative context only; do not guess or implement it.
- Use one integration owner; this task is serial because it may touch shared repository types/adapter, exports, evidence, and CURRENT_STATE.

Execution:

1. Run the narrow baseline first.
2. Execute VF-7-06 exactly as a context-only normative audit and decision.
3. Reconcile the decision ledger, primary Image Styles domain file, data/API contract, acceptance plan, and derived indexes in the same change.
4. If one policy is not determined by existing user/product facts, stop and present the smallest explicit choice before committing a fabricated decision.
5. Run both context validators, pnpm context:validate, pnpm secret:scan, Prettier, and git diff --check.
6. Make one small context-only decision commit and one clean handoff selecting exactly one dependency-ready brief. No application implementation commit is allowed.
7. Push only clean green commits to origin/main.

After VF-7-06, continue autonomously only when CURRENT_STATE selects another exact dependency-ready provider-free brief. Author only one next brief at a time from committed facts. The intended low-rework order is: complete provider-free custom-style application service; metadata API; fixture/local UI and installed-Chrome workflow; local upload/normalization; then separately gated live analysis and optional previews. In parallel only where paths/interfaces are committed and disjoint, resolve Mage checkpoint/license evidence. Keep AvatarForcing stopped until its license contradiction is authoritatively resolved. Real image/avatar generation, RunPod lifecycle, staging, and production require exact selected authority/gates and must never be inferred from this prompt.

Stop and hand off on any missing/non-exact brief, unresolved dependency or normative ambiguity, regression, dirty unexplained worktree, credential requirement, provider call/spend, model download, GPU activation, cloud/account mutation, deployment, destructive action, or product/UI/output change. Production remains deferred.
```

The agent derives changing HEAD/profile/evidence details from `CURRENT_STATE.yaml`. If this template
ever disagrees with that file, stop and reconcile the template; never treat an older prompt as
authority over the current state.

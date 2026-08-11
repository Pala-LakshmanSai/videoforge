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
   - VF-7-04 implementation: 789ea98e28baea7a7d6b9b40be06c3f5f8d4f8c2
   - VF-7-04 evidence: 49acea4312050804a02e6638f38fa2b24fd8bcef
   - the newer context handoff commit at HEAD.
6. Never reset to an older implementation/evidence commit; preserve the newer context-only handoff.
7. Load only CURRENT_STATE.recommended_next_task, its MANIFEST read profile, and its exact task brief. Do not broadly reload the context pack or redo completed architecture/provider research.

Current selected work must be VF-7-05 with profile phase7_style_reviewed_publication_service and brief project-context/tasks/VF-7-05.md. Implement only that exact provider-free application-service slice: safely expose the immutable VF-7-04 NEEDS_REVIEW snapshot and publish the byte-identical canonical profile through authenticated actor scope, optimistic concurrency, exact lineage revalidation, atomic active-pointer movement, and replay-safe receipts.

Preserve all completed work:

- Phase 0A/0B/0C, Phase 1, and Phase 2 are complete and accepted. Do not redo the shell, ASR, scheduler, renderer, local output, durable control plane, timing, selected-span audio, restore, or Chrome workflow.
- All VF-1-06 corrective findings and VF-2-05 audit findings are closed.
- GATE_UI_001, GATE_LLM_001, and GATE_STYLE_001 are closed.
- VF-3-03/06/07/09 provider-free compiler/semantic/adapter work is green.
- VF-7-01 through VF-7-04 lifecycle, references, claimed analysis, and durable result acceptance are green.

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

VF-7-05 boundaries:

- Provider mode remains fixture.
- Provider calls: forbidden.
- Credential access/model download/GPU/RunPod/cloud/staging/deployment: forbidden.
- External spend: $0.
- No manual profile edits, routes, UI, uploads, previews, live analyzer, or unrelated refactors.
- Manual-edit analyzer-evidence transformation is explicitly unresolved. Do not guess or silently implement it.
- Use one integration owner; this task is serial because it may touch shared repository types/adapter, exports, evidence, and CURRENT_STATE.

Execution:

1. Run the narrow baseline first.
2. Implement VF-7-05 exactly with focused fresh/reopened PGlite tests.
3. Run targeted lint/typecheck/build/tests first.
4. Run TURBO_FORCE=true pnpm verify at the integration checkpoint; then pnpm context:validate, pnpm secret:scan, and git diff --check.
5. Make a small implementation commit, a separate evidence commit under evidence/acceptance/VF-7-05/style-reviewed-publication-service, and one context-handoff commit.
6. Update CURRENT_STATE.yaml with exact SHAs, test counts, evidence, server/provider/spend truth, and exactly one next dependency-ready brief.
7. Push the clean green commits to origin/main.

After VF-7-05, continue autonomously only when CURRENT_STATE selects another exact dependency-ready provider-free brief. Author only one next brief at a time from committed facts. The intended low-rework order is: reconcile manual-edit provenance; complete provider-free custom-style application service; metadata API; fixture/local UI and installed-Chrome workflow; local upload/normalization; then separately gated live analysis and optional previews. In parallel only where paths/interfaces are committed and disjoint, resolve Mage checkpoint/license evidence. Keep AvatarForcing stopped until its license contradiction is authoritatively resolved. Real image/avatar generation, RunPod lifecycle, staging, and production require exact selected authority/gates and must never be inferred from this prompt.

Stop and hand off on any missing/non-exact brief, unresolved dependency or normative ambiguity, regression, dirty unexplained worktree, credential requirement, provider call/spend, model download, GPU activation, cloud/account mutation, deployment, destructive action, or product/UI/output change. Production remains deferred.
```

The agent derives changing HEAD/profile/evidence details from `CURRENT_STATE.yaml`. If this template
ever disagrees with that file, stop and reconcile the template; never treat an older prompt as
authority over the current state.

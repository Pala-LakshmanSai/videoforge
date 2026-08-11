# New-chat bootstrap prompt

```text
Continue VideoForge in /Users/lakshmansai/Documents/videoforge.

Keep responses concise and spend-conscious. Focus on implementation and verification.

Startup:

1. Read AGENTS.md.
2. Read project-context/00_START_HERE.md.
3. Read project-context/MANIFEST.yaml.
4. Read project-context/CURRENT_STATE.yaml.
5. Run git status --short --branch and confirm clean HEAD descends from checkpoint 3168602.
6. Preserve every newer commit. Never reset or redo completed work.
7. Load only CURRENT_STATE.recommended_next_task, its named MANIFEST read profile, and exact brief.
   Do not run a new research pass or preload later profiles/briefs.

Selected task: VF-4-01 durable prompt store continuation.
Profile: phase4_durable_prompt_execution.
Brief: project-context/tasks/VF-4-01.md.

Finish migration 0009 and production-code PGlite PromptExecutionStore integration. Bind exact
revision/timeline/style/task/claimed-attempt/acknowledged-outbox/cost/prompt/hash/retry/telemetry
authority. Prove atomic acceptance, exact replay, conflicting replay rejection, fresh/upgrade/
reopen/restore, cancellation, stale claims, isolation, partial output, cost drift, rollback, and
zero outbound calls.

Preserve Phase 0A–2, accepted shell/output, VF-DX-01/02, VF-REL-01, VF-5-01, VF-4-01 foundation
fe07066, VF-7-07 foundation 4a4806d, and checkpoint 3168602. Provider mode stays fixture; provider
calls, credentials, downloads, GPU/RunPod, cloud/account mutation, push, deployment, and spend are
forbidden. Shared migrations/repositories/context are serial; do not edit VF-7-07 concurrently.

Use focused tests and verify:fast while developing. Before acceptance run forced full pnpm verify,
context/schema validation, secret scan, Prettier, dependency audit, and git diff --check. Commit one
small green VF-4-01 change, refresh CURRENT_STATE.yaml/evidence, and author exactly one successor
brief: VF-7-07 persistence continuation. Do not author later briefs.

Stop on dirty unexplained state, missing brief, context contradiction, regression, unresolved gate,
provider ambiguity, destructive migration, or new authority requirement.
```

If this template disagrees with `CURRENT_STATE.yaml`, stop and reconcile it; current state wins.

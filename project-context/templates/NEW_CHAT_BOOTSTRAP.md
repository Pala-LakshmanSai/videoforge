# New-chat bootstrap prompt

For the current handoff, the user only needs to send this one line in a new coding chat:

```text
Continue VideoForge from the fresh project context. Start with the exact recommended next task and complete it through a green committed handoff, then continue task-by-task through VF-2-05 while each refreshed CURRENT_STATE says the next exact brief is dependency-ready and provider-free. Preserve completed work and recorded ownership. Stop before any remote/cloud/account mutation, credential operation, provider call or spend, missing brief, unresolved dependency/gate, or authority beyond the standing local Phase 2 envelope.
```

The agent must derive the task ID, profile, brief, base/evidence commit, ownership, route, commands,
and budget from `CURRENT_STATE.yaml`; the user should not have to paste those fields again. The
standing authorization applies only to exact provider-free briefs through VF-2-05. It must finish
and record one green task/wave before loading the next profile; a planned provider cap is never an
active authorization.

Use the longer form below only when deliberately overriding the recommended task:

If the user simply says to begin/continue development without a narrower task, use
`CURRENT_STATE.yaml.recommended_next_task` and its task brief exactly; do not reopen accepted
UI/renderer/architecture decisions or skip dependencies.

```text
Work in /Users/lakshmansai/Documents/videoforge.

Before acting, read AGENTS.md, project-context/00_START_HERE.md, project-context/MANIFEST.yaml, and project-context/CURRENT_STATE.yaml. Then read the recommended task's one MANIFEST profile and exact task brief. Follow the documented authority precedence; treat approved decisions as fixed and open gates as unverified. Do not redo broad model/architecture research unless this task explicitly revisits a decision.

Task ID/milestone: <ID and dependency>
Task: <one concrete outcome>
Base commit/branch: <from CURRENT_STATE>
Owned files/modules: <scope and collision notes>

Acceptance: <describe what I should be able to see/do>
Live route/scenario: <http://localhost:4173/... and fixture ID>
Validation commands: <targeted commands>
Real provider calls authorized: NO
Maximum external spend: $0
Evidence path: <expected path>

Run git status first, preserve unrelated changes, then run pnpm doctor and pnpm dev:status. Reuse rather than duplicate the stable server; never silently choose another port or kill an unrelated process. Use pnpm dev:open for the exact route. Before editing, run the narrow baseline journey and inspect console/failed network requests; repeat it after the change. Preserve my in-progress draft across hot reload. Run pnpm verify before a small green commit and report evidence truthfully. If I approve a decision change, update and validate the context pack in the same change. Update CURRENT_STATE.yaml at handoff with the exact route, fixture, server owner/PID, commit, last green commands, and latest user checkpoint.
```

For planning/research-only work add: `Do not implement application code in this task.`

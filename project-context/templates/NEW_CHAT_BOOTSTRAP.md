# New-chat bootstrap prompt

Copy, fill the task, and send in a new coding chat:

If the user simply says to begin development without a narrower task, use `CURRENT_STATE.yaml.recommended_next_task` exactly and follow `21_IMPLEMENTATION_EXECUTION_PLAN.md`; do not reopen the accepted UI/architecture decisions or skip dependencies.

```text
Work in /Users/lakshmansai/Documents/videoforge.

Before acting, read AGENTS.md, project-context/00_START_HERE.md, project-context/MANIFEST.yaml, and project-context/CURRENT_STATE.yaml. Then read only one MANIFEST read profile relevant to this task. Follow the documented authority precedence; treat approved decisions as fixed and open gates as unverified. Do not redo broad model/architecture research unless this task explicitly revisits a decision.

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

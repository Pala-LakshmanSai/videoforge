# New-chat bootstrap prompt

For the current handoff, the user only needs to send this one line in a new coding chat:

```text
Continue VideoForge from the fresh project context. Preserve the completed green Phase 0–2 work and follow only CURRENT_STATE's exact recommended checkpoint. Do not implement application code yet. Complete the read-only VF-3-00 gate/freshness review, present the consolidated authorization choices, and stop before credentials, provider calls or spend, remote/cloud/account mutation, deployment, missing evidence/brief, unresolved gate, or new implementation authority.
```

The agent must derive the task ID, profile, brief, base/evidence commit, ownership, route, commands,
and budget from `CURRENT_STATE.yaml`; the user should not have to paste those fields again. The
standing provider-free authority through VF-2-05 is complete and exhausted. `VF-3-00` is
planning-only and prepares one explicit decision; the planned provider cap is not active authority.

Use the longer form below only when deliberately overriding the recommended task:

If the user simply says to begin/continue from fresh context without a narrower task, use
`CURRENT_STATE.yaml.recommended_next_task` and its task brief exactly. At this checkpoint that means
the read-only planning review, not Phase 3 implementation. Do not reopen accepted
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

# New-chat bootstrap prompt

```text
Continue VideoForge in /Users/lakshmansai/Documents/videoforge.

Keep responses concise and spend-conscious. Focus on implementation and verification.

Startup:

1. Read AGENTS.md.
2. Read project-context/00_START_HERE.md.
3. Read project-context/MANIFEST.yaml.
4. Read project-context/CURRENT_STATE.yaml.
5. Run git status --short --branch and confirm clean HEAD descends from implementation bbb0a48.
6. Preserve every newer commit. Never reset or redo completed work.
7. Load only CURRENT_STATE.recommended_next_task, its named MANIFEST read profile, and exact brief.
   Do not run a new research pass or preload later profiles/briefs.

Selected task: VF-5-02 durable Avatar fixture result acceptance.
Profile: phase5_avatar_result_acceptance.
Brief: project-context/tasks/VF-5-02.md.

Compose existing VF-5-01 fixture results into durable Avatar acceptance. Bind exact revision,
current timeline, Avatar version/source, selected span audio, task/attempt/outbox/callback/cost,
technical QA, one native clip, and both renderer layouts. Preserve explicit subjective review.

Preserve Phase 0A–2, accepted shell/output, VF-DX-01/02, VF-REL-01, VF-5-01, completed VF-4-01
`1fba04c`, VF-4-02 `bbb0a48`, and VF-7-07 `20fd592`. Provider mode stays fixture; provider calls,
credentials, downloads, GPU/RunPod, cloud/account mutation, push, deployment, and spend are
forbidden. Shared migrations/repositories/context are serial.

Use focused tests and verify:fast while developing. Before acceptance run forced full pnpm verify,
context/schema validation, secret scan, Prettier, dependency audit, and git diff --check. Commit one
small green VF-5-02 change, refresh CURRENT_STATE.yaml/evidence, and author exactly one successor
brief: VF-7-08. Do not author later briefs.

Stop on dirty unexplained state, missing brief, context contradiction, regression, unresolved gate,
provider ambiguity, destructive migration, or new authority requirement.
```

If this template disagrees with `CURRENT_STATE.yaml`, stop and reconcile it; current state wins.

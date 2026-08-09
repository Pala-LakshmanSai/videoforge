# Context maintenance protocol

Status: mandatory for future chats  
Read when: the user changes a requirement, a benchmark closes a gate, or implementation reality diverges from this pack.

## Purpose

This folder prevents every new chat from re-learning the project and prevents old decisions from remaining as hidden contradictions. It must stay compact, current, and traceable.

## Authority and conflict rule

Precedence is:

1. An explicit change in the current user's message.
2. `15_DECISIONS_AND_OPEN_GATES.md` for decision/status.
3. The primary domain file in the table below for normative behavior.
4. A versioned machine schema for exact field shape.
5. `14_TESTING_AND_ACCEPTANCE.md` for acceptance.

`MANIFEST.yaml` and `00_START_HERE.md` are derived index/summary files, not independent decision authorities. If any layer conflicts, stop the affected work and reconcile all copies in the same task; never silently pick the convenient statement.

## New-chat procedure

1. Open the repository root.
2. Read `AGENTS.md` or `CLAUDE.md`.
3. Read `project-context/00_START_HERE.md`, `MANIFEST.yaml`, and `CURRENT_STATE.yaml`.
4. Load only the task read profile.
5. Treat approved decisions as fixed and open gates in `GATES.yaml` as unverified.
6. Do not start implementation unless the current user request authorizes it.

Use `templates/NEW_CHAT_BOOTSTRAP.md` for a paste-ready prompt.

## When a decision changes

In the same commit/task:

1. Add or update its row in `15_DECISIONS_AND_OPEN_GATES.md`; mark the prior decision superseded rather than erasing history when useful.
2. Update `MANIFEST.yaml` approved decision/open gate.
3. Update the single primary domain file.
4. Update every directly affected cost, plan, contract, and acceptance file.
5. Update `00_START_HERE.md` only if the change affects the mandatory summary.
6. Add date, evidence, and user-approval note to the decision row or a concise changelog section.
7. Search the pack for the old term/number and remove contradictions.

Do not paste the same large explanation into multiple files. One file owns detail; others link and summarize.

## Domain ownership

| Change | Primary file | Usually also update |
|---|---|---|
| Product scope/input/output | `01_PRODUCT_REQUIREMENTS.md` | start, manifest, output, plan, tests |
| Video grammar/framing | `02_OUTPUT_VIDEO_SPEC.md` | forensics, scheduler, tests |
| Reference measurement | `03_REFERENCE_VIDEO_FORENSICS.md` | evidence JSON/CSV, output/scheduler if adopted |
| Prompt/style | `04_VISUAL_IDENTITY_AND_PROMPTS.md` | models, tests, cost if call volume changes |
| Image Styles Hub/reference analysis | `18_IMAGE_STYLES_HUB.md` | product, prompts, UI, architecture, contracts, models, cost, plan, tests, decisions |
| Avatar Hub/catalog/source lifecycle | `20_AVATAR_HUB.md` | product, UI, architecture, contracts, cost, plan, tests, decisions, machine fixtures |
| Avatar generation model/router | `08_MODELS_AND_PROVIDERS.md` | scheduler, RunPod operations, cost, tests, gates |
| UI/UX | `05_UI_UX_SPEC.md` | product, plan, Chrome tests |
| Tech stack/services | `06_SYSTEM_ARCHITECTURE.md` | operations, contracts, cost, plan |
| Pipeline/scheduler | `07_PIPELINE_AND_SCHEDULER.md` | contracts, tests, output |
| Model/provider | `08_MODELS_AND_PROVIDERS.md` | manifest, costs, plan, tests, decisions |
| RunPod/queue | `09_RUNPOD_AND_QUEUE_OPERATIONS.md` | architecture, contracts, tests, cost |
| Schema/API | `10_DATA_AND_API_CONTRACTS.md` | architecture, tests, implementation plan |
| Golden machine fixture | relevant file under `evidence/fixtures/` | owning schema, data/API contract, tests |
| Price/benchmark | `11_COST_SPEED_BUDGET.md` | decisions/gates, source index |
| Mutable implementation phase/handoff | `CURRENT_STATE.yaml` | root loaders, playbook; replace snapshot rather than append logs |
| Development experience/commands | `19_IMPLEMENTATION_PLAYBOOK.md` | plan, task template, Chrome tests |

## Closing a benchmark gate

Record:

- Date and account/region.
- Exact commit/container digest/model hash.
- GPU SKU/price.
- Cold and warm runs.
- Inputs/fixture IDs.
- Peak VRAM, wall time, outputs, retry/rejection.
- Cost per accepted unit.
- Raw evidence location.
- Pass/fail against `14_TESTING_AND_ACCEPTANCE.md`.

Then replace planning language with measured language. Never silently change a range into a fact.

Write gate evidence under `evidence/gates/{GATE_ID}/{run_id}/` using `templates/GATE_EVIDENCE.md`, then update `GATES.yaml`, the decision ledger, and affected planning numbers. A gate cannot close from chat prose or a screenshot alone.

## Source freshness

Pricing, model releases, provider schemas, licenses, free-tier quotas, and GPU availability are time-sensitive. Recheck official sources when implementing/integrating or when a figure is more than 30 days old. Store `checked_at` with runtime rate configurations.

Reference-video measurements and user-approved aesthetic decisions are relatively stable; do not re-download copyrighted videos unless a new audit is genuinely needed.

## Assets

- Keep only compact research stills/sheets, never full reference videos/VTT.
- Preserve source URL, timestamp, rights status, checksum.
- Third-party reference images remain local/private and git-ignored.
- These private files are `local_optional`: a fresh private clone/context validator must warn rather than fail when they are absent, and app builds/tests use owned/synthetic fixtures.
- Never treat historical screenshots as current decisions.
- If an asset is replaced, update its manifest/checksum and README.

## Implementation docs

When app code begins, follow `19_IMPLEMENTATION_PLAYBOOK.md`. Keep operational commands under the normal repository structure, but do not duplicate product truth. Code comments and READMEs should link to relevant decision/gate IDs. Update `CURRENT_STATE.yaml` after every accepted milestone/handoff; it is a replace-in-place snapshot, not a diary.

## Final consistency check

Before finishing a context update, run:

```bash
project-context/scripts/validate-context.sh
project-context/scripts/validate-schemas.sh
```

Then confirm:

```text
- Root loaders still point to the folder.
- MANIFEST parses.
- Every manifest path exists.
- Approved decisions have no contradictory active statement.
- Open gates remain labeled unverified.
- Links/assets exist and checksums match.
- No secret or model weight entered the pack.
- No application code was changed unless the user requested implementation.
- `CURRENT_STATE.yaml` reflects the real repository/server/task state.
- Gate IDs/status match `GATES.yaml` and their evidence pointers.
- Each read profile stays within the manifest word-budget target or documents why it cannot.
```

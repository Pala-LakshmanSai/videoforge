# Hand anatomy prevention

Checkpoint V2-09, branch `codex/seedance-video`. User authorizes prevention repair and production publication after two supplied tool-contact images show three hands without clear ownership. Baseline source `756d3f22` / Worker `502858ce` at 100%; publication pending.

## Cause and narrow prevention

Image-model anatomy failure is visible in the supplied images. Three saved production HANDS_ACTION provider prompts are 692, 698 and 722 characters; none contains anatomy, malformed-hands, duplicate-limbs or wrist-ownership guidance. Kie adds optional negative terms only below its 640-character target, while required scene/style/exclusions may reach 800. This proves a prompt-protection gap; it cannot establish the model's internal cause or a guaranteed failure rate.

Newly bound HANDS_ACTION Kie prompts now require: “Per person: two hands max, own wrists; simple grip.” This 49-character rule replaces Natural Documentary's equal-size role clause without reducing its existing scene/style/keyword allowance. Other styles include it as required positive text before optional negatives. It applies to full/split layouts and preserves necessary collaborators/actions; landscapes remain unchanged. The entire prompt set is validated before binding or scheduling. Already-bound prompts remain authoritative, including PREPARED rows, and uncertain/submitted work is never remapped or replayed.

Writer requests, adaptive batch hashes, compiler versions, published styles/profile hashes, accepted media and budgets remain unchanged. An initially considered compiler/writer revision was discarded locally because changing the prompt plan would invalidate older saved-run recovery. The final fix uses the existing exact provider-prompt binding seam and does not change the writer or regeneration path.

## Functional proof

- 77 focused web tests pass for Kie, actual project dispatch/binding, prompt orchestration and image regeneration. They cover mandatory anatomy when negatives do not fit, full/split exact 800/801 boundaries, untouched input components, collaborators/action retention, unchanged landscapes, exact saved PREPARED prompt reuse without compilation, unknown/submitted fences, invalid later-row no-binding and atomic binding failures.
- 211 pipeline tests pass with original writer/compiler/batch behavior. 20 durable/PGlite prompt tests pass, including reopened exact replay without a writer call, accepted old compiler bytes, cancellation/ownership/tampering/cost failures and migration restoration. Total308.
- Three real saved production prompt fixtures reproduce the old mapping exactly. The optional new mapping includes mandatory anatomy at the same 692/698/722 lengths and leaves compiled input bytes unchanged; no image request is made.
- Web/Worker TypeScript, changed-file lint and production/staging builds pass. Both bundle firewalls, context validation and secret scan pass; static closure ceilings and all quarantine checks are unchanged. Existing optional context warnings remain. Production publication readbacks follow.

Private source snapshot and build/test receipts live under `.videoforge/hand-anatomy-20261003/` in the primary checkout; do not publish private metadata.

## Limits and spend

No provider image-analysis call, automatic regeneration/retry, new project, inference, render or compute start/stop. Existing photos and videos are unchanged. This release is a prompt-level prevention fix with functional regression proof; fresh generated-image failure-rate reduction is unmeasured, and correct anatomy cannot be guaranteed by a prompt. Editorial, Local, long-film speed, billing and historical UNKNOWN gates remain separate.

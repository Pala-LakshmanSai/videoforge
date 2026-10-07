# V2-09 image text prevention — 2026-10-07

User scope: diagnose captions painted into generated images, repair shared causes with parallel agents, verify functionality and publish production. No new paid inference has been approved for qualification yet.

## Cause and scope

Saved Kie prompts contain standalone labeled action sentences. The rescue-worker caption exactly copies `Offers short-term assistance.`; the construction caption resembles `Is partly cleared for redevelopment.` Both prompts retained permanent no-text exclusions and were below 800 characters. File acceptance checks dimensions/checksums but no pixel content.

Fresh provider prompts must describe one physical photograph without caption-like field labels. Existing saved requests, paid task IDs, accepted artifacts and immutable styles remain exact. Initial generation and Fal regeneration share output validation.

Separate generated-image QA is being prepared locally using existing Runware image inference. It must bind a durable receipt to exact image checksum, distinguish rejected from unknown output, prevent repeated paid submissions and block acceptance without PASS when required. Reference style analysis remains explicit-only. API cost projection must include QA costs truthfully. No probabilistic model can guarantee perfect detection.

## Acceptance

- Exact observed prompt regressions; all scene/style/keyword/exclusion content preserved within provider budget.
- Both generation and regeneration, including already stored-byte recovery, enforce required QA.
- Native tenant and checksum boundaries, duplicate observers, ambiguous provider outcomes and actual cost projection tested.
- Existing paid tasks remain unreplayed; active video and compute lifecycle preserved.
- Production source/configuration and existing Workflow identities preserved; backend adoption only at safe idle boundary.
- Live QA qualification requires a separate finite spend proposal before calls or activation.

Current progress and final evidence live in CURRENT_STATE.yaml. Worktree base: 14c1907b3840b8e80dcc6c37897dbf5d29a0ea65. Private prompt evidence stays outside Git under the primary checkout .videoforge/image-no-text-20261007.

## Qualified release boundary

Web suite: 226 files, 3,284 passed, one skipped. Web/Worker TypeScript, changed-file ESLint, web/Cloudflare/staging builds, context validation, dispatch firewall and secret scan passed. Native migration 290 rehearsal rolled back fully with previous schema289, exact preimages and zero provider requests; native runtime role, tenant isolation, checksum matching, immutable receipts and policy downgrade guards passed. Metadata restore/migration hardening passed. Final schema inventory and metadata tests passed (six tests): portable QA receipts restore before accepted jobs and retain exact task identity, checksum, verdict and charge. Capability-written tables are checked for denied direct runtime DML.

The first live rollback rehearsal deadlocked while upgrading a SHARE ROW EXCLUSIVE lock during concurrent work; rollback was independently confirmed. The harness now takes ACCESS EXCLUSIVE at the start in fixed initial/regeneration order with a five-second lock timeout; the second rehearsal passed without modifying user work.

Production publication is authorized. Paid pixel QA remains disabled by default until explicit consent, live qualification and safe runtime adoption. The pending proposal permits eight checks of existing images under USD0.20, then one billed check for each future image; it authorizes no new image generation or automatic regeneration. Current accepted images and saved prompts remain unchanged.

## Published evidence

Production source3ce1bbd6 / Worker77d7ae03 at100%, native290 inactive defaults. See [acceptance](evidence/acceptance/VF-10-09/2026-10-07-image-no-text.md). Existing coordinator adoption, postrelease Chrome and paid QA approval/qualification remain open.

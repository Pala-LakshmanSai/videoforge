# Natural Documentary: evidence and production plan

## Implementation authority — 2026-10-02

The user explicitly authorized implementation and production, accepting best-effort same-model
improvements even though consistent reference parity is unproven. The failed F/N candidates remain
rejected; the new default uses complete compact wording anchored to A. Functional compatibility,
immutable history, no additional ordinary calls and production verification remain required.
This instruction supersedes the earlier mandatory visual-preference threshold for this release.
The narrow release uses an exact immutable default identity, with code/profile verification before
additive seeding and production activation; no separate feature-flag framework is introduced.

The sections below preserve the research rationale and originally proposed qualification gates.
Current implementation/publication status lives in `CURRENT_STATE.yaml`.

2026-10-02 · V2-09 / VF-10-09 · Audited HEAD `f9b9283ca662e73c0ba276741db22521c3b65357`.

**Research and isolated API testing are complete. A replacement aesthetic is not release-qualified.** Seven rounds produced 162 images with the configured Kie **z-image** API. Every task completed, submitted prompts/settings and original image hashes were reconciled, and actual usage was **129.6 credits**. No application implementation, production data mutation, default activation or deployment was performed. The checkout contains substantial unrelated changes; it must not be published wholesale.

The tests changed the recommendation: a stronger-sounding “raw documentary” suffix is not enough. Two promising presets lost their advantage outside the initial food examples. Preserve the strongest tested documentary baseline while fixing default selection, ambiguous scene descriptions and prompt delivery; qualify the combined result before activation. See [experiment results](EXPERIMENTS.md) and the private gallery referenced there.

## Objective and boundaries

Give all users an automatically selected, immutable **Natural Documentary** image style whose ordinary lighting, materials and texture approach the supplied references using the existing model. Keep explicit custom choices and existing projects pinned to their original versions.

Only AI still-image quality is in scope. Avatar appearance, quality, frequency and placement; scheduling, shot-role allocation, layouts, image count, zoom, timing, hard cuts, rendering, provider routing, retries, recovery and tenant protections remain unchanged. No new model, upscaler, grain filter, paid analyzer, automatic reranking or regeneration loop. No text, captions, graphics, borders or decorative transitions.

One-time experiments are separate from the requirement that comparable future videos cost no more. The user's explicit authorization covers isolated API experiments without another approval question. Further testing should answer a concrete unresolved question, not repeat adjectives until a flattering sample appears.

## What the references establish

[Ribs reference](https://www.youtube.com/watch?v=6-a3d0zuT54): 133 storyboard frames across approximately 21:52. [Seafood reference](https://www.youtube.com/watch?v=sBvVVSHU89Q): 161 frames across approximately 13:20. Selected frames were also inspected through browser playback at decoded 1920×1080. This is **294 full-timeline samples plus closer checks**, not continuous viewing or every decoded frame; downloads returned HTTP 403. Short intervening shots and fine texture in thumbnails remain limits.

The consistent qualities are functional viewpoints, useful surrounding context, available daylight or practical interior light, plausible color, irregular placement, and different materials responding differently to the same light. Wet fish, plastic and steel should retain local reflections; cloth, wood and flesh should not share a uniform glossy finish. Clean/new objects must remain clean/new. Darkness, blur, noise, sepia, dirt and universally matte surfaces are not substitutes for realism.

Reference people, scenes, brands, text and graphics are not assets to copy. No competitor model or generation method is inferred. Private visual evidence remains in `/Users/lakshmansai/.agent-reach/vf-ribs-style/` and `/Users/lakshmansai/.agent-reach/vf-seafood-style/`; rejected advertisement captures are excluded. Historical VideoForge Napa/China images informed diagnosis but are not today's controlled production baseline.

## What the experiments proved—and did not

The first six-image F pilot looked better than the historical repository default. Broader testing did not reproduce a universal gain. In the final canonical-role, 12-scene comparison:

| Treatment | Mean realism / 5 | Preference against A | Median paired change |
| --- | ---: | --- | ---: |
| A: historical repository documentary treatment | 3.67 | Baseline | — |
| F: compact ordinary documentary video treatment | 3.25 | 1 win, 5 ties, 6 losses | 0 |
| N: local-news photograph treatment | 3.58 | 2 wins, 6 ties, 4 losses | 0 |

Neither candidate passed the declared 9/12 preferences and +1 median improvement gate. Ties are not wins. The 229-character F profile in `candidate-profile.json` is a **retained failed qualification candidate**, not the production seed. Its schema/hash validation does not establish visual quality. No significant universal improvement or reference parity is claimed.

Adding material detail indiscriminately displaced faces; changing prompt order made framing worse. Simple objects, vegetation and some food scenes were credible; whole-fish anatomy, specific food cuts, multi-part mechanics, hand counts, cart scale and face framing were less dependable. These are observed task-specific tendencies, not an exhaustive model capability claim. Preserve assigned shots and narrated facts; clarify a part, size or contact where necessary instead of changing the scheduler or adding clutter.

The final 20 targeted probes informed scene wording, not release qualification. Scale wording corrected miniature carts, but the revised fish wording produced steaks instead of fillets. Valve contact remained unreliable. All four stream images lacked blank panels, including controls; that follow-up cannot establish a panel-prevention effect. Exact counts and residual failures are in the experiment report.

## Root causes and uncertainty

| Verified behavior | Responsible location | Consequence |
| --- | --- | --- |
| Hosted suffix derives from `visual_profile`, not legacy `positive_suffix` | `apps/web/src/server/hosted/hosted-prompt-run.ts:298`; `packages/control-plane/src/prompts/pglite-store.ts:105` | A suffix-only edit misses the main path. |
| Image treatment emits four traits, shortened to 112 characters each | `packages/pipeline/src/prompts/types.ts:208` | The 410-character default has incomplete clauses; dedicated texture/depth fields do not reach Kie. |
| Profile `planner_guidance` is not sent to the writer; material/human fields are absent from its style projection | `packages/pipeline/src/prompts/runware-deepseek-writer.ts` | Adding prose to those fields alone has no runtime effect. |
| Final content comes from subject/action/environment, not `prompt_core` or `lighting_context` | `packages/pipeline/src/prompts/compiler.ts:419` | Put supported physical facts in fields actually compiled; keep style in delivered treatment. |
| Core prompt has an 800-character bound; continuity/role and negatives use 640. Enabled keywords use 800 but failed additions are unchecked | `apps/web/src/server/providers/kie-image-job.ts:59` | Framing or enabled keywords can disappear; long valid scenes can fail. The old exact-string compactor misses the derived default. |
| Split guidance names a “narrow vertical right panel” | `packages/pipeline/src/prompts/compiler.ts:343` | One generated white panel was observed. Scene-geometry wording merits qualification; a small non-recurrence is not proof. |
| Create auto-selects only when exactly one style exists | `apps/web/src/hosted/HostedProductScreens.tsx:2630` | Publishing another style alone does not establish a default. |

Read-only catalog inspection found **zero active published SYSTEM styles**, four active published workspace styles, and no active exact match to the repository default fixture. One active workspace style matched the known high-fidelity landscape/high-noon-or-golden-hour pattern; that pattern forced unsuitable lighting in the diagnostic panel. This does **not** establish that affected projects used it. A is a historical repository baseline, not a verified currently selected production default.

Before attributing a particular video's look, join its pinned style/version/hash, writer output, submitted Kie string and retained image read-only. Establish deployed source identity; do not assume equality with this dirty checkout.

## Implementation, in order

### 1. Fix prompt delivery in isolation

Reuse the writer, compiler, provider builder and tests. Keep the tested subject → framing → style order. Reproduce long-scene, missing-role, missing-keyword and split-panel cases without providers first.

Protect subject identity, action, participants, era, role and crop ahead of optional material prose. Replace redundant writer instructions with precise physical-description guidance within the same call/schema. State ordinary scale, relation or touched part only when relevant and supported. A required face should not compete with an unnecessarily detailed shirt or bowl. Keep condition factual; never add damage or dirt for effect. `candidate-writer-guidance.txt` is an unqualified draft, not an active policy.

Describe one continuous image with important evidence inside the existing safe region; do not ask the model to draw a panel. Preserve actual renderer geometry and zoom. Test several split scenes and existing crop/zoom endpoints before accepting the wording.

Compute fixed prompt cost before the writer call: selected treatment, required role/continuity, crop, permanent exclusions, enabled keywords and separators. Allocate the remainder to scene fields. Three allowed 240-character fields cannot always fit under 800; do not pretend every schema-valid combination fits. Shorten duplicate soft instructions, not facts or explicit custom styles. Reject impossible fixed combinations before a paid writer call, with a useful reason. If output still exceeds the bound, preserve atomic batch/recovery behavior and classify the failure without an automatic paid rewrite.

Version changed writer/compiler/provider policy and persist exact submitted bytes. Accepted or ambiguous historical work keeps its bound identity; never rebuild/replay it under today's policy. Add no compactor service, extra LLM call or custom-style rewrite.

### 2. Qualify the full aesthetic, then freeze it

Anchor the next compact profile to A's tested editorial/location-photography treatment. Replace cut-off clauses with complete compact wording; do not assume an untested shortening is equivalent. Keep ordinary available light, useful context and scene-appropriate material response. Do not ship F or N merely because they sound closer to the request.

Test the **actual writer → style derivation → compiler → provider** path using saved narration and current role assignments. Manual literal inputs here isolate image-model behavior; they do not qualify automated scene writing. Freeze the next candidate and evaluation set before submission, retain every result and stop widening the search when gains do not generalize.

Use a fresh balanced panel covering reference food/material cases and unrelated domains: clean objects, vegetation, historical settings, practical/night light, people and simple hand contact. Include both unchanged layouts. Model, dimensions, facts and image counts stay equal. No seed is exposed, so these are randomized independent samples, not seed-matched pairs. Repeat difficult/borderline pairs in a predeclared block; never choose only the best repeat.

Keep the declared acceptance gate: preference in at least 9/12 scene pairs, median realism gain of at least 1/5, no aggregate fidelity/sharpness/crop regression, and no new forbidden-content or serious anatomy pattern. This is an operational gate, not statistical proof. Also assess closeness to the reference at native size and in the unchanged render, not merely improvement against a weak baseline. Retain the complete gallery for user inspection. If qualification fails, record it and keep existing qualified behavior.

### 3. Establish the explicit global default

Add one SYSTEM parent and immutable published version, working identity `natural_documentary_v1`, display name **Natural Documentary**. Compute its canonical hash after qualification. Keep `documentary_stock_v1` and all existing versions byte-for-byte unchanged. SYSTEM immutability in migration `0018` stays enabled; verify additive seed/active-pointer behavior through the current catalog/resolver.

Keep the new default ID unset during seed verification and the manually selected canary. Return `default_image_style_version_id` only after its activation value is explicitly set to the qualified, published SYSTEM version. Use one release-controlled ID, not a new feature-flag framework. Initialize empty Create selection from that identity and label it Default. Preserve explicit custom selection across refresh. Retain compatible one-option fallback where appropriate; never choose by `styles[0]` or alphabetical order.

Reuse global built-in read permissions, tenant snapshot materialization, hashes and revision pins. Users get the same built-in without analysis, preview charges or setup. Old projects, custom selections and regeneration retain saved versions and exact provider bindings.

### 4. Verify, publish and preserve rollback

Start from an isolated checkout of verified deployed source. Separate prompt-policy and catalog/seed changes for review. Update the decision ledger, `04_VISUAL_IDENTITY_AND_PROMPTS.md`, `18_IMAGE_STYLES_HUB.md`, task/manifest indexes and `CURRENT_STATE.yaml` when the actual default decision changes; this plan does not change it.

Extend existing tests for derived profiles, all roles/layouts, 799/800/801 boundaries, technical/long scenes, keywords, custom isolation, saved-prompt reuse and no replay. Catalog/Create tests cover multiple styles, unavailable default and preserved selection. Migration/RLS tests cover two-account built-in visibility, private isolation, unchanged historical pins/hashes. Run touched tests, typechecks, lint, bundle and context validation.

Verify real Chrome Create with several styles, switching, reload, preflight and persisted version readback. Exercise historical projects with fixtures. Deploy compatible catalog support with the new default ID unset, add the qualified immutable seed, and verify production identity/hash/RLS. Do not restart ongoing workflows.

Before global activation, manually select the new style for one ordinary canary and verify prompts, original images, billed usage and the existing render. Only after it passes, set the release-controlled default ID for fresh Create and verify automatic selection in real Chrome. Avatar settings and zoom remain unchanged; this is B-roll acceptance, not an avatar experiment or speed benchmark. Review subsequent normally requested jobs through existing logs; introduce no background paid jobs.

Rollback unsets/restores the release-controlled default ID and restores the prior future prompt policy. Keep new immutable versions and already pinned projects/media. Pending or ambiguous jobs retain their policy or reconcile safely; rollback never means reinterpreting or redispatching them.

## Cost, ownership and remaining gates

No extra image calls, resolution, analysis, retries, render work or provider changes per comparable video. Replace writer instructions instead of accumulating them. Compare actual input/output tokens, planned batches and reservations on representative narration, including long scenes/custom keywords. Fewer characters alone do not prove billed parity. Verify canary charges separately from the 129.6-credit research total.

Parallel ownership: one agent for prompt/compiler/provider policy and tests; one for catalog/Create/seed and tests; one for independent visual/contract review. Integrator owns context, deployed baseline, Chrome, accounting and release. Avoid shared-file overlap.

Completed: reference sampling, three-agent source audit, seven experiments, blind full-image reviews, exact provider reconciliation, unchanged-source/no-replay checks and this revised plan. Static crop/zoom proxies were inspected; they are not full rendered-video acceptance.

Remaining: affected-project provenance, exact production baseline, implementation, actual-writer visual qualification, cost parity, additive seed, Chrome canary, publication and rollback verification. **Production quality improvement is not yet delivered or claimed.** No new commit was made. Existing context validation has a pre-existing missing `evidence/acceptance/VF-10-09/2026-10-01-cloud-pay-per-use.json` reference and oversized-profile warnings; repair the release baseline without discarding unrelated work.

Provider handoff: 162/162 API tasks terminal, zero unresolved experiment tasks, 129.6 actual credits, no verified USD invoice. No Pods/endpoints/paid-compute resources started or mutated. Unrelated inventory was not refreshed, so this does not assert every existing resource is off. Project Memory maintenance results are recorded in `CURRENT_STATE.yaml`.

# V2-09: Runware GPT-6 Luna image-prompt writer migration

User authority, 2026-10-06: replace fresh image-prompt writing with exact GPT-6 Luna,
use multiple Luna workers, preserve functionality, and publish only a qualified result.
Use the existing Runware connection; no OpenAI key is needed. User authority covers qualification
and publication of a qualified result; production publication and Brave/Chrome readiness checks are complete; broad CI and visual/editorial gates remain.

## Current state: v38 qualified and Workflow runtime adoption verified

Executable eae84263703aa8900bf3aeca466bc90d53d03612 / Worker aa60628f-571d-4503-bef1-7ab31a314bc1 (100%) / native283 are live. Three existing Workflow versions are registered; the acknowledged restart, four successful zero-work ticks, DUE=0, and positive runtime readback verify adoption. Saved prompt/task/cost/API preimages remained exact; the historical FAILED attempt state and debit stayed unchanged. No new Workflow instance or paid create occurred; browser readiness, 36 public assets, and private401 passed.

Qualification is complete for 152 scenes under mixed provenance, with zero independent-review findings. The final-scene POST was USD0.000893; nine other rows were retained byte-exactly, recovery made zero HTTP calls, and its one-POST approval is used; no further test inference is authorized. The conservative bound is USD3.099707, including unresolved v34 HTTP 524 liability USD0.006429; never replay it. Hashes and full evidence are below.

Focused pipeline/web/native checks passed as listed below. Broad-CI workflow 37524446718 remains non-green (81 failed, 3,113 passed, one skipped); causes are classified. Full-film visual/editorial quality remains unverified.

## Workflow runtime adoption evidence

Target linkage is inferred from `activeWorker`/fixed binding because no API Worker pointer is exposed. Proof: `workflow-driver-promotion-proof-private.json`, SHA-256 `ef3a100135917db82615b01097bfca5f7c195891f7460f663b09d3ff7e4068fc`. Preserve uncertain receipts; never restart user jobs.

## Provider and request contract

Authenticated Runware modelSearch returns AIR `openai:gpt@6-luna`. Native `/v1`
textInference rejected that AIR with HTTP400 `invalidModel`; compatible
`/v1/chat/completions` returned HTTP200 with strict JSON, exact AIR, and zero reasoning in
the bounded canary. Public catalog and native endpoint availability are distinct.

Fresh plans use policy `runware-luna-grounded-v1`, candidate request
`runware-gpt-6-luna-prompt-request-v38`, model `openai:gpt@6-luna`, and profile8. The
Runware-compatible request uses a closed strict JSON schema and `reasoning_effort: low`,
and no undocumented native polling or idempotency assumption. Each response has exact
`batch_id` and scene IDs; each scene has exactly eight required keys: `scene_id`,
`literal_subject`, `action`, `environment`, `in_image_shot_role`, `lighting_context`,
`continuity_tags`, and `prompt_core`. The schema binds batch/scene IDs, role enums, and
non-empty literal fields. The Luna wire schema has no literal-field `maxLength` because the
provider was observed to truncate constrained outputs. Local validation still enforces base
ceilings of 240 characters each for subject/action/environment, 120 for lighting, 600 for
`prompt_core`, and at most 12 unique continuity tags of 80 characters each. Local
normalization, shape, text, per-field ceilings and geometry-expanded combined-character
checks remain mandatory.

The final compiled image prompt must fit the actual Kie 800-character ceiling. Fresh Luna
planning derives a literal budget by running the exact compiler and Kie builder against
the pinned style, layout, and shot role. Natural Documentary also retains its existing
more-conservative 169-character combined literal cap. The planner uses that per-scene
budget before any paid claim; legacy policy budgets and hashes remain unchanged.

The v38 source-priority rules compare `literal_subject`, `action`, and `environment` together, reject positively requested product-surface imagery, preserve explicit negation, and tell the model to omit depicted content rather than recreate it as a physical event. The historical v37 rejection and none-versus-low comparison are superseded. A package picture or conjectural product claim must not be promoted into a real event. Explicitly denied actions/actors remain denied; actual cooking/fire and real people remain valid when locally narrated.

Input planning uses the exact canonical request-byte estimator, with a Luna-specific
effective ceiling of 20,928 estimated tokens. This ensures the direct UTF-8 system/user
byte bound plus 6,144 reserved tokens is at most 48,000 before claim. A no-HTTP CJK
regression demonstrated the old mismatch: a planner-accepted single batch had a 65,953
transport bound. Luna now splits it; legacy's 48,000 planner cap is unchanged.

The compatible endpoint has no documented native task-UUID retrieval or idempotency
guarantee. Persist the exact submission receipt immediately after a valid response ID;
known-ID continuation retrieves only that ID, while an unknown POST remains UNKNOWN and
must never automatically POST again. For the verified cancellation/pending paths, safe
receipt recovery makes zero HTTP calls when there is no matching persisted receipt.
Existing Gemini v24-v32 sealed requests, task retrieval, accepted prefixes, and native
claims are preserved byte-for-byte.

## Costs, verification, and remaining gates

Pinned rates are input USD0.10/M tokens, cached input USD0.01/M, cache-write
USD0.125/M, output USD0.50/M, with integer-micro-USD rounding once. Reasoning is a subset of
completion usage and is charged once at the output rate. Estimates are not provider invoices.
The v37 none-versus-low comparison estimate was USD0.000751. The first-seven retest that exposed
the scanner self-companion had pinned estimate USD0.001703; the guarded seven-scene retest used
two posts with pinned estimate USD0.001876. Historical v34 saved-receipt estimate was USD0.017795
including rejected original batch 9.

The historical account readback at 19:53 UTC showed 120 Luna requests, USD0.121421 in Luna usage and
USD3.090390 cumulative provider usage. It predates the two-post guarded retest and is not current,
run-specific or an invoice. The conservative liability-inclusive cumulative bound is USD3.099707, including the unresolved v34 HTTP 524 maximum liability of USD0.006429 and known qualification estimates. Never replay the v34 request. The user total authority remains USD6. Both the original final-ten authority and the additional final-scene one-POST authority are consumed; no further test inference is authorized.

The accepted-record review originally qualified manifest `sha256:ad411a3e9ed286a630a9b3e9a5cbaad55f9484e6fe9e640f8a301d7440134ad0`. The final 195-file raw-byte source manifest is `sha256:ee54e65cd94a4a7dd223bb5e52506aa898ac7c41a6304f3f793491b119c69cae`; offline compiler/Kie validation passed for all 152 scenes across 16 batches with zero HTTP. Independent current-source review c909e4dff7c945fe8a0bf7c2e2d6a01147dc711540fd47c7cf1c77d6ae1e29f0 passed with zero findings and binds accepted records af040be63801ee9808a36efa11a2aba313995cef44568b8f67914612ae85a882 to ee54. Current scoped checks: pipeline323, shared Runware transport26, migration9, focused five-file web89, and stage-continuation-sweep32. The latest broad-CI workflow failed (81 failed, 3,113 passed, one skipped); failure causes are classified; broad CI is still non-green. These checks do not prove Workflow registration or idle-singleton adoption, long-form throughput, or whole-film visual/editorial acceptance.

The final-scene corrective POST passed at USD0.000893; its one-post USD0.01 authority is consumed. All 152 rows are service-accepted and independently reviewed with zero findings under mixed provenance. Existing Workflow adoption is verified. A historical STOPPING/UNKNOWN Cloud cleanup row changed during a scheduled heartbeat; the prior full row is unavailable, so exact delta and cleanup completion remain unverified. Old-project scope has no launch path; do not claim zero provider HTTP or fresh inventory. Stable identity and terminal attempt/cost projection audit: `workflow-legacy-cleanup-audit-private.json`, SHA-256 `69512c88a725a96c821d39b2aa18e1652b5d413e8fff7f85c5447ef98da001e3`. Broad CI remains non-green and full-film visual/editorial review remains open. No further test inference is authorized; never replay v34 HTTP 524.

Rollback for future plans: select the old provider/profile while retaining accepted Luna
results and additive schema. Never backfill or rewrite old paid requests. No project media, avatar, GPU rental, or full-film generation occurred in this
qualification. Automatic funding was not used.

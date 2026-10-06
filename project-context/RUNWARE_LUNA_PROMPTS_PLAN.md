# V2-09: Runware GPT-6 Luna image-prompt writer migration

User authority, 2026-10-06: replace fresh image-prompt writing with exact GPT-6 Luna,
use multiple Luna workers, preserve functionality, and publish only a qualified result.
Use the existing Runware connection; no OpenAI key is needed. User authority covers qualification
and publication of a qualified result; publication remains pending the gates below.

## Current state: v38 partial service qualification; quality and release remain blocked

Production remains executable69175135 / Worker453a1c95 / native282. V38 and Runware profile8
remain unpublished candidates. The first v38 full-stage run made 19 posts and service-accepted
142/152 rows. Its final batch left nine individually valid rows and one over-limit unresolved
scene; the approved final-ten one-post USD0.01 cap was consumed. Do not replay the unresolved v34
HTTP 524 or reuse the consumed final-ten authority.

Independent review found a same-object companion in accepted scene 6. The Luna-only validator
now compares the primary subject, static action actor and relational companion heads, rejecting
unsupported self-companions such as a scanner resting beside another scanner. It preserves
source-supported pairs, human-primary scenes, and object-primary scenes with a distinct human
actor. The v38 system/user request text and version did not change. With the guard, 135 existing
rows from batches 2–15 revalidated offline with zero HTTP; 18 eligible wire branches were
unchanged. A new first-seven service retest accepted all seven in two posts, with pinned estimate
USD0.001876. Independent review of those seven found zero findings, including the corrected
scene 6 scanner at the checkout lane. This is not a complete 152-scene review: current service
acceptance is 142 rows (135 revalidated plus seven regenerated), while batch 16 still has nine
individually valid rows and one over-limit scene. The all-152 independent review is incomplete.

The original final-ten approval has been consumed. One additional corrective POST for the
over-limit final scene is pending explicit human approval, capped at one POST and USD0.01; no
automatic correction is authorized. V38 is not fully qualified, profile8/native schema is not
published, and no production/browser acceptance is claimed.

The original v38 full-run source fingerprint was
`sha256:ab69f26a761fa08b0eef3ecee379987a9966b02c5f45baa1f8c1f596f0f98371`. The current 195-file
local source manifest after the validator guard is
`sha256:ad411a3e9ed286a630a9b3e9a5cbaad55f9484e6fe9e640f8a301d7440134ad0`. Earlier v38 dry-run
hashes predate the guard and are historical only. Current-source pipeline323 tests, build,
typecheck, lint, formatting and diff checks pass. Earlier web362, native32, and build/secret/graph
checks are separate prior evidence; broad CI, real-browser acceptance and full-film editorial
review remain open. No project media, avatar, GPU rental, or full-film generation is part of this
prompt qualification.

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

The v37 source-priority rules compare `literal_subject`, `action`, and `environment`
together, reject positively requested product-surface imagery, preserve explicit negation,
and tell the model to omit depicted content rather than recreate it as a physical event.
The v37 diagnostic rejection means the candidate is not qualified. The v37 none-versus-low
comparison supporting v38 does not close this gate. Do not claim the guard is qualified until an
actual v38 full run and independent review of all accepted tuples pass. A package
picture or conjectural product claim must not be promoted into a real event. Explicitly denied
actions/actors remain denied; actual cooking/fire and real people remain valid when locally
narrated.
The compiler owns no-text/no-graphics and physical framing; safe unmarked surfaces may
stand in for price/ingredient/label beats.

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

The latest account readback at 19:53 UTC showed 120 Luna requests, USD0.121421 in Luna usage and
USD3.090390 cumulative provider usage. It predates the two-post guarded retest and is not current,
run-specific or an invoice. The conservative liability-inclusive cost bound is now USD3.098814;
it includes the unresolved v34 HTTP 524 maximum liability of USD0.006429 and known qualification
estimates. Never replay the v34 request. The user total authority remains USD6, but the separate
one-post final-ten authority was consumed by the first v38 full run.

Current source has 195 files with raw-byte manifest
`sha256:ad411a3e9ed286a630a9b3e9a5cbaad55f9484e6fe9e640f8a301d7440134ad0`. Current-source
pipeline323 tests, build, typecheck, lint, formatting and diff checks pass. Earlier web362,
native32, and build/secret/graph checks remain prior scoped evidence, not broad-CI completion.
These checks do not close the incomplete full-152 independent review, one over-limit final scene,
native publication, browser acceptance, broad CI, long-form throughput, or whole-film visual/
editorial review.

One more corrective POST for the over-limit final scene requires explicit human approval, capped
at one POST and USD0.01; the consumed final-ten approval does not cover it. The service-accepted
rows are 135 previously accepted scenes revalidated offline plus seven regenerated scenes, whose
independent review found zero findings. Nine rows in the final batch are individually valid; do
not call all 152 accepted or reviewed. Stop on cap risk, uncertain submission or response identity
contradiction. Report account usage, pinned estimates, liability, media/GPU work and production
state separately.

Rollback for future plans: select the old provider/profile while retaining accepted Luna
results and additive schema. Never backfill or rewrite old paid requests. No project media, avatar, GPU rental, or full-film generation occurred in this
qualification. Automatic funding was not used.

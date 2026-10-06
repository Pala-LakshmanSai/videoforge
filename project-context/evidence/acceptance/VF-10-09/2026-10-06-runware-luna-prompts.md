# Runware GPT-6 Luna prompt-writer migration — 2026-10-06

## Status update — 2026-10-07

Production remains executable69175135 / Worker453a1c95 / native282. The first v38 full-stage
run made 19 posts and service-accepted 142/152 rows; batch 16 left nine individually valid rows
and one over-limit scene. The original final-ten one-post approval was consumed. Independent
review found an unsupported same-object companion in accepted scene 6. A prior first-seven retest
exposed the scanner case (pinned estimate USD0.001703).

The Luna-only static self-companion guard now compares primary subject/action/object heads and
does not change v38 wire text or request version. Under that guard, 135 prior rows from batches
2–15 revalidated offline with zero HTTP and 18 eligible wire branches remained unchanged. A new
first-seven service retest accepted all seven in two posts (pinned estimate USD0.001876). Its
independent review found zero findings across all seven, including the corrected scene 6 scanner
at the checkout lane. Current service acceptance is 142 rows (135 revalidated plus seven
regenerated); nine final-batch rows are individually valid and one over-limit scene remains. The
full 152-scene independent review is incomplete.

The current 195-file source manifest is
`sha256:ad411a3e9ed286a630a9b3e9a5cbaad55f9484e6fe9e640f8a301d7440134ad0`; the original full-run
source fingerprint was `sha256:ab69f26a761fa08b0eef3ecee379987a9966b02c5f45baa1f8c1f596f0f98371`.
Earlier dry-run hashes predate the static self-companion guard. Current-source pipeline323 tests,
build, typecheck, lint, formatting and diff checks pass. Earlier web362, native32 and
build/secret/graph checks are scoped prior evidence, not broad-CI completion.

The latest account readback at 19:53 UTC showed 120 Luna requests/USD0.121421 and cumulative
provider usage USD3.090390; it predates the two-post retest and is not a current readback, invoice
or run-specific cost. The current conservative liability-inclusive bound is USD3.098814,
including unresolved v34 HTTP 524 maximum liability USD0.006429. Never replay that request. The
final-ten cap has been consumed; one further corrective POST for the last scene requires explicit
human approval, capped at one POST and USD0.01. Full qualification, native publication, browser
acceptance, broad CI, and full-film review are not claimed.

## Historical v34 decision snapshot

The status update above supersedes this snapshot for current candidate, cost and release state.

Status: `RELEASE_VERIFICATION_BLOCKED_PROVIDER_524_142_OF_152`. The v34 candidate has
partial saved proof only; it is not production-qualified or published. Production stays
executable69175135 / Worker453a1c95 / native282. Candidate profile8 and migration0283 are
not deployed. The candidate source manifest hash was
`sha256:cd11cc3d209ecee0ef9f141178a62810306bb656a4fcc1a4a5f81b0ab6892ddc`.

The v34 stage run durably accepted 142 of 152 scenes in 15 batches. The stopped runner
record counted 17 inference POSTs but has no safe receipt for the unresolved request;
that identity must not be replayed. The saved stop envelope labeled `response_body_invalid`,
and the provider returned HTTP 524 without a safe response receipt. The saved label does
not prove malformed JSON. The unresolved maximum liability is USD0.006429, not confirmed provider spend. The run's saved-receipt pinned-rate estimate is USD0.017795, including rejected original
batch 9. Runware's date/account usage readback shows 71 Luna requests and USD0.072169, an account-wide aggregate not attributable
to this run alone. Cumulative provider usage readback is USD3.041138 (not an invoice); the conservative
cumulative bound is USD3.047637 including the unresolved maximum liability. The user's approved additional
USD0.01 final-ten verification cap remains unused; no manual final-ten POST occurred.
A fresh v35 full-stage qualification is planned under the existing USD6 authority after
the guard and review are corrected. The separately approved final-ten cap is USD0.01 and
remains unused. No further request begins until the source
guard and reviewer gaps are resolved.

Independent editorial review for the accepted v34 tuples is incomplete. It found a
cross-field conflict: an unmarked-bottle subject paired with an action that puts a smoker
illustration on the bottle. The earlier offline 152-scene audit also flagged ordinal073
as a possible transfer of pictured smoke into a real fire-smoked food scene. A cross-field
guard correction and a complete zero-finding review are required before qualification.
No final zero-finding report exists; independent review and fresh full-stage v35 qualification
remain pending. The separately approved USD0.01 final-ten cap remains unused.

## Current candidate request and validation contract

Runware authenticated modelSearch exposes `openai:gpt@6-luna`. Native `/v1` textInference
returned HTTP400 `invalidModel`; compatible `/v1/chat/completions` returned HTTP200 with
exact AIR, strict JSON, and zero reasoning in the bounded canary. Catalog presence does
not establish native endpoint support. Use the existing Runware connection; no direct
OpenAI credential is used.

Fresh policy `runware-luna-grounded-v1` uses request v38 and Runware profile8. The v38
request was submitted in the partial full-stage run; the sealed request uses
`reasoning_effort: low`, JSON-schema structured output, and an output cap of 6,144. Its closed
schema requires `batch_id` and an ordered scene array. Each scene has exactly eight required
fields: `scene_id`, `literal_subject`,
`action`, `environment`, `in_image_shot_role`, `lighting_context`, `continuity_tags`, and
`prompt_core`. IDs bind to the request; shot roles use the six-enum contract. The strict schema
requires non-empty literal fields and omits literal-field `maxLength` because constrained
outputs were observed to truncate. Local validation enforces 240 characters each for subject,
action and environment, 120 for
lighting, 600 for `prompt_core`, and up to 12 unique continuity tags of 80 characters
each, plus normalized output.

The compiled prompt must fit Kie's 800-character input maximum. New Luna planning runs the
actual compiler and Kie prompt builder to derive a safe combined literal budget for each
role/layout/style; Natural Documentary keeps its smaller existing 169-character limit.
This rule applies before provider claim and preserves existing style and crop guidance.

An accepted v38 tuple exposed a cross-field gap: a same-object companion was described as a
second object in the action. The current Luna-only guard compares primary subject, action actor
and relational object heads using existing token morphology; it does not use a fixed container
catalog and does not alter request text/version. It rejects unsupported static self-companions,
while preserving source-supported pairs, human-primary scenes and object-primary scenes with a
distinct human actor. The first seven replacement outputs passed service validation and
independent review with zero findings. The other 135 rows in batches 2–15 revalidated locally
with zero HTTP; this is validator evidence, not an independent visual review. A complete
all-152 independent review remains open. The policy rejects text-bearing or drawn product
content and pictured/conjectural events promoted into real events. It preserves explicit
negation. Literal fields are authoritative; `prompt_core` cannot bypass them.

The pipeline previously allowed a Luna batch whose canonical request estimate fit the
48,000-token ceiling while the transport's UTF-8 system/user bound plus 6,144 reserve
exceeded it. The provider-free CJK vector measured 65,953 for a batch the old planner
accepted. The planner now caps its existing estimator at
`floor((48,000 - 6,144) / 2) = 20,928` for Luna only and splits before claim; legacy stays
at 48,000. The focused regression checks the old mismatch and that every new split stays
under the exact pre-POST byte bound.

The compatible API documents no native task-UUID retrieval or idempotency guarantee.
Save a successful response ID immediately. Continuation retrieves only a persisted,
identity-matched receipt; a lost POST stays UNKNOWN and is never automatically replayed.
No matching saved receipt makes safe recovery perform zero HTTP calls. Gemini request
versions v24-v32, old claims/retrieval, accepted prefixes, and legacy plan hashes remain
unchanged.

## Costs and scoped validation

Pinned estimate rates: input USD0.10/M tokens, cached input USD0.01/M, cache-write
USD0.125/M, and output USD0.50/M, calculated with integer micro-USD rounding. These are
estimates, not provider invoices. The bounded canary reported 57 input / 16 output tokens
and zero reasoning; provider usage was USD0.000013 versus a USD0.000014 pinned estimate.
The v37 none-versus-low private comparison supporting v38 had a USD0.000751 pinned estimate;
reasoning was 375 of 599 output tokens and was charged once within output. The v34 accepted
142-scene pinned estimate and historical Runware account readbacks are distinct figures above.

The latest account readback at 19:53 UTC showed 120 Luna requests/USD0.121421 and cumulative
provider usage USD3.090390; it predates the two-post seven-scene retest and is not a current
readback, invoice or run-specific cost. The pinned estimate for the retest is USD0.001876. The
current conservative liability-inclusive bound is USD3.098814, including the unresolved v34
HTTP 524 maximum liability USD0.006429. Never replay that request.

Current-source pipeline tests passed 323/323 with build, typecheck, lint, format and diff checks.
Earlier web362, native32, and build/secret/graph checks are prior scoped evidence, not broad-CI
completion after the latest guard. The current 195-file local source manifest is
`sha256:ad411a3e9ed286a630a9b3e9a5cbaad55f9484e6fe9e640f8a301d7440134ad0`; the original full-run
fingerprint and pre-guard dry-run hashes are historical. The remaining over-limit scene, full
152-row independent review, native publication, real-browser acceptance, broad CI, long-form
throughput, and whole-film visual/editorial review remain open. The original final-ten one-post
approval was consumed; another one-post USD0.01 correction requires explicit human approval.
No project media, avatar, GPU rental, or full-film generation was run.

Private, restricted evidence is under
`.videoforge/luna-runware-20261006/qualification-v38/` and its first-seven review record;
this public record
contains no credentials or customer payloads. Full project context and resume conditions
are in `RUNWARE_LUNA_PROMPTS_PLAN.md` and `CURRENT_STATE.yaml`.

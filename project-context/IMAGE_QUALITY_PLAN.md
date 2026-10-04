# Image anatomy and subject-presence prevention

Checkpoint V2-09 / VF-10-09, 4 October 2026. User requests diagnosis, isolated API testing, prevention for future videos, and a tested path through production deployment. Work starts from `ac1323b5`, preserving current production and unrelated checkout changes. The finite investigation ceiling is USD 5: USD 4 reserved for at most 80 Kie images at a conservative USD 0.05 per call, and USD 1 for text/vision qualification. No GPU or retained storage allocation.

## Confirmed causes

The source project contains 380 bound Kie prompts, including 12 generic normalization fallbacks. The screenshot's hand scene originally asked for hands pointing at a blueprint. The permanent no-graphics validator correctly rejects blueprints, but advisory normalization replaced the entire action with `depicting the narration-supported visible moment` and accepted it. The remaining image description has hands without a meaningful action or object. The actual bound Kie request already contains the 3 October hand-count/wrist rule; its presence did not prevent three hands. The gallery displays the compiled prompt, which differs from the actual compact provider request.

The car-trunk scene is REACTION_RESULT, so the HANDS_ACTION-only safeguard does not apply. Its literal subject says a person is packing a trunk, but neither person placement nor a view showing the body is defined. The model can frame the trunk with a disconnected or concealed person. These are observed input/output associations, not access to the model's internal reasoning.

The hand scene has an upstream mismatch too: `shotRoleFor` selected HANDS_ACTION from a seeded six-role rotation when its homeowner/developer narration had no lexical role match. The writer must echo that role and was instructed to invent a hand-object contact despite an abstract blame statement. A new scheduler policy must make hand-action roles eligible only for supported physical activity; changing writer wording alone leaves this pressure in place.

## Release 1: stop accepting missing scene meaning

Reject required subject/action/environment fields that are empty, generic placeholders, or forbidden content. Preserve harmless normalization, audit-only lighting and compatibility-only prompt_core handling. Keep exact writer request bytes, task UUIDs, versions, style hashes and accepted saved scenes unchanged. The existing durable invalid-result path verifies the terminal response and known charge, permits at most one distinct replacement within its existing reservation, and stops after another failure. Never silently invent an action or replay uncertain paid work.

Prove blueprint/action rejection, placeholder rejection, valid hands and collaborators, exact saved-prefix recovery, one-replacement limit, known-cost accounting, no replay on uncertainty, private ownership, current app builds and real Chrome readback. Publish this safeguard only when those checks pass. It prevents this confirmed sanitizer failure; it does not certify image anatomy.

## Framing qualification

Freeze V2–V5 schedules and legacy writer v24/v25 request bytes. Fresh-only V6/V7 retain their V2/V5 parent's timing/segment-ID seed namespace while filtering unsupported hand roles. A new writer request policy supplies explicit physical placement for whole-person actions, retaining legitimate hand closeups and collaborators. Reconstruct saved prompt plans against exact supported policy hashes before recovering any request; never default an existing plan to new wording. Verify old request/plan hashes, saved-prefix recovery and unknown-no-replay before publication.

Use the exact two bound provider prompts as the initial baseline. Compare repeated isolated generations with a compact body rule and concrete narration-related scene descriptions. Keep model, aspect ratio, safety setting and pinned style constant; separately label variants that intentionally rewrite scene content. Grade extra/missing limbs, connected ownership, visible required subject, action, relevance, text, and crop suitability. Include collaborators, ordinary hand work, non-human controls, and full/split layouts before promoting a general policy.

A 24-image initial study uses three variants and four repetitions for each source scene. A second 16-image study tests medium side views and rear views. A third 32-image study uses eight authored narration cases, actual legacy/v26 writer outputs and two image repetitions; role changes in that harness are explicitly selected test inputs, not a full fresh-video scheduler run. The final eight images use four actual v27 writer outputs with two repetitions. v26 did not reliably emit body placement, so it is not the fresh default; v27 emitted explicit placement for all three tested whole-person actions while keeping the jar closeup. Small samples establish failure examples and candidate behavior, not a universal defect rate. No framing variant is eligible merely because its text passes unit tests. Do not reduce a group to one person or erase a narrated precise action to make anatomy easier.

## Release 2: versioned prompt-input improvements

V6/V7 apply an eligibility filter to the old role candidate; they never change a non-HANDS role into HANDS. v27 explicitly requires visible torso/connected arms in the subject and person/object position plus camera side in the environment for whole-person handling actions. The v26 experiment remains frozen for recovery identity, but new runs select v27. Legacy low-level builders stay default-legacy; hosted fresh preparation selects the new policy, seals its hash, and saved recovery selects the exact matching policy.

The final trunk outputs show connected bodies; collaborators remain two people. The jar control still produced a third hand in one of two outputs, and door framing still tended toward the arm/edge of the torso. This supports a bounded input-framing improvement, not complete image-quality acceptance or a defect-free claim. Keep permanent manual output review and the explicit remaining gate below.

## Output-quality gate: qualify before activation

PNG/JPEG structure, dimensions, SHA-256 and R2 readback currently precede acceptance; they do not test visible anatomy or subject presence. A visual gate must complete before `videoforge_commit_hosted_api_output`, because that commit releases both scene-video and final-render dependencies.

Calibrate a versioned vision reviewer against manually labeled positives, known defective source/probe images and difficult legitimate occlusions/collaborators. Separate anatomy, required subject, action/relevance and output-grammar verdicts. An unavailable or uncertain reviewer must not approve an image. Measure false acceptance and false rejection; avoid promising perfect detection.

After calibration, add tenant-private immutable candidate and review attempts with exact image hash, prompt hash, model/policy, claim, provider task identity, verdict and cost. Claim before inference. Persist raw result and parsed verdict; reconcile unknown tasks read-only, never repeat a paid POST. Store each candidate under a distinct immutable key. Permit at most one corrected second candidate after a definite visual rejection, then stop the scene for review. The correction must retain narration and participants. Do not mark a failed image accepted, silently substitute unrelated imagery, overwrite prior media, or release Seedance/render until a candidate passes.

Pin the gate policy for newly created runs; historical accepted assets, active attempts and exports retain their original policy. Enforce the acceptance barrier in Postgres as well as the worker, with RLS, cancellation, concurrent observer, callback, backup/restore, no-replay, budget and rollback tests. Publish migration then app in a disabled state, qualify a bounded fresh canary, then activate only the calibrated policy. Verify real Chrome image review, scene-video handoff, final playback/download and per-call cost. A source-only detector or short fixture is not production acceptance.

## Qualification stop conditions and release order

The expanded review experiment rejected plausible occluded hands and small pointing fingers. Do not activate this candidate reviewer based on the earlier eight selected successes. Improve and retest on a separate, independently labeled corpus covering varied human actions, valid closeups, collaborators and occlusions before implementing a production acceptance policy. Exact disagreements and reported costs are retained with the private experiment evidence.

Then implement candidate/review persistence and the SQL acceptance barrier, with one bounded corrective candidate and exact-cost reconciliation; test the entire rejection-to-repair path. The existing manual Fal regeneration button requires an already accepted source and cannot repair an unaccepted quality-rejected image. A stop-only gate that strands whole videos is not the intended final design. New image-review costs must enter preflight estimates and project accounting. Activate only after a real fresh canary demonstrates bad-image rejection, successful corrected acceptance, downstream video exclusion, cancellation, and final playback. Keep old accepted jobs and active videos under their pinned original policy.

The independently verified required-facts fix was released first at e5568ca2 / Worker d0ab6aa9. Release the versioned scheduler/writer input improvements only after legacy identity, recovery, build and browser checks pass. Neither release implements or activates the proposed output-review gate. No schema migration is needed for these input safeguards.

## Handoff

Input safeguards published at source `75a002be` / Worker `c28499c3` at 100% traffic. The first sanitizer release was `e5568ca2` / Worker `d0ab6aa9`. Both builds, 226 focused follow-up checks, independent review, exact 38 archived request rebuilds, 380 saved image inputs, 30 public assets and signed-in Chrome readback pass. No migration or GPU rental was required. All 123 isolated provider tasks are reconciled, estimated USD 0.457601. Existing user video completion is compatibility evidence, not a fresh new-policy full-video run. Automatic visual acceptance/repair remains unimplemented and unqualified.

Current status, exact source/deployment, evidence, provider charges and remaining gates belong in `CURRENT_STATE.yaml` and the dated acceptance report. Retain all experiment task identities and reconcile every task; do not attribute other active user generation to this experiment's spend. No GPUs are created by these tests.

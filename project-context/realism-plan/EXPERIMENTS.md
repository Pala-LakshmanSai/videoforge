# Isolated z-image experiments — 2026-10-02

**162 original images, seven rounds, 129.6 actual Kie credits. Neither final aesthetic candidate qualified.** All originals, exact prompts and failures are retained. Production was not changed.

[Open the complete local gallery](/Users/lakshmansai/Documents/videoforge/.videoforge/quality-review/2026-10-02-zimage/gallery.html). It includes the final A/F/N comparison, targeted follow-ups, all 162 originals, exact prompts and independent review notes. Image/prompt checksums and links were checked; browser rendering was not verified because the browser disallowed local-file navigation. The HTML uses only native controls and inline JavaScript, with no remote assets or API calls.

## Method and accounting

- Configured Kie API, current `z-image`, 16:9, NSFW checker enabled; every original was 1280×720. No upscaling, retouching, alternative model or seed control.
- Reused repository compiler, treatment derivation, provider prompt builder/client and durable submission helper. Root alone submitted paid work, maximum two concurrent tasks; reviewers made no submissions.
- Journal persisted before submission; known tasks polled without replay. Ambiguous submissions would stop generation. No ambiguous or unfinished experiment tasks remained.
- Provider `recordInfo` readback matched every exact prompt hash, model and settings; every downloaded original matched its saved SHA-256. All 162 tasks reported success at **0.8 credits each**. Balance 8939.77 → 8810.17, exactly matching **129.6 credits**. No USD invoice claim.
- Reviewers inspected every original through opaque randomized aliases before decoding. Full-resolution checks were necessary: a plausible fish thumbnail concealed duplicate-head anatomy. Different panels used different reviewers; cross-panel mean scores are descriptive, not pooled inferential statistics.
- No app/DB/deployment changes, Pods, GPU endpoints or other paid-compute resources. The five audited source/fixture hashes remained unchanged. No claim about unrelated provider inventory.

Private root: `/Users/lakshmansai/Documents/videoforge/.videoforge/quality-review/2026-10-02-zimage/`. Manifests are `round1.json` through `round7.json`; provider state/URLs remain private. `final-accounting.json` and four `reconciled-*.json` reports contain the cost/identity results. No credentials are stored in the artifacts.

## Experiment sequence

| Round | New images | Question | Result and decision |
| --- | ---: | --- | --- |
| 1 | 36 | Three food/worker scenes × six treatments × two outputs | Historical A mean 3.0; exploratory F mean 4.0. F looked promising on six images. Initial B/D variants had anatomy/framing defects. Proceeded to challenge it rather than declare a winner. |
| 2 | 18 | Same themes: generic vs material detail vs material plus setting | Generic 3.5; both detailed arms 3.0. Four of six workers in detailed arms lost their heads. Reject blanket material padding. |
| 3 | 16 | Two scenes × four capture-medium phrases × two | Local-news phrase 4.0 versus ordinary documentary 3.5, phone 3.5, home-video 3.25. Head crops and one black border persisted in other arms. Local-news became a finalist, not a qualified default. |
| 4 | 12 | Two scenes × existing order, style-first, label-free × two | Existing order 4.0 with no hard defects; alternatives 3.25/3.5 with framing/text concerns. Keep assembly order. |
| 5 | 36 | Twelve new cross-domain scenes × A, compact F, landscape diagnostic L | A 4.0, F 3.75, L 3.0 under this reviewer. L incorrectly imposed sun/golden-hour lighting. F had contact/scale/fidelity problems. Canonical-role confirmation followed. |
| 6 | 24 | Fresh canonical F/N across the 12 scenes; reuse 12 exact-byte-equivalent A outputs | Final 36-image review: A 3.67, F 3.25, N 3.58. F 1 win/5 ties/6 losses; N 2 wins/6 ties/4 losses. Median paired improvement 0 for both. Both fail. |
| 7 | 20 | Five observed failure cases × old/precise wording × two | Scale improved, fish wording regressed, valve grip remained uncertain, worker composition worsened; stream tied. Targeted semantic refinement is conditional, not a universal realism upgrade. |

Total: 36 + 18 + 16 + 12 + 36 + 24 + 20 = **162**. Reused A outputs and crop proxies did not incur additional generation calls. Variant letters are round-specific; round 1 F is exploratory prose, while later F is a four-field derived treatment. Do not combine their scores as one identical policy.

## Final aesthetic comparison

The common 12 scenes were a new steel/glass kettle, cooked ribs, fish fillets, historical woodworking, a clean laboratory, cabbage/dew, practical-light night kitchen, hand sanding, partly served stew, woodland stream, irrigation valve and overcast vineyard. Six used full-frame and six split-image prompts. All API originals remained 16:9.

| Finalist | Wins / ties / losses vs A | Mean realism / 5 | Median paired difference | Pass 9/12 and +1 median? |
| --- | --- | ---: | ---: | --- |
| F: ordinary documentary video | 1 / 5 / 6 | 3.25 | 0 | No |
| N: local-news field photograph | 2 / 6 / 4 | 3.58 | 0 | No |

Baseline A mean 3.67. F won only the night scene; N won night and fillets. Do not choose the best treatment per scene after seeing outputs, or reinterpret ties as wins. All three laboratory outputs had implausibly miniature carts. F added a second hand in sanding/valve scenes and a large white panel in the stream. N reduced some failures but lost on cooked ribs, historical work, laboratory and stew. No universal or statistically established quality gain.

F's delivered treatment, 229 characters:

```text
medium: ordinary documentary video frame; realism: unretouched, natural material variation; viewpoint: working-angle view, useful context, natural spacing; lighting: available light, scene-appropriate color, localized reflections
```

The retained `candidate-profile.json` has canonical hash `sha256:8276b06d42e85899a6f20d78e2613063f611e5b003e6fc90ba5eb6e0de605cc7`. Its four delivered traits were tested; its unused profile fields and proposed writer guidance were not production-qualified. Preserve this file as research evidence, not an active default. N changed the medium to a candid local-news field photograph, keeping the other traits.

## Targeted follow-up: decoded results

Every arm had two independent samples; this is development evidence, not statistical proof.

| Case | Existing wording C | Clarified wording P | Decision |
| --- | --- | --- | --- |
| Fillets | 2/2 recognizable fillets | 2/2 bone-in cross-cut steaks | Reject the added “flat cuts of fish flesh” wording. More words made identity worse. |
| Laboratory | 2/2 miniature carts | 2/2 plausible full-size trolleys; 1/2 jars open despite sealed requirement | Scale/relationship anchoring helps this case; retain closure fidelity as unresolved. |
| Valve | 2/2 images show two hands | One hand in both, but ambiguous fist/hub contact instead of clear rim grip | Hand count improved; action/contact not qualified. |
| Worker | Full heads, better face and bowl visibility | Full heads but downward faces/bowls close to bottom edge | Keep existing wording on this evidence. |
| Stream | 2/2 full scenes, no blank panel | 2/2 full scenes, no blank panel | No difference established. Geometry wording remains a hypothesis requiring broader crop tests. |

C won two scene preferences, P two, one tied. Hard defects: C 4/10, P 3/10, plus two unresolved P valve-action concerns. Material and lighting quality were effectively tied. These results reject a blanket precision/material expansion as the default writer policy; use supported relations only where a concrete ambiguity needs resolution.

## Limits that must survive the handoff

1. Baseline A is the historical repository fixture treatment. Read-only production aggregates found no active SYSTEM default and no active exact fixture match; affected-project style provenance is still unresolved. L is a diagnostic known profile pattern, not proof it generated the user's videos.
2. Rounds 1–5 used descriptive role aliases for some manually constructed compiler calls. Round 6 corrected to canonical enum roles. A's 12 provider prompt strings were asserted byte-identical under canonical roles before reuse. Early rounds do not prove validated application flow.
3. Manual literal inputs bypassed the automated writer. Actual writer integration, profile delivery, prompt budgets and normal production persistence remain qualification gates. No source deployed identity was inferred from the local checkout.
4. Some early style changes altered which optional clauses fit under the 640-character target. These are actual whole-prompt comparisons, not pure one-word causal ablations. Later medium/order experiments controlled those additions.
5. No seed is exposed. One output per final scene/candidate is noisy; the operational gate failed nonetheless. The two-sample targeted repairs reused observed failures and are not held-out validation.
6. Full-resolution original review plus static existing-renderer crop/zoom proxies is not full video acceptance. Proxy factors came from current `_zoom_delta`; no renderer settings changed. Further proof must use the actual unchanged render.
7. The references were sampled across both complete timelines, with selected 1080p playback checks. They were not continuously watched frame by frame. No precise claim about competitor source technology, authentic footage or model quality ceiling follows.

## Runnable local checks

From the repository root, the existing private harness supports:

```sh
./apps/web/node_modules/.bin/tsx .videoforge/quality-review/2026-10-02-zimage/experiment.ts selfcheck
python3 .videoforge/quality-review/2026-10-02-zimage/build-gallery.py
```

The self-check verifies baseline prompt identity, durable duplicate prevention and ambiguous-submit fencing without paid calls. Gallery rebuilding verifies all prompt/image hashes and relative original links. `reconcile.mjs` performs read-only provider task verification; it does not submit images. Do not invoke `run` merely to review results.

Proceed using [the production plan](PLAN.md). Stronger default selection plus faithful, complete prompt delivery is the next implementation target; a universal aesthetic improvement remains an open visual gate.
